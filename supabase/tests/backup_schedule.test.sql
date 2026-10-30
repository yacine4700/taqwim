-- اختبارات ترحيل 20261030140000 (جدولة النسخ الاحتياطي).
-- يُشغَّل بدور supabase_admin بعد ترحيلات المشرف والرزنامة وهذا الترحيل، وبعد seed.sql.
-- كل تواريخ القرار ثابتة (تُمرَّر في p_now)، فلا يتغيّر الاختبار بتغيّر اليوم.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set M '''eeeeeeee-0000-4000-8000-00000000000e'''
\set sM '''5e550000-0000-4000-8000-0000000000e1'''
\set sA '''5e550000-0000-4000-8000-0000000000a1'''

truncate tests.results;
insert into private.admins (user_id, note) values (:M, 'test') on conflict do nothing;

-- الرزنامة كما في الإنتاج (exams_from فارغ = 14 يومًا قبل النهاية)
delete from public.term_calendar;
insert into public.term_calendar (school_year, term, starts_on, ends_on) values
  ('2026/2027', 1, '2026-09-01', '2026-12-17'),
  ('2026/2027', 2, '2026-12-18', '2027-03-18'),
  ('2026/2027', 3, '2027-03-19', '2027-07-08');

-- كل تنقيط البذور قديم، ليُتحكَّم بالعدّ يدويًا
set session_replication_role = replica;
update public.records set updated_at = '2026-01-01';
update public.tp_marks set updated_at = '2026-01-01';
update public.readings set created_at = '2026-01-01';
reset session_replication_role;

create function tests.err(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'no error';
exception when others then return sqlstate || ' ' || sqlerrm; end $$;

-- قرار ليوم ولحظة نسخة سابقة (بتوقيت الجزائر)
create function tests.dec(now_local text, last_local text, thr int default 50)
returns text language sql as $$
  select run::text || ' | ' || why from private.backup_decision(
    case when last_local is null then null else (last_local || '+01')::timestamptz end,
    (now_local || '+01')::timestamptz, thr)
$$;
create function tests.run(now_local text, last_local text, thr int default 50)
returns boolean language sql as $$
  select run from private.backup_decision(
    case when last_local is null then null else (last_local || '+01')::timestamptz end,
    (now_local || '+01')::timestamptz, thr)
$$;

-- ============================================================
-- 1) الجدولة العادية: أسبوعي ليلة الخميس إلى الجمعة
-- ============================================================
select tests.ok('جمعة عادية (6 نوفمبر): ينسخ أسبوعيًّا',
  tests.run('2026-11-06 02:23', '2026-10-30 02:30'));
select tests.ok('السبت بعدها: لا ينسخ (نسخة الأمس موجودة)',
  not tests.run('2026-11-07 02:23', '2026-11-06 02:30'));
select tests.ok('اثنين عادي بعد جمعة: لا ينسخ',
  not tests.run('2026-11-02 02:23', '2026-10-30 02:30'));
select tests.ok('الأربعاء بعد جمعة: لا ينسخ', not tests.run('2026-11-04 02:23', '2026-10-30 02:30'));
select tests.ok('الخميس قبل الجمعة: لا ينسخ', not tests.run('2026-11-05 02:23', '2026-10-30 02:30'));
select tests.ok('فاتت الجمعة: السبت ينسخ (مرّت 8 أيام)',
  tests.run('2026-11-07 02:23', '2026-10-30 02:30'));
select tests.ok('7 أيام بالضبط في يوم غير الجمعة: ينسخ',
  tests.run('2026-11-12 02:23', '2026-11-05 02:30'));
select tests.ok('6 أيام في يوم غير الجمعة: لا ينسخ',
  not tests.run('2026-11-11 02:23', '2026-11-05 02:30'));
select tests.ok('لا نسخة سابقة: ينسخ', tests.run('2026-11-04 02:23', null));
select tests.ok('اليوم بتوقيت الجزائر لا UTC: 23:30 UTC يوم الخميس هو الجمعة 00:30',
  (select run from private.backup_decision('2026-10-30 02:30+01', '2026-11-05 23:30+00', 50)));

-- ============================================================
-- 2) نافذة الاختبارات: يومي
-- ============================================================
select tests.ok('أول يوم في النافذة الافتراضية (3 ديسمبر = 17 − 14): ينسخ',
  tests.run('2026-12-03 02:23', '2026-12-02 02:30'));
select tests.ok('قبلها بيوم (2 ديسمبر، أربعاء): لا ينسخ',
  not tests.run('2026-12-02 02:23', '2026-12-01 02:30'));
