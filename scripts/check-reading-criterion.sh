#!/usr/bin/env bash
# اختبار ترحيل 20261030190000 (criterion_code في readings) على قاعدة محلية مؤقتة ببنية الإنتاج.
# لا يتصل بأي قاعدة خارجية. يحتاج Postgres محليًّا (initdb/pg_ctl) وحساب نظام postgres.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20261030190000_reading_criterion_code.sql"
DOWN="$ROOT/supabase/rollback/20261030190000_reading_criterion_code.down.sql"
TP="$ROOT/supabase/migrations/20261018150000_groups_and_tp_sessions.sql"
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

echo "== الحالة السابقة: المناظر كما في الإنتاج قبل الترحيل"
# v_reading_avg لم يُنشأ بترحيل في المستودع (أُنشئ مباشرة)، فيُكتب هنا كما هو في الإنتاج.
as postgres -c "create view public.v_reading_avg with (security_invoker = true) as
  select student_id, term, count(*)::integer as attempts, round(avg(score), 2) as value
  from public.readings group by student_id, term;"
# v_tp_avg وv_continuous كما في ترحيل الأفواج.
awk '/^create or replace view public.v_tp_avg/{p=1} p{print} p&&/^group by f.student_id/{exit}' "$TP" > "$DIR/prev.sql"
as postgres -f "$DIR/prev.sql"
before=$(as supabase_admin -At -c "select md5(string_agg(student_id||'|'||term||'|'||continuous, ',' order by student_id, term)) from public.v_continuous")
echo "   v_continuous قبل: $before"

echo "== الترحيل بدور postgres، كما في الإنتاج"
as postgres --single-transaction -f "$MIG"
after=$(as supabase_admin -At -c "select md5(string_agg(student_id||'|'||term||'|'||continuous, ',' order by student_id, term)) from public.v_continuous")
[ "$before" = "$after" ] && echo "ok  التقويم المحسوب لكل التلاميذ لم يتغيّر بعد الترحيل" || { echo "FAIL: تغيّر التقويم"; exit 1; }

as supabase_admin -f "$T/reading_criterion_code.test.sql"

echo "== التراجع: يرفض والقاعدة فيها محاولات لمعيار غير read"
as supabase_admin -At -c "insert into public.criteria (teacher_id, code, label, kind, base, ceiling, position)
  select 'aaaaaaaa-0000-4000-8000-00000000000a', 'oral2', 'x', 'auto', 0, 4, 9 where not exists (select 1 from public.criteria where code = 'oral2');
  insert into public.readings (teacher_id, student_id, term, score, criterion_code)
  select 'aaaaaaaa-0000-4000-8000-00000000000a', id, 1, 3, 'oral2' from public.students where teacher_id = 'aaaaaaaa-0000-4000-8000-00000000000a' limit 1;" >/dev/null
if as postgres --single-transaction -f "$DOWN" 2>"$DIR/down.err"; then
  echo "FAIL: التراجع مرّ رغم محاولات لمعيار آخر"; exit 1
else
  grep -q "rollback blocked: [0-9]* reading" "$DIR/down.err" && echo "ok  التراجع يرفض دون تأكيد" || { echo "FAIL: رسالة الرفض"; cat "$DIR/down.err"; exit 1; }
fi
as supabase_admin -At -c "delete from public.readings where criterion_code <> 'read'" >/dev/null
as postgres --single-transaction -f "$DOWN"
cols=$(as supabase_admin -At -c "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name = 'v_reading_avg' and table_schema = 'public'")
[ "$cols" = "student_id,term,attempts,value" ] && echo "ok  v_reading_avg عاد بشكله القديم" || { echo "FAIL: أعمدة v_reading_avg: $cols"; exit 1; }
nocol=$(as supabase_admin -At -c "select count(*) from information_schema.columns where table_name = 'readings' and column_name = 'criterion_code'")
[ "$nocol" = "0" ] && echo "ok  عمود criterion_code أُزيل" || { echo "FAIL: بقي العمود"; exit 1; }
as postgres --single-transaction -f "$MIG" && echo "ok  الترحيل يُطبَّق من جديد بعد التراجع"
echo "تمّ"
