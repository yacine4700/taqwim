-- تعديل رزنامة الفصول من لوحة المشرف.
--
-- يعتمد على ترحيل المشرف (20261022130000: private.require_admin وprivate.audit_log)
-- وعلى ترحيل الرزنامة (20261030090000: public.term_calendar).
--
-- ما يضيفه:
--   * public.admin_set_term: يضيف فصلًا أو يعدّل تواريخه ومهلته. الشرط نفسه في كل دالة
--     إدارية: في private.admins، وجلسة aal2، ورمز TOTP خلال 12 ساعة (private.require_admin).
--     ويُسجَّل كل تعديل في private.audit_log بالقيم الجديدة والسابقة والسبب إن كُتب.
--   * 'set_term' ضمن الأفعال المسموحة في السجلّ.
--
-- القراءة بلا دالة جديدة: الرزنامة نفسها مقروءة لكل أستاذ (read_calendar). والكتابة لا تتاح
-- إلا من هذه الدالة: الأساتذة لا يملكون صلاحية على الجدول.
--
-- ما تتحقّق منه الدالة (وكله قبل أي كتابة):
--   * الفصل 1 إلى 3، والنهاية لا تسبق البداية، والمهلة 0 إلى 30 يومًا.
--   * اسم السنة «2026/2027»: السنتان متتاليتان، فلا يقع خطأ في الكتابة (2062) فيقفل الفصول.
--   * التواريخ ضمن السنة الدراسية: من 1 جويلية للسنة الأولى إلى 30 سبتمبر للثانية.
--   * التداخل بين فصلين تمنعه قاعدة الاستبعاد في الجدول (23P01).
-- ما لا تفعله: لا تحذف فصلًا ولا سنة. الخطأ يُصحَّح بتعديله.

-- الفعل الجديد في السجلّ
alter table private.audit_log drop constraint if exists audit_log_action_check;
alter table private.audit_log
  add constraint audit_log_action_check check (action in (
    'disable', 'enable', 'cancel_deletion', 'request_deletion', 'purge', 'set_term'));

create function public.admin_set_term(
  p_school_year text,
  p_term integer,
  p_starts_on date,
  p_ends_on date,
  p_grace_days integer default 10,
  reason text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_admin();
  y1 integer;
  why text := nullif(left(btrim(coalesce(reason, '')), 300), '');
  before_row public.term_calendar;
begin
  if p_school_year is null or p_term is null or p_starts_on is null or p_ends_on is null
     or p_grace_days is null then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  if p_school_year !~ '^[0-9]{4}/[0-9]{4}$' then
    raise exception 'invalid school_year' using errcode = '22023';
  end if;
  y1 := split_part(p_school_year, '/', 1)::integer;
  if split_part(p_school_year, '/', 2)::integer <> y1 + 1 then
    raise exception 'school_year must be consecutive years' using errcode = '22023';
  end if;
  if p_term not between 1 and 3 then
    raise exception 'invalid term' using errcode = '22023';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'ends_on before starts_on' using errcode = '22023';
  end if;
  if p_grace_days not between 0 and 30 then
    raise exception 'invalid grace_days' using errcode = '22023';
  end if;
  if p_starts_on < make_date(y1, 7, 1) or p_ends_on > make_date(y1 + 1, 9, 30) then
    raise exception 'dates outside the school year' using errcode = '22023';
  end if;

  select * into before_row from public.term_calendar c
  where c.school_year = p_school_year and c.term = p_term;

  insert into public.term_calendar (school_year, term, starts_on, ends_on, grace_days)
  values (p_school_year, p_term, p_starts_on, p_ends_on, p_grace_days)
  on conflict (school_year, term) do update
    set starts_on = excluded.starts_on, ends_on = excluded.ends_on, grace_days = excluded.grace_days;

  insert into private.audit_log (actor_kind, actor_id, action, target_id, detail)
  values ('admin', me, 'set_term', null,
    jsonb_build_object(
      'school_year', p_school_year, 'term', p_term,
      'starts_on', p_starts_on, 'ends_on', p_ends_on, 'grace_days', p_grace_days,
      'previous', case when before_row.term is null then null
                       else jsonb_build_object('starts_on', before_row.starts_on,
                                               'ends_on', before_row.ends_on,
                                               'grace_days', before_row.grace_days) end)
    || case when why is null then '{}'::jsonb else jsonb_build_object('reason', why) end);
end;
$$;

revoke all on function public.admin_set_term(text, integer, date, date, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_term(text, integer, date, date, integer, text)
  to authenticated;
