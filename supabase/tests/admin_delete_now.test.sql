-- اختبارات ترحيل 20261030170000 (الحذف الفوري لحساب أستاذ، للمشرف وحده).
-- يُشغَّل بدور supabase_admin بعد ترحيل المشرف وهذا الترحيل، وبعد seed.sql.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set B '''bbbbbbbb-0000-4000-8000-00000000000b'''
\set M '''eeeeeeee-0000-4000-8000-00000000000e'''
\set M2 '''eeeeeeee-0000-4000-8000-0000000000e2'''
\set C '''cccccccc-0000-4000-8000-00000000000c'''
\set D '''dddddddd-0000-4000-8000-00000000000d'''
\set E '''ffffffff-0000-4000-8000-00000000000e'''
\set sM '''5e550000-0000-4000-8000-0000000000e1'''
\set sA '''5e550000-0000-4000-8000-0000000000a1'''

truncate tests.results;
insert into private.admins (user_id, note) values (:M, 'test') on conflict do nothing;
insert into auth.users (id, email, aud, role) values
  (:M2, 'admin2@school.dz', 'authenticated', 'authenticated'),
  (:C, 'c@school.dz', 'authenticated', 'authenticated'),
  (:D, 'd@school.dz', 'authenticated', 'authenticated'),
  (:E, 'e@school.dz', 'authenticated', 'authenticated');
insert into private.admins (user_id, note) values (:M2, 'second admin');
-- C له طلب حذف بمهلة جارية
insert into private.deletion_requests (user_id, requested_at, purge_after)
values (:C, now(), now() + interval '7 days');

create function tests.err(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'no error';
exception when others then return sqlstate || ' ' || sqlerrm; end $$;

-- رمز TOTP أُدخل قبل n دقيقة
create function tests.totp_ago(mins numeric) returns void language sql as $$
  update auth.mfa_amr_claims set updated_at = now() - make_interval(secs => mins * 60)
  where session_id = '5e550000-0000-4000-8000-0000000000e1' and authentication_method = 'totp';
$$;

select tests.fp(:A) as fpa_before \gset
select tests.rows_of(:B) as rowsb_before \gset
select count(*) as nstudb from public.students where teacher_id = :B \gset
select count(*) as nclassb from public.classes where teacher_id = :B \gset
select count(*) as nrecb from public.records where teacher_id = :B \gset
select count(*) as log0 from private.audit_log \gset
select tests.ok('B فيه بيانات تُحذف في الاختبار', :rowsb_before > 5);

-- ============================================================
-- 1) من يستطيع
-- ============================================================
select tests.totp_ago(0);
select tests.claims(:A, :sA, 'aal2');
set role authenticated;
select tests.ok('أستاذ (ولو aal2) لا يحذف: forbidden',
  tests.err($$select public.admin_delete_account_now('bbbbbbbb-0000-4000-8000-00000000000b', 'b@school.dz', 'اختبار')$$) = '42501 forbidden');
reset role;
select tests.claims(:M, :sM, 'aal1');
set role authenticated;
select tests.ok('المشرف بجلسة aal1: mfa_required',
  tests.err($$select public.admin_delete_account_now('bbbbbbbb-0000-4000-8000-00000000000b', 'b@school.dz', 'اختبار')$$) like '42501 mfa_required');
reset role;
set role anon;
select tests.fails('anon لا يستدعي', $$select public.admin_delete_account_now('bbbbbbbb-0000-4000-8000-00000000000b', 'b@school.dz', 'x')$$, '42501');
reset role;
select tests.ok('لا service_role ولا public',
  not has_function_privilege('service_role', 'public.admin_delete_account_now(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_delete_account_now(uuid,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_delete_account_now(uuid,text,text)', 'execute'));
select tests.ok('لم يُمسّ شيء', tests.rows_of(:B) = :rowsb_before and (select count(*) from private.audit_log) = :log0);

-- ============================================================
-- 2) رمز حديث (دقيقتان)
-- ============================================================
select tests.claims(:M, :sM, 'aal2');
select tests.totp_ago(30);
set role authenticated;
select tests.ok('رمز قبل 30 دقيقة (صالح للوحة): لا يكفي للحذف',
  tests.err($$select public.admin_delete_account_now('bbbbbbbb-0000-4000-8000-00000000000b', 'b@school.dz', 'اختبار')$$) = '42501 mfa_fresh_required');
reset role;
select tests.totp_ago(2.5);
set role authenticated;
select tests.ok('قبل دقيقتين ونصف: مرفوض',
  tests.err($$select public.admin_delete_account_now('bbbbbbbb-0000-4000-8000-00000000000b', 'b@school.dz', 'اختبار')$$) = '42501 mfa_fresh_required');
reset role;
select tests.ok('لا حذف ولا سجلّ', tests.rows_of(:B) = :rowsb_before and (select count(*) from private.audit_log) = :log0);
select tests.totp_ago(0);

