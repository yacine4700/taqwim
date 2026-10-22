-- اختبارات ترحيل 20261022130000. يُشغَّل بدور supabase_admin بعد الترحيل.
-- كل اختبار يكتب سطرًا في tests.results؛ يفشل التشغيل إن كان أيٌّ منها false.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set B '''bbbbbbbb-0000-4000-8000-00000000000b'''
\set M '''eeeeeeee-0000-4000-8000-00000000000e'''
\set sA '''5e550000-0000-4000-8000-0000000000a1'''
\set sA_old '''5e550000-0000-4000-8000-0000000000a2'''
\set sB '''5e550000-0000-4000-8000-0000000000b1'''
\set sM '''5e550000-0000-4000-8000-0000000000e1'''

-- الخطوة اليدوية بعد الترحيل: تعيين المشرف.
insert into private.admins (user_id, note) values (:M, 'test');

select tests.fp(:A) as fp_a0 \gset
select tests.fp(:B) as fp_b0 \gset
select tests.fp(:M) as fp_m0 \gset

-- ============================================================
-- 1) العزل: الأستاذ لا يرى غيره ولا بيانات المشرف
-- ============================================================
select tests.claims(:A, :sA);
set role authenticated;
select tests.ok('A يرى تلاميذه الثلاثة فقط', (select count(*) from public.students) = 3);
select tests.ok('A لا يرى علامات B', (select count(*) from public.records where teacher_id = :B) = 0);
select tests.ok('A لا يعدّل علامات B (0 صفوف)',
  tests.val($$with u as (update public.records set devoir = 0 where teacher_id = 'bbbbbbbb-0000-4000-8000-00000000000b' returning 1) select count(*) from u$$) = '0');
select tests.fails('A لا يقرأ private.admins', 'select * from private.admins', '42501');
select tests.fails('A لا يقرأ private.audit_log', 'select * from private.audit_log', '42501');
select tests.fails('A لا يقرأ private.deletion_requests', 'select * from private.deletion_requests', '42501');
select tests.fails('A لا يكتب في private.admins', $$insert into private.admins (user_id) values ('aaaaaaaa-0000-4000-8000-00000000000a')$$, '42501');
select tests.fails('A لا يستدعي admin_list_teachers', 'select * from public.admin_list_teachers()', '42501');
select tests.fails('A لا يعطّل B', $$select public.admin_set_disabled('bbbbbbbb-0000-4000-8000-00000000000b', true)$$, '42501');
select tests.fails('A لا يقرأ السجلّ', 'select * from public.admin_log_recent()', '42501');
select tests.fails('A لا يستدعي الحذف النهائي', 'select private.purge_deleted_accounts()', '42501');
select tests.fails('A لا يستدعي is_admin مباشرة', 'select private.is_admin()', '42501');
-- A يحاول أن يصير مشرفًا عبر جلسة aal2 مزوّرة في claims: لا يكفي لأنه ليس في الجدول.
select tests.claims(:A, :sA, 'aal2');
select tests.fails('A بجلسة aal2 ليس مشرفًا', 'select * from public.admin_list_teachers()', '42501');
reset role;

set role anon;
select set_config('request.jwt.claims', '', false);
select tests.fails('anon لا يستدعي دوال المشرف', 'select * from public.admin_list_teachers()', '42501');
select tests.fails('anon لا يطلب حذفًا', 'select public.request_account_deletion()', '42501');
reset role;

-- ============================================================
-- 2) المشرف
-- ============================================================
select tests.claims(:M, :sM, 'aal1');
set role authenticated;
select tests.fails('المشرف بجلسة aal1 مرفوض', 'select * from public.admin_list_teachers()', '42501');
select tests.claims(:M, :sM, 'aal2');
select tests.ok('المشرف aal2 يرى 3 حسابات', (select count(*) from public.admin_list_teachers()) = 3);
select tests.ok('أعداد A صحيحة (1 قسم، 3 تلاميذ، 3 سجلات)',
  (select classes = 1 and students = 3 and records = 3 and status = 'active' from public.admin_list_teachers() where id = :A));
select tests.ok('المشرف لا يرى تلاميذ أحد', (select count(*) from public.students) = 0);
select tests.ok('المشرف لا يرى علامات أحد', (select count(*) from public.records) + (select count(*) from public.tp_marks) + (select count(*) from public.readings) = 0);
select tests.fails('المشرف لا يقرأ private.admins مباشرة', 'select * from private.admins', '42501');
select tests.fails('المشرف لا يعطّل نفسه', $$select public.admin_set_disabled('eeeeeeee-0000-4000-8000-00000000000e', true)$$, '42501');
select tests.fails('المشرف لا يعطّل حسابًا غير موجود', $$select public.admin_set_disabled('00000000-0000-4000-8000-000000000000', true)$$, 'P0002');
select tests.fails('المشرف لا يستدعي الحذف النهائي', 'select private.purge_deleted_accounts()', '42501');
reset role;

