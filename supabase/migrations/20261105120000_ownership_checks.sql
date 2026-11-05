-- ملكية العلاقات: لا يربط أستاذٌ صفًّا يملكه بقسم أو تلميذ أو حصة يملكها غيره.
-- (مسوّدة للمراجعة: غير مطبَّقة في أي قاعدة.)
--
-- المشكلة: سياسة own_rows على الجداول الستة تفحص teacher_id وحده. وفحص المفتاح الأجنبي يتجاوز RLS،
-- فيقبل أي معرّف قسم أو تلميذ أو حصة موجود عند أي أستاذ. فمن عرف معرّف قسم أستاذ آخر أدرج
-- تلميذًا (teacher_id = هو) في ذلك القسم، أو زرع سجلًّا في (student_id, term) لتلميذ غيره فتعطّل
-- إدخال صاحبه (قيد فريد لا يراه صاحبه ولا يستطيع حذفه). لا قراءة ولا تعديل لبيانات الغير في أي حال:
-- السياسات كلها على teacher_id.
--
-- العلاج: WITH CHECK يشترط وجود الأب ببيّنة ملكيته. ALTER POLICY لا DROP/CREATE، فتبقى الأدوار
-- (to public / to authenticated) وشرط USING كما هما حرفيًّا.
--
-- * USING لم يُمسّ عن قصد. ذلك الشرط يحكم القراءة والحذف ورؤية الصف قبل تعديله، فلا يُربط بوجود
--   الأب: القراءة لا تتوقف على جدول آخر، ولا تتسلسل السياسات (students ← classes، وtp_marks ←
--   tp_sessions وstudents ← classes). وWITH CHECK هو ما يُقيَّم على الصف الجديد في INSERT وفي UPDATE
--   (وفي مسار DO UPDATE من upsert)، فتغيير class_id أو student_id أو session_id بتعديل يمرّ بنفس الفحص.
-- * الفحص صريح (c.teacher_id = auth.uid()) ولا يعتمد على RLS جدول الأب، فلا يتغيّر معناه لو
--   أُضيفت لاحقًا سياسة قراءة على classes.
-- * tp_marks: الحصة والتلميذ لأستاذ واحد، والتلميذ من قسم الحصة نفسه (الربط بـ class_id). لا يكفي
--   أن يكون كلٌّ منهما ملكَه على حدة.
-- * الحذف المتتالي وon delete set null (group_id) تنفّذه المفاتيح الأجنبية بصلاحية مالك الجدول، فلا تمرّ
--   بسياسات الصفوف ولا تتأثر. والسياسات التقييدية guard_* (التجميد والحذف المجدول) لم تُمسّ.
-- * الاستعادة لا تتأثر: data.sql يُنفَّذ بدور postgres (BYPASSRLS) والسياسات لا تُقيَّم عليه.
--
-- فحص مسبق: يرفض الترحيل (بلا أي تغيير) إن وُجد في القاعدة صف يخالف القاعدة الجديدة، فيُنظر فيه
-- يدويًّا بدل أن يتعطّل تعديله لاحقًا. يُنفَّذ بدور postgres (BYPASSRLS) فيرى كل الصفوف.

do $$
declare
  n_students integer;
  n_groups integer;
  n_sessions integer;
  n_records integer;
  n_readings integer;
  n_marks integer;
begin
  select count(*) into n_students from public.students s
    join public.classes c on c.id = s.class_id where c.teacher_id <> s.teacher_id;
  select count(*) into n_groups from public.class_groups g
    join public.classes c on c.id = g.class_id where c.teacher_id <> g.teacher_id;
  select count(*) into n_sessions from public.tp_sessions t
    join public.classes c on c.id = t.class_id where c.teacher_id <> t.teacher_id;
  select count(*) into n_records from public.records r
    join public.students s on s.id = r.student_id where s.teacher_id <> r.teacher_id;
  select count(*) into n_readings from public.readings g
    join public.students s on s.id = g.student_id where s.teacher_id <> g.teacher_id;
  select count(*) into n_marks from public.tp_marks m
    join public.tp_sessions t on t.id = m.session_id
    join public.students s on s.id = m.student_id
    where t.teacher_id <> m.teacher_id or s.teacher_id <> m.teacher_id or s.class_id <> t.class_id;

  if n_students + n_groups + n_sessions + n_records + n_readings + n_marks > 0 then
    raise exception 'ownership precheck failed: students=% class_groups=% tp_sessions=% records=% readings=% tp_marks=%',
      n_students, n_groups, n_sessions, n_records, n_readings, n_marks
      using hint = 'صفوف تربط بأب لا يملكه صاحبها (أو علامة تجمع تلميذًا وحصة من قسمين). افحصها وقرّر أمرها قبل الترحيل.';
  end if;
end $$;

alter policy own_rows on public.students
  with check (
    teacher_id = (select auth.uid())
    and exists (
      select 1 from public.classes c
      where c.id = students.class_id and c.teacher_id = (select auth.uid())
    )
  );

alter policy own_rows on public.class_groups
  with check (
    teacher_id = (select auth.uid())
    and exists (
      select 1 from public.classes c
      where c.id = class_groups.class_id and c.teacher_id = (select auth.uid())
    )
  );

alter policy own_rows on public.tp_sessions
  with check (
    teacher_id = (select auth.uid())
    and exists (
      select 1 from public.classes c
      where c.id = tp_sessions.class_id and c.teacher_id = (select auth.uid())
    )
  );

alter policy own_rows on public.records
  with check (
    teacher_id = (select auth.uid())
    and exists (
      select 1 from public.students s
      where s.id = records.student_id and s.teacher_id = (select auth.uid())
    )
  );

alter policy own_rows on public.readings
  with check (
    teacher_id = (select auth.uid())
    and exists (
      select 1 from public.students s
      where s.id = readings.student_id and s.teacher_id = (select auth.uid())
    )
  );

alter policy own_rows on public.tp_marks
  with check (
    teacher_id = (select auth.uid())
    and exists (
      select 1
      from public.tp_sessions t
      join public.students s on s.class_id = t.class_id
      where t.id = tp_marks.session_id
        and s.id = tp_marks.student_id
        and t.teacher_id = (select auth.uid())
        and s.teacher_id = (select auth.uid())
    )
  );
