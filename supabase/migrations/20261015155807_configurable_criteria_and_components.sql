-- المركّبة يمكن أن تكون حاضرة أو غائبة عن معدل المادة دون حذف تسميتها ومعاملها
alter table public.components
  add column if not exists active boolean not null default true;

-- منظر معدل المادة: كان يقرأ المعاملات بأربعة أكواد ثابتة، فإن غابت مركّبة
-- صار معاملها NULL وأفسد المعدل كله. الآن يُحسب من جدول المركّبات نفسه:
-- المركّبة المطفأة أو المحذوفة تخرج من البسط والمقام، والمركّبة غير المنقَّطة كذلك.
create or replace view public.v_term_average
with (security_invoker = true) as
with vals as (
  select s.id as student_id, s.class_id, s.teacher_id, t.term,
         cc.continuous as cc, r.tp, r.devoir, r.exam
  from public.students s
  cross join (values (1),(2),(3)) t(term)
  left join public.records r on r.student_id = s.id and r.term = t.term
  left join public.v_continuous cc on cc.student_id = s.id and cc.term = t.term
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
