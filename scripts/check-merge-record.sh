#!/usr/bin/env bash
# اختبار ترحيل 20261101130000 (merge_record) على قاعدة محلية مؤقتة ببنية الإنتاج.
# لا يتصل بأي قاعدة خارجية. يحتاج Postgres محليًّا (initdb/pg_ctl) وحساب نظام postgres.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRE="$ROOT/supabase/migrations/20261022130000_admin_and_deletion_grace.sql"
CAL="$ROOT/supabase/migrations/20261030090000_term_calendar_and_guard.sql"
MIG="$ROOT/supabase/migrations/20261101130000_merge_record.sql"
DOWN="$ROOT/supabase/rollback/20261101130000_merge_record.down.sql"
T="$ROOT/supabase/tests"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DIR="$(mktemp -d)"; chmod 755 "$DIR"; chown postgres "$DIR"
PORT=55435
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
as postgres --single-transaction -f "$PRE"
as postgres --single-transaction -f "$CAL"
before=$(as supabase_admin -At -c "select tests.structure()")

echo "== الترحيل بدور postgres، كما في الإنتاج"
as postgres --single-transaction -f "$MIG"
as supabase_admin -At -f "$T/merge_record.test.sql" | tee "$DIR/out.txt"
grep -q "FAIL" "$DIR/out.txt" && { echo "FAIL: في الاختبار فحوص فاشلة"; exit 1; }

echo "== التراجع: تُحذف الدالة وتعود البنية كما كانت"
as postgres --single-transaction -f "$DOWN"
after=$(as supabase_admin -At -c "select tests.structure()")
if [ "$before" = "$after" ]; then echo "ok  بنية public بعد التراجع مطابقة لما قبل الترحيل"; else echo "FAIL: البنية تغيّرت بعد التراجع"; exit 1; fi
as postgres --single-transaction -f "$MIG" && echo "ok  الترحيل يُطبَّق من جديد بعد التراجع"
echo "تمّ"