select tests.ok('آخر يوم في المهلة (17 ديسمبر + 10 = 27 ديسمبر): ينسخ',
  tests.run('2026-12-27 02:23', '2026-12-26 02:30'));
select tests.ok('اليوم التالي للمهلة (28 ديسمبر، اثنين): لا ينسخ',
  not tests.run('2026-12-28 02:23', '2026-12-27 02:30'));
select tests.ok('داخل النافذة لكن نسخة اليوم موجودة: لا ينسخ',
  not tests.run('2026-12-10 02:23', '2026-12-10 01:00'));
select tests.ok('ف2: النافذة 4 مارس 2027 (18 مارس − 14)',
  tests.run('2027-03-04 02:23', '2027-03-03 02:30') and not tests.run('2027-03-03 02:23', '2027-03-02 02:30'));
select tests.ok('ف3: الافتراضي 24 جوان 2027 (8 جويلية − 14)',
  tests.run('2027-06-24 02:23', '2027-06-23 02:30') and not tests.run('2027-06-23 02:23', '2027-06-22 02:30'));
select tests.ok('وسبب النافذة يذكر الفصل', tests.dec('2026-12-03 02:23', '2026-12-02 02:30') like 'true | exam window: term 1%');

-- ============================================================
-- 3) نشاط التنقيط
-- ============================================================
set session_replication_role = replica;
update public.records set updated_at = '2026-11-02 12:00+01'; -- 6 صفوف في البذور
reset session_replication_role;
select count(*) as nrec from public.records \gset
select tests.ok('البذور فيها تنقيط كافٍ للاختبار', :nrec >= 6);
select tests.ok(format('%s تنقيطات منذ آخر نسخة > عتبة 5: ينسخ في يوم عادي', :nrec),
  tests.run('2026-11-04 02:23', '2026-11-02 02:30', 5));
select tests.ok('وتحت العتبة الافتراضية 50: لا ينسخ', not tests.run('2026-11-04 02:23', '2026-11-02 02:30'));
select tests.ok('التنقيط قبل آخر نسخة لا يُحسب',
  not tests.run('2026-11-04 02:23', '2026-11-03 02:30', 0));
select tests.ok('وسبب النشاط يذكر العدد', tests.dec('2026-11-04 02:23', '2026-11-02 02:30', 5) like 'true | % marks written%');
-- القراءات وحدها تكفي لتجاوز العتبة
set session_replication_role = replica;
update public.records set updated_at = '2026-01-01';
update public.readings set created_at = '2026-11-02 12:00+01';
reset session_replication_role;
select tests.ok('قراءات الحصص (readings) تُحسب أيضًا',
  tests.run('2026-11-04 02:23', '2026-11-02 02:30', 5));
set session_replication_role = replica;
update public.readings set created_at = '2026-01-01';
update public.tp_marks set updated_at = '2026-11-02 12:00+01';
reset session_replication_role;
select count(*) as nmarks from public.tp_marks \gset
select tests.ok('وعلامات TP تُحسب أيضًا (إن وُجدت في البذور)',
  :nmarks = 0 or tests.run('2026-11-04 02:23', '2026-11-02 02:30', :nmarks - 1));
set session_replication_role = replica;
update public.tp_marks set updated_at = '2026-01-01';
reset session_replication_role;

-- ============================================================
-- 4) التحكم اليدوي (مباشرة في الجدول لتواريخ ثابتة)
-- ============================================================
update private.backup_control set mode = 'paused', until = '2026-11-10', reason = 'عطلة' where id;
select tests.ok('موقوف: الجمعة لا ينسخ', not tests.run('2026-11-06 02:23', '2026-10-30 02:30'));
select tests.ok('آخر يوم من التوقيف (10 نوفمبر) ما زال موقوفًا', not tests.run('2026-11-10 02:23', '2026-10-30 02:30'));
select tests.ok('وبعد انتهائه (11 نوفمبر) يعود وحده: ينسخ', tests.run('2026-11-11 02:23', '2026-10-30 02:30'));
select tests.ok('بلا نسخة سابقة وهو موقوف: لا ينسخ', not tests.run('2026-11-06 02:23', null));
update private.backup_control set until = '2026-12-10' where id;
select tests.ok('الإيقاف يغلب نافذة الاختبارات', not tests.run('2026-12-05 02:23', '2026-12-04 02:30'));
select tests.ok('وسببه يظهر في الجواب', tests.dec('2026-12-05 02:23', '2026-12-04 02:30') like 'false | paused until 2026-12-10: عطلة');

