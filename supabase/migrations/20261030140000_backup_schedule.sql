-- جدولة النسخ الاحتياطي: أسبوعي في الأيام العادية، ويومي في فترات الاختبارات.
--
-- يعتمد على ترحيل المشرف (20261022130000: private.require_admin وprivate.audit_log)
-- وعلى ترحيل الرزنامة (20261030090000: public.term_calendar).
--
-- سير العمل الليلي في taqwim-ops يبقى يعمل كل ليلة، ويسأل في أول خطوة:
--     select run, why from private.backup_decision(<تاريخ آخر نسخة ناجحة>)
-- فإن كان الجواب false خرج بنجاح دون أن ينسخ أو يحذف شيئًا. القرار كله هنا في مكان واحد
-- فيُعدَّل من لوحة المشرف ولا يحتاج تعديل GitHub. القاعدة لا تكتب شيئًا في الإنتاج عند السؤال.
--
-- ترتيب القرار (الأول الذي ينطبق):
--   1. إيقاف يدوي ساري (paused حتى تاريخ)            ← لا نسخ
--   2. نسخة اليوم موجودة أصلًا                        ← لا نسخ
--   3. يومي يدوي ساري (daily حتى تاريخ)               ← نسخ
--   4. داخل نافذة الاختبارات لأي فصل                  ← نسخ
--   5. لا نسخة ناجحة سابقة، أو مرّت 7 أيام فأكثر      ← نسخ
--   6. اليوم الجمعة (ليلة الخميس إلى الجمعة)          ← نسخ
--   7. كُتب أكثر من 50 تنقيطًا منذ آخر نسخة           ← نسخ
--   وإلا                                              ← لا نسخ
--
-- نافذة الاختبارات لفصل: من exams_from إلى ends_on + grace_days. وإن كان exams_from فارغًا
-- فالافتراض 14 يومًا قبل نهاية الفصل. ف3 يحتاج تاريخًا يدويًّا: نهايته المسجّلة افتراض.
--
-- التوقيف واليومي اليدويان مؤقتان دائمًا: تاريخ انتهاء إلزامي (غدًا إلى 30 يومًا) وسبب إلزامي،
-- ثم يعود النظام إلى الجدولة العادية وحده. لا يبقى النسخ موقوفًا لأن أحدًا نسي.
--
-- التنقيط يُحسب من records.updated_at وtp_marks.updated_at وreadings.created_at.
-- تنبيه معروف: التطبيق يكتب updated_at بوقت الإدخال على الهاتف، فتنقيط أُدخل دون شبكة قبل
-- آخر نسخة ووصل بعدها لا يُحسب هنا. يغطّيه النسخ الأسبوعي.

-- ---------------------------------------------------------------------------
-- نافذة الاختبارات في الرزنامة
-- ---------------------------------------------------------------------------
alter table public.term_calendar add column exams_from date;
alter table public.term_calendar add constraint term_calendar_exams_within
  check (exams_from is null or (exams_from >= starts_on and exams_from <= ends_on));
comment on column public.term_calendar.exams_from is
  'بداية فترة الاختبارات (نسخ يومي منها حتى نهاية المهلة). فارغ = 14 يومًا قبل ends_on.';

-- ---------------------------------------------------------------------------
-- التحكم
-- ---------------------------------------------------------------------------
create table private.backup_control (
  id boolean primary key default true check (id), -- صفّ واحد فقط
  mode text not null default 'auto' check (mode in ('auto', 'daily', 'paused')),
  until date,
  reason text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint backup_control_override check (
    mode = 'auto' or (until is not null and reason is not null and length(btrim(reason)) > 0))
);
insert into private.backup_control (mode) values ('auto');
revoke all on private.backup_control from public, anon, authenticated, service_role;

-- الأفعال الجديدة في السجلّ
alter table private.audit_log drop constraint if exists audit_log_action_check;
alter table private.audit_log
  add constraint audit_log_action_check check (action in (
    'disable', 'enable', 'cancel_deletion', 'request_deletion', 'purge',
    'set_term', 'set_backup', 'set_exams'));