-- ============================================================
-- 3) المدخلات
-- ============================================================
set role authenticated;
select tests.ok('بريد خاطئ: confirm_mismatch', tests.err($$select public.admin_delete_account_now('bbbbbbbb-0000-4000-8000-00000000000b', 'a@school.dz', 'اختبار')$$) = '22023 confirm_mismatch');
select tests.ok('بريد ناقص: confirm_mismatch', tests.err($$select public.admin_delete_account_now('bbbbbbbb-0000-4000-8000-00000000000b', 'b@school', 'اختبار')$$) = '22023 confirm_mismatch');
select tests.ok('بريد فارغ: confirm_mismatch', tests.err($$select public.admin_delete_account_now('bbbbbbbb-0000-4000-8000-00000000000b', '', 'اختبار')$$) = '22023 confirm_mismatch');
select tests.ok('بلا سبب: reason required', tests.err($$select public.admin_delete_account_now('bbbbbbbb-0000-4000-8000-00000000000b', 'b@school.dz', null)$$) = '22023 reason required');
select tests.ok('سبب حرفان: مرفوض', tests.err($$select public.admin_delete_account_now('bbbbbbbb-0000-4000-8000-00000000000b', 'b@school.dz', 'ab')$$) = '22023 reason required');
select tests.ok('سبب فراغات: مرفوض', tests.err($$select public.admin_delete_account_now('bbbbbbbb-0000-4000-8000-00000000000b', 'b@school.dz', '     ')$$) = '22023 reason required');
select tests.ok('هدف null: مرفوض', tests.err($$select public.admin_delete_account_now(null, 'b@school.dz', 'اختبار')$$) = '22023 invalid arguments');
select tests.ok('بريد null: مرفوض', tests.err($$select public.admin_delete_account_now('bbbbbbbb-0000-4000-8000-00000000000b', null, 'اختبار')$$) = '22023 invalid arguments');
select tests.ok('حساب غير موجود: P0002', tests.err($$select public.admin_delete_account_now('99999999-0000-4000-8000-000000000099', 'x@school.dz', 'اختبار')$$) = 'P0002 no such account');
select tests.ok('لا يحذف نفسه', tests.err($$select public.admin_delete_account_now('eeeeeeee-0000-4000-8000-00000000000e', 'admin@school.dz', 'اختبار')$$) = '42501 cannot delete an admin account');
select tests.ok('ولا مشرفًا آخر', tests.err($$select public.admin_delete_account_now('eeeeeeee-0000-4000-8000-0000000000e2', 'admin2@school.dz', 'اختبار')$$) = '42501 cannot delete an admin account');
reset role;
select tests.ok('كل المرفوضات لم تمسّ شيئًا ولم تُسجَّل',
  tests.rows_of(:B) = :rowsb_before and (select count(*) from private.audit_log) = :log0
  and (select count(*) from auth.users where id in (:M, :M2)) = 2);

-- ============================================================
-- 4) الحذف: بريد بحروف مختلفة وفراغات، ومعه كل ما يتبعه
-- ============================================================
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select public.admin_delete_account_now(:B, '  B@School.DZ ', 'طلب الأستاذ كتابيًّا') as res \gset
reset role;
select tests.ok('الحساب محذوف من auth', not exists (select 1 from auth.users where id = :B));
select tests.ok('وكل بياناته (teachers والأقسام والتلاميذ والعلامات والقراءات والتّب)', tests.rows_of(:B) = 0);
select tests.ok('الردّ بالأعداد', (:'res'::jsonb ->> 'students')::int = :nstudb and (:'res'::jsonb ->> 'classes')::int = :nclassb and (:'res'::jsonb ->> 'records')::int = :nrecb);
select tests.ok('بيانات A لم تُمسّ', tests.fp(:A) = :'fpa_before');
select tests.ok('سُجّل مرة واحدة بالفعل admin_purge ومن فعل', (select count(*) from private.audit_log) = :log0 + 1
  and (select (action, actor_kind, actor_id, target_id) = ('admin_purge', 'admin', :M::uuid, :B::uuid) from private.audit_log order by id desc limit 1));
select tests.ok('السجلّ فيه الأعداد والسبب وبريد مقنَّع لا كامل',
  (select detail ->> 'email_masked' from private.audit_log order by id desc limit 1) = 'b***@school.dz'
  and (select detail ->> 'reason' from private.audit_log order by id desc limit 1) = 'طلب الأستاذ كتابيًّا'
  and (select (detail ->> 'students')::int from private.audit_log order by id desc limit 1) = :nstudb
  and (select detail::text from private.audit_log order by id desc limit 1) not like '%b@school.dz%');
select tests.ok('إعادة المحاولة على المحذوف: P0002', (
  select tests.err(format($$select public.admin_delete_account_now(%L, 'b@school.dz', 'مرة ثانية')$$, :B)) = 'P0002 no such account'));

-- طلب حذف بمهلة جارية يُمحى معه
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('حذف C وله طلب حذف قائم: مقبول',
  tests.err($$select public.admin_delete_account_now('cccccccc-0000-4000-8000-00000000000c', 'c@school.dz', 'تجاوز المهلة بطلب منه')$$) = 'no error');
reset role;
select tests.ok('طلب الحذف القائم مُحي معه', not exists (select 1 from private.deletion_requests where user_id = :C));

-- ============================================================
-- 5) الحدّ: ثلاثة في 24 ساعة
-- ============================================================
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('الثالث مقبول', tests.err($$select public.admin_delete_account_now('dddddddd-0000-4000-8000-00000000000d', 'd@school.dz', 'اختبار الحدّ')$$) = 'no error');
select tests.ok('الرابع مرفوض: rate_limited', tests.err($$select public.admin_delete_account_now('ffffffff-0000-4000-8000-00000000000e', 'e@school.dz', 'اختبار الحدّ')$$) = 'P0001 rate_limited');
reset role;
select tests.ok('E لم يُحذف ولم يُسجَّل شيء', exists (select 1 from auth.users where id = :E)
  and (select count(*) from private.audit_log where action = 'admin_purge') = 3);
-- أقدم عملية تتجاوز 24 ساعة فيتّسع الحدّ
update private.audit_log set at = now() - interval '25 hours'
 where id = (select min(id) from private.audit_log where action = 'admin_purge');
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('بعد مرور 24 ساعة على أقدمها: مقبول', tests.err($$select public.admin_delete_account_now('ffffffff-0000-4000-8000-00000000000e', 'e@school.dz', 'بعد النافذة')$$) = 'no error');
reset role;
select tests.ok('E حُذف', not exists (select 1 from auth.users where id = :E));

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
