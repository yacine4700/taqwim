-- محاولات «السحب في الحصة» صارت تنتمي إلى معيار بعينه.
--
-- قبل هذا كانت المحاولة تُسجَّل باسم التلميذ والفصل وحدهما، وكان v_reading_avg يجمع
-- كل محاولات التلميذ في الفصل. فمعيار ثانٍ من النوع auto كان يأخذ المتوسط نفسه
-- ويُحسب التلميذ مرتين. الآن لكل معيار auto متوسط محاولاته وحدها.
--
-- * criterion_code نصّ لا مفتاح أجنبي، عن قصد: السجلّ الحالي (records.criteria) يخزّن
--   قيم المعايير بمفتاح الكود أيضًا، وحذف معيار يُخرج علاماته من الحساب ولا يمحوها
--   (قاعدة «العلامة لا تضيع»). فحذف المعيار لا يحذف محاولاته.
-- * القيمة الافتراضية 'read' هي كود معيار القراءة الذي يُنشئه seed_teacher لكل أستاذ.
--   فكل المحاولات الموجودة تتبع معيار القراءة دون نقل بيانات، وتبقى نسخة التطبيق القديمة
--   (وعمليات الطابور القديمة على الهواتف) صالحة: إدراج بلا criterion_code يأخذ 'read'.
-- * أضيف العمود بقيمة ثابتة، فلا تُعاد كتابة الجدول.
-- * المنطق مكتوب مرتين عن قصد، هنا وفي src/lib/scoring.ts (criterionValue)،
--   ويجب أن يبقيا متطابقين.

alter table public.readings
  add column criterion_code text not null default 'read';

create index readings_student_term_criterion_idx
  on public.readings (student_id, term, criterion_code);

-- العمود الجديد في آخر الأعمدة: create or replace لا يقبل غير ذلك. الصفوف صارت
-- صفًّا لكل (تلميذ، فصل، معيار)، فلا بدّ أن يُغيَّر v_continuous في المعاملة نفسها.
create or replace view public.v_reading_avg
with (security_invoker = true) as
select student_id,
       term,
       count(*)::integer as attempts,
       round(avg(score), 2) as value,
       criterion_code
from public.readings
group by student_id, term, criterion_code;

-- كما كان حرفيًا، والفرق الوحيد شرط الربط بالكود: معيار auto يرى محاولات كوده فقط.
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
  left join public.v_reading_avg ra
         on ra.student_id = s.id and ra.term = t.term and ra.criterion_code = c.code
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
