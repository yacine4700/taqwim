-- اختبارات ترحيل 20261104190000 (مدة سجلّ العمليات سنة واحدة).
-- يُشغَّل بدور supabase_admin بعد ترحيلات المشرف والسجلّ وهذا الترحيل، وبعد seed.sql.
\set ON_ERROR_STOP 1

truncate tests.results;

create function tests.err(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'no error';
exception when others then return sqlstate || ' ' || sqlerrm; end $$;

-- حسابات الاختبار: محذوف (لا صفّ له)، وموقوف الآن، وموقوف سابقًا، وله طلب حذف قائم، ومحجوز.
\set GONE    '''70000000-0000-4000-8000-000000000001'''
\set BANNED  '''70000000-0000-4000-8000-000000000002'''
\set WASBAN  '''70000000-0000-4000-8000-000000000003'''
\set PENDING '''70000000-0000-4000-8000-000000000004'''
\set HELD    '''70000000-0000-4000-8000-000000000005'''
\set EXPIRED '''70000000-0000-4000-8000-000000000006'''
\set ADMIN   '''70000000-0000-4000-8000-000000000007'''

insert into auth.users (id, email, aud, role, banned_until) values
  (:BANNED,  'banned@x.dz',  'authenticated', 'authenticated', now() + interval '100 years'),
  (:WASBAN,  'wasban@x.dz',  'authenticated', 'authenticated', now() - interval '1 day'),
  (:PENDING, 'pending@x.dz', 'authenticated', 'authenticated', null);
insert into private.deletion_requests (user_id, requested_at, purge_after)
values (:PENDING, now() - interval '400 days', now() - interval '393 days');
insert into private.audit_hold (target_id, reason, added_at, until) values
  (:HELD,    'تحقيق في محاولة دخول', now(),                     now() + interval '30 days'),
  (:EXPIRED, 'حجز انتهى',            now() - interval '60 days', now() - interval '1 day');

delete from private.audit_log;
-- السطر: (العمر بالأيام، الفعل، الهدف، الفاعل، وسم الاختبار في detail)
insert into private.audit_log (at, actor_kind, actor_id, action, target_id, detail)
select now() - make_interval(days => d), k, a::uuid, act, t::uuid, jsonb_build_object('case', c)
from (values
  (400, 'system',  null,   'purge',            :GONE,    'old_purge'),
  (400, 'teacher', :GONE,  'request_deletion', :GONE,    'old_request'),
  (366, 'admin',   null,   'set_backup',       null,     'old_no_target'),
  (364, 'system',  null,   'purge',            :GONE,    'edge_364'),
  (300, 'admin',   null,   'admin_purge',      :GONE,    'recent'),
  (500, 'admin',   null,   'disable',          :BANNED,  'banned_now'),
  (500, 'admin',   null,   'disable',          :WASBAN,  'ban_over'),
  (400, 'teacher', :PENDING,'request_deletion', :PENDING, 'pending_request'),
  (400, 'admin',   null,   'admin_purge',      :HELD,    'held_target'),
  (400, 'admin',   :HELD,  'enable',           :GONE,    'held_actor'),
  (400, 'admin',   null,   'admin_purge',      :EXPIRED, 'hold_expired')
) v(d, k, a, act, t, c);

select count(*) as before_total from private.audit_log \gset
select count(*) as before_teachers from public.teachers \gset

-- ============================================================
-- 1) الصلاحيات
-- ============================================================
set role authenticated;
select tests.ok('الأستاذ لا يشغّل التقليم', tests.err($$select private.trim_audit_log()$$) like '42501%');
select tests.ok('ولا يقرأ جدول الحجز', tests.err($$select * from private.audit_hold$$) like '42501%');
reset role;
set role taqwim_purger;
select tests.ok('دور الحذف الليلي لا يقرأ السجلّ', tests.err($$select * from private.audit_log$$) like '42501%');
select tests.ok('ولا يحذف منه مباشرة', tests.err($$delete from private.audit_log$$) like '42501%');
select tests.ok('ولا يكتب في الحجز', tests.err($$insert into private.audit_hold (target_id, reason, until) values (gen_random_uuid(), 'xxxxxx', now() + interval '1 day')$$) like '42501%');
select private.trim_audit_log() as deleted \gset
reset role;
select tests.ok('دور الحذف الليلي يشغّل التقليم', :deleted >= 0);
select tests.ok('الدالة بلا معاملات: لا يُمرَّر لها عمر أقصر',
  (select pronargs = 0 from pg_proc where oid = 'private.trim_audit_log'::regproc));

-- ============================================================
-- 2) ما حُذف وما بقي
-- ============================================================
create function tests.has(c text) returns boolean language sql as $$
  select exists (select 1 from private.audit_log where detail ->> 'case' = c) $$;

select tests.ok('حُذف: حذف ليلي عمره 400 يوم', not tests.has('old_purge'));
select tests.ok('حُذف: طلب حذف نُفّذ قبل 400 يوم', not tests.has('old_request'));
select tests.ok('حُذف: سطر بلا هدف عمره 366 يومًا', not tests.has('old_no_target'));
select tests.ok('حُذف: حجز انتهت مدّته', not tests.has('hold_expired'));
select tests.ok('حُذف: إيقاف رُفع (الحساب لم يعد موقوفًا)', not tests.has('ban_over'));
select tests.ok('بقي: عمره 364 يومًا (أقل من سنة)', tests.has('edge_364'));
select tests.ok('بقي: حديث (300 يوم)', tests.has('recent'));
select tests.ok('بقي: سبب إيقاف حساب ما زال موقوفًا', tests.has('banned_now'));
select tests.ok('بقي: إثبات طلب حذف لم يُنفَّذ بعد', tests.has('pending_request'));
select tests.ok('بقي: حساب محجوز للتحقيق (هدفًا)', tests.has('held_target'));
select tests.ok('بقي: حساب محجوز للتحقيق (فاعلًا)', tests.has('held_actor'));
select tests.ok('العدد المحذوف 5', :deleted = 5, :deleted::text);

-- ============================================================
-- 3) أثر التقليم نفسه
-- ============================================================
select tests.ok('سطر trim_audit واحد بعدد ما حُذف',
  (select count(*) = 1 and min((detail ->> 'deleted')::int) = 5 from private.audit_log where action = 'trim_audit'));
select tests.ok('المجموع: قبل − المحذوف + سطر التقليم',
  (select count(*) from private.audit_log) = :before_total - 5 + 1);

set role taqwim_purger;
select private.trim_audit_log() as again \gset
reset role;
select tests.ok('تشغيل ثانٍ لا يحذف شيئًا', :again = 0);
select tests.ok('ولا يكتب سطر تقليم ثانيًا', (select count(*) = 1 from private.audit_log where action = 'trim_audit'));

-- ============================================================
-- 4) لا يمسّ غير السجلّ
-- ============================================================
select tests.ok('حسابات الاختبار باقية', (select count(*) = 3 from auth.users where id in (:BANNED, :WASBAN, :PENDING)));
select tests.ok('طلب الحذف القائم باقٍ', exists (select 1 from private.deletion_requests where user_id = :PENDING));
select tests.ok('جداول التطبيق لم تُمسّ', (select count(*) from public.teachers) = :before_teachers);
select tests.ok('الحجز يرفض سببًا فارغًا',
  tests.err($$insert into private.audit_hold (target_id, reason, until) values (gen_random_uuid(), ' ', now() + interval '1 day')$$) like '23514%');

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
  select 1 / 0;
\endif
