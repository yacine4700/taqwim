-- اختبارات ترحيل 20261105122000 (منع تغيير students.class_id من العميل).
-- يُشغَّل بدور supabase_admin بعد seed.sql وترحيلات المشرف والرزنامة والسنة الدراسية وترحيلَي الملكية
-- و created_at. قبل الترحيل تفشل اختبارات المنع (يثبت أن الاختبار يكشف الثغرة)، وبعده تنجح كلها.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set B '''bbbbbbbb-0000-4000-8000-00000000000b'''

truncate tests.results;

create or replace function tests.sc_expect(label text, stmt text, want text) returns void language plpgsql as $$
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

create or replace function tests.sc_rows(stmt text) returns integer language plpgsql as $$
declare n integer;
begin execute stmt; get diagnostics n = row_count; return n; end $$;

delete from public.term_calendar;

select id as ca from public.classes where teacher_id = :A \gset
select id as cb from public.classes where teacher_id = :B \gset
select id as gb from public.class_groups where teacher_id = :B \gset
select id as xb from public.tp_sessions where teacher_id = :B \gset
select id as sa from public.students where teacher_id = :A order by full_name limit 1 \gset
-- B: تلميذ بفوج (من seed) وتلميذ بلا فوج، وقسم ثانٍ للأستاذ نفسه
select id as sb from public.students where teacher_id = :B order by full_name limit 1 \gset
insert into public.students (teacher_id, class_id, full_name) values (:B, :'cb', 'حر') returning id as sfree \gset
insert into public.classes (teacher_id, name) values (:B, 'قسم ب2') returning id as cb2 \gset
-- قسم قديم (سنة منتهية) لـ B وقسم جارٍ، كلاهما لـ B: لتجربة تهريب التلاميذ من قفل السنة
insert into public.classes (teacher_id, name, created_at) values (:B, 'قديم ب', now() - interval '2 years') returning id as cold \gset
insert into public.students (teacher_id, class_id, full_name) values (:B, :'cold', 'تلميذ قديم') returning id as sold \gset

select tests.fp(:A) as fpa0 \gset
select tests.fp(:B) as fpb0 \gset

-- ===========================================================================
-- 1) الأستاذ لا ينقل تلميذًا
-- ===========================================================================
select tests.claims(:B);
set role authenticated;

select tests.sc_expect('منع: B ينقل تلميذًا بلا فوج إلى قسم آخر يملكه',
  format($q$update public.students set class_id = %L where id = %L$q$, :'cb2', :'sfree'), '42501');
select tests.sc_expect('منع: B ينقل تلميذًا في فوج إلى قسم آخر يملكه',
  format($q$update public.students set class_id = %L where id = %L$q$, :'cb2', :'sb'), '42501');
select tests.sc_expect('منع: B يهرّب تلميذ قسم قديم إلى قسم جارٍ يملكه (يتخطى القفل والحذف السنوي)',
  format($q$update public.students set class_id = %L where id = %L$q$, :'cb', :'sold'), '42501');
select tests.sc_expect('منع: B ينقل تلميذًا بلا فوج إلى قسم أستاذ آخر',
  format($q$update public.students set class_id = %L where id = %L$q$, :'ca', :'sfree'), '42501');
select tests.sc_expect('منع: B ينقل تلميذه إلى قسم أستاذ آخر',
  format($q$update public.students set class_id = %L where id = %L$q$, :'ca', :'sb'), '42501');
select tests.sc_expect('منع: نقل جماعي بأمر واحد (ولا يُنقل أي صف)',
  format($q$update public.students set class_id = %L where class_id = %L$q$, :'cb2', :'cb'), '42501');
select tests.sc_expect('منع: upsert بـ DO UPDATE يغيّر class_id',
  format($q$insert into public.students (id, teacher_id, class_id, full_name) values (%L, %L, %L, 'x')
            on conflict (id) do update set class_id = excluded.class_id$q$, :'sfree', :B, :'cb2'), '42501');
