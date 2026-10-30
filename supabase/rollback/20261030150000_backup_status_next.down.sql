-- التراجع عن 20261030150000: تعود admin_backup_status إلى تعريف 20261030140000 (بلا موعد القادمة).
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
  schedule text;
begin
  perform private.require_admin();
  select * into ctl from private.backup_control where id;
  select c.* into win from public.term_calendar c
  where today between coalesce(c.exams_from, c.ends_on - 14) and c.ends_on + c.grace_days
  order by c.ends_on limit 1;

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
    'exam_window_ends', case when win.term is null then null else win.ends_on + win.grace_days end);
end;
$$;
