-- اختبارات ملكية العلاقات وحماية classes.created_at (ترحيلا 20261105120000 و20261105121000).
-- يُشغَّل بدور supabase_admin بعد seed.sql وبعد ترحيلات المشرف والرزنامة والسنة الدراسية، وقبل الترحيلين
-- (فتفشل اختبارات المنع وهذا مقصود: يثبت أن الاختبار يكشف الثغرة) أو بعدهما (فتنجح كلها).
-- الأستاذان: A وB، ولكلٍّ مؤسسة وقسم وفوج وحصة وثلاثة تلاميذ بتنقيط وقراءة وعلامة عمل تطبيقي (seed.sql).
-- الأدوار تُحاكي PostgREST: claims ثم set role authenticated. والأوامر المجرَّبة تُنفَّذ بدور الأستاذ.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set B '''bbbbbbbb-0000-4000-8000-00000000000b'''

truncate tests.results;

-- ينفّذ أمرًا ويسجّل: هل كانت نتيجته want ('ok' أو رمز SQLSTATE)؟ ما نجح يبقى (لا rollback).
create or replace function tests.ow_expect(label text, stmt text, want text) returns void language plpgsql as $$
declare got text; msg text := '';
begin
  begin
    execute stmt;
    got := 'ok';
  exception when others then
    got := sqlstate; msg := sqlerrm;
  end;
  insert into tests.results (label, ok, detail)
  values (label, got = want, format('المتوقَّع %s، الفعلي %s %s', want, got, msg));
end $$;

-- عدد الصفوف التي مسّها أمر كتابة (0 = لم يُمسّ شيء، لا خطأ)
create or replace function tests.ow_rows(stmt text) returns integer language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

-- ===========================================================================
-- تجهيز (بدور الخادم): الرزنامة فارغة فكل الفصول مفتوحة، فلا يتعلّق الاختبار بتاريخ تشغيله
-- ===========================================================================
delete from public.term_calendar;

select id as ca from public.classes where teacher_id = :A \gset
select id as cb from public.classes where teacher_id = :B \gset
select id as ga from public.class_groups where teacher_id = :A \gset
select id as gb from public.class_groups where teacher_id = :B \gset
select id as xa from public.tp_sessions where teacher_id = :A \gset
select id as xb from public.tp_sessions where teacher_id = :B \gset
select id as sa from public.students where teacher_id = :A order by full_name limit 1 \gset
select id as sb from public.students where teacher_id = :B order by full_name limit 1 \gset

-- ضحية A: تلميذ بلا أي تنقيط. هو الهدف الذي يزرع B عليه قيودًا فريدة قبل أن يُنقَّط.
insert into public.students (teacher_id, class_id, full_name) values (:A, :'ca', 'ضحية') returning id as sv \gset
-- B: قسم ثانٍ بتلميذ وحصة، لاختبار علامة تجمع تلميذًا وحصة من قسمين مختلفين لأستاذ واحد
insert into public.classes (teacher_id, name) values (:B, 'قسم ب2') returning id as cb2 \gset
insert into public.students (teacher_id, class_id, full_name) values (:B, :'cb2', 'تلميذ ب2') returning id as sb2 \gset
insert into public.tp_sessions (teacher_id, class_id, term) values (:B, :'cb2', 1) returning id as xb2 \gset
insert into public.class_groups (teacher_id, class_id, name) values (:B, :'cb2', 'فوج ب2') returning id as gb2 \gset
-- قسم قديم لـ B (سنة منتهية دائمًا مهما كان تاريخ التشغيل) بتلميذ: لاختبار قفل السنة
insert into public.classes (teacher_id, name, created_at) values (:B, 'قديم ب', now() - interval '2 years') returning id as cold \gset
insert into public.students (teacher_id, class_id, full_name) values (:B, :'cold', 'تلميذ قديم') returning id as sold \gset

select tests.fp(:A) as fpa0 \gset
select tests.fp(:B) as fpb0 \gset
select (select count(*) from public.students where teacher_id = :B and class_id = :'ca') as b_in_ca0 \gset

