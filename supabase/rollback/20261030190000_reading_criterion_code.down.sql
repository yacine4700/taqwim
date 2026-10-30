-- التراجع عن 20261030190000: تعود المحاولات تجمَّع لكل تلميذ وفصل دون معيار.
--
-- يرفض إن وُجدت محاولات لمعيار غير 'read'، فبعد التراجع تلتحق بمتوسط القراءة ويتغيّر
-- تقويم من قُرئ لهم. أكّد بـ: PGOPTIONS="-c taqwim.rollback_confirm=yes"
do $$
declare n integer;
begin
  select count(*) into n from public.readings where criterion_code <> 'read';
  if n > 0 and coalesce(current_setting('taqwim.rollback_confirm', true), '') <> 'yes' then
    raise exception 'rollback blocked: % reading(s) belong to a criterion other than read', n;
  end if;
end $$;

-- v_continuous يعتمد على v_reading_avg ولا يمكن حذف عمود من منظر قائم عليه غيره:
-- يُفكّ الربط أولًا بتجميع داخلي يطابق الشكل القديم، ثم يُعاد المنظر القديم.
create or replace view public.v_continuous
with (security_invoker = true) as
with per_crit as (
  select s.id as student_id, t.term, c.code, c.kind, c.base, c.ceiling,
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
  left join (
    select student_id, term, round(avg(score), 2) as value
    from public.readings group by student_id, term
  ) ra on ra.student_id = s.id and ra.term = t.term
  left join public.v_tp_avg ta on ta.student_id = s.id and ta.term = t.term
)
select student_id, term,
       round(
         sum(greatest(0::numeric, least(ceiling, base + coalesce(val, 0::numeric))))
           filter (where base > 0::numeric or val is not null)
         / nullif(sum(ceiling) filter (where base > 0::numeric or val is not null), 0::numeric)
         * 20::numeric
       , 2) as continuous
from per_crit
group by student_id, term
having count(*) filter (where val is not null) > 0;

drop view public.v_reading_avg;
create view public.v_reading_avg
with (security_invoker = true) as
select student_id,
       term,
       count(*)::integer as attempts,
       round(avg(score), 2) as value
from public.readings
group by student_id, term;
grant all on public.v_reading_avg to anon, authenticated, service_role;

create or replace view public.v_continuous
with (security_invoker = true) as
with per_crit as (
  select s.id as student_id, t.term, c.code, c.kind, c.base, c.ceiling,
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
select student_id, term,
       round(
         sum(greatest(0::numeric, least(ceiling, base + coalesce(val, 0::numeric))))
           filter (where base > 0::numeric or val is not null)
         / nullif(sum(ceiling) filter (where base > 0::numeric or val is not null), 0::numeric)
         * 20::numeric
       , 2) as continuous
from per_crit
group by student_id, term
having count(*) filter (where val is not null) > 0;

drop index if exists public.readings_student_term_criterion_idx;
alter table public.readings drop column criterion_code;
