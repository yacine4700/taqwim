-- المؤسسة صفة القسم لا صفة الأستاذ: كثير من الأساتذة يدرّسون في ثانويتين،
-- فكان اسم المؤسسة الواحد في جدول الأساتذة يطبع ترويسة واحدة لكشوف مؤسستين.

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  name text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.schools is
  'مؤسسات الأستاذ. القسم ينتمي إلى واحدة منها، وترويسة كشفه تأخذ اسمها.';

alter table public.schools enable row level security;

drop policy if exists own_rows on public.schools;
create policy own_rows on public.schools
  for all
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

-- حذف المؤسسة لا يحذف أقسامها: تبقى بلا مؤسسة وتُنسب من جديد.
alter table public.classes
  add column if not exists school_id uuid references public.schools (id) on delete set null;

create index if not exists classes_school_id_idx on public.classes (school_id);

-- ترحيل: اسم المؤسسة المكتوب في بيانات الأستاذ يصير مؤسسةً تُنسب إليها أقسامه
-- كلها. ومن كان يدرّس في ثانويتين ينقل أقسام الثانية إليها من التطبيق — ولا
-- يُخمَّن له ذلك هنا، فالقسم المنسوب خطأً يطبع ترويسة خاطئة.
do $$
declare
  t record;
  new_school uuid;
begin
  for t in
    select id, school_name from public.teachers
    where coalesce(btrim(school_name), '') <> ''
  loop
    if exists (select 1 from public.schools where teacher_id = t.id) then
      continue;
    end if;
    insert into public.schools (teacher_id, name, position)
    values (t.id, btrim(t.school_name), 1)
    returning id into new_school;

    update public.classes
    set school_id = new_school
    where teacher_id = t.id and school_id is null;
  end loop;
end $$;

comment on column public.teachers.school_name is
  'متروك: صار مكان المؤسسة جدول schools، والقسم ينتمي إليها بـclasses.school_id.';