-- ===========================================================================
-- 1) B يحاول ربط صفوفه بقسم A وتلميذه وحصته: كلها مرفوضة (42501)
-- ===========================================================================
select tests.claims(:B);
set role authenticated;

select tests.ow_expect('منع: B يدرج تلميذًا في قسم A',
  format($q$insert into public.students (teacher_id, class_id, full_name) values (%L, %L, 'دخيل')$q$, :B, :'ca'), '42501');
select tests.ow_expect('منع: B ينقل تلميذه إلى قسم A بتعديل class_id',
  format($q$update public.students set class_id = %L where id = %L$q$, :'ca', :'sb'), '42501');
select tests.ow_expect('منع: B يدرج فوجًا في قسم A',
  format($q$insert into public.class_groups (teacher_id, class_id, name) values (%L, %L, 'فوج دخيل')$q$, :B, :'ca'), '42501');
select tests.ow_expect('منع: B ينقل فوجه إلى قسم A',
  format($q$update public.class_groups set class_id = %L where id = %L$q$, :'ca', :'gb'), '42501');
select tests.ow_expect('منع: B يدرج حصة في قسم A',
  format($q$insert into public.tp_sessions (teacher_id, class_id, term) values (%L, %L, 1)$q$, :B, :'ca'), '42501');
select tests.ow_expect('منع: B ينقل حصته إلى قسم A',
  format($q$update public.tp_sessions set class_id = %L where id = %L$q$, :'ca', :'xb'), '42501');

-- نسخ بلا فوج: لا يحجبها المفتاح المركّب (group_id, class_id)، فيبقى الفحص وحده هو الحاجز
select tests.ow_expect('منع: B ينقل تلميذًا بلا فوج إلى قسم A',
  format($q$update public.students set class_id = %L where id = %L$q$, :'ca', :'sb2'), '42501');
select tests.ow_expect('منع: B ينقل فوجًا بلا تلاميذ إلى قسم A',
  format($q$update public.class_groups set class_id = %L where id = %L$q$, :'ca', :'gb2'), '42501');
select tests.ow_expect('منع: B ينقل حصة بلا فوج إلى قسم A',
  format($q$update public.tp_sessions set class_id = %L where id = %L$q$, :'ca', :'xb2'), '42501');

select tests.ow_expect('منع: B ينشئ سجل علامات لتلميذ A',
  format($q$insert into public.records (teacher_id, student_id, term, devoir) values (%L, %L, 1, 10)$q$, :B, :'sv'), '42501');
select tests.ow_expect('منع: B ينقل سجله إلى تلميذ A بتعديل student_id',
  format($q$update public.records set student_id = %L where student_id = %L and term = 1$q$, :'sv', :'sb'), '42501');
select tests.ow_expect('منع: B ينشئ قراءة لتلميذ A',
  format($q$insert into public.readings (teacher_id, student_id, term, score) values (%L, %L, 1, 2)$q$, :B, :'sv'), '42501');
select tests.ow_expect('منع: B ينقل قراءته إلى تلميذ A بتعديل student_id',
  format($q$update public.readings set student_id = %L where student_id = %L$q$, :'sv', :'sb'), '42501');

select tests.ow_expect('منع: علامة بحصة B وتلميذ A',
  format($q$insert into public.tp_marks (teacher_id, session_id, student_id, score) values (%L, %L, %L, 5)$q$, :B, :'xb', :'sv'), '42501');
select tests.ow_expect('منع: علامة بحصة A وتلميذ B',
  format($q$insert into public.tp_marks (teacher_id, session_id, student_id, score) values (%L, %L, %L, 5)$q$, :B, :'xa', :'sb'), '42501');
select tests.ow_expect('منع: علامة بحصة A وتلميذ A',
  format($q$insert into public.tp_marks (teacher_id, session_id, student_id, score) values (%L, %L, %L, 5)$q$, :B, :'xa', :'sv'), '42501');
select tests.ow_expect('منع: علامة تجمع تلميذًا وحصة من قسمين مختلفين لـ B نفسه',
  format($q$insert into public.tp_marks (teacher_id, session_id, student_id, score) values (%L, %L, %L, 5)$q$, :B, :'xb', :'sb2'), '42501');
