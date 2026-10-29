-- حساب المشرف، ومهلة 7 أيام قبل حذف الحساب نهائيًّا.
--
-- ما يضيفه:
--   * مخطّط private (غير مكشوف لواجهة API) فيه: المشرفون، طلبات الحذف، السجلّ.
--   * دوال RPC للأستاذ: طلب الحذف (بعد إدخال كلمة المرور خلال 10 دقائق)، إلغاؤه، حالته.
--   * دوال RPC للمشرف: القائمة والأعداد، التعطيل/الإعادة، إلغاء حذف، السجلّ، وam_i_admin
--     التي تقول للمتصل عن نفسه وحده هل هو مشرف وهل تحقّقه الثنائي ساري. الشرط في كل دالة إدارية:
--     في private.admins، وجلسة aal2، وإدخال رمز TOTP في هذه الجلسة خلال آخر 12 ساعة، والجلسة
--     ما زالت قائمة وغير منتهية (تُقرأ كلها من جداول الخادم، لا مما يرسله العميل).
--     السجلّ لا يكتب عرض القائمة: العمليات التي تغيّر شيئًا فقط، ومعها السبب إن كُتب.
--   * سياسات تقييدية جديدة على الجداول الأحد عشر:
--       - الحساب الموقوف: لا قراءة ولا كتابة، ولو بقي معه access token صادر قبل الإيقاف.
--       - الحساب المجدول للحذف: قراءة فقط (لتنزيل «نسختي»)، ولا كتابة حتى يُلغى الطلب.
--     السياسات الحالية (own_rows / own_profile) لا تتغيّر.
--   * دالة الحذف النهائي private.purge_deleted_accounts ودور taqwim_purger لا يملك غيرها.
--   * سحب صلاحية تشغيل delete_my_account (تبقى الدالة، فيسهل التراجع).
--
-- ما لا يمسّه: أعمدة الجداول الحالية وبياناتها وسياساتها ومحفّزاتها.
--
-- الأساس الذي بُني عليه التحقّق من كلمة المرور (من كود Supabase Auth):
--   عند كل دخول بكلمة المرور يُكتب/يُحدَّث صفّ في auth.mfa_amr_claims لتلك الجلسة
--   (authentication_method = 'password'، updated_at = لحظة الإدخال)، ولا يتغيّر عند
--   تجديد الجلسة. وsession_id يأتي من JWT الذي تتحقّق PostgREST من توقيعه. فالشرط
--   كلّه يُقرأ من جداول الخادم، لا من وقت أو قيمة يرسلها العميل.

-- ---------------------------------------------------------------------------
-- المخطّط والجداول
-- ---------------------------------------------------------------------------
create schema private;
revoke all on schema private from public;
-- usage فقط، ليستطيع تقييم السياسات التي تستدعي دوال هذا المخطّط. لا صلاحية على جداوله.
grant usage on schema private to authenticated;

create table private.admins (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  note     text
);

create table private.deletion_requests (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now(),
  purge_after  timestamptz not null,
  check (purge_after >= requested_at + interval '7 days')
);

-- السجلّ لا مفتاح أجنبيًّا فيه: يبقى بعد حذف الحساب المعنيّ. ولا دالة تحذف منه.
create table private.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor_kind text not null check (actor_kind in ('admin', 'teacher', 'system')),
  actor_id   uuid,
  action     text not null check (action in (
               'disable', 'enable', 'cancel_deletion',
               'request_deletion', 'purge')),
  target_id  uuid,
  detail     jsonb not null default '{}'::jsonb
);

revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all sequences in schema private from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- دوال مساعدة (داخلية)
-- ---------------------------------------------------------------------------

-- أقصى عمر لتحقّق TOTP: بعده تُطلب إعادة الرمز. تعريف واحد تقرؤه كل الدوال.
create function private.mfa_max_age()
returns interval
language sql
immutable
as $$ select interval '12 hours' $$;

