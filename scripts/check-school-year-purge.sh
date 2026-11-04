#!/usr/bin/env bash
# اختبار ترحيل السنة الدراسية (قفل التنقيط + الحذف السنوي المحمي) على قاعدة محلية مؤقتة ببنية الإنتاج.
# لا يتصل بأي قاعدة خارجية. يحتاج Postgres محليًّا (initdb/pg_ctl) وحساب نظام postgres.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M="$ROOT/supabase/migrations"
MIG="$M/20261105100000_school_year_purge.sql"
DOWN="$ROOT/supabase/rollback/20261105100000_school_year_purge.down.sql"
T="$ROOT/supabase/tests"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DIR="$(mktemp -d)"; chmod 755 "$DIR"; chown postgres "$DIR"
PORT=55442
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
echo "== الترحيلات السابقة (بدور postgres كما في الإنتاج) ثم ترحيل السنة الدراسية"
for f in 20261022130000_admin_and_deletion_grace 20261030090000_term_calendar_and_guard \
         20261030120000_admin_term_calendar 20261030140000_backup_schedule 20261030150000_backup_status_next \
         20261030170000_admin_delete_now 20261101100000_purge_unconfirmed 20261101130000_merge_record \
         20261104190000_audit_log_retention; do
  as postgres --single-transaction -f "$M/$f.sql" >/dev/null
done
as postgres --single-transaction -f "$MIG"

echo "== اختبارات الرزنامة القائمة (term_guard) تعمل كما هي والترحيل مطبَّق فوقها"
as supabase_admin -f "$T/term_guard.test.sql"

echo "== اختبارات السنة الدراسية"
as supabase_admin -f "$T/school_year_purge.test.sql"

echo "== الاستعادة الحقيقية: pg_dump لسجلّ العمليات ثم استعادته يعيد التسلسل فيُكتشف التراجع"
as supabase_admin -At -c "delete from private.audit_log"
Y=$(as supabase_admin -At -c "select private.school_year_of((now() at time zone 'Africa/Algiers')::date)")
r=$(as supabase_admin -At -c "select private.purge_old_school_years_at(make_date($Y, 12, 1), null, 100)")
F0=$(echo "$r" | cut -d'|' -f3)
# نسخة اليوم (تحوي خط الأساس F0)
"$BIN/pg_dump" -h "$DIR" -p $PORT -U supabase_admin -d postgres --data-only -t private.audit_log > "$DIR/audit_snapshot.sql"
# ليلتان لاحقتان تتقدّم بهما القاعدة؛ خط الأساس المسجَّل خارجها صار F2
r=$(as supabase_admin -At -c "select private.purge_old_school_years_at(make_date($Y, 12, 2), $F0, 100)")
F1=$(echo "$r" | cut -d'|' -f3)
r=$(as supabase_admin -At -c "select private.purge_old_school_years_at(make_date($Y, 12, 3), $F1, 100)")
F2=$(echo "$r" | cut -d'|' -f3)
# الاستعادة من نسخة اليوم: السجلّ وتسلسله يعودان إلى ما قبل F1
as supabase_admin -At -c "truncate private.audit_log"
as supabase_admin -f "$DIR/audit_snapshot.sql" >/dev/null
seq=$(as supabase_admin -At -c "select pg_sequence_last_value('private.audit_log_id_seq'::regclass)")
[ "$seq" = "$F0" ] && echo "ok  التسلسل بعد الاستعادة = قيمته وقت النسخ ($seq)" || { echo "FAIL: التسلسل $seq بدل $F0"; exit 1; }
r=$(as supabase_admin -At -c "select private.purge_old_school_years_at(make_date($Y, 12, 4), $F2, 100)")
[ "$r" = "year-purge|regression|0|0|0|0" ] && echo "ok  بعد الاستعادة: regression بخط الأساس الأحدث (F2=$F2)" || { echo "FAIL: $r"; exit 1; }
# نشاط عادي يرفع التسلسل فوق F2 لا يُخفي التراجع: السطر F2 نفسه غير موجود
as supabase_admin -At -c "insert into private.audit_log (actor_kind, action) select 'system', 'trim_audit' from generate_series(1, $((F2 - F0 + 5)))" >/dev/null
r=$(as supabase_admin -At -c "select private.purge_old_school_years_at(make_date($Y, 12, 5), $F2, 100)")
[ "$r" = "year-purge|regression|0|0|0|0" ] && echo "ok  وبعد ارتفاع التسلسل فوق F2 يبقى regression" || { echo "FAIL: $r"; exit 1; }
# خط الأساس الذي كان وقت النسخ (F0) صحيح، فيتابع الحذف
r=$(as supabase_admin -At -c "select private.purge_old_school_years_at(make_date($Y, 12, 6), $F0, 100)")
case "$r" in year-purge\|ok\|*) echo "ok  خط الأساس القديم الصحيح (F0=$F0) يتابع: $r" ;; *) echo "FAIL: $r"; exit 1 ;; esac