select tests.ow_expect('منع: B ينقل علامته إلى تلميذ من قسم آخر بتعديل student_id',
  format($q$update public.tp_marks set student_id = %L where session_id = %L and student_id = %L$q$, :'sb2', :'xb', :'sb'), '42501');
select tests.ow_expect('منع: B ينقل علامته إلى حصة A بتعديل session_id',
  format($q$update public.tp_marks set session_id = %L where session_id = %L and student_id = %L$q$, :'xa', :'xb', :'sb'), '42501');

-- فوج A لا يُربط به تلميذ B (المفتاح المركّب (group_id, class_id) يحميه)
select tests.ow_expect('منع: B يضع تلميذه في فوج A (مفتاح مركّب)',
  format($q$update public.students set group_id = %L where id = %L$q$, :'ga', :'sb'), '23503');

-- upsert على صف A: لا كتابة فوقه
select tests.ow_expect('منع: upsert بـ DO UPDATE على تلميذ A',
  format($q$insert into public.students (id, teacher_id, class_id, full_name) values (%L, %L, %L, 'استيلاء')
            on conflict (id) do update set full_name = excluded.full_name$q$, :'sa', :B, :'cb'), '42501');
select tests.ow_expect('منع: upsert بـ DO UPDATE على علامة A',
  format($q$insert into public.tp_marks (teacher_id, session_id, student_id, score) values (%L, %L, %L, 1)
            on conflict (session_id, student_id) do update set score = excluded.score$q$, :B, :'xa', :'sa'), '42501');
-- DO NOTHING لا يمسّ صف A (سلوك move: ignoreDuplicates). ينجح صامتًا ولا يغيّر شيئًا
select tests.ow_expect('upsert بـ DO NOTHING على معرّف تلميذ A: صامت ولا يغيّر شيئًا',
  format($q$insert into public.students (id, teacher_id, class_id, full_name) values (%L, %L, %L, 'استيلاء')
            on conflict (id) do nothing$q$, :'sa', :B, :'cb'), 'ok');

-- لا قراءة ولا تعديل ولا حذف لصفوف A بمعرّفاتها
select tests.ow_expect('B لا يقرأ تلميذ A بمعرّفه',
  format($q$do $d$ begin if exists (select 1 from public.students where id = %L) then raise exception 'visible'; end if; end $d$$q$, :'sa'), 'ok');
select tests.ow_expect('B لا يعدّل تلميذ A (0 صفوف)',
  format($q$do $d$ begin if tests.ow_rows(format('update public.students set full_name = ''x'' where id = %%L', %L)) <> 0 then raise exception 'updated'; end if; end $d$$q$, :'sa'), 'ok');
select tests.ow_expect('B لا يحذف قسم A (0 صفوف)',
  format($q$do $d$ begin if tests.ow_rows(format('delete from public.classes where id = %%L', %L)) <> 0 then raise exception 'deleted'; end if; end $d$$q$, :'ca'), 'ok');

-- زرع قيود فريدة على تلميذ A قبل تنقيطه
select tests.ow_expect('منع: B يزرع سجلًّا على (تلميذ A، الفصل 1) قبل تنقيطه',
  format($q$insert into public.records (teacher_id, student_id, term, devoir) values (%L, %L, 1, 0)$q$, :B, :'sv'), '42501');
select tests.ow_expect('منع: B يزرع علامة على (حصة A، تلميذ A) قبل تنقيطها',
  format($q$insert into public.tp_marks (teacher_id, session_id, student_id, score) values (%L, %L, %L, 0)$q$, :B, :'xa', :'sv'), '42501');

reset role;

select tests.ok('لم يُدرج B شيئًا في قسم A',
  (select count(*) from public.students where teacher_id = :B and class_id = :'ca') = :b_in_ca0);
select tests.ok('بيانات A كما هي بعد كل محاولات B (بصمة)', tests.fp(:A) = :'fpa0');
select tests.ok('بيانات B كما هي بعد محاولاته المرفوضة (بصمة)', tests.fp(:B) = :'fpb0');
select tests.ok('تلميذ B ما زال في قسمه',
  (select class_id from public.students where id = :'sb') = :'cb'::uuid);