-- أعمدة القائمة: لا شيء من محتوى البيانات.
select tests.ok('القائمة لا تعيد أسماء تلاميذ ولا علامات',
  (select string_agg(a, ',' order by a) from unnest(
     (select proargnames from pg_proc where oid = 'public.admin_list_teachers()'::regprocedure)) a)
  = 'banned_until,classes,created_at,email,full_name,id,is_admin,last_activity,last_sign_in_at,purge_after,records,status,students',
  (select array_to_string(proargnames, ',') from pg_proc where oid = 'public.admin_list_teachers()'::regprocedure));

-- ============================================================
-- 3) التعطيل
-- ============================================================
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select public.admin_set_disabled(:B, true);
reset role;
select tests.ok('التعطيل يضع banned_until في المستقبل', (select banned_until > now() + interval '50 years' from auth.users where id = :B));
select tests.ok('التعطيل يحذف جلسات B (فلا تجديد)', (select count(*) from auth.sessions where user_id = :B) = 0);
select tests.ok('التعطيل لا يغيّر بيانات B', tests.fp(:B) = :'fp_b0');
-- B ما زال يحمل access token صادرًا قبل التعطيل:
select tests.claims(:B, :sB);
set role authenticated;
select tests.ok('B الموقوف لا يقرأ شيئًا بتوكنه القديم', (select count(*) from public.students) + (select count(*) from public.teachers) = 0);
select tests.fails('B الموقوف لا يضيف', $$insert into public.schools (teacher_id, name) values ('bbbbbbbb-0000-4000-8000-00000000000b', 'x')$$, '42501');
select tests.ok('B الموقوف: my_account_status يقول writes_blocked', (public.my_account_status() ->> 'writes_blocked')::boolean);
select tests.ok('B الموقوف لا يعدّل (0 صفوف)',
  tests.val($$with u as (update public.records set devoir = 0 returning 1) select count(*) from u$$) = '0');
reset role;
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('القائمة تُظهر B موقوفًا', (select status from public.admin_list_teachers() where id = :B) = 'disabled');
select public.admin_set_disabled(:B, false);
reset role;
select tests.ok('إعادة التفعيل ترفع الإيقاف', (select banned_until is null from auth.users where id = :B));
select tests.ok('بيانات B كما كانت بعد الإعادة', tests.fp(:B) = :'fp_b0');
select tests.claims(:B, :sB);
set role authenticated;
select tests.ok('B يقرأ بياناته بعد الإعادة', (select count(*) from public.students) = 3);
reset role;

-- ============================================================
-- 4) طلب الحذف: إثبات إدخال كلمة المرور من جداول الخادم
-- ============================================================
set role authenticated;
select tests.claims(:A, null);
select tests.fails('بلا session_id: مرفوض', 'select public.request_account_deletion()', 'P0001');
select tests.claims(:A, :sA_old);
select tests.fails('كلمة المرور قبل 11 دقيقة: مرفوض', 'select public.request_account_deletion()', 'P0001');
select tests.claims(:A, :sB);
select tests.fails('session_id لجلسة أستاذ آخر: مرفوض', 'select public.request_account_deletion()', 'P0001');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated","session_id":"not-a-uuid"}', false);
select tests.fails('session_id غير صالح: مرفوض', 'select public.request_account_deletion()', 'P0001');
reset role;
-- جلسة A الحديثة بلا سطر password (دخل برابط بريد مثلًا):
update auth.mfa_amr_claims set authentication_method = 'otp' where session_id = :sA;
select tests.claims(:A, :sA);
set role authenticated;
select tests.fails('جلسة بلا كلمة مرور (otp): مرفوض', 'select public.request_account_deletion()', 'P0001');
reset role;
update auth.mfa_amr_claims set authentication_method = 'password' where session_id = :sA;
-- جلسة منتهية (not_after في الماضي):
update auth.sessions set not_after = now() - interval '1 minute' where id = :sA;
set role authenticated;
select tests.fails('جلسة منتهية: مرفوض', 'select public.request_account_deletion()', 'P0001');
reset role;
update auth.sessions set not_after = null where id = :sA;
select tests.ok('لا طلب حذف بعد كل المحاولات المرفوضة', (select count(*) from private.deletion_requests) = 0);