echo "== مسار الاستعادة المصمَّم: replica يسمح بالإدخال في قسم مقفل وبعده يعود القفل"
cls=$(as supabase_admin -At -c "select tests.yr_mkclass('aaaaaaaa-0000-4000-8000-00000000000a', 'للاستعادة', (make_date($Y - 1, 9, 1)::timestamp) at time zone 'Africa/Algiers', 1)")
st=$(as supabase_admin -At -c "select id from public.students where class_id = '$cls' limit 1")
out=$(as supabase_admin -At <<SQL 2>&1 || true
set session_replication_role = replica;
insert into public.readings (teacher_id, student_id, term, score) values ('aaaaaaaa-0000-4000-8000-00000000000a', '$st', 1, 3);
reset session_replication_role;
insert into public.readings (teacher_id, student_id, term, score) values ('aaaaaaaa-0000-4000-8000-00000000000a', '$st', 1, 3);
SQL
)
echo "$out" | grep -q "class_year_closed" && echo "ok  replica أدخل، والإدخال العادي بعده رُفض" || { echo "FAIL: $out"; exit 1; }
n=$(as supabase_admin -At -c "select count(*) from public.readings where student_id = '$st'")
[ "$n" = "2" ] && echo "ok  القراءة المستعادة موجودة (مع قراءة الإعداد)" || { echo "FAIL: العدد $n"; exit 1; }

echo "== التراجع: يرفض بوجود سطور year_purge، ثم يزيل القفل والدوال"
if as postgres --single-transaction -f "$DOWN" >/dev/null 2>"$DIR/down.err"; then
  echo "FAIL: التراجع نجح رغم وجود سطور year_purge"; exit 1
else
  grep -q "year_purge rows exist" "$DIR/down.err" && echo "ok  التراجع يرفض صراحة" || { echo "FAIL: سبب مختلف"; cat "$DIR/down.err"; exit 1; }
fi
as supabase_admin -At -c "delete from private.audit_log where action = 'year_purge'"
before=$(as supabase_admin -At -c "select tests.fp('aaaaaaaa-0000-4000-8000-00000000000a') || tests.fp('bbbbbbbb-0000-4000-8000-00000000000b')")
as postgres --single-transaction -f "$DOWN"
after=$(as supabase_admin -At -c "select tests.fp('aaaaaaaa-0000-4000-8000-00000000000a') || tests.fp('bbbbbbbb-0000-4000-8000-00000000000b')")
[ "$before" = "$after" ] && echo "ok  بيانات الأساتذة كما هي بعد التراجع" || { echo "FAIL: تغيّرت البيانات"; exit 1; }
left=$(as supabase_admin -At -c "select (select count(*) from pg_trigger where tgname = 'trg_guard_year_write') + (select count(*) from pg_proc where proname in ('guard_year_write','class_year_closed','school_year_of','purge_old_school_years','purge_old_school_years_at','my_year_notice'))")
[ "$left" = "0" ] && echo "ok  لا محفّز ولا دالة باقية" || { echo "FAIL: بقي $left"; exit 1; }
as supabase_admin -At -c "insert into private.audit_log (actor_kind, action) values ('system', 'trim_audit')" >/dev/null
as postgres --single-transaction -f "$MIG" && echo "ok  الترحيل يُطبَّق من جديد بعد التراجع"
echo "== done"
