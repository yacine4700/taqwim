#!/usr/bin/env bash
# اختبار ترحيلات ملكية العلاقات (20261105120000) وحماية classes.created_at (20261105121000)
# ومنع تغيير students.class_id (20261105122000) على قاعدة محلية مؤقتة ببنية الإنتاج. لا يتصل بأي قاعدة خارجية. يحتاج Postgres محليًّا
# (initdb/pg_ctl) وحساب نظام postgres.
#
# المراحل:
#   1) الحالة قبل الترحيلين: الاختبارات تُشغَّل فيجب أن تفشل اختبارات المنع (يثبت أن الاختبار يكشف الثغرة).
#   2) الفحص المسبق: قاعدة فيها صف مخالف ترفض الترحيل ولا تتغيّر.
#   3) الترحيلان بدور postgres كما في الإنتاج، ثم الاختبارات كلها يجب أن تنجح.
#   4) الاستعادة الحقيقية: pg_dump ثم استعادة (replica ثم postgres) لا تتعطّل ولا تغيّر created_at.
#   5) التراجع: يعيد البنية كما كانت حرفيًّا ولا يمسّ البيانات، ثم يُطبَّق الترحيلان من جديد.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M="$ROOT/supabase/migrations"
R="$ROOT/supabase/rollback"
T="$ROOT/supabase/tests"
MIG1="$M/20261105120000_ownership_checks.sql"
MIG2="$M/20261105121000_class_created_at_guard.sql"
MIG3="$M/20261105122000_student_class_guard.sql"
DOWN1="$R/20261105120000_ownership_checks.down.sql"
DOWN2="$R/20261105121000_class_created_at_guard.down.sql"
DOWN3="$R/20261105122000_student_class_guard.down.sql"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DIR="$(mktemp -d)"; chmod 755 "$DIR"; chown postgres "$DIR"
PORT=55471
cleanup() { su postgres -c "$BIN/pg_ctl -s -D $DIR/data stop -m fast" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
su postgres -c "$BIN/initdb -D $DIR/data -U supabase_admin --auth=trust" >/dev/null
su postgres -c "$BIN/pg_ctl -s -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log start"
DB=postgres
as() { local who="$1"; shift; psql -X -q -v ON_ERROR_STOP=1 -h "$DIR" -p $PORT -U "$who" -d "$DB" "$@"; }
asdb() { local db="$1"; shift; DB="$db" as "$@"; }
echo "Postgres: $($BIN/postgres --version)"
A=aaaaaaaa-0000-4000-8000-00000000000a
B=bbbbbbbb-0000-4000-8000-00000000000b

as supabase_admin -f "$T/bootstrap.sql"
as supabase_admin -f "$T/prod-schema.sql" >/dev/null
as supabase_admin -f "$T/fixup.sql"
as supabase_admin -f "$T/seed.sql"
echo "== الترحيلات السابقة (بدور postgres كما في الإنتاج) بما فيها السنة الدراسية"
for f in 20261022130000_admin_and_deletion_grace 20261030090000_term_calendar_and_guard \
         20261030120000_admin_term_calendar 20261030140000_backup_schedule 20261030150000_backup_status_next \
         20261030170000_admin_delete_now 20261101100000_purge_unconfirmed 20261101130000_merge_record \
         20261104190000_audit_log_retention 20261105100000_school_year_purge; do
  as postgres --single-transaction -f "$M/$f.sql" >/dev/null
done
before=$(as supabase_admin -At -c "select tests.structure()")
POLICIES="select tablename || ' | ' || permissive || ' | roles=' || roles::text || ' | ' || cmd || E'\n    USING      ' || coalesce(qual, '-') || E'\n    WITH CHECK ' || coalesce(with_check, '-') from pg_policies where schemaname = 'public' and policyname = 'own_rows' and tablename in ('students','class_groups','tp_sessions','records','readings','tp_marks') order by tablename"
as supabase_admin -At -c "$POLICIES" > "$DIR/policies.before"

# قواعد مشتقة من الحالة النظيفة: للحالة قبل الترحيل، وللفحص المسبق (صفان مخالفان)
as supabase_admin -d template1 -c "create database t_pre template postgres"
as supabase_admin -d template1 -c "create database t_viol1 template postgres"
as supabase_admin -d template1 -c "create database t_viol2 template postgres"

echo
echo "== 1) قبل الترحيلين: يجب أن تفشل اختبارات المنع (الثغرة قائمة)"
set +e
asdb t_pre supabase_admin -f "$T/ownership.test.sql" > "$DIR/pre.out" 2>&1
set -e
nfail=$(grep -c '| FAIL |' "$DIR/pre.out" || true)
echo "اختبارات فشلت قبل الترحيل: $nfail"
grep '| FAIL |' "$DIR/pre.out" | sed -E 's/ +/ /g' | cut -c1-140
must_fail=("منع: B يدرج تلميذًا في قسم A" "منع: B ينقل تلميذًا بلا فوج إلى قسم A" "منع: B ينقل حصة بلا فوج إلى قسم A" "منع: علامة تجمع تلميذًا وحصة من قسمين مختلفين لـ B نفسه" \
           "منع: B يزرع سجلًّا على (تلميذ A، الفصل 1) قبل تنقيطه" "A ينقّط الضحية: سجل جديد (upsert كالتطبيق)" \
           "منع: B يعدّل created_at لقسمه إلى الآن" "منع: B يقدّم created_at لقسمه (يسرّع حذفه)")
for lbl in "${must_fail[@]}"; do
  grep '| FAIL |' "$DIR/pre.out" | grep -qF -- "$lbl" || { echo "FAIL: الاختبار لم يكشف الثغرة: $lbl"; exit 1; }
done
echo "ok  الاختبارات الستة المفصلية تفشل قبل الترحيل: الاختبار يكشف الثغرة فعلًا"

echo
echo "== 2) الفحص المسبق: صفوف مخالفة ترفض الترحيل بلا أي تغيير"
snap=$(asdb t_viol1 supabase_admin -At -c "select tests.structure()")
asdb t_viol1 supabase_admin -At -c "insert into public.students (teacher_id, class_id, full_name)
  select '$B', id, 'مزروع' from public.classes where teacher_id = '$A' limit 1" >/dev/null
if DB=t_viol1 as postgres --single-transaction -f "$MIG1" 2>"$DIR/v1.err"; then echo "FAIL: مرّ الترحيل رغم تلميذ مزروع"; exit 1; fi
grep -q "ownership precheck failed: students=1 " "$DIR/v1.err" && echo "ok  تلميذ مزروع في قسم غيره: الترحيل يرفض (students=1)" || { echo "FAIL"; cat "$DIR/v1.err"; exit 1; }
[ "$snap" = "$(asdb t_viol1 supabase_admin -At -c 'select tests.structure()')" ] && echo "ok  لا سياسة تغيّرت بعد الرفض" || { echo "FAIL: تغيّرت البنية"; exit 1; }

asdb t_viol2 supabase_admin -At -c "
  insert into public.classes (teacher_id, name) values ('$B', 'ثانٍ');
  insert into public.students (teacher_id, class_id, full_name) select '$B', id, 'من ثانٍ' from public.classes where teacher_id = '$B' and name = 'ثانٍ';
  insert into public.tp_marks (teacher_id, session_id, student_id, score)
    select '$B', (select id from public.tp_sessions where teacher_id = '$B' limit 1),
           (select s.id from public.students s join public.classes c on c.id = s.class_id where c.name = 'ثانٍ' and s.teacher_id = '$B'), 7" >/dev/null
if DB=t_viol2 as postgres --single-transaction -f "$MIG1" 2>"$DIR/v2.err"; then echo "FAIL: مرّ الترحيل رغم علامة من قسمين"; exit 1; fi
grep -q "tp_marks=1" "$DIR/v2.err" && echo "ok  علامة تجمع تلميذًا وحصة من قسمين: الترحيل يرفض (tp_marks=1)" || { echo "FAIL"; cat "$DIR/v2.err"; exit 1; }

echo
echo "== 3) الترحيلان بدور postgres (كما في الإنتاج) ثم الاختبارات"
as postgres --single-transaction -f "$MIG1"
as postgres --single-transaction -f "$MIG2"
# حالتان مشتقتان قبل ترحيل class_id: واحدة تُشغَّل عليها اختبارات المنع بلا الترحيل (يجب أن تفشل)، وأخرى يُطبَّق عليها
as supabase_admin -d template1 -c "create database t_mid_a template postgres"
as supabase_admin -d template1 -c "create database t_mid_b template postgres"
as postgres --single-transaction -f "$MIG3"
as supabase_admin -At -c "$POLICIES" > "$DIR/policies.after"
after1=$(as supabase_admin -At -c "select tests.structure()")
as supabase_admin -f "$T/ownership.test.sql" | tee "$DIR/out.txt"
grep -q "| FAIL |" "$DIR/out.txt" && { echo "FAIL: في الاختبار فحوص فاشلة"; exit 1; }

echo
echo "== 3ب) منع تغيير students.class_id: قبل الترحيل يجب أن تفشل اختبارات المنع، وبعده تنجح كلها"
set +e
asdb t_mid_a supabase_admin -f "$T/student_class_guard.test.sql" > "$DIR/sc.pre.out" 2>&1
set -e
echo "اختبارات فشلت قبل ترحيل class_id: $(grep -ac '| FAIL |' "$DIR/sc.pre.out" || true)"
grep -a '| FAIL |' "$DIR/sc.pre.out" | sed -E 's/ +/ /g' | cut -c1-120
for lbl in "منع: B ينقل تلميذًا بلا فوج إلى قسم آخر يملكه" "منع: B يهرّب تلميذ قسم قديم إلى قسم جارٍ يملكه" "منع: upsert بـ DO UPDATE يغيّر class_id"; do
  grep -a '| FAIL |' "$DIR/sc.pre.out" | grep -qF -- "$lbl" || { echo "FAIL: الاختبار لم يكشف الثغرة: $lbl"; exit 1; }
done
echo "ok  اختبارات المنع الجوهرية تفشل قبل الترحيل: الاختبار يكشف الثغرة فعلًا"
DB=t_mid_b as postgres --single-transaction -f "$MIG3"
asdb t_mid_b supabase_admin -f "$T/student_class_guard.test.sql" | tee "$DIR/sc.out"
grep -a -q "| FAIL |" "$DIR/sc.out" && { echo "FAIL: في اختبار class_id فحوص فاشلة"; exit 1; }

echo
echo "== 4) الاستعادة الحقيقية: pg_dump لجداول الأقسام ثم استعادتها"
fp_all() { as supabase_admin -At -c "select tests.fp('$A') || tests.fp('$B') || (select md5(string_agg(c::text, ',' order by c.id)) from public.classes c)"; }
fp0=$(fp_all)
TABLES=(-t public.classes -t public.class_groups -t public.students -t public.tp_sessions -t public.records -t public.readings -t public.tp_marks)
"$BIN/pg_dump" -h "$DIR" -p $PORT -U supabase_admin -d postgres --data-only "${TABLES[@]}" > "$DIR/data.raw.sql"
{ echo 'SET session_replication_role = replica;'; cat "$DIR/data.raw.sql"; echo 'RESET ALL;'; } > "$DIR/data.sql"
as supabase_admin -c "truncate public.classes cascade"
[ "$(as supabase_admin -At -c 'select count(*) from public.classes')" = "0" ] || { echo "FAIL: لم تُفرَّغ"; exit 1; }
as supabase_admin -f "$DIR/data.sql" >/dev/null
[ "$fp0" = "$(fp_all)" ] && echo "ok  استعادة بنمط data.sql (replica): البيانات وcreated_at كما كانت حرفيًّا" || { echo "FAIL: اختلفت البيانات بعد الاستعادة (replica)"; exit 1; }
as supabase_admin -c "truncate public.classes cascade"
as postgres -f "$DIR/data.raw.sql" >/dev/null
[ "$fp0" = "$(fp_all)" ] && echo "ok  استعادة عادية بدور postgres (بلا replica): البيانات وcreated_at كما كانت حرفيًّا" || { echo "FAIL: اختلفت البيانات بعد الاستعادة (postgres)"; exit 1; }

echo
echo "== 5) السياسات: القديمة والجديدة"
diff "$DIR/policies.before" "$DIR/policies.after" || true

echo
echo "== التراجع: البنية كما كانت حرفيًّا والبيانات لم تُمسّ"
dfp0=$(fp_all)
as postgres --single-transaction -f "$DOWN3"
as postgres --single-transaction -f "$DOWN2"
as postgres --single-transaction -f "$DOWN1"
afterdown=$(as supabase_admin -At -c "select tests.structure()")
if [ "$before" = "$afterdown" ]; then echo "ok  بنية public والسياسات بعد التراجع مطابقة لما قبل الترحيلين"; else echo "FAIL: البنية تختلف"; diff <(echo "$before") <(echo "$afterdown") | head -20; exit 1; fi
left=$(as supabase_admin -At -c "select (select count(*) from pg_trigger where tgname in ('trg_guard_class_created_at', 'trg_guard_student_class_id')) + (select count(*) from pg_proc where proname in ('guard_class_created_at', 'guard_student_class_id'))")
[ "$left" = "0" ] && echo "ok  لا محفّز ولا دالة باقية" || { echo "FAIL: بقي $left"; exit 1; }
[ "$dfp0" = "$(fp_all)" ] && echo "ok  البيانات كما هي بعد التراجع" || { echo "FAIL: تغيّرت البيانات"; exit 1; }
as supabase_admin -At -c "$POLICIES" > "$DIR/policies.down"
cmp -s "$DIR/policies.before" "$DIR/policies.down" && echo "ok  نصّ السياسات الستّ مطابق حرفيًّا لما قبل" || { echo "FAIL: نصّ السياسات"; exit 1; }
echo "== إعادة الترحيل بعد التراجع"
as postgres --single-transaction -f "$MIG1"
as postgres --single-transaction -f "$MIG2"
as postgres --single-transaction -f "$MIG3"
[ "$after1" = "$(as supabase_admin -At -c 'select tests.structure()')" ] && echo "ok  البنية بعد إعادة التطبيق مطابقة لما بعد التطبيق الأول" || { echo "FAIL"; exit 1; }
echo "== done"
