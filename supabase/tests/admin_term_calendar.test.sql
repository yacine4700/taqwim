-- اختبارات ترحيل 20261030120000 (تعديل روزنامة الفصول من لوحة المشرف).
-- يُشغَّل بدور supabase_admin بعد ترحيلات المشرف والروزنامة وهذا الترحيل، وبعد seed.sql.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set M '''eeeeeeee-0000-4000-8000-00000000000e'''
\set sM '''5e550000-0000-4000-8000-0000000000e1'''
\set sA '''5e550000-0000-4000-8000-0000000000a1'''

truncate tests.results;
insert into private.admins (user_id, note) values (:M, 'test') on conflict do nothing;

-- الروزنامة الأساسية كما في الإنتاج
delete from public.term_calendar;
insert into public.term_calendar (school_year, term, starts_on, ends_on) values
  ('2026/2027', 1, '2026-09-01', '2026-12-17'),
  ('2026/2027', 2, '2026-12-18', '2027-03-18'),
  ('2026/2027', 3, '2027-03-19', '2027-07-08');
select count(*) as log0 from private.audit_log \gset

create function tests.err(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'no error';
exception when others then return sqlstate || ' ' || sqlerrm; end $$;

-- ============================================================
-- 1) من يستطيع
-- ============================================================
select tests.claims(:A, :sA, 'aal2');
set role authenticated;
select tests.ok('أستاذ (ولو بجلسة aal2) لا يعدّل الروزنامة: forbidden',
  tests.err($$select public.admin_set_term('2026/2027', 1, '2026-09-01', '2026-12-15', 10)$$) = '42501 forbidden');
select tests.fails('الأستاذ لا يكتب في الجدول مباشرة', $$update public.term_calendar set grace_days = 30$$, '42501');
reset role;
select tests.ok('لم يتغيّر شيء', (select grace_days from public.term_calendar where term = 1) = 10
  and (select count(*) from private.audit_log) = :log0);

select tests.claims(:M, :sM, 'aal1');
set role authenticated;
select tests.ok('المشرف بلا aal2: mfa_required',
  tests.err($$select public.admin_set_term('2026/2027', 1, '2026-09-01', '2026-12-20', 10)$$) like '42501 mfa_required');
reset role;

set role anon;
select tests.fails('anon لا يستدعيها', $$select public.admin_set_term('2026/2027', 1, '2026-09-01', '2026-12-20', 10)$$, '42501');
reset role;
select tests.ok('service_role لا يملك تشغيلها',
  not has_function_privilege('service_role', 'public.admin_set_term(text,integer,date,date,integer,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_set_term(text,integer,date,date,integer,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_set_term(text,integer,date,date,integer,text)', 'execute'));

-- ============================================================
-- 2) تعديل فصل: يُكتب ويُسجَّل بالقيم السابقة
-- ============================================================
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('المشرف يقدّم نهاية ف1 ويمدّد مهلته',
  tests.err($$select public.admin_set_term('2026/2027', 1, '2026-09-01', '2026-12-15', 12, '  تقديم الاختبارات  ')$$) = 'no error');
reset role;
select tests.ok('التعديل كُتب',
  (select (starts_on, ends_on, grace_days) = ('2026-09-01'::date, '2026-12-15'::date, 12) from public.term_calendar where term = 1));
select tests.ok('وسُجّل مرة واحدة', (select count(*) from private.audit_log) = :log0 + 1);
select tests.ok('السجلّ فيه القيم الجديدة والسابقة والسبب مشذَّبًا',
  (select detail ->> 'reason' = 'تقديم الاختبارات'
      and detail ->> 'ends_on' = '2026-12-15' and (detail ->> 'grace_days')::int = 12
      and detail #>> '{previous,ends_on}' = '2026-12-17' and (detail #>> '{previous,grace_days}')::int = 10
      and actor_kind = 'admin' and actor_id = :M and target_id is null
   from private.audit_log where action = 'set_term' order by id desc limit 1));
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('ويقرؤه المشرف في admin_log_recent',
  exists (select 1 from public.admin_log_recent(10) where action = 'set_term' and target_email is null));

-- تعديل بلا سبب: لا مفتاح reason في السجلّ؛ وسبب من فراغ يُهمَل؛ وأطول من 300 يُقصّ
select public.admin_set_term('2026/2027', 1, '2026-09-01', '2026-12-17', 10);
select public.admin_set_term('2026/2027', 1, '2026-09-01', '2026-12-17', 10, '   ');
select public.admin_set_term('2026/2027', 1, '2026-09-01', '2026-12-17', 10, repeat('س', 500));
reset role;
select tests.ok('بلا سبب: لا reason في السجلّ', (select not (detail ? 'reason') from private.audit_log
  where action = 'set_term' order by id desc offset 2 limit 1));
select tests.ok('سبب من فراغ يُهمَل', (select not (detail ? 'reason') from private.audit_log
  where action = 'set_term' order by id desc offset 1 limit 1));
