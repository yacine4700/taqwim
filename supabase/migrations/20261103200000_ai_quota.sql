-- حدّ يومي لقراءة الصور والأوراق بـ Gemini.
--
-- المشكلة: /api/roster يقبل أي أستاذ داخل بجلسته، ولا شيء يمنع حسابًا واحدًا من
-- إرسال آلاف الطلبات بحلقة. والواجهة مفوترة، فالاستنزاف مال لا حصّة مجانية فقط.
--
-- * الحدّ عدّاد في القاعدة لا في ذاكرة الخادم: Vercel يشغّل نسخًا كثيرة تُنسى بعد
--   كل طلب، فالعدّاد في الذاكرة لا يحدّ شيئًا.
-- * لكل أستاذ 20 طلبًا في اليوم، وللتطبيق كله 200. اليوم بتوقيت الجزائر.
--   الطلب الواحد صفحتان من صورة أو حتى 12 ورقة، فاستيراد خمسة أقسام بعد محاولات
--   فاشلة لا يقترب من 20. والحدّ العام يحمي الفاتورة إن فُتحت حسابات كثيرة لاستنزافها.
-- * يُحتسب الطلب قبل إرسال Gemini لا بعد نجاحه: الفشل عند Gemini لا يُعيد المحاولة
--   مجانًا لمن يريد الاستنزاف، والحدّ واسع بما يكفي لمحاولات الأستاذ الحقيقية.
-- * security definer: الجدول في private ولا يُمنح لأحد. والدالة لا تعدّ إلا للأستاذ
--   الداخل (auth.uid())، فلا يستطيع أحد أن يستهلك حدّ غيره.
-- * إضافة فقط: جدول ودالة. وإن غابت الدالة (PGRST202) يقرأ الخادم بلا حدّ كما كان.
--   المنطق الذي يفسّر الجواب في src/lib/aiQuota.ts.

create table private.ai_usage (
  teacher_id uuid not null references auth.users (id) on delete cascade,
  day        date not null,
  calls      integer not null default 0 check (calls >= 0),
  primary key (teacher_id, day)
);
alter table private.ai_usage enable row level security;
revoke all on private.ai_usage from public, anon, authenticated;

create index ai_usage_day on private.ai_usage (day);

comment on table private.ai_usage is
  'عدد طلبات القراءة بـ Gemini لكل أستاذ في كل يوم (بتوقيت الجزائر). يكتبه public.consume_ai_quota وحده. يُمحى ما مضى عليه أكثر من 30 يومًا.';

-- الجواب: {"ok": true, "remaining": n} أو {"ok": false, "scope": "teacher"|"global", "limit": n}
create function public.consume_ai_quota(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  per_teacher constant integer := 20;
  per_day     constant integer := 200;
  today date := (now() at time zone 'Africa/Algiers')::date;
  used_all integer;
  used integer;
begin
  if me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('images', 'sheets') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  -- قفل للمعاملة: طلبان متزامنان لا يعبران الحدّ العام معًا.
  perform pg_advisory_xact_lock(hashtext('public.consume_ai_quota'));

  delete from private.ai_usage where day < today - 30;

  select coalesce(sum(calls), 0) into used_all from private.ai_usage where day = today;
  if used_all >= per_day then
    return jsonb_build_object('ok', false, 'scope', 'global', 'limit', per_day);
  end if;

  insert into private.ai_usage as u (teacher_id, day, calls)
  values (me, today, 1)
  on conflict (teacher_id, day) do update
    set calls = u.calls + 1
    where u.calls < per_teacher
  returning u.calls into used;

  if used is null then
    return jsonb_build_object('ok', false, 'scope', 'teacher', 'limit', per_teacher);
  end if;
  return jsonb_build_object('ok', true, 'remaining', per_teacher - used);
end
$$;

revoke all on function public.consume_ai_quota(text) from public, anon;
grant execute on function public.consume_ai_quota(text) to authenticated;