select tests.sc_expect('منع: class_id إلى NULL',
  format($q$update public.students set class_id = null where id = %L$q$, :'sfree'), '42501');

-- ===========================================================================
-- 2) ما يبقى مسموحًا
-- ===========================================================================
select tests.sc_expect('B يعدّل الاسم',
  format($q$update public.students set full_name = 'اسم جديد' where id = %L$q$, :'sfree'), 'ok');
select tests.sc_expect('B يعدّل الملاحظة والوسوم والترتيب والنشاط',
  format($q$update public.students set note = 'ملاحظة', tags = '{a,b}', position = 9, is_active = false where id = %L$q$, :'sfree'), 'ok');
select tests.sc_expect('B يضع تلميذه في فوج قسمه ثم يُخرجه منه',
  format($q$update public.students set group_id = %L where id = %L$q$, :'gb', :'sfree'), 'ok');
select tests.sc_expect('B يُخرج تلميذه من الفوج (group_id = null)',
  format($q$update public.students set group_id = null where id = %L$q$, :'sfree'), 'ok');
select tests.sc_expect('تعيين class_id إلى قيمته نفسها يمرّ (لا تغيير)',
  format($q$update public.students set class_id = class_id, full_name = 'نفس القسم' where id = %L$q$, :'sfree'), 'ok');
select tests.sc_expect('upsert بـ DO UPDATE يغيّر الاسم ويُبقي class_id (ما قد يرسله عميل)',
  format($q$insert into public.students (id, teacher_id, class_id, full_name) values (%L, %L, %L, 'عبر upsert')
            on conflict (id) do update set class_id = excluded.class_id, full_name = excluded.full_name$q$, :'sfree', :B, :'cb'), 'ok');
select tests.sc_expect('B يضيف تلميذًا (إدراج عادي)',
  format($q$insert into public.students (id, teacher_id, class_id, full_name, position) values ('bbbbbbbb-6000-4000-8000-0000000000a1', %L, %L, 'جديد', 5)$q$, :B, :'cb'), 'ok');
select tests.sc_expect('B يحذف تلميذًا (الحذف لا يمنعه المحفّز)',
  $q$delete from public.students where id = 'bbbbbbbb-6000-4000-8000-0000000000a1'$q$, 'ok');
select tests.sc_expect('B يحذف تلميذًا له سجلات وعلامات: تُحذف بالتتالي',
  format($q$delete from public.students where id = %L$q$, :'sb'), 'ok');

-- لا يمسّ تلميذ غيره: 0 صفوف لا خطأ (RLS)
select tests.sc_expect('B لا يعدّل صف تلميذ A (0 صفوف، لا خطأ)',
  format($q$do $d$ begin if tests.sc_rows(format('update public.students set class_id = %%L where id = %%L', %L, %L)) <> 0 then raise exception 'moved'; end if; end $d$$q$, :'cb', :'sa'), 'ok');

-- نقل الأسماء الحالي: قسم جديد وتلاميذ جدد بمعرّفات جديدة، ويُعاد الإرسال بتجاهل التعارض
select tests.sc_expect('نقل الأسماء: إدراج القسم الجديد بتجاهل التعارض',
  format($q$insert into public.classes (id, teacher_id, name, position) values ('bbbbbbbb-7000-4000-8000-000000000001', %L, 'منقول', 8) on conflict (id) do nothing$q$, :B), 'ok');
select tests.sc_expect('نقل الأسماء: إدراج تلاميذ جدد بتجاهل التعارض',
  format($q$insert into public.students (id, teacher_id, class_id, full_name, position) values
     ('bbbbbbbb-7000-4000-8000-0000000000a1', %L, 'bbbbbbbb-7000-4000-8000-000000000001', 'م1', 1),
     ('bbbbbbbb-7000-4000-8000-0000000000a2', %L, 'bbbbbbbb-7000-4000-8000-000000000001', 'م2', 2)
     on conflict (id) do nothing$q$, :B, :B), 'ok');
