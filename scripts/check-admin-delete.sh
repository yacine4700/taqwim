#!/usr/bin/env bash
# اختبار ترحيل الحذف الفوري لحساب أستاذ (للمشرف وحده، بتأكيدات تفرضها القاعدة) على قاعدة محلية مؤقتة ببنية الإنتاج.
# لا يتصل بأي قاعدة خارجية. يحتاج Postgres محليًّا (initdb/pg_ctl) وحساب نظام postgres.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRE="$ROOT/supabase/migrations/20261022130000_admin_and_deletion_grace.sql"
MIG5="$ROOT/supabase/migrations/20261030170000_admin_delete_now.sql"
DOWN5="$ROOT/supabase/rollback/20261030170000_admin_delete_now.down.sql"
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
echo "== ترحيل المشرف ثم الحذف الفوري بدور postgres، كما في الإنتاج"
as postgres --single-transaction -f "$PRE"
as postgres --single-transaction -f "$MIG5"
as supabase_admin -f "$T/admin_delete_now.test.sql"

echo "== التراجع يزيل الدالة فقط، ثم يُعاد"
as postgres --single-transaction -f "$DOWN5"
left=$(as supabase_admin -At -c "select count(*) from pg_proc where proname = 'admin_delete_account_now'")
[ "$left" = "0" ] && echo "ok  لا دالة باقية" || { echo "FAIL: بقيت الدالة"; exit 1; }
as postgres --single-transaction -f "$MIG5" && echo "ok  الترحيل يُطبَّق من جديد"