update private.backup_control set mode = 'daily', until = '2026-11-10', reason = 'إدخال كثيف' where id;
select tests.ok('يومي يدوي: الأربعاء ينسخ', tests.run('2026-11-04 02:23', '2026-11-03 02:30'));
select tests.ok('يومي يدوي لكن نسخة اليوم موجودة: لا ينسخ', not tests.run('2026-11-04 02:23', '2026-11-04 01:00'));
select tests.ok('وبعد انتهاء اليومي (11 نوفمبر): لا ينسخ', not tests.run('2026-11-11 02:23', '2026-11-10 02:30'));

update private.backup_control set mode = 'auto', until = null, reason = null where id;

-- القيد: لا تجاوز بلا تاريخ ولا سبب
select tests.fails('paused بلا تاريخ مرفوض في الجدول',
  $$update private.backup_control set mode = 'paused', reason = 'x' where id$$, '23514');
select tests.fails('daily بلا سبب مرفوض في الجدول',
  $$update private.backup_control set mode = 'daily', until = '2026-11-10' where id$$, '23514');
select tests.fails('سبب فراغات مرفوض',
  $$update private.backup_control set mode = 'daily', until = '2026-11-10', reason = '  ' where id$$, '23514');
select tests.fails('لا صفّ ثانٍ',
  $$insert into private.backup_control (id, mode) values (false, 'auto')$$, '23514');
select tests.ok('صفّ واحد', (select count(*) from private.backup_control) = 1);

-- ============================================================
-- 5) دوال المشرف
-- ============================================================
select count(*) as log0 from private.audit_log \gset

select tests.claims(:A, :sA, 'aal2');
set role authenticated;
select tests.ok('أستاذ لا يغيّر النسخ: forbidden',
  tests.err($$select public.admin_set_backup('paused', (now() + interval '3 days')::date, 'x')$$) = '42501 forbidden');
select tests.ok('أستاذ لا يقرأ الحالة: forbidden', tests.err($$select public.admin_backup_status()$$) = '42501 forbidden');
select tests.ok('أستاذ لا يعدّل exams_from: forbidden',
  tests.err($$select public.admin_set_exams_from('2026/2027', 1, '2026-12-01')$$) = '42501 forbidden');
select tests.fails('الأستاذ لا يقرأ الجدول مباشرة', $$select * from private.backup_control$$, '42501');
reset role;

select tests.claims(:M, :sM, 'aal1');
set role authenticated;
select tests.ok('المشرف بلا aal2: mfa_required',
  tests.err($$select public.admin_set_backup('paused', (now() + interval '3 days')::date, 'x')$$) like '42501 mfa_required');
reset role;

set role anon;
select tests.fails('anon لا يستدعي', $$select public.admin_backup_status()$$, '42501');
reset role;
select tests.ok('service_role لا يملك تشغيلها', not has_function_privilege('service_role', 'public.admin_set_backup(text,date,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_backup_status()', 'execute')
  and not has_function_privilege('authenticated', 'private.backup_decision(timestamptz,timestamptz,integer)', 'execute'));
select tests.ok('لم يتغيّر شيء', (select mode from private.backup_control) = 'auto' and (select count(*) from private.audit_log) = :log0);

select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('المشرف: حالة أسبوعية في يوم عادي (أو يومية إن وقع الاختبار في نافذة)',
  (public.admin_backup_status() ->> 'schedule') in ('weekly', 'daily_exams'));
-- التحقّق من المدخلات
select tests.ok('نمط غير معروف مرفوض', tests.err($$select public.admin_set_backup('stop', (now() + interval '3 days')::date, 'x')$$) = '22023 invalid mode');
select tests.ok('تاريخ اليوم نفسه مرفوض', tests.err($$select public.admin_set_backup('paused', (now() at time zone 'Africa/Algiers')::date, 'x')$$) like '22023%');
select tests.ok('تاريخ ماضٍ مرفوض', tests.err($$select public.admin_set_backup('paused', (now() - interval '2 days')::date, 'x')$$) like '22023%');
select tests.ok('بعد 31 يومًا مرفوض', tests.err($$select public.admin_set_backup('paused', ((now() at time zone 'Africa/Algiers')::date + 31), 'x')$$) like '22023%');
select tests.ok('بلا تاريخ مرفوض', tests.err($$select public.admin_set_backup('daily', null, 'x')$$) like '22023%');
select tests.ok('بلا سبب مرفوض', tests.err($$select public.admin_set_backup('paused', ((now() at time zone 'Africa/Algiers')::date + 3), null)$$) = '22023 reason required');
select tests.ok('سبب فراغات مرفوض', tests.err($$select public.admin_set_backup('paused', ((now() at time zone 'Africa/Algiers')::date + 3), '   ')$$) = '22023 reason required');
reset role;
select tests.ok('المرفوضات لم تغيّر شيئًا ولم تسجّل', (select mode from private.backup_control) = 'auto' and (select count(*) from private.audit_log) = :log0);

