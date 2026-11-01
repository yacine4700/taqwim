-- اختبارات ترحيل 20261101100000 (حذف الحسابات غير المؤكَّدة بتأكيد المشرف).
-- يُشغَّل بدور supabase_admin بعد ترحيل 20261022130000 وهذا الترحيل، وبعد seed.sql.
-- حسابات seed.sql (A وB والمشرف M) بلا email_confirmed_at، فهي مرشَّحة بالعمر وحده، وتحميها هنا شروط
-- البيانات والإشراف، وهذا من صلب الاختبار.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set B '''bbbbbbbb-0000-4000-8000-00000000000b'''
\set M '''eeeeeeee-0000-4000-8000-00000000000e'''
\set sM '''5e550000-0000-4000-8000-0000000000e1'''
\set sA '''5e550000-0000-4000-8000-0000000000a1'''

truncate tests.results;
insert into private.admins (user_id, note) values (:M, 'test') on conflict do nothing;
update auth.users set created_at = now() - interval '10 days' where id = :M;

create function tests.err(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'no error';
exception when others then return sqlstate || ' ' || sqlerrm; end $$;

-- رمز TOTP أُدخل قبل n دقيقة
create function tests.totp_ago(mins numeric) returns void language sql as $$
  update auth.mfa_amr_claims set updated_at = now() - make_interval(secs => mins * 60)
  where session_id = '5e550000-0000-4000-8000-0000000000e1' and authentication_method = 'totp';
$$;

create function tests.mk(n int, age interval, patch text default '')
returns uuid language plpgsql as $$
declare id uuid := ('c0ffee00-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, created_at, aud, role)
  values (id, 'u' || n || '@x.dz', 'x', '{"full_name":"حساب"}', now() - age, 'authenticated', 'authenticated');
  if patch <> '' then execute 'update auth.users set ' || patch || ' where id = $1' using id; end if;
  return id;
end $$;

select tests.mk(1, interval '10 days') as u1 \gset
select tests.mk(2, interval '2 days') as u2 \gset
select tests.mk(3, interval '10 days', 'email_confirmed_at = now()') as u3 \gset
select tests.mk(4, interval '10 days', 'last_sign_in_at = now()') as u4 \gset
select tests.mk(5, interval '10 days', 'banned_until = now() + interval ''100 years''') as u5 \gset
select tests.mk(6, interval '10 days') as u6 \gset
insert into public.schools (teacher_id, name) values (:'u6', 'ثانوية');
select tests.mk(7, interval '10 days') as u7 \gset
insert into private.deletion_requests (user_id, requested_at, purge_after) values (:'u7', now() - interval '1 day', now() + interval '6 days');
select tests.mk(9, interval '10 days', 'raw_app_meta_data = ''{"provider":"google"}''') as u9 \gset

select tests.fp(:A) as fp_a0 \gset
select tests.fp(:B) as fp_b0 \gset
select count(*) as log0 from private.audit_log \gset

-- ============================================================
-- 1) من يستطيع
-- ============================================================
select tests.totp_ago(0);
select tests.claims(:A, :sA, 'aal2');
set role authenticated;
select tests.ok('أستاذ (ولو aal2) لا يرى القائمة: forbidden',
  tests.err($$select * from public.admin_unconfirmed_accounts()$$) = '42501 forbidden');
select tests.ok('ولا يحذف: forbidden', tests.err($$select public.admin_purge_unconfirmed(1)$$) = '42501 forbidden');
select tests.claims(:M, :sM, 'aal1');
select tests.ok('المشرف بجلسة aal1: mfa_required للقائمة',
  tests.err($$select * from public.admin_unconfirmed_accounts()$$) = '42501 mfa_required');
select tests.ok('وللحذف', tests.err($$select public.admin_purge_unconfirmed(1)$$) = '42501 mfa_required');
reset role;
set role anon;
select tests.ok('anon لا يستدعي', tests.err($$select public.admin_purge_unconfirmed(1)$$) like '42501%');
reset role;
select tests.totp_ago(13 * 60);
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('رمز مضى عليه أكثر من 12 ساعة: mfa_required', tests.err($$select public.admin_purge_unconfirmed(1)$$) = '42501 mfa_required');
reset role;
select tests.totp_ago(0);
select tests.ok('كل المرفوضات لم تمسّ شيئًا ولم تُسجَّل',
  (select count(*) from auth.users where id = :'u1') = 1 and (select count(*) from private.audit_log) = :log0);

-- ============================================================
-- 2) القائمة
-- ============================================================
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select count(*) filter (where deletable) as n_del, count(*) as n_all,
       bool_or(id = :'u2' and not deletable) as u2_listed_not_deletable,
       bool_or(id = :'u1' and deletable) as u1_deletable,
       bool_or(id = :M) as admin_listed,
       bool_or(id = :'u3') as confirmed_listed,
       bool_or(id = :A and not deletable) as a_not_deletable
