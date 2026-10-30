-- رزنامة الفصول، ومنع التنقيط في فصل مقفل.
--
-- ما يضيفه:
--   * public.term_calendar: بداية كل فصل ونهايته ومهلته (10 أيام افتراضيًّا). يقرؤه
--     كل أستاذ ولا يكتبه إلا من يملك الجدول (ترحيل جديد كل سنة). الفصول لا تتداخل.
--   * private.term_open(الفصل، اليوم): هل الفصل مفتوح للكتابة؟ مفتوح من أول يوم فيه
--     حتى ends_on + grace_days. فتتداخل مهلة فصل مع بداية اللاحق، ويُنقَّط الاثنان معًا.
--   * محفّز BEFORE على records وreadings وtp_sessions وtp_marks يرفض إدخال علامة أو
--     تعديلها أو حذفها في فصل مقفل، برمز 23514 ورسالة term_closed:<الفصل>.
--
-- قرارات التصميم:
--   * اليوم يُحسب بتوقيت الجزائر في الخادم، لا بساعة الهاتف.
--   * المحفّز يعمل لمن معه JWT فقط (auth.uid() ليس فارغًا): الترحيلات والحذف الليلي
--     للحسابات المجدولة (دور خادم بلا JWT) لا يمرّان به.
--   * لا يعمل حين pg_trigger_depth() > 1: أي ما يُطلقه مفتاح أجنبي (حذف تلميذ أو قسم
--     أو حساب يحذف علاماتهم، وحذف فوج يفرّغ group_id في حصصه) ليس تنقيطًا.
--   * الاستعادة من النسخة الاحتياطية تعمل بـ session_replication_role = replica فلا
--     تُطلق المحفّزات، فتُستعاد علامات الفصول المقفلة كما هي.
--   * إن لم تغطِّ الرزنامة تاريخ اليوم (قاعدة بلا صفوف، أو بعد آخر فصل بأكثر من 30
--     يومًا) فلا شيء يُقفل: نسيان رزنامة السنة القادمة لا يحبس الأساتذة خارج تطبيقهم.
--     وما بين فصلين، أو بين آخر فصل و30 يومًا بعده (العطلة)، لا فصل مفتوح فيه.

-- ---------------------------------------------------------------------------
-- الرزنامة
-- ---------------------------------------------------------------------------
create table public.term_calendar (
  school_year text not null check (school_year ~ '^[0-9]{4}/[0-9]{4}$'),
  term smallint not null check (term between 1 and 3),
  starts_on date not null,
  ends_on date not null,
  grace_days smallint not null default 10 check (grace_days between 0 and 30),
  primary key (school_year, term),
  constraint term_calendar_order check (ends_on >= starts_on),
  constraint term_calendar_no_overlap exclude using gist (daterange(starts_on, ends_on, '[]') with &&)
);

comment on table public.term_calendar is
  'حدود الفصول الدراسية. الفصل مفتوح للتنقيط من starts_on حتى ends_on + grace_days. تُضاف سنة جديدة بترحيل قبل سبتمبر.';

alter table public.term_calendar enable row level security;

create policy read_calendar on public.term_calendar
  for select to authenticated
  using (true);

-- الصلاحيات الافتراضية في Supabase تفتح الجدول الجديد لـ anon وauthenticated.
revoke all on public.term_calendar from anon, authenticated;
grant select on public.term_calendar to authenticated;

-- الموسم 2026/2027: رزنامة وزارة التربية الوطنية. كل فصل يبدأ في اليوم التالي لنهاية سابقه.
--   ف1 ينتهي بعطلة الشتاء (مساء الخميس 17 ديسمبر)، وف2 بعطلة الربيع (مساء الخميس 18 مارس)،
--   وف3 ببداية العطلة السنوية للأساتذة (مساء 8 جويلية 2027).
insert into public.term_calendar (school_year, term, starts_on, ends_on) values
  ('2026/2027', 1, '2026-09-01', '2026-12-17'),
  ('2026/2027', 2, '2026-12-18', '2027-03-18'),
  ('2026/2027', 3, '2027-03-19', '2027-07-08');

-- ---------------------------------------------------------------------------
-- هل الفصل مفتوح للكتابة؟
-- ---------------------------------------------------------------------------
create function private.term_open(
  p_term integer,
  p_on date default (now() at time zone 'Africa/Algiers')::date
) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when b.lo is null or p_on < b.lo or p_on > b.hi then true
    else exists (
      select 1 from public.term_calendar c
      where c.term = p_term
        and p_on between c.starts_on and c.ends_on + c.grace_days
    )
  end
  from (
    select min(starts_on) as lo, max(ends_on + grace_days) + 30 as hi
    from public.term_calendar
  ) b
$$;

revoke all on function private.term_open(integer, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- المحفّز
-- ---------------------------------------------------------------------------
create function private.guard_term_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  t_new smallint;
  t_old smallint;
begin
  -- دور خادم بلا JWT (ترحيل، حذف ليلي، صيانة): ليس تنقيط أستاذ.
  -- وما يطلقه مفتاح أجنبي أو محفّز آخر: حذف تلميذ أو قسم أو حساب، لا تنقيط.
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'tp_marks' then
    if tg_op <> 'DELETE' then
      select s.term into t_new from public.tp_sessions s where s.id = new.session_id;
    end if;
    if tg_op <> 'INSERT' then
      select s.term into t_old from public.tp_sessions s where s.id = old.session_id;
    end if;
  else
    if tg_op <> 'DELETE' then t_new := new.term; end if;
    if tg_op <> 'INSERT' then t_old := old.term; end if;
  end if;

  if t_new is not null and not private.term_open(t_new) then
    raise exception 'term_closed:%', t_new using errcode = '23514';
  end if;
  if t_old is not null and t_old is distinct from t_new and not private.term_open(t_old) then
    raise exception 'term_closed:%', t_old using errcode = '23514';
  end if;

  return coalesce(new, old);
end $$;

revoke all on function private.guard_term_write() from public, anon, authenticated;

create trigger trg_guard_term_write before insert or update or delete on public.records
  for each row execute function private.guard_term_write();
create trigger trg_guard_term_write before insert or update or delete on public.readings
  for each row execute function private.guard_term_write();
create trigger trg_guard_term_write before insert or update or delete on public.tp_sessions
  for each row execute function private.guard_term_write();
create trigger trg_guard_term_write before insert or update or delete on public.tp_marks
  for each row execute function private.guard_term_write();
