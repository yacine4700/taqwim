-- حالة النسخ في لوحة المشرف تذكر الآن موعد النسخة القادمة وبداية النسخ اليومي القادمة،
-- فيعرف المشرف هل النسخ يومي اليوم أم لا ومتى يتغيّر. استبدال لدالة 20261030140000 بمفاتيح إضافية:
--   next_weekly: أقرب جمعة بعد اليوم (ليلة النسخ الأسبوعي القادمة)
--   next_exam_from / next_exam_term / next_exam_school_year: أقرب بداية اختبارات بعد اليوم
-- لا تغيّر القرار نفسه (private.backup_decision) ولا الصلاحيات (create or replace يحفظها).
create or replace function public.admin_backup_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ctl private.backup_control;
  today date := (now() at time zone 'Africa/Algiers')::date;
  win public.term_calendar;
  nxt public.term_calendar;
  schedule text;
  dow integer := extract(isodow from today)::integer;
begin
  perform private.require_admin();
  select * into ctl from private.backup_control where id;
  select c.* into win from public.term_calendar c
  where today between coalesce(c.exams_from, c.ends_on - 14) and c.ends_on + c.grace_days
  order by c.ends_on limit 1;
  select c.* into nxt from public.term_calendar c
  where coalesce(c.exams_from, c.ends_on - 14) > today
  order by coalesce(c.exams_from, c.ends_on - 14) limit 1;

  schedule := case
    when ctl.mode = 'paused' and ctl.until >= today then 'paused'
    when ctl.mode = 'daily' and ctl.until >= today then 'daily_override'
    when win.term is not null then 'daily_exams'
    else 'weekly' end;

  return jsonb_build_object(
    'schedule', schedule,
    'mode', ctl.mode, 'until', ctl.until, 'reason', ctl.reason, 'updated_at', ctl.updated_at,
    'override_expired', ctl.mode <> 'auto' and ctl.until < today,
    'exam_term', win.term, 'exam_school_year', win.school_year,
    'exam_window_ends', case when win.term is null then null else win.ends_on + win.grace_days end,
    'next_weekly', today + case when dow = 5 then 7 else (5 - dow + 7) % 7 end,
    'next_exam_from', case when nxt.term is null then null else coalesce(nxt.exams_from, nxt.ends_on - 14) end,
    'next_exam_term', nxt.term, 'next_exam_school_year', nxt.school_year);
end;
$$;