select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('توقيف 30 يومًا بالضبط مقبول',
  tests.err($$select public.admin_set_backup('paused', ((now() at time zone 'Africa/Algiers')::date + 30), '  عطلة الشتاء  ')$$) = 'no error');
select tests.ok('الحالة موقوف', public.admin_backup_status() ->> 'schedule' = 'paused'
  and public.admin_backup_status() ->> 'reason' = 'عطلة الشتاء');
reset role;
select tests.ok('كُتب في الجدول وسُجّل مرة واحدة بالقيم السابقة',
  (select mode = 'paused' and reason = 'عطلة الشتاء' and updated_by = :M from private.backup_control)
  and (select count(*) from private.audit_log) = :log0 + 1
  and (select detail #>> '{previous,mode}' from private.audit_log where action = 'set_backup' order by id desc limit 1) = 'auto');

select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('يومي يدوي غدًا', tests.err($$select public.admin_set_backup('daily', ((now() at time zone 'Africa/Algiers')::date + 1), 'استيراد أقسام')$$) = 'no error');
select tests.ok('وحالته يومي يدوي', public.admin_backup_status() ->> 'schedule' = 'daily_override');
select tests.ok('auto يلغي التجاوز ولو بلا تاريخ وسبب', tests.err($$select public.admin_set_backup('auto')$$) = 'no error');
reset role;
select tests.ok('عاد auto وفرغ التاريخ والسبب',
  (select mode = 'auto' and until is null and reason is null from private.backup_control)
  and (select count(*) from private.audit_log) = :log0 + 3);

-- نافذة الاختبارات من المشرف
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('exams_from قبل بداية الفصل مرفوض', tests.err($$select public.admin_set_exams_from('2026/2027', 1, '2026-08-31')$$) = '22023 exams_from outside the term');
select tests.ok('وبعد نهايته مرفوض', tests.err($$select public.admin_set_exams_from('2026/2027', 1, '2026-12-18')$$) = '22023 exams_from outside the term');
select tests.ok('فصل غير موجود مرفوض', tests.err($$select public.admin_set_exams_from('2030/2031', 1, '2030-12-01')$$) = '22023 term not found');
select tests.ok('تعديل صحيح', tests.err($$select public.admin_set_exams_from('2026/2027', 1, '2026-11-19', 'اختبارات مبكرة')$$) = 'no error');
reset role;
select tests.ok('النافذة تبدأ الآن 19 نوفمبر (خميس): ينسخ', tests.run('2026-11-19 02:23', '2026-11-18 02:30'));
select tests.ok('وقبلها بيوم لا ينسخ', not tests.run('2026-11-18 02:23', '2026-11-17 02:30'));
select tests.ok('سُجّل بالقيمة السابقة (فارغة)',
  (select detail ->> 'exams_from' from private.audit_log where action = 'set_exams' order by id desc limit 1) = '2026-11-19'
  and (select detail ->> 'reason' from private.audit_log where action = 'set_exams' order by id desc limit 1) = 'اختبارات مبكرة');
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select public.admin_set_exams_from('2026/2027', 1, null);
reset role;
select tests.ok('null يعيد الافتراضي (3 ديسمبر)', not tests.run('2026-11-19 02:23', '2026-11-18 02:30') and tests.run('2026-12-03 02:23', '2026-12-02 02:30'));
select tests.fails('قيد الجدول: exams_from خارج الفصل',
  $$update public.term_calendar set exams_from = '2027-01-01' where term = 1$$, '23514');

-- admin_set_term القائمة لا تمسّ exams_from، لكن قيد الجدول يمنع نقل النهاية قبله
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select public.admin_set_exams_from('2026/2027', 1, '2026-12-05');
select tests.ok('تقديم نهاية الفصل مع بقاء exams_from قبلها مقبول',
  tests.err($$select public.admin_set_term('2026/2027', 1, '2026-09-01', '2026-12-15', 10)$$) = 'no error');
select tests.ok('وexams_from كما هو', (select exams_from from public.term_calendar where term = 1) = '2026-12-05');
select tests.ok('لكن نقل النهاية قبل exams_from مرفوض (23514)',
  tests.err($$select public.admin_set_term('2026/2027', 1, '2026-09-01', '2026-12-04', 10)$$) like '23514%');
reset role;

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
  select 1 / 0; -- يوقف psql بخطأ فيفشل المُشغِّل
\endif