-- لحظة آخر إدخال لرمز TOTP في جلسة المتصل الحالية، أو null إن لم يوجد أو لم تعد الجلسة
-- قائمة. الجلسة تُقرأ من auth.sessions: من خرج أو أُوقف حسابه (حُذفت جلساته) يسقط فورًا
-- ولو بقي access token صادر قبل ذلك صالحًا، وكذلك الجلسة المنتهية (not_after).
-- التحقّق الثنائي يبقى aal2 في JWT طوال عمر الجلسة (أيامًا)، فلا يكفي وحده.
create function private.mfa_verified_at()
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  at  timestamptz;
begin
  if uid is null then
    return null;
  end if;
  begin
    sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    return null;
  end;
  if sid is null then
    return null;
  end if;
  select max(c.updated_at) into at
  from auth.sessions s
  join auth.mfa_amr_claims c on c.session_id = s.id
  where s.id = sid
    and s.user_id = uid
    and (s.not_after is null or s.not_after > now())
    and c.authentication_method = 'totp';
  return at;
end;
$$;

-- مشرف = في الجدول + جلسة aal2 + رمز TOTP حديث في جلسة قائمة.
create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
     and exists (select 1 from private.admins a where a.user_id = (select auth.uid()))
     and coalesce((select private.mfa_verified_at()) > now() - private.mfa_max_age(), false);
$$;

-- الرسالتان تفرّقان لواجهة المشرف بين «لا صلاحية» و«أعد الرمز». الثانية لا تصل إلا لمن
-- هو في الجدول فعلًا؛ غيره يسمع «forbidden» دائمًا فلا يعرف من هو مشرف.
create function private.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from private.admins a where a.user_id = (select auth.uid())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.is_admin() then
    raise exception 'mfa_required' using errcode = '42501',
      hint = 'أدخل رمز التحقّق الثنائي من جديد';
  end if;
  return auth.uid();
end;
$$;

-- الحساب موقوف الآن؟ (banned_until في المستقبل)
create function private.read_blocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid()) and u.banned_until is not null and u.banned_until > now()
  );
$$;

-- لا كتابة: موقوف، أو مجدول للحذف.
create function private.write_blocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.read_blocked()
      or exists (select 1 from private.deletion_requests d where d.user_id = (select auth.uid()));
$$;

revoke all on function private.mfa_max_age(), private.mfa_verified_at(), private.is_admin(),
  private.require_admin(), private.read_blocked(), private.write_blocked()
  from public, anon, authenticated, service_role;
-- السياسات تُقيَّم بدور المستخدم، فيلزمه حقّ تشغيل هاتين فقط.
grant execute on function private.read_blocked(), private.write_blocked() to authenticated;

