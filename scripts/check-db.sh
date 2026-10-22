#!/usr/bin/env bash
# اختبار ترحيل المشرف ومهلة الحذف على قاعدة محلية مؤقتة ببنية الإنتاج.
# لا يتصل بأي قاعدة خارجية. يحتاج Postgres محليًّا (initdb/pg_ctl) وحساب نظام postgres.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20261022130000_admin_and_deletion_grace.sql"
DOWN="$ROOT/supabase/rollback/20261022130000_admin_and_deletion_grace.down.sql"
T="$ROOT/supabase/tests"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DIR="$(mktemp -d)"; chmod 755 "$DIR"; chown postgres "$DIR"
PORT=55432
cleanup() { su postgres -c "$BIN/pg_ctl -s -D $DIR/data stop -m fast" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
su postgres -c "$BIN/initdb -D $DIR/data -U supabase_admin --auth=trust" >/dev/null
su postgres -c "$BIN/pg_ctl -s -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log start"
as() { local who="$1"; shift; psql -X -q -v ON_ERROR_STOP=1 -h "$DIR" -p $PORT -U "$who" -d postgres "$@"; }
echo "Postgres: $($BIN/postgres --version)"

as supabase_admin -f "$T/bootstrap.sql"
as supabase_admin -f "$T/prod-schema.sql" >/dev/null
as supabase_admin -f "$T/fixup.sql"
as supabase_admin -f "$T/seed.sql"
before=$(as supabase_admin -At -c "select tests.structure()")

echo "== الترحيل (بدور postgres، كما في الإنتاج)"
as postgres --single-transaction -f "$MIG"
as supabase_admin -f "$T/admin_and_deletion.test.sql"

echo "== التراجع"
as supabase_admin -At -c "insert into private.deletion_requests (user_id, purge_after) values ('bbbbbbbb-0000-4000-8000-00000000000b', now() + interval '7 days')"
if as postgres --single-transaction -f "$DOWN" 2>"$DIR/down.err"; then
  echo "FAIL: التراجع مرّ رغم وجود طلب معلّق"; exit 1
else
  grep -q "rollback blocked: 1 pending" "$DIR/down.err" && echo "ok  التراجع يرفض وفي القاعدة طلب حذف معلّق"
fi
# B موقوف بيد المشرف قبل التراجع، وC موقوف من خارج التطبيق (لوحة Supabase):
as supabase_admin -At -c "update auth.users set banned_until = now() + interval '100 years' where id = 'bbbbbbbb-0000-4000-8000-00000000000b';
  insert into private.audit_log (actor_kind, actor_id, action, target_id) values ('admin', 'eeeeeeee-0000-4000-8000-00000000000e', 'disable', 'bbbbbbbb-0000-4000-8000-00000000000b');
  insert into auth.users (id, email, aud, role, banned_until) values ('cccccccc-0000-4000-8000-00000000000c', 'c@x.dz', 'authenticated', 'authenticated', now() + interval '1 day');" >/dev/null
PGOPTIONS="-c taqwim.rollback_confirm=yes" as postgres --single-transaction -f "$DOWN"
after=$(as supabase_admin -At -c "select tests.structure()")
if [ "$before" = "$after" ]; then echo "ok  بعد التراجع: السياسات والدوال وصلاحياتها والمخطّطات والأدوار كما قبل الترحيل"
else echo "FAIL: البنية بعد التراجع تختلف"; diff <(echo "$before") <(echo "$after") | head -20; exit 1; fi
as supabase_admin -At -c "select case when (select banned_until is null from auth.users where id='bbbbbbbb-0000-4000-8000-00000000000b')
   and (select banned_until is not null from auth.users where id='cccccccc-0000-4000-8000-00000000000c') then 'ok  التراجع رفع إيقاف المشرف وحده، وترك إيقاف اللوحة' else 'FAIL unban' end" | tee "$DIR/u"; grep -q '^ok' "$DIR/u"
as supabase_admin -At -c "select case when exists (select 1 from auth.users where id='bbbbbbbb-0000-4000-8000-00000000000b') then 'ok  طلب الحذف المعلّق أُلغي ولم يُحذف الحساب' else 'FAIL' end" | tee "$DIR/u"; grep -q '^ok' "$DIR/u"

echo "== إعادة الترحيل بعد التراجع"
as postgres --single-transaction -f "$MIG" && echo "ok  الترحيل يُطبَّق من جديد بعد التراجع"
