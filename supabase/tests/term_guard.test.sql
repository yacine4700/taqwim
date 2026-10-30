-- اختبارات ترحيل 20261030090000 (روزنامة الفصول ومنع التنقيط في فصل مقفل).
-- يُشغَّل بدور supabase_admin بعد ترحيل المشرف ثم هذا الترحيل. كل سيناريو يستبدل الروزنامة
-- بأخرى تُحسب بالنسبة لليوم الحقيقي بتوقيت الجزائر، فلا يتعلّق الاختبار بتاريخ تشغيله.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set B '''bbbbbbbb-0000-4000-8000-00000000000b'''

-- يستبدل الروزنامة: كل فصل (بداية، نهاية) بعدد الأيام من اليوم (سالب = ماضٍ).
create function tests.cal(s1 int, e1 int, s2 int, e2 int, s3 int, e3 int, grace int default 10)
returns void language plpgsql as $$
declare d date := (now() at time zone 'Africa/Algiers')::date;
begin
  delete from public.term_calendar;
  insert into public.term_calendar (school_year, term, starts_on, ends_on, grace_days) values
    ('2026/2027', 1, d + s1, d + e1, grace),
    ('2026/2027', 2, d + s2, d + e2, grace),
    ('2026/2027', 3, d + s3, d + e3, grace);
end $$;

-- أول طالب لـ A، وحصته في الفصل 1، لاستعمالها في الاختبارات
select id as st from public.students where teacher_id = :A order by full_name limit 1 \gset
select id as ses1 from public.tp_sessions where teacher_id = :A and term = 1 limit 1 \gset
select id as cls from public.classes where teacher_id = :A limit 1 \gset

-- نتيجة أمر كتابة: 'ok' أو نصّ الخطأ مع الرمز
create function tests.try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- حصة موجودة مسبقًا في فصل (تُنشأ بدور الخادم بلا JWT) لتجربة علامة عليها حتى لو كان الفصل مقفلًا
create function tests.mksession(t int) returns uuid language plpgsql security definer as $$
declare id uuid := gen_random_uuid(); saved text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claims', '', false);
  insert into public.tp_sessions (id, teacher_id, class_id, term)
    values (id, 'aaaaaaaa-0000-4000-8000-00000000000a', current_setting('tests.cls')::uuid, t);
  insert into tests.ids (k, v) values (id::text, id);
  perform set_config('request.jwt.claims', coalesce(saved, ''), false);
  return id;
end $$;

-- أوامر الكتابة المجرَّبة في فصل معيّن (ف) لأستاذ A
create function tests.writes(t int) returns text language plpgsql as $$
declare
  r text := '';
  st uuid := current_setting('tests.st')::uuid;
  ses uuid;
  mid uuid;
begin
  -- عدّاد: إدخال علامة تلميذ في فصل (upsert كما يفعل التطبيق)
  r := r || 'rec:' || tests.try(format($q$insert into public.records (teacher_id, student_id, term, criteria, devoir)
      values ('aaaaaaaa-0000-4000-8000-00000000000a', %L, %s, '{"part":2}', 11)
      on conflict (student_id, term) do update set devoir = excluded.devoir, criteria = excluded.criteria$q$, st, t)) || ';';
  -- قراءة: إضافة محاولة ثم حذفها
  r := r || 'rd+:' || tests.try(format($q$insert into public.readings (teacher_id, student_id, term, score)
      values ('aaaaaaaa-0000-4000-8000-00000000000a', %L, %s, 3)$q$, st, t)) || ';';
  -- حصة أعمال تطبيقية وعلامتها
  ses := tests.mksession(t);
  mid := gen_random_uuid();
  insert into tests.ids (k, v) values (mid::text, mid);
  r := r || 'ses:' || tests.try(format($q$insert into public.tp_sessions (id, teacher_id, class_id, term)
      values (%L, 'aaaaaaaa-0000-4000-8000-00000000000a', %L, %s)$q$, mid, current_setting('tests.cls')::uuid, t)) || ';';
  r := r || 'mark:' || tests.try(format($q$insert into public.tp_marks (teacher_id, session_id, student_id, score)
      values ('aaaaaaaa-0000-4000-8000-00000000000a', %L, %L, 12)$q$, ses, st)) || ';';
  return r;