-- ---------------------------------------------------------------------------
-- السياسات التقييدية الجديدة (تُضاف إلى ما هو موجود، ولا تغيّره)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['teachers', 'schools', 'classes', 'class_groups', 'students',
                           'criteria', 'components', 'records', 'readings',
                           'tp_sessions', 'tp_marks'] loop
    execute format($f$create policy guard_read on public.%I as restrictive for select
      to authenticated using (not (select private.read_blocked()))$f$, t);
    execute format($f$create policy guard_insert on public.%I as restrictive for insert
      to authenticated with check (not (select private.write_blocked()))$f$, t);
    execute format($f$create policy guard_update on public.%I as restrictive for update
      to authenticated using (not (select private.write_blocked()))
      with check (not (select private.write_blocked()))$f$, t);
    execute format($f$create policy guard_delete on public.%I as restrictive for delete
      to authenticated using (not (select private.write_blocked()))$f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- دوال الأستاذ
-- ---------------------------------------------------------------------------

-- يبدأ مهلة الحذف. يشترط أن تكون كلمة المرور قد أُدخلت في هذه الجلسة خلال 10 دقائق.
create function public.request_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  due timestamptz;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  begin
    sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    sid := null;
  end;

  if sid is null or not exists (
       select 1
       from auth.sessions s
       join auth.mfa_amr_claims c on c.session_id = s.id
       where s.id = sid
         and s.user_id = uid
         and (s.not_after is null or s.not_after > now())
         and c.authentication_method = 'password'
         and c.updated_at > now() - interval '10 minutes'
     ) then
    raise exception 'reauth_required'
      using errcode = 'P0001', hint = 'أدخل كلمة المرور من جديد ثم أعد المحاولة خلال 10 دقائق';
  end if;

  insert into private.deletion_requests (user_id, requested_at, purge_after)
  values (uid, now(), now() + interval '7 days')
  on conflict (user_id) do nothing;

  select d.purge_after into due from private.deletion_requests d where d.user_id = uid;

  insert into private.audit_log (actor_kind, actor_id, action, target_id, detail)
  values ('teacher', uid, 'request_deletion', uid, jsonb_build_object('purge_after', due));

  return due;
end;
$$;

create function public.cancel_account_deletion()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  found_one boolean;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from private.deletion_requests where user_id = uid;
  found_one := found;
  if found_one then
    insert into private.audit_log (actor_kind, actor_id, action, target_id)
    values ('teacher', uid, 'cancel_deletion', uid);
  end if;
  return found_one;
end;
$$;

create function public.my_account_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- writes_blocked: يسأل عنه طابور التطبيق قبل إرسال حذف، لأن RLS لا تُرجع خطأً
  -- على الحذف الممنوع بل صفر صفوف، فيضيع الحذف بصمت لو أُرسل.
  select jsonb_build_object(
    'deletion_requested_at', d.requested_at,
    'purge_after', d.purge_after,
    'writes_blocked', private.write_blocked())
  from (select (select auth.uid()) as uid) me
  left join private.deletion_requests d on d.user_id = me.uid
  where me.uid is not null;
$$;

-- ---------------------------------------------------------------------------
-- دوال المشرف
-- ---------------------------------------------------------------------------

-- يسأل بها المتصل عن نفسه وحده (لا معامل، فلا تُستعمل لسؤال عن غيره). لا تكتب في السجلّ.
--   listed: هل هو في private.admins (غير المشرف يرى false وnull في الباقي).
--   ready:  هل يقبل الخادم دوال الإشراف منه الآن.
--   mfa_expires_at: متى يسقط تحقّقه الثنائي؛ null إن لم يُدخل الرمز في هذه الجلسة.
create function public.am_i_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  listed boolean;
  at timestamptz;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  listed := exists (select 1 from private.admins a where a.user_id = uid);
  if not listed then
    return jsonb_build_object('listed', false, 'ready', false);
  end if;
  at := private.mfa_verified_at();
  return jsonb_build_object(
    'listed', true,
    'aal', auth.jwt() ->> 'aal',
    'mfa_verified_at', at,
    'mfa_expires_at', at + private.mfa_max_age(),
    'ready', private.is_admin());
end;
$$;

-- القائمة: هويّة الحساب وحالته وأعداد بياناته. لا أسماء تلاميذ ولا علامات.
create function public.admin_list_teachers()
returns table (
  id uuid, email text, full_name text, created_at timestamptz, last_sign_in_at timestamptz,
  status text, banned_until timestamptz, purge_after timestamptz, is_admin boolean,
  classes integer, students integer, records integer, last_activity timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();

  return query
  select u.id, u.email::text, t.full_name, u.created_at, u.last_sign_in_at,
         case when u.banned_until is not null and u.banned_until > now() then 'disabled'
              when d.user_id is not null then 'deletion_pending'
              else 'active' end,
         u.banned_until, d.purge_after,
         exists (select 1 from private.admins a where a.user_id = u.id),
         (select count(*)::int from public.classes c where c.teacher_id = u.id),
         (select count(*)::int from public.students s where s.teacher_id = u.id),
         (select count(*)::int from public.records r where r.teacher_id = u.id),
         greatest(
           (select max(r.updated_at) from public.records r where r.teacher_id = u.id),
           (select max(m.updated_at) from public.tp_marks m where m.teacher_id = u.id),
           (select max(g.created_at) from public.readings g where g.teacher_id = u.id))
  from auth.users u
  left join public.teachers t on t.id = u.id
  left join private.deletion_requests d on d.user_id = u.id
  order by u.created_at;
end;
$$;

-- التعطيل يمنع الدخول وتجديد الجلسة (Supabase Auth يرفض المحظور)، ويحذف الجلسات
-- القائمة، والسياسات التقييدية تمنع ما بقي من access token حتى ينتهي. البيانات لا تُمسّ.
create function public.admin_set_disabled(target uuid, disabled boolean, reason text default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_admin();
  until timestamptz;
  why text := nullif(left(btrim(coalesce(reason, '')), 300), '');
begin
  if target is null or disabled is null then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  if target = me or exists (select 1 from private.admins a where a.user_id = target) then
    raise exception 'cannot disable an admin account' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = target) then
    raise exception 'no such account' using errcode = 'P0002';
  end if;

  -- تاريخ بعيد لا 'infinity': Supabase Auth يقرأ banned_until وقتًا عاديًّا.
  until := case when disabled then now() + interval '100 years' else null end;
  update auth.users set banned_until = until where id = target;
  if disabled then
    delete from auth.sessions where user_id = target;
  end if;

  insert into private.audit_log (actor_kind, actor_id, action, target_id, detail)
  values ('admin', me, case when disabled then 'disable' else 'enable' end, target,
          case when why is null then '{}'::jsonb else jsonb_build_object('reason', why) end);
  return until;
end;
$$;

create function public.admin_cancel_deletion(target uuid, reason text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_admin();
  found_one boolean;
  why text := nullif(left(btrim(coalesce(reason, '')), 300), '');
begin
  delete from private.deletion_requests where user_id = target;
  found_one := found;
  if found_one then
    insert into private.audit_log (actor_kind, actor_id, action, target_id, detail)
    values ('admin', me, 'cancel_deletion', target,
            case when why is null then '{}'::jsonb else jsonb_build_object('reason', why) end);
  end if;
  return found_one;
end;
$$;

create function public.admin_log_recent(max_rows integer default 50)
returns table (at timestamptz, actor_kind text, actor_id uuid, action text,
               target_id uuid, target_email text, detail jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select l.at, l.actor_kind, l.actor_id, l.action, l.target_id, u.email::text, l.detail
  from private.audit_log l
  left join auth.users u on u.id = l.target_id
  order by l.id desc
  limit least(greatest(coalesce(max_rows, 50), 1), 200);
end;
$$;

-- ---------------------------------------------------------------------------
-- الحذف النهائي: يُستدعى من التشغيل الليلي بعد نجاح النسخة والتحقّق منها.
-- ---------------------------------------------------------------------------
create function private.purge_deleted_accounts(max_accounts integer default 5)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due uuid[];
  n integer;
begin
  -- for update: إلغاء يصل أثناء التشغيل ينتظر حتى ينتهي، وإلغاء سبقه لا يُرى هنا.
  -- بدون القفل كان يمكن أن يُلغي الأستاذ طلبه بين القراءة والحذف فيُحذف حسابه رغم الإلغاء.
  select coalesce(array_agg(s.user_id order by s.purge_after), '{}')
    into due
  from (
    select d.user_id, d.purge_after
    from private.deletion_requests d
    where d.purge_after <= now()
    for update
  ) s;

  n := cardinality(due);
  if n = 0 then
    return 0;
  end if;
  -- حاجز: عدد غير معتاد يستدعي نظر إنسان، فلا يُحذف شيء.
  if n > max_accounts then
    raise exception 'refusing to purge % accounts (limit %)', n, max_accounts using errcode = 'P0001';
  end if;

  insert into private.audit_log (actor_kind, action, target_id, detail)
  select 'system', 'purge', x, jsonb_build_object('requested_at', d.requested_at, 'purge_after', d.purge_after)
  from unnest(due) x join private.deletion_requests d on d.user_id = x;

  -- الحذف التسلسلي الحالي يمحو teachers وكل ما يتبعها، وطلب الحذف نفسه.
  delete from auth.users where id = any(due);
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- الصلاحيات
-- ---------------------------------------------------------------------------
revoke all on function public.request_account_deletion(), public.cancel_account_deletion(),
  public.my_account_status(), public.am_i_admin(), public.admin_list_teachers(),
  public.admin_set_disabled(uuid, boolean, text), public.admin_cancel_deletion(uuid, text),
  public.admin_log_recent(integer), private.purge_deleted_accounts(integer)
  from public, anon, authenticated, service_role;

grant execute on function public.request_account_deletion(), public.cancel_account_deletion(),
  public.my_account_status(), public.am_i_admin(), public.admin_list_teachers(),
  public.admin_set_disabled(uuid, boolean, text), public.admin_cancel_deletion(uuid, text),
  public.admin_log_recent(integer)
  to authenticated;

-- دور الحذف الليلي: لا يدخل حتى تضبط له كلمة مرور يدويًّا، ولا يملك إلا هذه الدالة.
create role taqwim_purger nologin noinherit;
grant usage on schema private to taqwim_purger;
grant execute on function private.purge_deleted_accounts(integer) to taqwim_purger;

-- الحذف الفوري لم يعد متاحًا من التطبيق.
revoke execute on function public.delete_my_account() from authenticated;