-- بلا جلسة (anon): لا كتابة في أي جدول منها
select set_config('request.jwt.claims', '', false);
set role anon;
select tests.ow_expect('anon لا يدرج حصة في قسم A',
  format($q$insert into public.tp_sessions (teacher_id, class_id, term) values (%L, %L, 1)$q$, :A, :'ca'), '42501');
select tests.ow_expect('anon لا يدرج علامة (حصة A، تلميذ A)',
  format($q$insert into public.tp_marks (teacher_id, session_id, student_id, score) values (%L, %L, %L, 1)$q$, :A, :'xa', :'sv'), '42501');
reset role;

-- ===========================================================================
-- 2) A لا يتأثر بوجود صفوف B: ينقّط الضحية ويفعل ما يفعله التطبيق
-- ===========================================================================
select tests.claims(:A);
set role authenticated;

select tests.ow_expect('A ينقّط الضحية: سجل جديد (upsert كالتطبيق)',
  format($q$insert into public.records (teacher_id, student_id, term, devoir) values (%L, %L, 1, 11)
            on conflict (student_id, term) do update set devoir = excluded.devoir$q$, :A, :'sv'), 'ok');
select tests.ow_expect('A يضيف علامة عمل تطبيقي للضحية (upsert كالتطبيق)',
  format($q$insert into public.tp_marks (teacher_id, session_id, student_id, score) values (%L, %L, %L, 13)
            on conflict (session_id, student_id) do update set score = excluded.score$q$, :A, :'xa', :'sv'), 'ok');
select tests.ow_expect('A يضيف قراءة للضحية',
  format($q$insert into public.readings (teacher_id, student_id, term, score) values (%L, %L, 1, 3)$q$, :A, :'sv'), 'ok');
select tests.ow_expect('A يضيف تلميذًا إلى قسمه',
  format($q$insert into public.students (teacher_id, class_id, full_name) values (%L, %L, 'جديد أ')$q$, :A, :'ca'), 'ok');
select tests.ow_expect('A يضيف حصة وفوجًا إلى قسمه',
  format($q$insert into public.tp_sessions (teacher_id, class_id, group_id, term) values (%L, %L, %L, 2)$q$, :A, :'ca', :'ga'), 'ok');
select tests.ow_expect('A يضع تلميذه في فوج قسمه',
  format($q$update public.students set group_id = %L where id = %L$q$, :'ga', :'sv'), 'ok');

reset role;

select tests.claims(:A);
set role authenticated;
select tests.ow_expect('A لا يرى أي صف لـ B',
  $q$do $d$ begin
       if exists (select 1 from public.students where teacher_id <> auth.uid())
          or exists (select 1 from public.classes where teacher_id <> auth.uid())
          or exists (select 1 from public.tp_marks where teacher_id <> auth.uid())
          or exists (select 1 from public.records where teacher_id <> auth.uid()) then
         raise exception 'leak'; end if; end $d$$q$, 'ok');
reset role;
select tests.fp(:A) as fpa1 \gset

-- ===========================================================================
-- 3) B على بياناته: كل العمليات المشروعة تعمل
-- ===========================================================================
select tests.claims(:B);
set role authenticated;

-- ما يفعله التطبيق عند إنشاء قسم وتلاميذه ثم الفوج والحصة والتنقيط
select tests.ow_expect('B ينشئ قسمًا',
  format($q$insert into public.classes (id, teacher_id, name, position) values ('bbbbbbbb-2000-4000-8000-000000000001', %L, 'قسم جديد', 3)$q$, :B), 'ok');
select tests.ow_expect('B يدرج تلاميذ القسم دفعة واحدة',
  format($q$insert into public.students (id, teacher_id, class_id, full_name, position) values
     ('bbbbbbbb-2000-4000-8000-0000000000a1', %L, 'bbbbbbbb-2000-4000-8000-000000000001', 'ن1', 1),
     ('bbbbbbbb-2000-4000-8000-0000000000a2', %L, 'bbbbbbbb-2000-4000-8000-000000000001', 'ن2', 2)$q$, :B, :B), 'ok');
