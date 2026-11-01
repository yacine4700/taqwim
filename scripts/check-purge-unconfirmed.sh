#!/usr/bin/env bash
# اختبار ترحيل تنظيف الحسابات غير المؤكَّدة على قاعدة محلية مؤقتة ببنية الإنتاج.
# لا يتصل بأي قاعدة خارجية. يحتاج Postgres محليًّا (initdb/pg_ctl) وحساب نظام postgres.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRE="$ROOT/supabase/migrations/20261022130000_admin_and_deletion_grace.sql"
MIG="$ROOT/supabase/migrations/20261101100000_purge_unconfirmed.sql"
DOWN="$ROOT/supabase/rollback/20261101100000_purge_unconfirmed.down.sql"
T="$ROOT/supabase/tests"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DIR="$(mktemp -d)"; chmod 755 "$DIR"; chown postgres "$DIR"
PORT=55436
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
echo "== الترحيلان بدور postgres، كما في الإنتاج"
as postgres --single-transaction -f "$PRE"
as postgres --single-transaction -f "$MIG"
as supabase_admin -f "$T/purge_unconfirmed.test.sql"

echo "== التراجع يعيد الحذف الليلي كما كان ويزيل الدالة"
as supabase_admin -At -c "insert into private.audit_log (actor_kind, action, target_id) values ('system', 'purge_unconfirmed', 'c0ffee00-0000-4000-8000-000000000099')" >/dev/null
as postgres --single-transaction -f "$DOWN"
left=$(as supabase_admin -At -c "select count(*) from pg_proc where proname = 'purge_unconfirmed_accounts'")
[ "$left" = "0" ] && echo "ok  دالة التنظيف أُزيلت" || { echo "FAIL: بقيت دالة التنظيف"; exit 1; }
old=$(as supabase_admin -At -c "select prosrc like '%purge_unconfirmed%' from pg_proc where proname = 'purge_deleted_accounts'")
[ "$old" = "f" ] && echo "ok  الحذف الليلي عاد إلى تعريفه السابق" || { echo "FAIL: لم يعد"; exit 1; }
conv=$(as supabase_admin -At -c "select count(*) from private.audit_log where action = 'purge' and detail ->> 'was' = 'purge_unconfirmed'")
[ "$conv" -ge 1 ] && echo "ok  سطور السجلّ حُوّلت إلى purge ولم تُحذف" || { echo "FAIL: سجلّ"; exit 1; }
as postgres --single-transaction -f "$MIG" && echo "ok  الترحيل يُطبَّق من جديد بعد التراجع"
echo "== done"
