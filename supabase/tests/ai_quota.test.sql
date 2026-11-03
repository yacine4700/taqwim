-- اختبارات ترحيل 20261103200000 (ai_quota: حدّ يومي لقراءة Gemini).
-- يُشغَّل بدور supabase_admin بعد الترحيل. النداءات بدور authenticated وJWT الأستاذ كما في التطبيق.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set B '''bbbbbbbb-0000-4000-8000-00000000000b'''
\o /dev/null

create function tests.try(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function tests.q(kind text) returns jsonb language sql as $$ select public.consume_ai_quota(kind) $$;
grant execute on function tests.q(text) to public;
create function tests.today() returns date language sql as $$ select (now() at time zone 'Africa/Algiers')::date $$;

-- 1. أول طلب للأستاذ A
select tests.claims(:A::uuid);
set role authenticated;
select tests.q('images')::text as r1 \gset
reset role;
select tests.ok('أول طلب مقبول ويبقى 19', :'r1'::jsonb = '{"ok":true,"remaining":19}', :'r1');
select tests.ok('العدّاد 1 لـ A اليوم',
  (select calls = 1 from private.ai_usage where teacher_id = :A and day = tests.today()));

-- 2. حتى العشرين ثم الرفض، والرفض لا يزيد العدّاد
set role authenticated;
select tests.q('sheets') from generate_series(2, 20);
select tests.q('images')::text as r21 \gset
select tests.q('images')::text as r22 \gset
reset role;
select tests.ok('الطلب 21 مرفوض بحدّ الأستاذ', :'r21'::jsonb = '{"ok":false,"scope":"teacher","limit":20}', :'r21');
select tests.ok('الرفض لا يزيد العدّاد',
  (select calls = 20 from private.ai_usage where teacher_id = :A and day = tests.today()));

-- 3. حدّ A لا يمسّ B
select tests.claims(:B::uuid);
set role authenticated;
select tests.q('images')::text as rb \gset
reset role;
select tests.ok('B مستقلّ عن A', :'rb'::jsonb = '{"ok":true,"remaining":19}', :'rb');

-- 4. يوم جديد يعيد العدّ، وما مضى عليه أكثر من 30 يومًا يُمحى
update private.ai_usage set day = day - 1 where teacher_id = :A;
insert into private.ai_usage values (:A, tests.today() - 40, 5);
select tests.claims(:A::uuid);
set role authenticated;
select tests.q('images')::text as rnew \gset
reset role;
select tests.ok('أمس لا يُحتسب اليوم', :'rnew'::jsonb = '{"ok":true,"remaining":19}', :'rnew');
select tests.ok('أمس باقٍ', exists (select 1 from private.ai_usage where teacher_id = :A and day = tests.today() - 1));
select tests.ok('ما قبل 30 يومًا مُحي', not exists (select 1 from private.ai_usage where day < tests.today() - 30));

-- 5. الحدّ العام: 200 في اليوم للتطبيق كله
insert into private.ai_usage
  select u.id, tests.today(), 0 from auth.users u
  where u.id not in (select teacher_id from private.ai_usage where day = tests.today())
  on conflict do nothing;
update private.ai_usage set calls = 0 where day = tests.today();
update private.ai_usage set calls = 200 where day = tests.today() and teacher_id = :B;
select tests.claims(:A::uuid);
set role authenticated;
select tests.q('images')::text as rg \gset
reset role;
select tests.ok('الحدّ العام يرفض', :'rg'::jsonb = '{"ok":false,"scope":"global","limit":200}', :'rg');
select tests.ok('رفض الحدّ العام لا يزيد عدّاد A',
  (select calls = 0 from private.ai_usage where teacher_id = :A and day = tests.today()));
update private.ai_usage set calls = 199 where day = tests.today() and teacher_id = :B;
set role authenticated;
select tests.q('images')::text as rg2 \gset
select tests.q('images')::text as rg3 \gset
reset role;
select tests.ok('آخر طلب تحت الحدّ العام مقبول', (:'rg2'::jsonb ->> 'ok')::boolean, :'rg2');
select tests.ok('ثم يُرفض', :'rg3'::jsonb ->> 'scope' = 'global', :'rg3');

-- 6. مداخل مرفوضة
select tests.claims(:A::uuid);
set role authenticated;
select tests.try($q$select public.consume_ai_quota('other')$q$) as rk \gset
select tests.try($q$select public.consume_ai_quota(null)$q$) as rn \gset
select tests.try($q$select * from private.ai_usage$q$) as rt \gset
select tests.try($q$insert into private.ai_usage values (auth.uid(), current_date, 0)$q$) as ri \gset
reset role;
select tests.ok('نوع مجهول مرفوض', :'rk' like '22023%', :'rk');
select tests.ok('نوع فارغ مرفوض', :'rn' like '22023%', :'rn');
select tests.ok('الأستاذ لا يقرأ الجدول', :'rt' like '42501%', :'rt');
select tests.ok('الأستاذ لا يكتب في الجدول (ليصفّر عدّاده)', :'ri' like '42501%', :'ri');

select set_config('request.jwt.claims', '', false);
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select tests.try($q$select public.consume_ai_quota('images')$q$) as ra \gset
reset role;
select tests.ok('anon بلا صلاحية', :'ra' like '42501%', :'ra');
set role authenticated;
select tests.try($q$select public.consume_ai_quota('images')$q$) as rnone \gset
reset role;
select tests.ok('بلا جلسة: not_authenticated', :'rnone' like '42501%not_authenticated%', :'rnone');

-- 7. حذف الأستاذ يمحو عدّاداته
delete from auth.users where id = :B;
select tests.ok('حذف الحساب يمحو عدّاداته', not exists (select 1 from private.ai_usage where teacher_id = :B));

\o
select (case when ok then '  ok  ' else '  FAIL' end) || ' ' || label || coalesce(case when ok then '' else '  → ' || detail end, '') from tests.results order by n;
select count(*) filter (where not ok) as failed, count(*) as total from tests.results \gset
\echo :total فحصًا، :failed فاشل
do $$ begin if exists (select 1 from tests.results where not ok) then raise exception 'ai_quota tests failed'; end if; end $$;