set role authenticated;
select public.request_account_deletion() as due \gset
select tests.ok('الطلب الصحيح يحدّد الحذف بعد 7 أيام',
  (:'due')::timestamptz between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute');
select tests.ok('my_account_status يعيد موعد الحذف', (public.my_account_status() ->> 'purge_after') is not null);

-- خلال المهلة: قراءة نعم، كتابة لا.
select tests.ok('خلال المهلة: A يقرأ بياناته (لـ«نسختي»)', (select count(*) from public.students) = 3);
select tests.fails('خلال المهلة: لا إضافة', $$insert into public.schools (teacher_id, name) values ('aaaaaaaa-0000-4000-8000-00000000000a', 'x')$$, '42501');
select tests.ok('خلال المهلة: لا تعديل (0 صفوف)', tests.val($$with u as (update public.records set devoir = 1 returning 1) select count(*) from u$$) = '0');
select tests.ok('خلال المهلة: لا حذف (0 صفوف)', tests.val($$with d as (delete from public.readings returning 1) select count(*) from d$$) = '0');
select tests.ok('خلال المهلة: لا تعديل للملف الشخصي', tests.val($$with u as (update public.teachers set full_name = 'x' returning 1) select count(*) from u$$) = '0');
select tests.fails('delete_my_account لم تعد متاحة', 'select public.delete_my_account()', '42501');
reset role;
select tests.ok('بيانات A لم تتغيّر خلال المهلة', tests.fp(:A) = :'fp_a0');

-- طلب ثانٍ لا يؤخّر الموعد الأول.
update private.deletion_requests set requested_at = requested_at - interval '1 day', purge_after = purge_after - interval '1 day' where user_id = :A;
select purge_after::text as due1 from private.deletion_requests where user_id = :A \gset
set role authenticated;
select public.request_account_deletion();
reset role;
select tests.ok('تكرار الطلب لا يغيّر الموعد', (select purge_after::text from private.deletion_requests where user_id = :A) = :'due1');

-- الطابور خلال المهلة: لماذا يسأل التطبيق قبل إرسال الحذف، وأن الإعادة بعد الإلغاء لا تكرّر.
set role authenticated;
select tests.ok('my_account_status: writes_blocked خلال المهلة', (public.my_account_status() ->> 'writes_blocked')::boolean);
select tests.ok('حذف محاولة قراءة خلال المهلة: «ينجح» على صفر صفوف بلا خطأ (فلا يُرسل والحساب مجمَّد)',
  tests.val($$with d as (delete from public.readings where id = (select id from public.readings limit 1) returning 1) select count(*) from d$$) = '0');
select tests.fails('upsert محاولة قراءة خلال المهلة: رفض صريح 42501',
  $$insert into public.readings (id, teacher_id, student_id, term, score) select '7e570000-0000-4000-8000-000000000001', teacher_id, id, 1, 3 from public.students limit 1 on conflict (id) do update set score = excluded.score$$, '42501');
reset role;
-- الإلغاء من الأستاذ.
set role authenticated;
select tests.ok('A يلغي الطلب', public.cancel_account_deletion());
select tests.ok('بعد الإلغاء: الكتابة تعود',
  tests.val($$with u as (update public.records set devoir = devoir returning 1) select count(*) from u$$) = '3');
reset role;
select tests.ok('بعد الإلغاء: بيانات A كما كانت حرفًا بحرف', tests.fp(:A) = :'fp_a0');

select tests.ok('بعد الإلغاء: writes_blocked = false', not (public.my_account_status() ->> 'writes_blocked')::boolean);
-- العملية المحفوظة في الطابور تُرسل بعد الإلغاء مرتين (إعادة بعد ردّ ضائع): صفّ واحد.
select tests.val($$insert into public.readings (id, teacher_id, student_id, term, score) select '7e570000-0000-4000-8000-000000000001', teacher_id, id, 1, 3 from public.students order by id limit 1 on conflict (id) do update set score = excluded.score returning 1$$);
select tests.val($$insert into public.readings (id, teacher_id, student_id, term, score) select '7e570000-0000-4000-8000-000000000001', teacher_id, id, 1, 3 from public.students order by id limit 1 on conflict (id) do update set score = excluded.score returning 1$$);
select tests.ok('بعد الإلغاء: المحاولة المؤجّلة سُجّلت مرة واحدة', (select count(*) from public.readings where id = '7e570000-0000-4000-8000-000000000001') = 1);
delete from public.readings where id = '7e570000-0000-4000-8000-000000000001';
reset role;
select tests.fp(:A) as fp_a0 \gset
select tests.claims(:A, :sA);
set role authenticated;
-- الإلغاء من المشرف.
select tests.claims(:A, :sA);
set role authenticated;
select public.request_account_deletion();
select tests.claims(:M, :sM, 'aal2');
select tests.ok('القائمة تُظهر A مجدولًا للحذف', (select status from public.admin_list_teachers() where id = :A) = 'deletion_pending');
select tests.ok('المشرف يلغي حذف A', public.admin_cancel_deletion(:A));
select tests.ok('السجلّ يقرؤه المشرف', (select count(*) from public.admin_log_recent(100)) >= 5);
reset role;
select tests.ok('لا طلبات معلّقة بعد الإلغاء', (select count(*) from private.deletion_requests) = 0);

-- ============================================================
-- 5) الحذف النهائي
-- ============================================================
select tests.fp(:B) as fp_b1 \gset
insert into private.deletion_requests (user_id, requested_at, purge_after) values
  (:A, now() - interval '8 days', now() - interval '1 day'),   -- انتهت مهلته
  (:B, now() - interval '1 day', now() + interval '6 days');   -- ما زال في المهلة
