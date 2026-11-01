-- اختبارات ترحيل 20261101100000 (تنظيف الحسابات غير المؤكَّدة).
-- يُشغَّل بدور supabase_admin بعد ترحيل 20261022130000 وهذا الترحيل، وبعد seed.sql.
-- ملاحظة: حسابات seed.sql (A وB والمشرف M) بلا email_confirmed_at، فهي مرشَّحة بالعمر وحده،
-- وتحميها هنا شروط البيانات والإشراف، وهذا من صلب الاختبار.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set B '''bbbbbbbb-0000-4000-8000-00000000000b'''
\set M '''eeeeeeee-0000-4000-8000-00000000000e'''

truncate tests.results;
insert into private.admins (user_id, note) values (:M, 'test') on conflict do nothing;

-- العمر: كل الحسابات الأقدم من 7 أيام
update auth.users set created_at = now() - interval '10 days' where id in (:M);

create function tests.mk(n int, age interval, patch text default '')
returns uuid language plpgsql as $$
declare id uuid := ('c0ffee00-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, created_at, aud, role)
  values (id, 'u' || n || '@x.dz', 'x', '{"full_name":"حساب"}', now() - age, 'authenticated', 'authenticated');
  if patch <> '' then execute 'update auth.users set ' || patch || ' where id = $1' using id; end if;
  return id;
end $$;

-- 1: قديم وغير مؤكَّد وبلا بيانات → يُحذف
select tests.mk(1, interval '10 days') as u1 \gset
-- 2: حديث (يومان) → يبقى
select tests.mk(2, interval '2 days') as u2 \gset
-- 3: قديم لكن بريده مؤكَّد → يبقى
select tests.mk(3, interval '10 days', 'email_confirmed_at = now()') as u3 \gset
-- 4: قديم لكنه سجّل دخولًا مرة → يبقى
select tests.mk(4, interval '10 days', 'last_sign_in_at = now()') as u4 \gset
-- 5: قديم وموقوف → يبقى (الإيقاف قرار بشري)
select tests.mk(5, interval '10 days', 'banned_until = now() + interval ''100 years''') as u5 \gset
-- 6: قديم وله مؤسسة → يبقى (بيانات)
select tests.mk(6, interval '10 days') as u6 \gset
insert into public.schools (teacher_id, name) values (:'u6', 'ثانوية');
-- 7: قديم وعليه طلب حذف → يبقى
select tests.mk(7, interval '10 days') as u7 \gset
insert into private.deletion_requests (user_id, requested_at, purge_after) values (:'u7', now() - interval '1 day', now() + interval '6 days');
-- 9: قديم بمزوّد آخر → يبقى
select tests.mk(9, interval '10 days', 'raw_app_meta_data = ''{"provider":"google"}''') as u9 \gset

select tests.fp(:A) as fp_a0 \gset
select tests.fp(:B) as fp_b0 \gset

-- ============================================================
-- 1) التنظيف
-- ============================================================
select tests.ok('أول تشغيل يحذف حسابًا واحدًا فقط', private.purge_unconfirmed_accounts() = 1);
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
select tests.ok('A وB (قديمان بلا تأكيد لكن عندهما أقسام وعلامات) يبقيان وبياناتهما كما هي',
  tests.fp(:A) = :'fp_a0' and tests.fp(:B) = :'fp_b0'
  and exists (select 1 from auth.users where id = :A) and exists (select 1 from auth.users where id = :B));
select tests.ok('تشغيل ثانٍ لا يحذف شيئًا', private.purge_unconfirmed_accounts() = 0);

-- ============================================================
-- 2) السجلّ: فعل خاص، بلا بريد
-- ============================================================
select tests.ok('سُجّل فعل purge_unconfirmed للمحذوف',
  (select count(*) from private.audit_log where action = 'purge_unconfirmed' and target_id = :'u1' and actor_kind = 'system') = 1);
select tests.ok('السجلّ بلا بريد ولا اسم',
  (select detail::text from private.audit_log where action = 'purge_unconfirmed' and target_id = :'u1') !~ '(@|حساب)');

-- ============================================================
-- 3) الحاجز: أكثر من الحدّ لا يُحذف منه شيء
-- ============================================================
select tests.mk(20, interval '9 days') as v1 \gset
select tests.mk(21, interval '9 days') as v2 \gset
select tests.mk(22, interval '9 days') as v3 \gset
select tests.ok('ثلاثة مرشَّحين والحدّ اثنان: يرفض ولا يحذف', private.purge_unconfirmed_accounts(interval '7 days', 2) = 0);
select tests.ok('الثلاثة باقون', (select count(*) from auth.users where id in (:'v1', :'v2', :'v3')) = 3);
select tests.ok('وبالحدّ الكافي يُحذفون', private.purge_unconfirmed_accounts(interval '7 days', 3) = 3);

-- ============================================================
-- 4) الصلاحيات: لا يستدعيها غير مالكها
-- ============================================================
select tests.claims(:A, null);
set role authenticated;
select tests.fails('الأستاذ لا يستدعي دالة التنظيف', 'select private.purge_unconfirmed_accounts()', '42501');
reset role;
set role taqwim_purger;
select tests.fails('دور الحذف الليلي لا يستدعيها مباشرة', 'select private.purge_unconfirmed_accounts()', '42501');
reset role;

-- ============================================================
-- 5) التكامل مع الحذف الليلي
-- ============================================================
select tests.mk(30, interval '12 days') as w1 \gset
set role taqwim_purger;
select tests.ok('الحذف الليلي يرجع عدد طلبات الحذف لا التنظيف (لا طلب مستحق: 0)', private.purge_deleted_accounts() = 0);
reset role;
select tests.ok('وقد نظّف الحساب غير المؤكَّد في طريقه', not exists (select 1 from auth.users where id = :'w1'));

-- طلب حذف مستحق + حساب غير مؤكَّد يفشل حذفه: الحذف الأصلي لا يتعطّل
select tests.mk(31, interval '12 days') as x1 \gset
select tests.mk(32, interval '12 days') as dueu \gset
insert into private.deletion_requests (user_id, requested_at, purge_after)
values (:'dueu', now() - interval '8 days', now() - interval '1 day');
create function tests.block_x1() returns trigger language plpgsql as $$
begin
  if old.id = 'c0ffee00-0000-4000-8000-000000000031'::uuid then raise exception 'blocked for test'; end if;
  return old;
end $$;
create trigger trg_block_x1 before delete on auth.users for each row execute function tests.block_x1();
select tests.ok('خطأ في التنظيف لا يعطّل الحذف الأصلي: حُذف الحساب المستحق (1)', private.purge_deleted_accounts() = 1);
select tests.ok('والحساب المستحق حُذف فعلًا', not exists (select 1 from auth.users where id = :'dueu'));
select tests.ok('وغير المؤكَّد الذي فشل حذفه باقٍ (لم يُمسّ)', exists (select 1 from auth.users where id = :'x1'));
drop trigger trg_block_x1 on auth.users;

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