select tests.ow_expect('B ينشئ فوجًا في قسمه',
  format($q$insert into public.class_groups (id, teacher_id, class_id, name) values ('bbbbbbbb-2000-4000-8000-0000000000b1', %L, 'bbbbbbbb-2000-4000-8000-000000000001', 'ف')$q$, :B), 'ok');
select tests.ow_expect('B ينشئ حصة في قسمه',
  format($q$insert into public.tp_sessions (id, teacher_id, class_id, group_id, term) values ('bbbbbbbb-2000-4000-8000-0000000000c1', %L, 'bbbbbbbb-2000-4000-8000-000000000001', 'bbbbbbbb-2000-4000-8000-0000000000b1', 1)$q$, :B), 'ok');
select tests.ow_expect('B يعدّل تلميذه: الاسم والملاحظة والوسوم (outbox)',
  $q$update public.students set full_name = 'ن1 معدَّل', note = 'ملاحظة', tags = '{a,b}' where id = 'bbbbbbbb-2000-4000-8000-0000000000a1'$q$, 'ok');
select tests.ow_expect('B يضع تلميذه في فوج قسمه',
  $q$update public.students set group_id = 'bbbbbbbb-2000-4000-8000-0000000000b1' where id in ('bbbbbbbb-2000-4000-8000-0000000000a1', 'bbbbbbbb-2000-4000-8000-0000000000a2')$q$, 'ok');
select tests.ow_expect('B ينقّط تلميذه: سجل upsert',
  $q$insert into public.records (teacher_id, student_id, term, devoir) values ('bbbbbbbb-0000-4000-8000-00000000000b', 'bbbbbbbb-2000-4000-8000-0000000000a1', 1, 14)
     on conflict (student_id, term) do update set devoir = excluded.devoir$q$, 'ok');
select tests.ow_expect('B ينقّط بـ merge_record على تلميذه',
  $q$select public.merge_record('bbbbbbbb-2000-4000-8000-0000000000a1', 1::smallint, '{"criteria": {"part": 2}, "exam": 15}'::jsonb)$q$, 'ok');
select tests.ow_expect('merge_record على تلميذ A: student_not_found',
  format($q$select public.merge_record(%L, 1::smallint, '{"exam": 1}'::jsonb)$q$, :'sa'), '23503');
select tests.ow_expect('B يضيف قراءة لتلميذه',
  $q$insert into public.readings (teacher_id, student_id, term, score) values ('bbbbbbbb-0000-4000-8000-00000000000b', 'bbbbbbbb-2000-4000-8000-0000000000a1', 1, 3)$q$, 'ok');
select tests.ow_expect('B ينقّط علامة عمل تطبيقي: تلميذ وحصة من القسم نفسه',
  $q$insert into public.tp_marks (teacher_id, session_id, student_id, score) values ('bbbbbbbb-0000-4000-8000-00000000000b', 'bbbbbbbb-2000-4000-8000-0000000000c1', 'bbbbbbbb-2000-4000-8000-0000000000a1', 12)
     on conflict (session_id, student_id) do update set score = excluded.score$q$, 'ok');
select tests.ow_expect('B يعدّل العلامة نفسها (upsert ثانٍ)',
  $q$insert into public.tp_marks (teacher_id, session_id, student_id, score) values ('bbbbbbbb-0000-4000-8000-00000000000b', 'bbbbbbbb-2000-4000-8000-0000000000c1', 'bbbbbbbb-2000-4000-8000-0000000000a1', 16)
     on conflict (session_id, student_id) do update set score = excluded.score$q$, 'ok');
select tests.ow_expect('B يعلّم غائبًا',
  $q$insert into public.tp_marks (teacher_id, session_id, student_id, score, absent) values ('bbbbbbbb-0000-4000-8000-00000000000b', 'bbbbbbbb-2000-4000-8000-0000000000c1', 'bbbbbbbb-2000-4000-8000-0000000000a2', null, true)$q$, 'ok');
select tests.ow_expect('B يعدّل حصته (عنوان وتاريخ)',
  $q$update public.tp_sessions set title = 'حصة 1', held_on = current_date where id = 'bbbbbbbb-2000-4000-8000-0000000000c1'$q$, 'ok');