select tests.sc_expect('نقل الأسماء: إعادة الإرسال بعد ضياع الردّ (استكمال)',
  format($q$insert into public.students (id, teacher_id, class_id, full_name, position) values
     ('bbbbbbbb-7000-4000-8000-0000000000a1', %L, 'bbbbbbbb-7000-4000-8000-000000000001', 'م1', 1),
     ('bbbbbbbb-7000-4000-8000-0000000000a2', %L, 'bbbbbbbb-7000-4000-8000-000000000001', 'م2', 2)
     on conflict (id) do nothing$q$, :B, :B), 'ok');
reset role;

select tests.ok('لم ينتقل التلميذان المجرَّبان: class_id كما كان',
  (select class_id = :'cb'::uuid from public.students where id = :'sfree')
  and (select class_id = :'cold'::uuid from public.students where id = :'sold'));
select tests.ok('بيانات A كما هي', tests.fp(:A) = :'fpa0');
select tests.ok('نقل الأسماء: قسم واحد وتلميذان جديدان بعد تكرار الإرسال',
  (select count(*) from public.classes where id = 'bbbbbbbb-7000-4000-8000-000000000001') = 1
  and (select count(*) from public.students where class_id = 'bbbbbbbb-7000-4000-8000-000000000001') = 2);

-- ===========================================================================
-- 3) anon: لا يصل المحفّز إليه عمليًّا (RLS تخفي الصفوف)، فنثبت أنه يسري عليه بسياسة مؤقتة
-- ===========================================================================
create policy tmp_anon_all on public.students as permissive for all to anon using (true) with check (true);
select set_config('request.jwt.claims', '', false);
set role anon;
select tests.sc_expect('منع: دور anon (بسياسة مؤقتة) لا يغيّر class_id',
  format($q$update public.students set class_id = %L where id = %L$q$, :'cb2', :'sfree'), '42501');
select tests.sc_expect('دور anon (بسياسة مؤقتة) يعدّل الاسم',
  format($q$update public.students set full_name = 'من anon' where id = %L$q$, :'sfree'), 'ok');
reset role;
drop policy tmp_anon_all on public.students;

-- ===========================================================================
-- 4) أدوار الخادم والاستعادة: السلوك كما كان
-- ===========================================================================
select tests.sc_expect('supabase_admin ينقل تلميذًا (صيانة)',
  format($q$update public.students set class_id = %L where id = %L$q$, :'cb2', :'sfree'), 'ok');
set role service_role;
select tests.sc_expect('service_role ينقل تلميذًا (صيانة)',
  format($q$update public.students set class_id = %L where id = %L$q$, :'cb', :'sfree'), 'ok');
reset role;
set role postgres;
select tests.sc_expect('postgres ينقل تلميذًا (صيانة/هجرة)',
  format($q$update public.students set class_id = %L where id = %L$q$, :'cb2', :'sfree'), 'ok');
reset role;
select tests.ok('وانتقل فعلًا', (select class_id = :'cb2'::uuid from public.students where id = :'sfree'));

-- الاستعادة (replica): إدراج بقيمة class_id الأصلية، وحتى قبل وجود القسم
set session_replication_role = replica;
insert into public.students (id, teacher_id, class_id, full_name) values ('bbbbbbbb-8000-4000-8000-0000000000a1', :B, 'bbbbbbbb-8000-4000-8000-000000000001', 'مستعاد قبل قسمه');
insert into public.classes (id, teacher_id, name) values ('bbbbbbbb-8000-4000-8000-000000000001', :B, 'مستعاد');
update public.students set class_id = :'cb' where id = 'bbbbbbbb-8000-4000-8000-0000000000a1';
reset session_replication_role;
select tests.ok('الاستعادة (replica): تُدرج وتُعدَّل class_id بلا اعتراض من المحفّز',
  (select class_id = :'cb'::uuid from public.students where id = 'bbbbbbbb-8000-4000-8000-0000000000a1'));

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
