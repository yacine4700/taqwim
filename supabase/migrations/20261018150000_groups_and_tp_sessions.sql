-- الأفواج وحصص الأعمال التطبيقية.
--
-- القسم يُقسَّم إلى أفواج ثابتة طوال السنة (التسمية اختيارية)، وكل فوج يُنقَّط
-- في حصص. معدّل حصص التلميذ في الفصل يُحسب ولا يُخزَّن، ثم يغذّي الخانة التي
-- يختارها الأستاذ لكل قسم: مركّبة الأعمال التطبيقية مباشرة، أو معيارًا من
-- التقويم المستمر إن كان لا يملك مركّبة أعمال تطبيقية.
--
-- الهجرة إضافية بالكامل: لا تغيّر صفًّا ولا عمودًا قائمًا. وقسمٌ لم يُضبط له
-- tp_target (الوضع الابتدائي لكل الأقسام الحالية) يحسب كما كان حرفيًا.

/* ---------- الأفواج ---------- */

create table if not exists public.class_groups (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  -- اختياري: الفارغ يُعرض «فوج 1» بحسب ترتيبه
  name text,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint class_groups_name_not_blank check (name is null or btrim(name) <> ''),
  -- لازم ليشير التلميذ إلى فوج من قسمه هو (المفتاح المركّب أدناه)
  constraint class_groups_id_class_key unique (id, class_id)
);

comment on table public.class_groups is
  'أفواج القسم. ثابتة طوال السنة، واسمها اختياري. تنظّم تنقيط الأعمال التطبيقية ولا تدخل في الحساب بذاتها.';

create index if not exists class_groups_class_idx on public.class_groups (class_id);

alter table public.class_groups enable row level security;

drop policy if exists own_rows on public.class_groups;
create policy own_rows on public.class_groups
  for all
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

/* التلميذ في فوج واحد على الأكثر، من قسمه هو. حذف الفوج يُخرج تلاميذه منه
   (group_id وحده يُفرَّغ، لا class_id) ولا يحذف تلميذًا ولا علامة. */
alter table public.students add column if not exists group_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'students_group_fkey'
  ) then
    alter table public.students
      add constraint students_group_fkey
      foreign key (group_id, class_id)
      references public.class_groups (id, class_id)
      on delete set null (group_id);
  end if;
end $$;

create index if not exists students_group_idx on public.students (group_id);

comment on column public.students.group_id is
  'فوج التلميذ في قسمه، أو NULL إن لم يُوزَّع. لا يدخل في أي حساب.';

/* ---------- حصص الأعمال التطبيقية ---------- */

-- الفوج في الحصة للتنظيم لا للحساب: العلامات مفتاحها التلميذ. فحذف الفوج
-- يُبقي حصصه وعلاماتها (group_id يُفرَّغ) ولا يضيع شيء.
create table if not exists public.tp_sessions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  group_id uuid,
  term smallint not null check (term between 1 and 3),
  held_on date not null default current_date,
  title text,
  created_at timestamptz not null default now(),
  constraint tp_sessions_title_not_blank check (title is null or btrim(title) <> ''),
  constraint tp_sessions_group_fkey
    foreign key (group_id, class_id)
    references public.class_groups (id, class_id)
    on delete set null (group_id)
);

comment on table public.tp_sessions is
  'حصص الأعمال التطبيقية. تُنقَّط لكل تلميذ في tp_marks، ومعدّل الفصل يغذّي الهدف الذي اختاره الأستاذ لقسمه.';

create index if not exists tp_sessions_class_term_idx on public.tp_sessions (class_id, term);

alter table public.tp_sessions enable row level security;

drop policy if exists own_rows on public.tp_sessions;
create policy own_rows on public.tp_sessions
  for all
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

