#!/usr/bin/env bash
# اختبار ترحيل الرزنامة والمحفّز على قاعدة محلية مؤقتة ببنية الإنتاج.
# لا يتصل بأي قاعدة خارجية. يحتاج Postgres محليًّا (initdb/pg_ctl) وحساب نظام postgres.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRE="$ROOT/supabase/migrations/20261022130000_admin_and_deletion_grace.sql"
MIG="$ROOT/supabase/migrations/20261030090000_term_calendar_and_guard.sql"
DOWN="$ROOT/supabase/rollback/20261030090000_term_calendar_and_guard.down.sql"
MIG2="$ROOT/supabase/migrations/20261030120000_admin_term_calendar.sql"
DOWN2="$ROOT/supabase/rollback/20261030120000_admin_term_calendar.down.sql"
T="$ROOT/supabase/tests"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DIR="$(mktemp -d)"; chmod 755 "$DIR"; chown postgres "$DIR"
PORT=55433
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

echo "== النسختان (private.term_open وsrc/lib/terms.ts) تتفقان في كل يوم من يوليو 2026 إلى ديسمبر 2027"
as supabase_admin -At -c "select school_year||'|'||term||'|'||starts_on||'|'||ends_on||'|'||grace_days from public.term_calendar order by term" \
  | node --experimental-strip-types --no-warnings "$ROOT/scripts/terms-open-dump.mjs" > "$DIR/ts.txt"
as supabase_admin -At -c "select d::date || '|' || coalesce((select string_agg(t::text, ',' order by t) from generate_series(1,3) t where private.term_open(t, d::date)), '')
  from generate_series('2026-07-01'::date, '2027-12-31'::date, '1 day') d order by d" > "$DIR/sql.txt"
if diff -q "$DIR/ts.txt" "$DIR/sql.txt" >/dev/null; then echo "ok  $(wc -l < "$DIR/ts.txt") يومًا متطابقة"
else echo "FAIL: النسختان تختلفان"; diff "$DIR/ts.txt" "$DIR/sql.txt" | head -10; exit 1; fi

as supabase_admin -f "$T/term_guard.test.sql"

echo "== تعديل الرزنامة من المشرف (ترحيل 20261030120000)"
as postgres --single-transaction -f "$MIG2"
as supabase_admin -f "$T/admin_term_calendar.test.sql"
as postgres --single-transaction -f "$DOWN2" && echo "ok  التراجع عن دالة المشرف نظيف"
as postgres --single-transaction -f "$MIG2" && echo "ok  وإعادة تطبيقها"

echo "== التراجع لا يمسّ علامة، ثم إعادة الترحيل"
before=$(as supabase_admin -At -c "select tests.fp('aaaaaaaa-0000-4000-8000-00000000000a') || tests.fp('bbbbbbbb-0000-4000-8000-00000000000b')")
as postgres --single-transaction -f "$DOWN2"
as postgres --single-transaction -f "$DOWN"
after=$(as supabase_admin -At -c "select tests.fp('aaaaaaaa-0000-4000-8000-00000000000a') || tests.fp('bbbbbbbb-0000-4000-8000-00000000000b')")
[ "$before" = "$after" ] && echo "ok  بيانات الأساتذة كما هي بعد التراجع" || { echo "FAIL: تغيّرت البيانات"; exit 1; }
left=$(as supabase_admin -At -c "select count(*) from pg_trigger where tgname = 'trg_guard_term_write'")
[ "$left" = "0" ] && echo "ok  لا محفّز باقٍ بعد التراجع" || { echo "FAIL: بقي محفّز"; exit 1; }
as postgres --single-transaction -f "$MIG" && echo "ok  الترحيل يُطبَّق من جديد بعد التراجع"
