#!/usr/bin/env bash
# اختبار ترحيل مدة سجلّ العمليات (سنة) على قاعدة محلية مؤقتة ببنية الإنتاج.
# لا يتصل بأي قاعدة خارجية. يحتاج Postgres محليًّا (initdb/pg_ctl) وحساب نظام postgres.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M="$ROOT/supabase/migrations"
MIG="$M/20261104190000_audit_log_retention.sql"
DOWN="$ROOT/supabase/rollback/20261104190000_audit_log_retention.down.sql"
T="$ROOT/supabase/tests"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DIR="$(mktemp -d)"; chmod 755 "$DIR"; chown postgres "$DIR"
PORT=55441
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
echo "== الترحيلات السابقة التي تمسّ السجلّ، ثم هذا الترحيل، بدور postgres كما في الإنتاج"
for f in 20261022130000_admin_and_deletion_grace 20261030090000_term_calendar_and_guard \
         20261030120000_admin_term_calendar 20261030140000_backup_schedule 20261030150000_backup_status_next \
         20261030170000_admin_delete_now 20261101100000_purge_unconfirmed; do
  as postgres --single-transaction -f "$M/$f.sql" >/dev/null
done
as postgres --single-transaction -f "$MIG"
as supabase_admin -f "$T/audit_log_retention.test.sql"

echo "== التراجع يزيل الدالة والحجز، ويُبقي أثر التقليم"
as postgres --single-transaction -f "$DOWN"
left=$(as supabase_admin -At -c "select count(*) from pg_proc where proname = 'trim_audit_log'")
[ "$left" = "0" ] && echo "ok  لا دالة باقية" || { echo "FAIL: بقيت الدالة"; exit 1; }
held=$(as supabase_admin -At -c "select to_regclass('private.audit_hold') is null")
[ "$held" = "t" ] && echo "ok  جدول الحجز حُذف" || { echo "FAIL: الحجز باقٍ"; exit 1; }
conv=$(as supabase_admin -At -c "select count(*) from private.audit_log where detail ->> 'was' = 'trim_audit'")
[ "$conv" = "1" ] && echo "ok  سطر التقليم حُوّل ولم يُحذف" || { echo "FAIL: سطر التقليم ($conv)"; exit 1; }
as postgres --single-transaction -f "$MIG" && echo "ok  الترحيل يُطبَّق من جديد بعد التراجع"
echo "== done"
