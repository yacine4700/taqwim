#!/usr/bin/env bash
# اختبار ترحيل جدولة النسخ الاحتياطي (قرار النسخ الأسبوعي واليومي ودوال المشرف) على قاعدة محلية مؤقتة ببنية الإنتاج.
# لا يتصل بأي قاعدة خارجية. يحتاج Postgres محليًّا (initdb/pg_ctl) وحساب نظام postgres.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRE="$ROOT/supabase/migrations/20261022130000_admin_and_deletion_grace.sql"
MIG="$ROOT/supabase/migrations/20261030090000_term_calendar_and_guard.sql"
DOWN="$ROOT/supabase/rollback/20261030090000_term_calendar_and_guard.down.sql"
MIG2="$ROOT/supabase/migrations/20261030120000_admin_term_calendar.sql"
MIG3="$ROOT/supabase/migrations/20261030140000_backup_schedule.sql"
DOWN3="$ROOT/supabase/rollback/20261030140000_backup_schedule.down.sql"
MIG4="$ROOT/supabase/migrations/20261030150000_backup_status_next.sql"
DOWN4="$ROOT/supabase/rollback/20261030150000_backup_status_next.down.sql"
T="$ROOT/supabase/tests"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DIR="$(mktemp -d)"; chmod 755 "$DIR"; chown postgres "$DIR"
PORT=55434
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
echo "== الترحيلات الثلاثة بدور postgres، كما في الإنتاج"
as postgres --single-transaction -f "$PRE"
as postgres --single-transaction -f "$MIG"
as postgres --single-transaction -f "$MIG2"
as postgres --single-transaction -f "$MIG3"
as postgres --single-transaction -f "$MIG4"
as supabase_admin -f "$T/backup_schedule.test.sql"

echo "== التراجع عن ترحيل الموعد القادم وإعادته"
as postgres --single-transaction -f "$DOWN4"
k=$(as supabase_admin -At -c "select prosrc like '%next_weekly%' from pg_proc where proname = 'admin_backup_status'")
[ "$k" = "f" ] && echo "ok  عادت الدالة إلى تعريفها السابق" || { echo "FAIL: لم تعد"; exit 1; }
as postgres --single-transaction -f "$MIG4" && echo "ok  وأُعيد تطبيقه"

echo "== التراجع لا يمسّ علامة، ولا يترك شيئًا"
before=$(as supabase_admin -At -c "select tests.fp('aaaaaaaa-0000-4000-8000-00000000000a') || tests.fp('bbbbbbbb-0000-4000-8000-00000000000b')")
as postgres --single-transaction -f "$DOWN4"
as postgres --single-transaction -f "$DOWN3"
after=$(as supabase_admin -At -c "select tests.fp('aaaaaaaa-0000-4000-8000-00000000000a') || tests.fp('bbbbbbbb-0000-4000-8000-00000000000b')")
[ "$before" = "$after" ] && echo "ok  بيانات الأساتذة كما هي بعد التراجع" || { echo "FAIL: تغيّرت البيانات"; exit 1; }
left=$(as supabase_admin -At -c "select (select count(*) from pg_proc where proname in ('backup_decision','admin_set_backup','admin_backup_status','admin_set_exams_from')) + (select count(*) from information_schema.columns where table_name = 'term_calendar' and column_name = 'exams_from') + (select count(*) from pg_class where relname = 'backup_control')")
[ "$left" = "0" ] && echo "ok  لا دالة ولا جدول ولا عمود باقٍ" || { echo "FAIL: بقي $left"; exit 1; }
as postgres --single-transaction -f "$MIG3" && as postgres --single-transaction -f "$MIG4" && echo "ok  الترحيلان يُطبَّقان من جديد بعد التراجع"
