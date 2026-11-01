-- دمج تغيير في صف علامات التلميذ بدل استبدال الصف كله.
--
-- المشكلة: التطبيق كان يرسل صف العلامات كاملًا (upsert). فإن كانت شاشة الهاتف تحمل
-- نسخة أقدم من الخادم (قراءة سبقت حفظًا، أو جهاز ثانٍ عدّل معيارًا آخر) محا الإرسال
-- في الخادم كل ما لم تلمسه يد الأستاذ. الآن يُرسل التغيير وحده ويدمجه الخادم في
-- الصف القائم.
--
-- * إضافة فقط: دالة جديدة، لا جدول ولا عمود ولا منظر يتغيّر. والتطبيق القديم (وطابور
--   قديم على هاتف) يواصل الإرسال بـ upsert دون أي تغيير. والتطبيق الجديد إن لم يجد
--   الدالة (PGRST202) عاد إلى الإرسال القديم.
-- * security invoker: تعمل تحت RLS وتحت محفّز قفل الفصل (trg_guard_term_write) وسياسات
--   التجميد كأي كتابة مباشرة. فالفصل المغلق يُرفض بـ term_closed، والحساب المجمَّد بـ 42501.
-- * p_changes: {"criteria": {"disc": -1, "part": null}, "tp": 12, "devoir": null}
--   حضور المفتاح هو التغيير. criteria[code] = null يحذف المفتاح فيعود المعيار «لم يُقيَّم»
--   لا صفرًا. و tp/devoir/exam بـ null تمسح الخانة. وغياب المفتاح = لم يُمسّ.
-- * المنطق مكتوب مرتين عن قصد، هنا وفي src/lib/outbox.ts (applyChanges)، ويجب أن يبقيا
--   متطابقين: التطبيق يعرض ما سيفعله الخادم قبل أن يصل.

create function public.merge_record(
  p_student_id uuid,
  p_term smallint,
  p_changes jsonb,
  p_at timestamptz default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  c jsonb;
  drop_keys text[];
begin
  if me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;

  c := coalesce(p_changes -> 'criteria', '{}'::jsonb);
  if jsonb_typeof(c) <> 'object' then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;
  -- قيمة المعيار رقم أو null (مسح). غير ذلك لا يُكتب في jsonb العلامات.
  if exists (select 1 from jsonb_each(c) e where e.value <> 'null'::jsonb and jsonb_typeof(e.value) <> 'number') then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;
  -- الخانات: رقم أو null.
  if exists (
    select 1 from unnest(array['tp', 'devoir', 'exam']) f
    where p_changes ? f and jsonb_typeof(p_changes -> f) not in ('number', 'null')
  ) then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;

  -- التلميذ تحت RLS: لا يُكتب لتلميذ حُذف أو لأستاذ آخر. 23503 رفض نهائي في التطبيق.
  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception 'student_not_found' using errcode = '23503';
  end if;

  select coalesce(array_agg(e.key), '{}') into drop_keys
  from jsonb_each(c) e where e.value = 'null'::jsonb;

  insert into public.records as r (teacher_id, student_id, term, criteria, tp, devoir, exam, updated_at)
  values (
    me, p_student_id, p_term,
    jsonb_strip_nulls(c),
    case when p_changes ? 'tp' then (p_changes ->> 'tp')::numeric end,
    case when p_changes ? 'devoir' then (p_changes ->> 'devoir')::numeric end,
    case when p_changes ? 'exam' then (p_changes ->> 'exam')::numeric end,
    coalesce(p_at, now())
  )
  on conflict (student_id, term) do update set
    criteria = (r.criteria || jsonb_strip_nulls(c)) - drop_keys,
    tp = case when p_changes ? 'tp' then (p_changes ->> 'tp')::numeric else r.tp end,
    devoir = case when p_changes ? 'devoir' then (p_changes ->> 'devoir')::numeric else r.devoir end,
    exam = case when p_changes ? 'exam' then (p_changes ->> 'exam')::numeric else r.exam end,
    updated_at = coalesce(p_at, now());
end;
$$;

-- لا تُنفَّذ من anon ولا من PUBLIC: صاحبة الجلسة وحدها.
revoke all on function public.merge_record(uuid, smallint, jsonb, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.merge_record(uuid, smallint, jsonb, timestamptz)
  to authenticated;
