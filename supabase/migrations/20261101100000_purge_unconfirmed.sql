-- تنظيف الحسابات التي سجّلت ولم تؤكّد بريدها.
--
-- بعد تفعيل Confirm email، التسجيل يُنشئ صفّه في auth.users فورًا ومعه (بمحفّزي handle_new_user
-- وseed_teacher) صفّ الأستاذ ومعاييره الخمسة ومركّباته الأربعة، ثم لا يدخل صاحبه ولا يُحذف
-- الصفّ: Supabase لا ينظّف غير المؤكَّدين. فتتراكم حسابات لا يملكها أحد، ويبقى بريد كل منها
-- محجوزًا، ويحصيها اللوحة مع الأساتذة.
--
-- الحذف بعد 7 أيام من التسجيل، وبشروط كلها معًا (أي شرط يخالفه حسابٌ يُترك):
--   * لا بريد مؤكَّد ولا هاتف، ولم يسجّل دخولًا قطّ.
--   * مزوّده البريد (لا حسابات أخرى).
--   * ليس مشرفًا، وليس عليه طلب حذف، وليس موقوفًا (الإيقاف قرار بشري لا يُمحى بتنظيف).
--   * لا بيانات: لا مؤسسة ولا قسم ولا تلميذ ولا علامة. فلا يضيع بهذا الحذف شيء يملكه أستاذ،
--     حتى لو أخطأ شرط آخر.
-- وحاجز: أكثر من 20 حسابًا في تشغيلة واحدة يعني خللًا لا تنظيفًا، فلا يُحذف شيء ويُكتب تحذير.
--
-- يُشغَّل مع الحذف النهائي الليلي (private.purge_deleted_accounts) لا بجدولة جديدة: pg_cron غير
-- مفعَّلة في المشروع، والتشغيل الليلي يأتي بعد نسخة ناجحة ومتحقَّق منها. وخطأ التنظيف لا يعطّل
-- الحذف الأصلي: يُسجَّل تحذيرًا ويمضي. توقيع الدالة وقيمتها المُرجَعة كما كانا.

alter table private.audit_log drop constraint if exists audit_log_action_check;
alter table private.audit_log
  add constraint audit_log_action_check check (action in (
    'disable', 'enable', 'cancel_deletion', 'request_deletion', 'purge',
    'set_term', 'set_backup', 'set_exams', 'admin_purge', 'purge_unconfirmed'));

create function private.purge_unconfirmed_accounts(
  min_age interval default interval '7 days',
  max_accounts integer default 20
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale uuid[];
  n integer;
begin
  -- for update skip locked: تأكيدٌ يصل أثناء التشغيل يحجز صفّه فيُتخطّى، لا يُحذف حساب يتأكّد الآن.
  select coalesce(array_agg(s.id order by s.created_at), '{}')
    into stale
  from (
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
    for update of u skip locked
  ) s;

  n := cardinality(stale);
  if n = 0 then
    return 0;
  end if;
  if n > max_accounts then
    raise warning 'refusing to purge % unconfirmed accounts (limit %)', n, max_accounts;
    return 0;
  end if;

  -- بلا بريد في السجلّ: الحساب لم يُفعَّل، وبريده معرِّف شخص لم يطلب شيئًا.
  insert into private.audit_log (actor_kind, action, target_id, detail)
  select 'system', 'purge_unconfirmed', u.id,
         jsonb_build_object('created_at', u.created_at, 'min_age', min_age::text)
  from auth.users u
  where u.id = any(stale);

  -- الحذف التسلسلي يمحو teachers ومعاييرها ومركّباتها التي أنشأها المحفّز.
  delete from auth.users where id = any(stale);
  return n;
end;
$$;

-- الدالة نفسها كما في 20261022130000، والجديد استدعاء التنظيف في أولها داخل كتلة استثناء.
create or replace function private.purge_deleted_accounts(max_accounts integer default 5)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due uuid[];
  n integer;
begin
  begin
    perform private.purge_unconfirmed_accounts();
  exception when others then
    raise warning 'purge_unconfirmed_accounts failed: % (%)', sqlerrm, sqlstate;
  end;

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

-- لا يستدعيها أحد مباشرة: تُستدعى من الدالة أعلاه (security definer بمالكها).
revoke all on function private.purge_unconfirmed_accounts(interval, integer)
  from public, anon, authenticated, service_role;