select tests.ok('السبب الطويل يُقصّ إلى 300', (select char_length(detail ->> 'reason') = 300 from private.audit_log
  where action = 'set_term' order by id desc limit 1));
select tests.ok('وأُعيدت القيم الأصلية', (select (ends_on, grace_days) = ('2026-12-17'::date, 10) from public.term_calendar where term = 1));

-- ============================================================
-- 3) المرفوض: لا يُكتب شيء ولا يُسجَّل شيء
-- ============================================================
select count(*) as log1 from private.audit_log \gset
select md5(string_agg(t::text, ',' order by term)) as cal1 from public.term_calendar t \gset
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('فصل رابع', tests.err($$select public.admin_set_term('2026/2027', 4, '2027-04-01', '2027-06-01', 10)$$) like '22023%');
select tests.ok('فصل صفر', tests.err($$select public.admin_set_term('2026/2027', 0, '2027-04-01', '2027-06-01', 10)$$) like '22023%');
select tests.ok('نهاية قبل البداية', tests.err($$select public.admin_set_term('2026/2027', 3, '2027-06-01', '2027-05-01', 10)$$) like '22023%');
select tests.ok('مهلة 31', tests.err($$select public.admin_set_term('2026/2027', 3, '2027-03-19', '2027-07-08', 31)$$) like '22023%');
select tests.ok('مهلة سالبة', tests.err($$select public.admin_set_term('2026/2027', 3, '2027-03-19', '2027-07-08', -1)$$) like '22023%');
select tests.ok('اسم سنة بصيغة خاطئة', tests.err($$select public.admin_set_term('2026-2027', 3, '2027-03-19', '2027-07-08', 10)$$) like '22023%');
select tests.ok('سنتان غير متتاليتين', tests.err($$select public.admin_set_term('2026/2028', 3, '2027-03-19', '2027-07-08', 10)$$) like '22023%');
select tests.ok('خطأ كتابة في السنة (2062)', tests.err($$select public.admin_set_term('2026/2027', 3, '2062-03-19', '2062-07-08', 10)$$) like '22023%');
select tests.ok('بداية قبل السنة الدراسية', tests.err($$select public.admin_set_term('2026/2027', 3, '2026-06-30', '2027-07-08', 10)$$) like '22023%');
select tests.ok('نهاية بعد السنة الدراسية', tests.err($$select public.admin_set_term('2026/2027', 3, '2027-03-19', '2027-10-01', 10)$$) like '22023%');
select tests.ok('وسيط فارغ', tests.err($$select public.admin_set_term('2026/2027', 3, null, '2027-07-08', 10)$$) like '22023%');
select tests.ok('تداخل مع فصل آخر: 23P01',
  tests.err($$select public.admin_set_term('2026/2027', 2, '2026-12-10', '2027-03-18', 10)$$) like '23P01%');
reset role;
select tests.ok('لا تغيّر في الجدول ولا سطر في السجلّ بعد كل الرفض',
  (select md5(string_agg(t::text, ',' order by term)) from public.term_calendar t) = :'cal1'
  and (select count(*) from private.audit_log) = :log1);

-- ============================================================
-- 4) سنة جديدة، وأثرها على قفل الأساتذة
-- ============================================================
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select public.admin_set_term('2027/2028', 1, '2027-09-01', '2027-12-16', 10);
select public.admin_set_term('2027/2028', 2, '2027-12-17', '2028-03-16', 10);
select public.admin_set_term('2027/2028', 3, '2028-03-17', '2028-07-06', 10);
reset role;
select tests.ok('ستة فصول في الجدول', (select count(*) from public.term_calendar) = 6);
select tests.ok('السنة الجديدة تُقرأ', (select count(*) from public.term_calendar where school_year = '2027/2028') = 3);
select tests.ok('وثلاثة أسطر سجلّ لها', (select count(*) from private.audit_log where action = 'set_term') >= 3);
-- مع السنة الجديدة: بعد 18 جويلية 2027 وقبل 1 سبتمبر 2027 لا فصل مفتوح، وبعد 17 أوت لا يُفتح كل شيء
select tests.ok('18 أوت 2027: ما يزال مقفلًا لأن الروزنامة تغطّيه',
  not private.term_open(1, '2027-08-18') and not private.term_open(2, '2027-08-18') and not private.term_open(3, '2027-08-18'));
select tests.ok('1 سبتمبر 2027: ف1 الجديد مفتوح', private.term_open(1, '2027-09-01') and not private.term_open(2, '2027-09-01'));

-- تعديل فصل يغيّر ما يقفله المحفّز
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select public.admin_set_term('2027/2028', 1, '2027-09-01', '2027-12-16', 0);
reset role;
select tests.ok('مهلة 0: ف1 يُقفل في اليوم التالي لنهايته', private.term_open(1, '2027-12-16') and not private.term_open(1, '2027-12-17'));

-- ============================================================
-- النتيجة
-- ============================================================
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
