-- اختبارات ترحيل 20261101130000 (merge_record: دمج التغيير في صف العلامات).
-- يُشغَّل بدور supabase_admin بعد ترحيلَي المشرف والرزنامة ثم هذا الترحيل.
-- كل اختبار بدور authenticated وJWT الأستاذ، أي تحت RLS ومحفّز قفل الفصل كما في التطبيق.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set B '''bbbbbbbb-0000-4000-8000-00000000000b'''
\o /dev/null

create function tests.try(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlstate || ' ' || sqlerrm; end $$;

select id as st from public.students where teacher_id = :A order by full_name limit 1 \gset
select id as stb from public.students where teacher_id = :B order by full_name limit 1 \gset
-- الأول: صف الفصل 1 في البذرة هو criteria={"part":3}, devoir=13 (الأول من 3 تلاميذ)
select devoir as dev0 from public.records where student_id = :'st' and term = 1 \gset

create function tests.row(st uuid, t int) returns text language sql as $$
  select coalesce((select jsonb_build_object('c', criteria, 'tp', tp, 'dv', devoir, 'ex', exam)::text
                   from public.records where student_id = st and term = t), 'none')
$$;
grant execute on function tests.row(uuid, int) to public;

select tests.claims(:A::uuid);
set role authenticated;

-- 1. تغيير معيار واحد لا يمسّ البقية: part يبقى 3 وdevoir يبقى كما كان.
select public.merge_record(:'st', 1::smallint, '{"criteria":{"disc":-1}}');
reset role;
select tests.ok('معيار جديد يُضاف ويبقى part وdevoir',
  (select criteria = '{"part":3,"disc":-1}' and devoir = :dev0 from public.records where student_id = :'st' and term = 1),
  tests.row(:'st', 1));

-- 2. تعديل قيمة معيار موجود يغيّره وحده.
set role authenticated;
select public.merge_record(:'st', 1::smallint, '{"criteria":{"part":4.5}}');
reset role;
select tests.ok('تعديل معيار موجود',
  (select criteria = '{"part":4.5,"disc":-1}' from public.records where student_id = :'st' and term = 1), tests.row(:'st', 1));

-- 3. «مسح»: null يحذف المفتاح (لم يُقيَّم) ولا يكتب صفرًا، وغيره باقٍ.
set role authenticated;
select public.merge_record(:'st', 1::smallint, '{"criteria":{"part":null}}');
reset role;
select tests.ok('المسح يحذف المفتاح لا يصفّره',
  (select criteria = '{"disc":-1}' and not criteria ? 'part' from public.records where student_id = :'st' and term = 1), tests.row(:'st', 1));

-- 4. الصفر المقيَّم يبقى صفرًا (يختلف عن المسح).
set role authenticated;
select public.merge_record(:'st', 1::smallint, '{"criteria":{"part":0}}');
reset role;
select tests.ok('الصفر المقيَّم يبقى صفرًا',
  (select (criteria -> 'part') = '0'::jsonb and criteria ? 'part' from public.records where student_id = :'st' and term = 1), tests.row(:'st', 1));

-- 5. الخانات: حضور المفتاح = تغيير، null = مسح، الغائب = لم يُمسّ.
set role authenticated;
select public.merge_record(:'st', 1::smallint, '{"tp":12.5,"exam":9}');
reset role;
select tests.ok('tp وexam تُكتبان وdevoir باقٍ',
  (select tp = 12.5 and exam = 9 and devoir = :dev0 from public.records where student_id = :'st' and term = 1), tests.row(:'st', 1));
set role authenticated;
select public.merge_record(:'st', 1::smallint, '{"tp":null}');
reset role;
select tests.ok('tp بـ null يُمسح وexam باقٍ',
  (select tp is null and exam = 9 and devoir = :dev0 from public.records where student_id = :'st' and term = 1), tests.row(:'st', 1));

-- 6. السباق نفسه: شاشة قديمة (لا تعرف أن part صُفّر وأن tp مُسح) تعدّل معيارًا آخر فقط.
set role authenticated;
select public.merge_record(:'st', 1::smallint, '{"criteria":{"hw":1.5}}');
reset role;
select tests.ok('تعديل معيار آخر لا يعيد ما مُسح ولا يمحو ما كُتب',
  (select criteria = '{"disc":-1,"part":0,"hw":1.5}' and tp is null and exam = 9 from public.records where student_id = :'st' and term = 1),
  tests.row(:'st', 1));

-- 7. صف غير موجود: يُنشأ بالتغيير وحده (تلميذ ثانٍ، الفصل 1 المفتوح اليوم).
select id as st2 from public.students where teacher_id = :A and id <> :'st' order by full_name limit 1 \gset
delete from public.records where student_id = :'st2' and term = 1;
select tests.ok('لا صف قبل الكتابة', tests.row(:'st2', 1) = 'none');
set role authenticated;
select public.merge_record(:'st2', 1::smallint, '{"criteria":{"disc":-2},"devoir":14}');
reset role;
select tests.ok('الصف أُنشئ بالتغيير وحده ولأستاذه',
  (select criteria = '{"disc":-2}' and devoir = 14 and tp is null and exam is null and teacher_id = :A::uuid
   from public.records where student_id = :'st2' and term = 1), tests.row(:'st2', 1));
set role authenticated;
select public.merge_record(:'st2', 1::smallint, '{"criteria":{"ghost":null}}');
reset role;
select tests.ok('مسح معيار غير موجود لا يضيف شيئًا',
  (select criteria = '{"disc":-2}' from public.records where student_id = :'st2' and term = 1), tests.row(:'st2', 1));

-- 8. updated_at: من الهاتف إن أُرسل، وإلا الآن.
set role authenticated;
select public.merge_record(:'st2', 1::smallint, '{"exam":1}', '2026-11-01 10:00:00+00');
reset role;
select tests.ok('updated_at يأخذ وقت الإدخال على الهاتف',
  (select updated_at = '2026-11-01 10:00:00+00' from public.records where student_id = :'st2' and term = 1));

-- 9. رفض القيم الخاطئة والتلميذ الغريب، ولا شيء يُكتب.
select tests.claims(:A::uuid);
set role authenticated;
create temp table res (label text, r text);
grant all on res to public;
insert into res select 'خانة خارج 0..20', tests.try(format($q$select public.merge_record(%L, 1::smallint, '{"exam":25}')$q$, :'st'));
insert into res select 'معيار نصّ', tests.try(format($q$select public.merge_record(%L, 1::smallint, '{"criteria":{"part":"x"}}')$q$, :'st'));
insert into res select 'خانة نصّ', tests.try(format($q$select public.merge_record(%L, 1::smallint, '{"tp":"x"}')$q$, :'st'));
insert into res select 'تغييرات ليست كائنًا', tests.try(format($q$select public.merge_record(%L, 1::smallint, '[1]')$q$, :'st'));
insert into res select 'تلميذ أستاذ آخر', tests.try(format($q$select public.merge_record(%L, 1::smallint, '{"criteria":{"part":1}}')$q$, :'stb'));
insert into res select 'تلميذ غير موجود', tests.try($q$select public.merge_record(gen_random_uuid(), 1::smallint, '{"criteria":{"part":1}}')$q$);
insert into res select 'فصل 3 لم يبدأ', tests.try(format($q$select public.merge_record(%L, 3::smallint, '{"criteria":{"part":1}}')$q$, :'st'));
insert into res select 'فصل خارج 1-3', tests.try(format($q$select public.merge_record(%L, 4::smallint, '{"criteria":{"part":1}}')$q$, :'st'));
reset role;
select tests.ok('خانة 25 مرفوضة بقيد الجدول', (select r like '23514%' from res where label = 'خانة خارج 0..20'), (select r from res where label = 'خانة خارج 0..20'));
select tests.ok('قيمة معيار نصّية مرفوضة', (select r like '22023%' from res where label = 'معيار نصّ'), (select r from res where label = 'معيار نصّ'));
select tests.ok('خانة نصّية مرفوضة', (select r like '22023%' from res where label = 'خانة نصّ'), (select r from res where label = 'خانة نصّ'));
select tests.ok('تغييرات غير كائن مرفوضة', (select r like '22023%' from res where label = 'تغييرات ليست كائنًا'), (select r from res where label = 'تغييرات ليست كائنًا'));
select tests.ok('تلميذ أستاذ آخر: student_not_found برمز 23503', (select r = '23503 student_not_found' from res where label = 'تلميذ أستاذ آخر'), (select r from res where label = 'تلميذ أستاذ آخر'));
select tests.ok('تلميذ غير موجود: student_not_found', (select r = '23503 student_not_found' from res where label = 'تلميذ غير موجود'), (select r from res where label = 'تلميذ غير موجود'));
select tests.ok('الفصل 3 لم يبدأ: يرفضه محفّز القفل term_closed', (select r like '23514 term_closed:3' from res where label = 'فصل 3 لم يبدأ'), (select r from res where label = 'فصل 3 لم يبدأ'));
select tests.ok('فصل 4 مرفوض', (select r like '23514%' from res where label = 'فصل خارج 1-3'), (select r from res where label = 'فصل خارج 1-3'));
select tests.ok('لا صف كُتب في فصل مغلق أو غير صالح',
  (select count(*) = 0 from public.records where (student_id = :'st' and term in (2, 3, 4) and teacher_id = :A::uuid and updated_at > now() - interval '1 minute')));
select tests.ok('صف التلميذ لم يتأثر بالمحاولات المرفوضة',
  (select exam = 9 or exam = 1 from public.records where student_id = :'st' and term = 1), tests.row(:'st', 1));

-- 10. بلا جلسة: لا تُنفَّذ (anon لا يملك صلاحية التنفيذ أصلًا).
select set_config('request.jwt.claims', '', false);
set role anon;
select tests.try(format($q$select public.merge_record(%L, 1::smallint, '{"criteria":{"part":1}}')$q$, :'st')) as anon_r \gset
reset role;
select tests.ok('anon لا يستطيع التنفيذ', :'anon_r' like '42501%', :'anon_r');

-- 11. الأستاذ B لا يرى ولا يغيّر صف A.
select tests.claims(:B::uuid);
set role authenticated;
select tests.try(format($q$select public.merge_record(%L, 1::smallint, '{"criteria":{"part":9}}')$q$, :'st')) as b_r \gset
reset role;
select tests.ok('B لا يعدّل علامات تلميذ A', :'b_r' = '23503 student_not_found', :'b_r');
select tests.ok('علامات A لم تتغيّر بعد محاولة B',
  (select (criteria -> 'part') = '0'::jsonb from public.records where student_id = :'st' and term = 1));

-- 12. تُنفَّذ على حساب مجمَّد؟ المحفّز/السياسة تمنع كما الكتابة المباشرة (حالة my_account_status).
select tests.claims(:A::uuid);
insert into private.deletion_requests (user_id, purge_after) values ('aaaaaaaa-0000-4000-8000-00000000000a', now() + interval '7 days');
set role authenticated;
select tests.try(format($q$select public.merge_record(%L, 1::smallint, '{"criteria":{"part":7}}')$q$, :'st')) as frozen_r \gset
reset role;
select tests.ok('حساب مجدول للحذف: الكتابة مرفوضة صراحةً بـ 42501', :'frozen_r' like '42501%', :'frozen_r');
select tests.ok('وصف الصف لم يتغيّر',
  (select (criteria -> 'part') = '0'::jsonb from public.records where student_id = :'st' and term = 1));
delete from private.deletion_requests where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a';

\o
select (case when ok then '  ok  ' else '  FAIL' end) || ' ' || label || coalesce(case when ok then '' else '  → ' || detail end, '') from tests.results order by n;
select count(*) filter (where not ok) as failed, count(*) as total from tests.results \gset
\echo :total فحصًا، :failed فاشل
do $$ begin if exists (select 1 from tests.results where not ok) then raise exception 'merge_record tests failed'; end if; end $$;