end $$;

create table tests.ids (k text primary key, v uuid);
grant all on tests.ids to public;
select set_config('tests.st', :'st', false), set_config('tests.cls', :'cls', false) \gset

-- يقول إن كانت الكتابات الأربع كلها مرّت (ok) أو كلها رُفضت بـ 23514 term_closed:<t>
create function tests.verdict(t int) returns text language plpgsql as $$
declare w text := tests.writes(t); n int;
begin
  n := (select count(*) from regexp_matches(w, ':ok;', 'g'));
  if n = 4 then return 'open'; end if;
  if n = 0 and (select count(*) from regexp_matches(w, '23514 term_closed:' || t, 'g')) = 4 then return 'closed'; end if;
  return 'MIXED ' || w;
end $$;

-- يسجّل النتيجة بعد تجربة واحدة فقط (تجربة الكتابة تترك أثرًا فلا تُكرَّر)
create function tests.expect(label text, t int, want text) returns void language plpgsql as $$
declare v text := tests.verdict(t);
begin
  insert into tests.results (label, ok, detail) values (label, v = want, v);
end $$;

-- تنظيف ما تتركه التجارب، بدور الخادم (بلا JWT فلا يعترض المحفّز)
create function tests.clean() returns void language plpgsql as $$
declare st uuid := current_setting('tests.st')::uuid;
begin
  perform set_config('request.jwt.claims', '', false);
  delete from public.tp_marks where session_id in (select v from tests.ids);
  delete from public.tp_sessions where id in (select v from tests.ids);
  delete from tests.ids;
  delete from public.records where student_id = st and term in (2, 3);
  delete from public.readings where student_id = st and score = 3;
end $$;

-- ============================================================
-- 1) وسط الفصل الثاني: ف1 أُغلق قبل 40 يومًا، ف3 لم يبدأ
-- ============================================================
select tests.cal(-120, -40, -39, 40, 41, 120);
select tests.claims(:A);
set role authenticated;
select tests.expect('وسط ف2: التنقيط في ف2 مفتوح', 2, 'open');
reset role;
-- تُنظَّف سجلات الفصل ليبقى الاختبار قابلًا للتكرار
delete from public.records where student_id = :'st' and term in (2, 3);
delete from public.readings where student_id = :'st' and term in (2, 3);
delete from public.tp_sessions where id in (select v from tests.ids);
delete from tests.ids;

select tests.claims(:A);
set role authenticated;
select tests.expect('وسط ف2: ف1 مقفل (الأربع كتابات مرفوضة)', 1, 'closed');
select tests.expect('وسط ف2: ف3 مقفل لم يبدأ', 3, 'closed');
reset role;
select tests.clean();

-- ============================================================
-- 2) المهلة: ف1 انتهى قبل 4 أيام وف2 بدأ قبل 3 أيام — الاثنان مفتوحان، وف3 لا
-- ============================================================
select tests.cal(-100, -4, -3, 80, 81, 160);
select tests.claims(:A);
set role authenticated;
select tests.expect('المهلة: ف1 ما يزال مفتوحًا بعد 4 أيام من نهايته', 1, 'open');
select tests.expect('المهلة: ف2 مفتوح في الوقت نفسه', 2, 'open');
select tests.expect('المهلة: ف3 مقفل', 3, 'closed');
reset role;
select tests.clean();

-- ============================================================
-- 3) حدّ المهلة بالضبط: انتهى قبل 10 أيام ← مفتوح اليوم، قبل 11 ← مقفل
-- ============================================================
select tests.cal(-100, -10, -9, 80, 81, 160);
select tests.claims(:A);
set role authenticated;
select tests.expect('حدّ المهلة: اليوم العاشر بعد النهاية ما يزال مفتوحًا', 1, 'open');
reset role;
select tests.clean();
select tests.cal(-100, -11, -10, 80, 81, 160);
select tests.claims(:A);
set role authenticated;
select tests.expect('حدّ المهلة: اليوم الحادي عشر مقفل', 1, 'closed');
select tests.expect('حدّ المهلة: ف2 مفتوح', 2, 'open');
reset role;
select tests.clean();

