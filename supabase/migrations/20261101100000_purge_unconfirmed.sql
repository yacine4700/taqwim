-- حذف الحسابات التي سجّلت ولم تؤكّد بريدها، بتأكيد المشرف وحده.
--
-- بعد تفعيل Confirm email يُنشأ صفّ المسجِّل ومعه (بمحفّزي handle_new_user وseed_teacher) صفّ الأستاذ
-- ومعاييره الخمسة ومركّباته الأربعة فورًا، ثم لا يُحذف إن لم يؤكّد: Supabase لا ينظّف غير المؤكَّدين،
-- فيبقى بريده محجوزًا وتحصيه اللوحة مع الأساتذة.
--
-- لا حذف تلقائي: لا يُحذف حساب إلا حين يضغط المشرف «احذف» في لوحته بعد أن يرى القائمة. ولا يُمسّ
-- الحذف الليلي (private.purge_deleted_accounts) ولا غيره من الدوال القائمة.
--
-- «قابل للحذف» (تحدّده القاعدة لا الواجهة، وكل الشروط معًا):
--   * مرّت 7 أيام على التسجيل، ولا بريد ولا هاتف مؤكَّد، ولم يدخل قطّ، ومزوّده البريد.
--   * ليس مشرفًا، ولا عليه طلب حذف، ولا موقوفًا (الإيقاف قرار بشري لا يمحوه تنظيف).
--   * لا بيانات: لا مؤسسة ولا قسم ولا تلميذ ولا علامة. فلا يضيع بهذا الحذف شيء يملكه أستاذ.
--
-- الحذف يُمرَّر معه العدد الذي رآه المشرف: إن تغيّر (تأكّد حساب في الأثناء، أو سُجّل غيره، أو قفل
-- صفّه) رُفض ولم يُحذف شيء، فلا يُحذف ما لم يره. وأكثر من 50 حسابًا في المرة يعني خللًا، فيُرفض.
-- الصلاحية: private.require_admin (مشرف + aal2 + TOTP خلال 12 ساعة). لا رمزًا جديدًا ولا بريدًا
-- مكتوبًا كالحذف الفوري، لأن ما يُحذف هنا حسابات بلا بيانات لم يستعملها أحد.

alter table private.audit_log drop constraint if exists audit_log_action_check;
alter table private.audit_log
  add constraint audit_log_action_check check (action in (
    'disable', 'enable', 'cancel_deletion', 'request_deletion', 'purge',
    'set_term', 'set_backup', 'set_exams', 'admin_purge', 'purge_unconfirmed'));

-- القابلون للحذف: تعريف واحد تقرؤه القائمة والحذف معًا، فلا يختلفان.
create function private.stale_unconfirmed(min_age interval default interval '7 days')
returns table (id uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.created_at
  from auth.users u
  where u.email_confirmed_at is null
    and u.phone_confirmed_at is null
    and u.last_sign_in_at is null
    and u.banned_until is null
    and u.created_at < now() - min_age
    and coalesce(u.raw_app_meta_data ->> 'provider', 'email') = 'email'
    and not exists (select 1 from private.admins a where a.user_id = u.id)
    and not exists (select 1 from private.deletion_requests d where d.user_id = u.id)
    and not exists (select 1 from public.schools x where x.teacher_id = u.id)
    and not exists (select 1 from public.classes x where x.teacher_id = u.id)
    and not exists (select 1 from public.students x where x.teacher_id = u.id)
    and not exists (select 1 from public.records x where x.teacher_id = u.id)
$$;

-- القائمة: كل من لم يؤكّد بريده (مع الحديثين، للاطلاع)، وأيّهم يُحذف الآن. لا بيانات غير الهويّة والعمر.
create function public.admin_unconfirmed_accounts()
returns table (
  id uuid, email text, full_name text, created_at timestamptz,
  days_old integer, deletable boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();

  return query
  select u.id, u.email::text, t.full_name, u.created_at,
         floor(extract(epoch from (now() - u.created_at)) / 86400)::integer,
         exists (select 1 from private.stale_unconfirmed() s where s.id = u.id)
  from auth.users u
  left join public.teachers t on t.id = u.id
  where u.email_confirmed_at is null
    and u.phone_confirmed_at is null
    and not exists (select 1 from private.admins a where a.user_id = u.id)
  order by u.created_at;
end;
$$;

-- الحذف: يُرجع عدد المحذوفين. expected = ما رآه المشرف قابلًا للحذف.
create function public.admin_purge_unconfirmed(expected integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_admin();
  stale uuid[];
  n integer;
begin
  if expected is null or expected < 1 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  if expected > 50 then
    raise exception 'too_many' using errcode = 'P0001',
      hint = 'أكثر من 50 حسابًا في المرة: راجعها قبل الحذف';
  end if;

  -- القفل مع تخطّي المقفول: تأكيدٌ يصل أثناء التشغيل يحجز صفّه فيُتخطّى (فيختلف العدد ويُرفض الحذف).
  -- وشرطا التأكيد والدخول يُعادان بعد القفل، فحسابٌ تأكّد بين الاختيار والقفل لا يُحذف.
  select coalesce(array_agg(s.id order by s.created_at), '{}')
    into stale
  from (
    select c.id, c.created_at
    from private.stale_unconfirmed() c
    join auth.users u on u.id = c.id
    where u.email_confirmed_at is null and u.last_sign_in_at is null
    for update of u skip locked
  ) s;

  n := cardinality(stale);
  if n <> expected then
    raise exception 'unconfirmed_changed' using errcode = 'P0001',
      hint = 'تغيّرت القائمة منذ أن رأيتها';
  end if;

  -- بلا بريد في السجلّ: الحساب لم يُفعَّل، وبريده معرِّف شخص لم يطلب شيئًا.
  insert into private.audit_log (actor_kind, actor_id, action, target_id, detail)
  select 'admin', me, 'purge_unconfirmed', u.id,
         jsonb_build_object('created_at', u.created_at)
  from auth.users u
  where u.id = any(stale);

  -- الحذف التسلسلي نفسه المستعمل في بقية الحذف: يمحو teachers ومعاييرها ومركّباتها التي أنشأها المحفّز.
  delete from auth.users where id = any(stale);
  return n;
end;
$$;

revoke all on function private.stale_unconfirmed(interval),
  public.admin_unconfirmed_accounts(), public.admin_purge_unconfirmed(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_unconfirmed_accounts(), public.admin_purge_unconfirmed(integer)
  to authenticated;
