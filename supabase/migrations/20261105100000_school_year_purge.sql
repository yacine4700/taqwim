-- السنة الدراسية: قفل التنقيط في أقسام السنوات المنتهية، والحذف السنوي المحمي.
-- (غير مطبَّق في الإنتاج: تطبيقه قرار منفصل بعد SELECT يثبت تواريخ الأقسام.)
--
-- القواعد المعتمدة:
--   * سنة القسم تُحسب من created_at الذي يكتبه الخادم (لا من نصّ school_year)، وبداية السنة
--     الدراسية 1 أغسطس بتوقيت الجزائر.
--   * من 1 أغسطس يُمنع إدخال التنقيط وتعديله في أقسام السنة المنتهية: records وreadings
--     وtp_sessions وtp_marks. لا يُمنع إضافة التلاميذ ولا القراءة ولا التصدير ولا الحذف.
--   * القفل يسري على كل الأدوار بلا استثناء بالهوية: لا auth.uid() ولا auth.role() ولا
--     pg_trigger_depth(). فهو لا يعتمد على RLS ولا على مفتاح الطلب. استثناء واحد: تحديث على
--     tp_sessions لا يغيّر شيئًا غير تفريغ group_id، وهو ما يفعله المفتاح الأجنبي
--     (on delete set null) عند حذف فوج أو قسم. والاستعادة لا تمرّ بهذا المحفّز: data.sql
--     يبدأ بـ session_replication_role = replica (مسار الاستعادة المصمَّم والمختبَر).
--   * الحذف: من 7 نوفمبر من السنة التالية لسنة القسم، حتى 100 قسم في التشغيل، ولا يمسّ قسمًا
--     أُنشئ في السنة الجارية. يكتب سطرًا إحصائيًّا في كل تشغيل (أعداد فقط، لا أسماء).
--   * حماية الاستعادة: الدالة تأخذ «خط الأساس» = رقم آخر سطر year_purge سجّلته المهمة الليلية
--     (يُحفظ خارج القاعدة في إصدار GitHub باسم purge-baseline). إن لم يوجد ذلك السطر في
--     السجل، أو كان تسلسل السجل أقل منه، فقد رجعت القاعدة إلى الوراء: لا حذف.
--
-- الحالات التي تعيدها دالة الحذف: baseline | regression | ok | already_ran.

-- ---------------------------------------------------------------------------
-- 1) السنة الدراسية
-- ---------------------------------------------------------------------------

-- سنة البداية للعام الدراسي الذي يقع فيه اليوم: 1 أغسطس 2026 .. 31 يوليو 2027 = 2026
create function private.school_year_of(p_day date)
returns integer
language sql
immutable
as $$
  select extract(year from p_day)::integer - case when extract(month from p_day) < 8 then 1 else 0 end
$$;

-- هل سنة القسم (من created_at) انتهت قبل السنة الجارية؟ قسم غير موجود = false.
create function private.class_year_closed(p_class uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.school_year_of((c.created_at at time zone 'Africa/Algiers')::date)
          < private.school_year_of((now() at time zone 'Africa/Algiers')::date)
     from public.classes c where c.id = p_class),
    false)
$$;
revoke all on function private.school_year_of(date) from public, anon, authenticated;
revoke all on function private.class_year_closed(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) القفل
-- ---------------------------------------------------------------------------
create function private.guard_year_write() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_new uuid;
  c_old uuid;
begin
  -- الاستثناء الوحيد: تفريغ group_id وحده (مفتاح أجنبي on delete set null)
  -- (متداخلة عن قصد: plpgsql لا يضمن قصر الدائرة، و new.group_id غير موجود في بقية الجداول)
  if tg_table_name = 'tp_sessions' and tg_op = 'UPDATE' then
    if (to_jsonb(new) ->> 'group_id') is null
       and (to_jsonb(new) - 'group_id') = (to_jsonb(old) - 'group_id') then
      return new;
    end if;
  end if;

  if tg_table_name = 'tp_sessions' then
    c_new := new.class_id;
    if tg_op = 'UPDATE' then c_old := old.class_id; end if;
  elsif tg_table_name = 'tp_marks' then
    select s.class_id into c_new from public.tp_sessions s where s.id = new.session_id;
    if tg_op = 'UPDATE' then
      select s.class_id into c_old from public.tp_sessions s where s.id = old.session_id;
    end if;
  else -- records وreadings: القسم من التلميذ
    select st.class_id into c_new from public.students st where st.id = new.student_id;
    if tg_op = 'UPDATE' then
      select st.class_id into c_old from public.students st where st.id = old.student_id;
    end if;
  end if;

  if c_new is not null and private.class_year_closed(c_new) then
    raise exception 'class_year_closed' using errcode = '23514';
  end if;
  if c_old is not null and c_old is distinct from c_new and private.class_year_closed(c_old) then
    raise exception 'class_year_closed' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_year_write() from public, anon, authenticated;

create trigger trg_guard_year_write before insert or update on public.records
  for each row execute function private.guard_year_write();
create trigger trg_guard_year_write before insert or update on public.readings
  for each row execute function private.guard_year_write();
create trigger trg_guard_year_write before insert or update on public.tp_sessions
  for each row execute function private.guard_year_write();