-- الصف يوجد فقط لتلميذ نُقِّط أو عُلِّم غائبًا. «غير مقيَّم» = لا صف، فلا
-- يدخل المعدّل ولا يُحسب صفرًا. ومسح العلامة يحذف الصف.
create table if not exists public.tp_marks (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  session_id uuid not null references public.tp_sessions (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  score numeric(4,2) check (score is null or (score >= 0 and score <= 20)),
  absent boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint tp_marks_session_student_key unique (session_id, student_id),
  -- الغائب لا علامة له: لا يُحسب صفرًا ولا يدخل المعدّل
  constraint tp_marks_absent_has_no_score check (not absent or score is null)
);

comment on table public.tp_marks is
  'علامة التلميذ في حصة أعمال تطبيقية من 20. score فارغة مع absent = true تعني غائبًا.';

create index if not exists tp_marks_student_idx on public.tp_marks (student_id);

alter table public.tp_marks enable row level security;

drop policy if exists own_rows on public.tp_marks;
create policy own_rows on public.tp_marks
  for all
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

/* ---------- الهدف: أين تذهب النقطة ---------- */

-- NULL (الابتدائي): لا ربط، فلا يتغيّر شيء في حساب القسم.
-- 'component': يغذّي مركّبة الأعمال التطبيقية (records.tp).
-- 'criterion:<code>': يغذّي معيارًا من نوع إضافة (base = 0) في التقويم المستمر.
alter table public.classes add column if not exists tp_target text;

alter table public.classes drop constraint if exists classes_tp_target_check;
alter table public.classes
  add constraint classes_tp_target_check
  check (tp_target is null or tp_target = 'component' or tp_target like 'criterion:%');

comment on column public.classes.tp_target is
  'وجهة معدّل حصص الأعمال التطبيقية: NULL لا ربط، component مركّبة الأعمال التطبيقية، criterion:<code> معيار إضافة.';

/* ---------- المناظر: النسخة الثانية من الحساب ---------- */

-- معدّل التلميذ على حصصه المنقَّطة في الفصل. غير المقيَّم والغائب خارجان
-- (score IS NULL)، فلا تُحسب الحصة التي لم تُنقَّط صفرًا. بلا تقريب هنا: التقريب
-- في آخر كل منظر كما في v_continuous، فلا يتراكم تقريبان.
create or replace view public.v_tp_avg
with (security_invoker = true) as
select m.student_id,
       s.term,
       count(*)::integer as attempts,
       avg(m.score) as value
from public.tp_marks m
join public.tp_sessions s on s.id = m.session_id
where m.score is not null
group by m.student_id, s.term;

-- كما كان حرفيًا، مع فرع واحد جديد: إن كان هدف قسم التلميذ هذا المعيار (معيار
-- إضافة) ولتلميذه معدّل حصص، فقيمته معدّل الحصص محوَّلًا إلى سقف المعيار.
-- وإلا بقيت القيمة اليدوية. وهذا ما يفعله applyTpTarget في src/lib/scoring.ts.
create or replace view public.v_continuous
with (security_invoker = true) as
with per_crit as (
  select s.id as student_id,
         t.term,
         c.code,
         c.kind,
         c.base,
         c.ceiling,
         case
           when c.kind = 'auto'::criterion_kind then ra.value
           when c.kind = 'add'::criterion_kind
                and c.base = 0
                and cl.tp_target = 'criterion:' || c.code
                and ta.value is not null
             then ta.value / 20 * c.ceiling
           else (r.criteria ->> c.code)::numeric
         end as val
  from public.students s
  cross join (values (1), (2), (3)) t(term)
  join public.classes cl on cl.id = s.class_id
  join public.criteria c on c.teacher_id = s.teacher_id
  left join public.records r on r.student_id = s.id and r.term = t.term
  left join public.v_reading_avg ra on ra.student_id = s.id and ra.term = t.term
  left join public.v_tp_avg ta on ta.student_id = s.id and ta.term = t.term
)
select student_id,
       term,
       round(
         sum(greatest(0::numeric, least(ceiling, base + coalesce(val, 0::numeric))))
           filter (where base > 0::numeric or val is not null)
         / nullif(sum(ceiling) filter (where base > 0::numeric or val is not null), 0::numeric)
         * 20::numeric
       , 2) as continuous
from per_crit
group by student_id, term
having count(*) filter (where val is not null) > 0;

-- كما كان حرفيًا، والفرق أن tp المعروض هو معدّل الحصص حين يكون هدف القسم
-- 'component' ولتلميذه معدّل، وإلا فالقيمة اليدوية.
create or replace view public.v_term_average
with (security_invoker = true) as
with vals as (
  select s.id as student_id, s.class_id, s.teacher_id, t.term,
         cc.continuous as cc,
         case
           when cl.tp_target = 'component' and ta.value is not null then ta.value
           else r.tp
         end as tp,
         r.devoir, r.exam
  from public.students s
  cross join (values (1),(2),(3)) t(term)
  join public.classes cl on cl.id = s.class_id
  left join public.records r on r.student_id = s.id and r.term = t.term
  left join public.v_continuous cc on cc.student_id = s.id and cc.term = t.term
  left join public.v_tp_avg ta on ta.student_id = s.id and ta.term = t.term
),
flat as (
  select v.*, x.code, x.value
  from vals v
  cross join lateral (values
    ('cc', v.cc), ('tp', v.tp), ('devoir', v.devoir), ('exam', v.exam)
  ) as x(code, value)
)
select f.student_id, f.class_id, f.teacher_id, f.term,
       max(f.cc)                      as cc,
       max(f.tp)::numeric(5,2)        as tp,
       max(f.devoir)::numeric(5,2)    as devoir,
       max(f.exam)::numeric(5,2)      as exam,
       round(
         sum(f.value * c.weight) filter (where f.value is not null and c.weight is not null)
         / nullif(sum(c.weight) filter (where f.value is not null and c.weight is not null), 0)
       , 2) as average
from flat f
left join public.components c
       on c.teacher_id = f.teacher_id
      and c.code = f.code
      and c.active
group by f.student_id, f.class_id, f.teacher_id, f.term;
