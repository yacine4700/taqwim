-- حالات جاهزة تُختار بنقرة، إلى جانب الملاحظة الحرة في note
alter table public.students
  add column if not exists tags text[] not null default '{}';

comment on column public.students.tags is
  'حالات جاهزة يختارها الأستاذ بنقرة. لا تُستعمل في أي حساب.';