create trigger trg_guard_year_write before insert or update on public.tp_marks
  for each row execute function private.guard_year_write();

-- ---------------------------------------------------------------------------
-- 3) السجلّ: فعل جديد
-- ---------------------------------------------------------------------------
alter table private.audit_log drop constraint if exists audit_log_action_check;
alter table private.audit_log
  add constraint audit_log_action_check check (action in (
    'disable', 'enable', 'cancel_deletion', 'request_deletion', 'purge',
    'set_term', 'set_backup', 'set_exams', 'admin_purge', 'purge_unconfirmed',
    'trim_audit', 'year_purge'));

-- ---------------------------------------------------------------------------
-- 4) الحذف السنوي: طبقتان
-- ---------------------------------------------------------------------------

-- الطبقة الداخلية (للمالك وحده): التاريخ يُمرَّر لتُختبر الحدود دون انتظار الأيام.
-- الردّ: year-purge|status|line_id|classes|students|marks
create function private.purge_old_school_years_at(p_on date, p_floor bigint, p_max integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  seq_now bigint;
  ids uuid[];
  n_cls integer := 0;
  n_stu integer := 0;
  n_mrk integer := 0;
  line bigint;
  st text;
begin
  if p_max is null or p_max < 1 or p_max > 100 then
    raise exception 'p_max must be between 1 and 100';
  end if;

  -- تشغيلان متزامنان يتسلسلان
  perform pg_advisory_xact_lock(hashtextextended('taqwim:year_purge', 0));

  -- مرّ تشغيل ناجح اليوم؟
  select l.id into line from private.audit_log l
  where l.action = 'year_purge'
    and l.detail ->> 'on_date' = p_on::text
    and l.detail ->> 'status' in ('baseline', 'ok')
  order by l.id desc limit 1;
  if found then
    return format('year-purge|already_ran|%s|0|0|0', line);
  end if;

  if p_floor is null then
    st := 'baseline';
  else
    seq_now := pg_sequence_last_value(pg_get_serial_sequence('private.audit_log', 'id')::regclass);
    if seq_now is null or seq_now < p_floor
       or not exists (select 1 from private.audit_log l where l.id = p_floor and l.action = 'year_purge') then
      return 'year-purge|regression|0|0|0|0';
    end if;
    st := 'ok';
  end if;

  if st = 'ok' then
    select coalesce(array_agg(x.id), '{}') into ids from (
      select c.id from public.classes c
      where p_on >= make_date(
              private.school_year_of((c.created_at at time zone 'Africa/Algiers')::date) + 1, 11, 7)
      order by c.created_at, c.id
      limit p_max) x;

    if cardinality(ids) > 0 then
      select count(*) into n_stu from public.students s where s.class_id = any (ids);
      select (select count(*) from public.records r join public.students s on s.id = r.student_id where s.class_id = any (ids))
           + (select count(*) from public.readings g join public.students s on s.id = g.student_id where s.class_id = any (ids))
           + (select count(*) from public.tp_marks m join public.tp_sessions t on t.id = m.session_id where t.class_id = any (ids))
        into n_mrk;
      n_cls := cardinality(ids);
      delete from public.classes where id = any (ids);
    end if;
  end if;

  insert into private.audit_log (actor_kind, action, detail)
  values ('system', 'year_purge', jsonb_build_object(
    'status', st, 'on_date', p_on, 'classes', n_cls, 'students', n_stu, 'marks', n_mrk))
  returning id into line;

  return format('year-purge|%s|%s|%s|%s|%s', st, line, n_cls, n_stu, n_mrk);
end $$;
revoke all on function private.purge_old_school_years_at(date, bigint, integer)
  from public, anon, authenticated, service_role;

-- الطبقة التي يستدعيها دور الحذف الليلي: اليوم بتوقيت الجزائر، لا يختاره المتصل.
create function private.purge_old_school_years(p_floor bigint, p_max integer default 100)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.purge_old_school_years_at((now() at time zone 'Africa/Algiers')::date, p_floor, p_max)
$$;
revoke all on function private.purge_old_school_years(bigint, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.purge_old_school_years(bigint, integer) to taqwim_purger;

-- ---------------------------------------------------------------------------
-- 5) إشعار الأستاذ: معرّفات أقسامه المقفلة وتاريخ حذفها فقط
-- ---------------------------------------------------------------------------
create function public.my_year_notice()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'year_start', private.school_year_of((now() at time zone 'Africa/Algiers')::date),
    'closed', coalesce(jsonb_agg(jsonb_build_object(
        'class_id', c.id,
        'purge_on', make_date(private.school_year_of((c.created_at at time zone 'Africa/Algiers')::date) + 1, 11, 7))
      order by c.created_at, c.id), '[]'::jsonb))
  from public.classes c
  where c.teacher_id = (select auth.uid())
    and private.school_year_of((c.created_at at time zone 'Africa/Algiers')::date)
      < private.school_year_of((now() at time zone 'Africa/Algiers')::date)
$$;
revoke all on function public.my_year_notice() from public, anon;
grant execute on function public.my_year_notice() to authenticated;

comment on function private.purge_old_school_years(bigint, integer) is
  'الحذف السنوي للمهمة الليلية. p_floor = رقم آخر سطر year_purge المسجَّل خارج القاعدة. الحالات: baseline | regression | ok | already_ran.';