-- ============================================================
-- 4) العطلة الصيفية: بعد ف3 وبعد مهلته بلا فصل لاحق ← لا فصل مفتوح
-- ============================================================
select tests.cal(-300, -200, -199, -100, -99, -20);
select tests.claims(:A);
set role authenticated;
select tests.expect('العطلة: ف3 مقفل بعد مهلته', 3, 'closed');
select tests.expect('العطلة: ف1 مقفل', 1, 'closed');
reset role;
select tests.clean();

-- ============================================================
-- 5) روزنامة لا تغطي اليوم: لا شيء يُقفل
-- ============================================================
select tests.cal(-400, -300, -299, -200, -199, -60);   -- آخر فصل انتهى قبل 60 يومًا > 10 + 30
select tests.claims(:A);
set role authenticated;
select tests.expect('نسيان روزنامة السنة الجديدة: ف1 مفتوح', 1, 'open');
select tests.expect('نسيان روزنامة السنة الجديدة: ف3 مفتوح', 3, 'open');
reset role;
select tests.clean();
select tests.cal(10, 100, 101, 200, 201, 300);          -- روزنامة كلها في المستقبل
select tests.claims(:A);
set role authenticated;
select tests.expect('قبل بداية الروزنامة: كل الفصول مفتوحة', 1, 'open');
reset role;
select tests.clean();
select tests.claims(:A);
set role authenticated;
select tests.expect('جدول فارغ: كل الفصول مفتوحة', 2, 'open');
reset role;
select tests.clean();

-- ============================================================
-- 6) تعديل علامة موجودة وحذفها في فصل مقفل (ف1 فيه بيانات الاختبار)
-- ============================================================
select tests.cal(-120, -40, -39, 40, 41, 120);
select devoir as dv from public.records where student_id = :'st' and term = 1 \gset
select tests.claims(:A);
set role authenticated;
select tests.ok('تعديل علامة في فصل مقفل مرفوض',
  tests.try($$update public.records set devoir = 1 where student_id = current_setting('tests.st')::uuid and term = 1$$) like '23514 term_closed:1%');
select tests.ok('حذف محاولة قراءة من فصل مقفل مرفوض',
  tests.try($$delete from public.readings where student_id = current_setting('tests.st')::uuid and term = 1$$) like '23514 term_closed:1%');
select tests.ok('مسح علامة حصة من فصل مقفل مرفوض',
  tests.try($$delete from public.tp_marks where student_id = current_setting('tests.st')::uuid$$) like '23514 term_closed:1%');
select tests.ok('حذف حصة من فصل مقفل مرفوض',
  tests.try($$delete from public.tp_sessions where term = 1$$) like '23514 term_closed:1%');
select tests.ok('إدخال علامة في ف2 المفتوح يمرّ',
  tests.try(format($q$insert into public.records (teacher_id, student_id, term, criteria) values ('aaaaaaaa-0000-4000-8000-00000000000a', %L, 2, '{}')$q$, current_setting('tests.st'))) = 'ok');
select tests.ok('نقل علامة من ف2 المفتوح إلى ف1 المقفل بالتعديل مرفوض',
  tests.try(format($q$update public.records set term = 1 where student_id = %L and term = 2$q$, current_setting('tests.st'))) like '23514 term_closed:1%');
select tests.ok('ونقلها من ف1 المقفل إلى ف2 بالتعديل مرفوض أيضًا',
  tests.try(format($q$update public.records set term = 3 where student_id = %L and term = 1$q$, current_setting('tests.st'))) like '23514 term_closed:%');
reset role;
select tests.ok('بيانات ف1 لم تتغيّر بعد كل الرفض',
  (select devoir from public.records where student_id = :'st' and term = 1) = :dv
  and (select count(*) from public.readings where student_id = :'st' and term = 1) >= 1
  and (select count(*) from public.tp_marks where student_id = :'st') >= 1);
select tests.clean();

-- ============================================================
-- 7) الحذف بالتتابع لا يعترضه المحفّز: حذف تلميذ يحذف علامات فصل مقفل
-- ============================================================
select tests.claims(:A);
set role authenticated;
select tests.ok('حذف تلميذ بعلاماته في فصل مقفل يمرّ (تتابع)',
  tests.try($$delete from public.students where id = current_setting('tests.st')::uuid$$) = 'ok');
