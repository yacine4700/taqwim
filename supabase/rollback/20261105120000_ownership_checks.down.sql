-- تراجع 20261105120000_ownership_checks: يعيد WITH CHECK إلى ما كان في الإنتاج حرفيًّا
-- (teacher_id وحده). لا يمسّ بيانات ولا USING ولا الأدوار. الصفوف التي أُدرجت بعد الترحيل تبقى كما هي.
alter policy own_rows on public.students
  with check (teacher_id = (select auth.uid()));
alter policy own_rows on public.class_groups
  with check (teacher_id = (select auth.uid()));
alter policy own_rows on public.tp_sessions
  with check (teacher_id = (select auth.uid()));
alter policy own_rows on public.records
  with check (teacher_id = (select auth.uid()));
alter policy own_rows on public.readings
  with check (teacher_id = (select auth.uid()));
alter policy own_rows on public.tp_marks
  with check (teacher_id = (select auth.uid()));