set role taqwim_purger;
select tests.fails('دور الحذف لا يقرأ public', 'select count(*) from public.students', '42501');
select tests.fails('دور الحذف لا يقرأ private.deletion_requests', 'select * from private.deletion_requests', '42501');
select tests.fails('دور الحذف لا يستدعي دوال المشرف', 'select * from public.admin_list_teachers()', '42501');
select private.purge_deleted_accounts() as purged \gset
reset role;
select tests.ok('حُذف حساب واحد', :purged = 1);
select tests.ok('A وكل بياناته حُذفت', tests.rows_of(:A) = 0 and not exists (select 1 from auth.users where id = :A));
select tests.ok('B في المهلة لم يُمسّ', tests.fp(:B) = :'fp_b1' and exists (select 1 from private.deletion_requests where user_id = :B));
select tests.ok('حساب المشرف لم يُمسّ', tests.fp(:M) = :'fp_m0');
select tests.ok('الحذف مسجّل في السجلّ', exists (select 1 from private.audit_log where action = 'purge' and target_id = :A));
delete from private.deletion_requests where user_id = :B;

-- حاجز العدد: 6 حسابات مستحقّة > الحدّ 5 ⇒ لا يُحذف شيء.
insert into auth.users (id, email, aud, role)
select gen_random_uuid(), 'bulk' || g || '@x.dz', 'authenticated', 'authenticated' from generate_series(1, 6) g;
insert into private.deletion_requests (user_id, requested_at, purge_after)
select id, now() - interval '9 days', now() - interval '2 days' from auth.users where email like 'bulk%';
set role taqwim_purger;
select tests.fails('أكثر من 5 مستحقّة: يرفض كلّها', 'select private.purge_deleted_accounts()', 'P0001');
reset role;
select tests.ok('حاجز العدد لم يحذف شيئًا', (select count(*) from auth.users where email like 'bulk%') = 6);
delete from auth.users where email like 'bulk%';

-- ============================================================
-- 6) الصلاحيات الافتراضية في الإنتاج تفتح كل دالة جديدة في public لـ anon:
--    التأكّد أنها سُحبت من كل الدوال الجديدة، وأن service_role لا يملك دوال المشرف.
-- ============================================================
select tests.ok('anon لا يملك تشغيل أي دالة جديدة',
  not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
              and p.proname in ('request_account_deletion','cancel_account_deletion','my_account_status','admin_list_teachers',
                                'admin_set_disabled','admin_cancel_deletion','admin_log_recent','purge_deleted_accounts',
                                'is_admin','require_admin','read_blocked','write_blocked')
              and has_function_privilege('anon', p.oid, 'execute')),
  (select string_agg(p.oid::regprocedure::text, ', ') from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and has_function_privilege('anon', p.oid, 'execute')));
select tests.ok('authenticated لا يملك الحذف النهائي ولا is_admin',
  not has_function_privilege('authenticated', 'private.purge_deleted_accounts(integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.is_admin()', 'execute'));
select tests.ok('لا أحد من أدوار API يقرأ جداول private',
  not exists (select 1 from pg_class c, unnest(array['anon','authenticated','service_role']) r
              where c.relnamespace = 'private'::regnamespace and c.relkind = 'r'
              and has_table_privilege(r, c.oid, 'select')));

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