-- ---------------------------------------------------------------------------
-- القرار (للمهمّة الليلية: تُستدعى بدور postgres)
-- ---------------------------------------------------------------------------
create function private.backup_decision(
  p_last_success timestamptz,
  p_now timestamptz default now(),
  p_threshold integer default 50
) returns table (run boolean, why text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := (p_now at time zone 'Africa/Algiers')::date;
  last_day date := (p_last_success at time zone 'Africa/Algiers')::date;
  ctl private.backup_control;
  win public.term_calendar;
  marks bigint;
begin
  select * into ctl from private.backup_control where id;

  if ctl.mode = 'paused' and ctl.until >= today then
    return query select false, format('paused until %s: %s', ctl.until, ctl.reason);
    return;
  end if;
  if p_last_success is not null and last_day >= today then
    return query select false, 'already backed up today';
    return;
  end if;
  if ctl.mode = 'daily' and ctl.until >= today then
    return query select true, format('daily override until %s: %s', ctl.until, ctl.reason);
    return;
  end if;

  select c.* into win from public.term_calendar c
  where today between coalesce(c.exams_from, c.ends_on - 14) and c.ends_on + c.grace_days
  order by c.ends_on limit 1;
  if found then
    return query select true, format('exam window: term %s of %s', win.term, win.school_year);
    return;
  end if;

  if p_last_success is null then
    return query select true, 'no previous successful backup';
    return;
  end if;
  if today - last_day >= 7 then
    return query select true, format('last success %s days ago', today - last_day);
    return;
  end if;
  if extract(isodow from today) = 5 then
    return query select true, 'weekly (Friday)';
    return;
  end if;

  select (select count(*) from public.records r where r.updated_at > p_last_success)
       + (select count(*) from public.tp_marks m where m.updated_at > p_last_success)
       + (select count(*) from public.readings g where g.created_at > p_last_success)
    into marks;
  if marks > p_threshold then
    return query select true, format('%s marks written since last backup', marks);
    return;
  end if;

  return query select false, format('not due: %s marks since last backup, next on Friday', marks);
end;
$$;

revoke all on function private.backup_decision(timestamptz, timestamptz, integer)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- لوحة المشرف
-- ---------------------------------------------------------------------------

-- الوضع الحالي كما سيراه القرار اليوم (دون معرفة آخر نسخة، فهي في GitHub).
create function public.admin_backup_status()
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

-- التوقيف واليومي اليدوي: مؤقتان بتاريخ وسبب. 'auto' يلغي أي تجاوز.
create function public.admin_set_backup(
  p_mode text,
  p_until date default null,
  reason text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_admin();
  today date := (now() at time zone 'Africa/Algiers')::date;
  why text := nullif(left(btrim(coalesce(reason, '')), 300), '');
  before_row private.backup_control;
begin
  if p_mode is null or p_mode not in ('auto', 'daily', 'paused') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;
  if p_mode <> 'auto' then
    if p_until is null or p_until < today + 1 or p_until > today + 30 then
      raise exception 'until must be between tomorrow and 30 days ahead' using errcode = '22023';
    end if;
    if why is null then
      raise exception 'reason required' using errcode = '22023';
    end if;
  end if;

  select * into before_row from private.backup_control where id;
  update private.backup_control
     set mode = p_mode,
         until = case when p_mode = 'auto' then null else p_until end,
         reason = case when p_mode = 'auto' then null else why end,
         updated_by = me, updated_at = now()
   where id;

  insert into private.audit_log (actor_kind, actor_id, action, target_id, detail)
  values ('admin', me, 'set_backup', null,
    jsonb_build_object('mode', p_mode, 'until', case when p_mode = 'auto' then null else p_until end,
      'previous', jsonb_build_object('mode', before_row.mode, 'until', before_row.until,
                                     'reason', before_row.reason))
    || case when why is null then '{}'::jsonb else jsonb_build_object('reason', why) end);
end;
$$;

-- بداية فترة الاختبارات لفصل. null يعيدها إلى الافتراض (14 يومًا قبل النهاية).
create function public.admin_set_exams_from(
  p_school_year text,
  p_term integer,
  p_exams_from date,
  reason text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_admin();
  why text := nullif(left(btrim(coalesce(reason, '')), 300), '');
  row_ public.term_calendar;
begin
  if p_school_year is null or p_term is null then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  select * into row_ from public.term_calendar c
  where c.school_year = p_school_year and c.term = p_term;
  if not found then
    raise exception 'term not found' using errcode = '22023';
  end if;
  if p_exams_from is not null and (p_exams_from < row_.starts_on or p_exams_from > row_.ends_on) then
    raise exception 'exams_from outside the term' using errcode = '22023';
  end if;

  update public.term_calendar set exams_from = p_exams_from
   where school_year = p_school_year and term = p_term;

  insert into private.audit_log (actor_kind, actor_id, action, target_id, detail)
  values ('admin', me, 'set_exams', null,
    jsonb_build_object('school_year', p_school_year, 'term', p_term,
      'exams_from', p_exams_from, 'previous', row_.exams_from)
    || case when why is null then '{}'::jsonb else jsonb_build_object('reason', why) end);
end;
$$;

revoke all on function public.admin_backup_status() from public, anon, authenticated, service_role;
revoke all on function public.admin_set_backup(text, date, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_exams_from(text, integer, date, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_backup_status() to authenticated;
grant execute on function public.admin_set_backup(text, date, text) to authenticated;
grant execute on function public.admin_set_exams_from(text, integer, date, text) to authenticated;