select tests.ok('علاماته حُذفت معه',
  (select count(*) from public.records where student_id = current_setting('tests.st')::uuid) = 0
  and (select count(*) from public.readings where student_id = current_setting('tests.st')::uuid) = 0
  and (select count(*) from public.tp_marks where student_id = current_setting('tests.st')::uuid) = 0);
select tests.ok('حذف فوج فيه حصة من فصل مقفل يمرّ (تفريغ group_id)',
  tests.try($$delete from public.class_groups where teacher_id = 'aaaaaaaa-0000-4000-8000-00000000000a'$$) = 'ok');
select tests.ok('وحصة الفصل المقفل باقية وfوجها فارغ',
  (select count(*) from public.tp_sessions where term = 1 and group_id is null and teacher_id = 'aaaaaaaa-0000-4000-8000-00000000000a') >= 1);
select tests.ok('حذف قسم بكل ما فيه من فصول مقفلة يمرّ',
  tests.try($$delete from public.classes where teacher_id = 'aaaaaaaa-0000-4000-8000-00000000000a'$$) = 'ok');
reset role;

-- ============================================================
-- 8) من لا JWT له (ترحيل، صيانة) ومن استعاد نسخة
-- ============================================================
select tests.cal(-120, -40, -39, 40, 41, 120);
select set_config('request.jwt.claims', '', false);
select tests.ok('دور خادم بلا JWT يكتب في فصل مقفل',
  tests.try($$insert into public.readings (teacher_id, student_id, term, score)
              select teacher_id, id, 1, 1 from public.students where teacher_id = 'bbbbbbbb-0000-4000-8000-00000000000b' limit 1$$) = 'ok');
-- الاستعادة: session_replication_role = replica لا يُطلق المحفّزات حتى مع JWT لأستاذ
select tests.claims(:B);
set role authenticated;
select tests.ok('الأستاذ نفسه يُرفض في الفصل المقفل (الشاهد)',
  tests.try($$insert into public.readings (teacher_id, student_id, term, score)
              select teacher_id, id, 1, 2 from public.students where teacher_id = 'bbbbbbbb-0000-4000-8000-00000000000b' limit 1$$) like '23514 term_closed:1%');
reset role;
begin;
set local session_replication_role = replica;
with i as (insert into public.readings (teacher_id, student_id, term, score)
  select teacher_id, id, 1, 2 from public.students where teacher_id = 'bbbbbbbb-0000-4000-8000-00000000000b' limit 1 returning 1)
select count(*) as restored from i \gset
rollback;
select tests.ok('استعادة علامة فصل مقفل بالنسخة (replica) تمرّ ولو كان JWT أستاذ في الجلسة', :restored = 1);

-- ============================================================
-- 9) الروزنامة نفسها: قراءة للأساتذة، ولا كتابة، ولا تداخل، ولا دوال مكشوفة
-- ============================================================
select tests.cal(-120, -40, -39, 40, 41, 120);
select tests.claims(:A);
set role authenticated;
select tests.ok('الأستاذ يقرأ الروزنامة', (select count(*) from public.term_calendar) = 3);
select tests.fails('الأستاذ لا يضيف فصلًا', $$insert into public.term_calendar values ('2030/2031', 1, '2030-09-01', '2030-12-01', 10)$$, '42501');
select tests.fails('الأستاذ لا يعدّل الروزنامة', $$update public.term_calendar set grace_days = 30$$, '42501');
select tests.fails('الأستاذ لا يحذف من الروزنامة', $$delete from public.term_calendar$$, '42501');
select tests.fails('الأستاذ لا يستدعي term_open', $$select private.term_open(1)$$, '42501');
reset role;
set role anon;
select tests.fails('anon لا يقرأ الروزنامة', $$select * from public.term_calendar$$, '42501');
reset role;
select tests.fails('فصلان متداخلان مرفوضان', $$insert into public.term_calendar values ('2027/2028', 1, current_date, current_date + 5, 10)$$, '23P01');
select tests.fails('نهاية قبل البداية مرفوضة', $$insert into public.term_calendar values ('2040/2041', 1, '2040-12-01', '2040-09-01', 10)$$, '23514');
select tests.fails('مهلة أكبر من 30 يومًا مرفوضة', $$insert into public.term_calendar values ('2040/2041', 1, '2040-09-01', '2040-12-01', 31)$$, '23514');

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