select tests.ow_expect('B يعيد تسمية قسمه ويسنده لمؤسسته',
  format($q$update public.classes set name = 'اسم جديد', school_id = (select id from public.schools where teacher_id = %L) where id = 'bbbbbbbb-2000-4000-8000-000000000001'$q$, :B), 'ok');
select tests.ow_expect('B يمسح علامة (يحذف الصف)',
  $q$delete from public.tp_marks where session_id = 'bbbbbbbb-2000-4000-8000-0000000000c1' and student_id = 'bbbbbbbb-2000-4000-8000-0000000000a2'$q$, 'ok');

-- نقل الأسماء (moveRoster): قسم وتلاميذ بـ upsert وتجاهل التعارض، ويُكرَّر الإرسال فلا تكرار
select tests.ow_expect('نقل الأسماء: إدراج القسم بتجاهل التعارض',
  format($q$insert into public.classes (id, teacher_id, name, position) values ('bbbbbbbb-3000-4000-8000-000000000001', %L, 'منقول', 4) on conflict (id) do nothing$q$, :B), 'ok');
select tests.ow_expect('نقل الأسماء: إدراج التلاميذ بتجاهل التعارض',
  format($q$insert into public.students (id, teacher_id, class_id, full_name, position) values
     ('bbbbbbbb-3000-4000-8000-0000000000a1', %L, 'bbbbbbbb-3000-4000-8000-000000000001', 'م1', 1),
     ('bbbbbbbb-3000-4000-8000-0000000000a2', %L, 'bbbbbbbb-3000-4000-8000-000000000001', 'م2', 2),
     ('bbbbbbbb-3000-4000-8000-0000000000a3', %L, 'bbbbbbbb-3000-4000-8000-000000000001', 'م3', 3)
     on conflict (id) do nothing$q$, :B, :B, :B), 'ok');
select tests.ow_expect('نقل الأسماء: إعادة إرسال القسم نفسه (استكمال)',
  format($q$insert into public.classes (id, teacher_id, name, position) values ('bbbbbbbb-3000-4000-8000-000000000001', %L, 'منقول', 4) on conflict (id) do nothing$q$, :B), 'ok');
select tests.ow_expect('نقل الأسماء: إعادة إرسال التلاميذ نفسهم (استكمال)',
  format($q$insert into public.students (id, teacher_id, class_id, full_name, position) values
     ('bbbbbbbb-3000-4000-8000-0000000000a1', %L, 'bbbbbbbb-3000-4000-8000-000000000001', 'م1', 1),
     ('bbbbbbbb-3000-4000-8000-0000000000a2', %L, 'bbbbbbbb-3000-4000-8000-000000000001', 'م2', 2),
     ('bbbbbbbb-3000-4000-8000-0000000000a3', %L, 'bbbbbbbb-3000-4000-8000-000000000001', 'م3', 3)
     on conflict (id) do nothing$q$, :B, :B, :B), 'ok');

reset role;
select tests.ok('نقل الأسماء: قسم واحد وثلاثة تلاميذ بعد تكرار الإرسال',
  (select count(*) from public.classes where id = 'bbbbbbbb-3000-4000-8000-000000000001') = 1
  and (select count(*) from public.students where class_id = 'bbbbbbbb-3000-4000-8000-000000000001') = 3);
select tests.ok('بعد عمليات B المشروعة: لا شيء من بيانات A تغيّر (بصمة)', tests.fp(:A) = :'fpa1');
select tests.ok('وB لم يُدخل شيئًا في قسم A', (select count(*) from public.students where teacher_id = :B and class_id = :'ca') = :b_in_ca0);

-- الحذف المشروع والمتتالي (المفاتيح الأجنبية تنفّذه بصلاحية المالك فلا تعترضه سياسات الصفوف)
select tests.claims(:B);
set role authenticated;
select tests.ow_expect('B يضع تلميذ قسمه الثاني في فوجه ثم يحذف الفوج',
  format($q$update public.students set group_id = %L where id = %L$q$, :'gb2', :'sb2'), 'ok');
select tests.ow_expect('B يحذف الفوج: يُفرَّغ group_id ولا يُحذف تلميذ',
  format($q$delete from public.class_groups where id = %L$q$, :'gb2'), 'ok');
