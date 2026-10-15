-- ملاحظة الأستاذ عن التلميذ: حالة خاصة يتذكّرها، لا تدخل أي حساب
alter table public.students
  add column if not exists note text;

comment on column public.students.note is
  'ملاحظة حرة يكتبها الأستاذ ليتذكّر حالة التلميذ. لا تُستعمل في أي حساب.';