from public.admin_unconfirmed_accounts() \gset
reset role;
select tests.ok('القابل للحذف واحد فقط (u1)', :n_del = 1 and :'u1_deletable' = 't');
select tests.ok('الحديث (يومان) يُعرض ولا يُحذف', :'u2_listed_not_deletable' = 't');
select tests.ok('المؤكَّد والمشرف لا يظهران في القائمة', :'confirmed_listed' = 'f' and :'admin_listed' = 'f');
select tests.ok('A (قديم بلا تأكيد وعنده بيانات) يظهر ولا يُحذف', :'a_not_deletable' = 't');
select tests.ok('أعداد القائمة: كل غير المؤكَّدين غير المشرف (u1 u2 u4 u5 u6 u7 u9 وA وB = 9)', :n_all = 9, :n_all::text);

-- ============================================================
-- 3) الحذف: لا يحذف ما لم يره المشرف
-- ============================================================
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('العدد غير المطابق (2 والقابل 1): unconfirmed_changed',
  tests.err($$select public.admin_purge_unconfirmed(2)$$) = 'P0001 unconfirmed_changed');
select tests.ok('عدد صفر مرفوض', tests.err($$select public.admin_purge_unconfirmed(0)$$) = '22023 invalid arguments');
select tests.ok('فوق الحدّ مرفوض', tests.err($$select public.admin_purge_unconfirmed(51)$$) = 'P0001 too_many');
reset role;
select tests.ok('لم يُحذف شيء ولم يُسجَّل', (select count(*) from auth.users where id = :'u1') = 1 and (select count(*) from private.audit_log) = :log0);

-- حساب يتأكّد بعد أن رآه المشرف قابلًا للحذف: يُرفض الحذف ويبقى الحساب
select tests.mk(10, interval '10 days') as u10 \gset
update auth.users set email_confirmed_at = now() where id = :'u10';
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('تأكّد حساب بعد القائمة: العدد 2 لم يعد صحيحًا', tests.err($$select public.admin_purge_unconfirmed(2)$$) = 'P0001 unconfirmed_changed');
reset role;
select tests.ok('والمؤكَّد باقٍ', exists (select 1 from auth.users where id = :'u10'));

-- الحذف الصحيح
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select public.admin_purge_unconfirmed(1) as purged \gset
reset role;
select tests.ok('حُذف واحد', :purged = 1);
select tests.ok('القديم غير المؤكَّد حُذف', not exists (select 1 from auth.users where id = :'u1'));
select tests.ok('وحُذف معه صفّ الأستاذ ومعاييره ومركّباته (لا يتيم)',
  (select count(*) from public.teachers where id = :'u1')
  + (select count(*) from public.criteria where teacher_id = :'u1')
  + (select count(*) from public.components where teacher_id = :'u1') = 0);
select tests.ok('الحديث يبقى', exists (select 1 from auth.users where id = :'u2'));
select tests.ok('المؤكَّد يبقى', exists (select 1 from auth.users where id = :'u3'));
select tests.ok('من سجّل دخولًا يبقى', exists (select 1 from auth.users where id = :'u4'));
select tests.ok('الموقوف يبقى', exists (select 1 from auth.users where id = :'u5'));
select tests.ok('صاحب البيانات يبقى (مؤسسة)', exists (select 1 from auth.users where id = :'u6'));
select tests.ok('من عليه طلب حذف يبقى', exists (select 1 from auth.users where id = :'u7'));
select tests.ok('مزوّد غير البريد يبقى', exists (select 1 from auth.users where id = :'u9'));
select tests.ok('المشرف يبقى رغم أنه بلا تأكيد وقديم', exists (select 1 from auth.users where id = :M));
select tests.ok('A وB يبقيان وبياناتهما كما هي',
  tests.fp(:A) = :'fp_a0' and tests.fp(:B) = :'fp_b0'
  and exists (select 1 from auth.users where id = :A) and exists (select 1 from auth.users where id = :B));

-- ============================================================
-- 4) السجلّ: فعل خاص، ومن فعل، بلا بريد
-- ============================================================
select tests.ok('سُجّل مرة واحدة بالفعل purge_unconfirmed ومن فعل',
  (select count(*) from private.audit_log) = :log0 + 1
  and (select (action, actor_kind, actor_id, target_id) = ('purge_unconfirmed', 'admin', :M::uuid, :'u1'::uuid)
       from private.audit_log order by id desc limit 1));
select tests.ok('السجلّ بلا بريد ولا اسم',
  (select detail::text from private.audit_log order by id desc limit 1) !~ '(@|حساب)');
select tests.claims(:M, :sM, 'aal2');
set role authenticated;
select tests.ok('إعادة الحذف بعد أن لم يبق قابل: unconfirmed_changed', tests.err($$select public.admin_purge_unconfirmed(1)$$) = 'P0001 unconfirmed_changed');
reset role;

-- ============================================================
-- 5) لا أثر على الحذف الليلي
-- ============================================================
select tests.ok('الحذف الليلي كما كان (لا ذكر للتنظيف فيه)',
  (select prosrc not like '%unconfirmed%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'purge_deleted_accounts'));
set role taqwim_purger;
select tests.ok('وصاحبه لا يستدعي دالة المشرف ولا التعريف',
  tests.err($$select public.admin_purge_unconfirmed(1)$$) like '42501%'
  and tests.err($$select * from private.stale_unconfirmed()$$) like '42501%');
reset role;

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