reset role;
select tests.ok('حذف الفوج: التلميذ باقٍ وgroup_id فارغ',
  (select group_id is null from public.students where id = :'sb2'));

select tests.claims(:B);
set role authenticated;
select tests.ow_expect('B يحذف تلميذًا: تُحذف سجلاته وعلاماته بالتتالي',
  format($q$delete from public.students where id = %L$q$, :'sb'), 'ok');
reset role;
select tests.ok('حذف التلميذ: لا سجلات ولا قراءات ولا علامات له',
  not exists (select 1 from public.records where student_id = :'sb')
  and not exists (select 1 from public.readings where student_id = :'sb')
  and not exists (select 1 from public.tp_marks where student_id = :'sb'));

select tests.claims(:B);
set role authenticated;
select tests.ow_expect('B يحذف قسمه: تُحذف أفواجه وحصصه وتلاميذه بالتتالي',
  format($q$delete from public.classes where id in (%L, 'bbbbbbbb-2000-4000-8000-000000000001')$q$, :'cb2'), 'ok');
reset role;
select tests.ok('حذف القسم: لا تلاميذ ولا حصص ولا أفواج بقيت له',
  not exists (select 1 from public.students where class_id in (:'cb2', 'bbbbbbbb-2000-4000-8000-000000000001'))
  and not exists (select 1 from public.tp_sessions where class_id in (:'cb2', 'bbbbbbbb-2000-4000-8000-000000000001'))
  and not exists (select 1 from public.class_groups where class_id in (:'cb2', 'bbbbbbbb-2000-4000-8000-000000000001')));

-- التجميد: السياسات التقييدية guard_* لم تُمسّ. حساب مجدول للحذف لا يكتب ولو كان الكتابة مشروعة
insert into private.deletion_requests (user_id, requested_at, purge_after) values (:B, now(), now() + interval '8 days');
select tests.claims(:B);
set role authenticated;
select tests.ow_expect('حساب مجدول للحذف: إدراج مشروع يُرفض (guard_insert)',
  format($q$insert into public.students (teacher_id, class_id, full_name) values (%L, %L, 'بعد الجدولة')$q$, :B, :'cb'), '42501');
reset role;
delete from private.deletion_requests where user_id = :B;
select tests.claims(:B);
set role authenticated;
select tests.ow_expect('بعد إلغاء الجدولة: الإدراج المشروع يعمل',
  format($q$insert into public.students (teacher_id, class_id, full_name) values (%L, %L, 'بعد الإلغاء')$q$, :B, :'cb'), 'ok');
reset role;

-- ===========================================================================
-- 4) classes.created_at
-- ===========================================================================
select tests.claims(:B);
set role authenticated;

select tests.ow_expect('B يدرج قسمًا بتاريخ مصطنع قديم',
  format($q$insert into public.classes (id, teacher_id, name, created_at) values ('bbbbbbbb-4000-4000-8000-000000000001', %L, 'مصطنع قديم', now() - interval '3 years')$q$, :B), 'ok');
select tests.ow_expect('B يدرج قسمًا بتاريخ مصطنع في المستقبل',
  format($q$insert into public.classes (id, teacher_id, name, created_at) values ('bbbbbbbb-4000-4000-8000-000000000002', %L, 'مصطنع آتٍ', now() + interval '3 years')$q$, :B), 'ok');
select tests.ow_expect('upsert لقسم قائم بلا created_at (ما يفعله التطبيق) يمرّ',
  format($q$insert into public.classes (id, teacher_id, name) values ('bbbbbbbb-4000-4000-8000-000000000001', %L, 'اسم آخر')
            on conflict (id) do update set name = excluded.name$q$, :B), 'ok');
select tests.ow_expect('تعديل غير created_at يمرّ (الاسم والترتيب والمؤسسة)',
  $q$update public.classes set name = 'تعديل', position = 9 where id = 'bbbbbbbb-4000-4000-8000-000000000001'$q$, 'ok');
select tests.ow_expect('منع: B يعدّل created_at لقسمه إلى الآن',
  format($q$update public.classes set created_at = now() where id = %L$q$, :'cold'), '42501');
