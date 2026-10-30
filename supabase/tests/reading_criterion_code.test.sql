-- اختبارات ترحيل 20261030190000 (محاولات السحب تنتمي إلى معيار بعينه).
-- يُشغَّل بدور supabase_admin بعد الترحيل. الأستاذ A عنده معيار read الافتراضي، ونضيف له
-- معيارين من النوع auto: oral (له محاولات) وmental (بلا محاولات).
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set B '''bbbbbbbb-0000-4000-8000-00000000000b'''
\o /dev/null

select id as st from public.students where teacher_id = :A order by full_name limit 1 \gset
select id as stb from public.students where teacher_id = :B order by full_name limit 1 \gset

-- 1. المحاولات القديمة تتبع معيار القراءة دون نقل بيانات.
select tests.ok('كل المحاولات الموجودة صارت read',
  (select count(*) = 6 and bool_and(criterion_code = 'read') from public.readings));

-- 2. إدراج بلا criterion_code (طابور قديم على هاتف) يأخذ read.
insert into public.readings (teacher_id, student_id, term, score) values (:A, :'st', 2, 1.00);
select tests.ok('إدراج بلا كود يأخذ read',
  (select criterion_code from public.readings where student_id = :'st' and term = 2) = 'read');
delete from public.readings where student_id = :'st' and term = 2;

-- 3. معيار القراءة وحده: التقويم كما كان (4+4+3+2.5 على 16).
select tests.ok('تقويم معيار القراءة وحده لم يتغيّر',
  (select continuous from public.v_continuous where student_id = :'st' and term = 1) = 16.88,
  (select continuous::text from public.v_continuous where student_id = :'st' and term = 1));

-- 4. معيار ثانٍ بمحاولاته: 4 و2 → متوسط 3، ولا يختلط بمتوسط القراءة 2.5.
insert into public.criteria (teacher_id, code, label, kind, base, ceiling, position)
values (:A, 'oral', 'الأسئلة الشفوية', 'auto', 0, 4, 6);
insert into public.readings (teacher_id, student_id, term, score, criterion_code) values
  (:A, :'st', 1, 4, 'oral'), (:A, :'st', 1, 2, 'oral');

select tests.ok('v_reading_avg: القراءة 2.5 بمحاولة واحدة',
  (select value = 2.5 and attempts = 1 from public.v_reading_avg
    where student_id = :'st' and term = 1 and criterion_code = 'read'));
select tests.ok('v_reading_avg: الشفوية 3 بمحاولتين',
  (select value = 3 and attempts = 2 from public.v_reading_avg
    where student_id = :'st' and term = 1 and criterion_code = 'oral'));
select tests.ok('التقويم مع معيارين: (4+4+3+2.5+3)/20×20 = 16.5 لا تكرار',
  (select continuous from public.v_continuous where student_id = :'st' and term = 1) = 16.50,
  (select continuous::text from public.v_continuous where student_id = :'st' and term = 1));

-- 5. معيار auto بلا محاولات يخرج من القسمة ولا يُحسب صفرًا.
insert into public.criteria (teacher_id, code, label, kind, base, ceiling, position)
values (:A, 'mental', 'الحساب الذهني', 'auto', 0, 4, 7);
select tests.ok('معيار auto بلا محاولات لا يغيّر التقويم',
  (select continuous from public.v_continuous where student_id = :'st' and term = 1) = 16.50);

-- 6. الفصل منفصل: محاولات الفصل 1 لا تدخل الفصل 2.
select tests.ok('لا تقويم في فصل بلا علامة',
  not exists (select 1 from public.v_continuous where student_id = :'st' and term = 2));

-- 7. أستاذ آخر لا يتأثر.
select tests.ok('تقويم B كما هو (4+4+3+2.5 على 16)',
  (select continuous from public.v_continuous where student_id = :'stb' and term = 1) = 16.88);

-- 8. حذف المعيار يُخرج محاولاته من الحساب ولا يحذفها.
delete from public.criteria where teacher_id = :A and code in ('oral', 'mental');
select tests.ok('محاولات oral باقية بعد حذف معيارها',
  (select count(*) from public.readings where student_id = :'st' and criterion_code = 'oral') = 2);
select tests.ok('وخرجت من الحساب: التقويم عاد 16.88',
  (select continuous from public.v_continuous where student_id = :'st' and term = 1) = 16.88);

-- 9. إعادة إنشاء معيار بالكود نفسه تعيد محاولاته (الربط بالكود).
insert into public.criteria (teacher_id, code, label, kind, base, ceiling, position)
values (:A, 'oral', 'الأسئلة الشفوية', 'auto', 0, 4, 6);
select tests.ok('إعادة إنشاء المعيار بكوده تعيد محاولاته',
  (select continuous from public.v_continuous where student_id = :'st' and term = 1) = 16.50);

-- 10. المنظران التابعان يعملان (v_term_average وv_class_stats) بلا تكرار صفوف.
select tests.ok('v_term_average صفّ واحد لكل (تلميذ، فصل)',
  (select count(*) = count(distinct (student_id, term)) from public.v_term_average));

-- 11. خصائص المناظر كما كانت.
select tests.ok('المناظر security_invoker',
  (select count(*) = 2 from pg_class c where c.relnamespace = 'public'::regnamespace
     and c.relname in ('v_reading_avg', 'v_continuous') and c.reloptions @> array['security_invoker=true']));
select tests.ok('anon وauthenticated وservice_role على v_reading_avg كما كانت',
  (select count(distinct a.grantee) = 3 from pg_class c, aclexplode(c.relacl) a
    where c.relname = 'v_reading_avg' and c.relnamespace = 'public'::regnamespace
      and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
      and a.privilege_type = 'SELECT'));

-- ============================================================
-- النتيجة
-- ============================================================
\o
\pset format aligned
\pset footer off
select n, case when ok then 'ok' else 'FAIL' end as r, label, case when ok then '' else coalesce(detail, '') end as detail
from tests.results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from tests.results \gset
\echo :passed passed, :failed failed
select :failed = 0 as all_passed \gset
\if :all_passed
\else
  \echo 'FAILED'
  \quit 3
\endif