select tests.ow_expect('منع: B يقدّم created_at لقسمه (يسرّع حذفه)',
  format($q$update public.classes set created_at = now() - interval '5 years' where id = %L$q$, :'cb'), '42501');
select tests.ow_expect('منع: upsert يغيّر created_at عبر DO UPDATE',
  format($q$insert into public.classes (id, teacher_id, name, created_at) values (%L, %L, 'x', now() - interval '9 years')
            on conflict (id) do update set created_at = excluded.created_at$q$, :'cb', :B), '42501');
-- القفل ما زال يحمي القسم المقفل
select tests.ow_expect('قسم السنة المنتهية: كتابة تنقيطه ما زالت مرفوضة بعد المحاولة',
  format($q$insert into public.records (teacher_id, student_id, term, devoir) values (%L, %L, 1, 10)$q$, :B, :'sold'), '23514');

reset role;

select tests.ok('القسم المُدرج بتاريخ قديم أخذ تاريخ الإدراج الفعلي',
  (select created_at > now() - interval '1 minute' and created_at <= now() + interval '1 minute'
     from public.classes where id = 'bbbbbbbb-4000-4000-8000-000000000001'));
select tests.ok('والمُدرج بتاريخ آتٍ أخذ تاريخ الإدراج الفعلي',
  (select created_at <= now() + interval '1 minute' from public.classes where id = 'bbbbbbbb-4000-4000-8000-000000000002'));
select tests.ok('created_at للقسم القديم لم يتغيّر',
  (select created_at < now() - interval '1 year' from public.classes where id = :'cold'));
select tests.ok('وبعد المحاولات ما زال القسم القديم يُعدّ منتهي السنة (قفل ثابت)',
  private.class_year_closed(:'cold'::uuid));

-- دور الخادم: التصحيح اليدوي لتاريخ قسم ممكن، والاختبارات القائمة تعتمد عليه
select tests.ow_expect('الصيانة بدور supabase_admin: تعديل created_at يمرّ',
  format($q$update public.classes set created_at = created_at - interval '1 day' where id = %L$q$, :'cold'), 'ok');
set role service_role;
select tests.ow_expect('الصيانة بدور service_role: تعديل created_at يمرّ',
  format($q$update public.classes set created_at = created_at - interval '1 day' where id = %L$q$, :'cold'), 'ok');
reset role;
set role postgres;
select tests.ow_expect('بدور postgres (المهاجر والاستعادة): إدراج بتاريخ محدّد يُحفظ كما هو',
  format($q$insert into public.classes (id, teacher_id, name, created_at) values ('bbbbbbbb-4000-4000-8000-000000000003', %L, 'مستعاد', timestamptz '2019-03-04 10:00:00+01')$q$, :B), 'ok');
reset role;
select tests.ok('تاريخ postgres حُفظ حرفيًّا',
  (select created_at = timestamptz '2019-03-04 10:00:00+01' from public.classes where id = 'bbbbbbbb-4000-4000-8000-000000000003'));

-- الاستعادة: session_replication_role = replica (كما في data.sql): تُدرج الصفوف بأي ترتيب وبتواريخها الأصلية
set session_replication_role = replica;
insert into public.students (id, teacher_id, class_id, full_name) values ('bbbbbbbb-5000-4000-8000-0000000000a1', :B, 'bbbbbbbb-5000-4000-8000-000000000001', 'يتيم الترتيب');
insert into public.classes (id, teacher_id, name, created_at) values ('bbbbbbbb-5000-4000-8000-000000000001', :B, 'مستعاد بالترتيب المعكوس', timestamptz '2018-01-02 00:00:00+01');
reset session_replication_role;
select tests.ok('الاستعادة (replica): القسم بتاريخه الأصلي والتلميذ قبل قسمه لا يعترضه شيء',
  (select created_at = timestamptz '2018-01-02 00:00:00+01' from public.classes where id = 'bbbbbbbb-5000-4000-8000-000000000001')
  and exists (select 1 from public.students where id = 'bbbbbbbb-5000-4000-8000-0000000000a1'));

-- ===========================================================================
-- التقرير
-- ===========================================================================
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
