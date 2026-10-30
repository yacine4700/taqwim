-- الحذف الفوري لحساب أستاذ، للمشرف وحده، دون مهلة السبعة أيام.
--
-- المهلة هي شبكة الأمان الوحيدة أمام خطأ بشري (أو حساب مشرف مخترَق)، لذا لا يُفتح هذا الباب
-- إلا بتأكيدات تفرضها القاعدة نفسها لا الواجهة، فلا يتجاوزها من يستدعي الدالة مباشرة:
--   1. مشرف حقيقي: في private.admins، وجلسة aal2، ورمز TOTP خلال 12 ساعة (private.require_admin).
--   2. رمز TOTP جديد: أُدخل خلال آخر دقيقتين (الواجهة تطلب رمزًا عند الضغط وتتحقّق منه قبل الاستدعاء).
--   3. كتابة بريد الحساب كاملًا كما هو (يُقارَن دون حساسية للحروف). يمنع حذف حساب بنقرة خاطئة.
--   4. سبب مكتوب (3 أحرف فأكثر).
--   5. لا مشرف ولا حساب المتصل نفسه.
--   6. حدّ ثلاثة حسابات في أي 24 ساعة، فحساب مشرف مخترَق لا يمحو الجميع.
-- ويُسجَّل في private.audit_log بالفعل admin_purge: من وما كان في الحساب (أعداد لا أسماء) وبريد مقنَّع
-- (لا بريد كاملًا: الحساب حُذف طلبًا للخصوصية فلا يبقى معرِّفه في السجلّ).
--
-- لا يمسّ هذا الحذف النسخ الاحتياطية: تبقى بيانات الحساب فيها حتى تُحذف نسخها (آخر 30 يومًا،
-- وأول نسخة من كل شهر لـ12 شهرًا). وهذا موثّق في الواجهة. لا يمسّ كذلك طريق الحذف بالمهلة.

alter table private.audit_log drop constraint if exists audit_log_action_check;
alter table private.audit_log
  add constraint audit_log_action_check check (action in (
    'disable', 'enable', 'cancel_deletion', 'request_deletion', 'purge',
    'set_term', 'set_backup', 'set_exams', 'admin_purge'));

create function public.admin_delete_account_now(
  target uuid,
  confirm_email text,
  reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_admin();
  why text := nullif(left(btrim(coalesce(reason, '')), 300), '');
  victim_email text;
  fresh timestamptz;
  recent integer;
  n_classes integer;
  n_students integer;
  n_records integer;
begin
  if target is null or confirm_email is null then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  if why is null or length(why) < 3 then
    raise exception 'reason required' using errcode = '22023';
  end if;
  if target = me or exists (select 1 from private.admins a where a.user_id = target) then
    raise exception 'cannot delete an admin account' using errcode = '42501';
  end if;

  -- رمز حديث: require_admin يقبل حتى 12 ساعة، وهذا الفعل لا رجعة فيه.
  fresh := private.mfa_verified_at();
  if fresh is null or fresh < now() - interval '2 minutes' then
    raise exception 'mfa_fresh_required' using errcode = '42501',
      hint = 'أدخل رمز التحقّق الثنائي الحالي';
  end if;

  -- قفل الحساب: لا يتغيّر بريده ولا يُحذف من جلسة أخرى أثناء الفحص.
  select u.email into victim_email from auth.users u where u.id = target for update;
  if not found then
    raise exception 'no such account' using errcode = 'P0002';
  end if;
  if lower(btrim(confirm_email)) <> lower(coalesce(victim_email, '')) or victim_email is null then
    raise exception 'confirm_mismatch' using errcode = '22023';
  end if;

  select count(*) into recent from private.audit_log
  where action = 'admin_purge' and at > now() - interval '24 hours';
  if recent >= 3 then
    raise exception 'rate_limited' using errcode = 'P0001',
      hint = 'ثلاثة حسابات كحدّ أقصى في 24 ساعة';
  end if;

  select count(*) into n_classes from public.classes where teacher_id = target;
  select count(*) into n_students from public.students where teacher_id = target;
  select count(*) into n_records from public.records where teacher_id = target;

  insert into private.audit_log (actor_kind, actor_id, action, target_id, detail)
  values ('admin', me, 'admin_purge', target,
    jsonb_build_object(
      'reason', why,
      'email_masked', left(split_part(victim_email, '@', 1), 1) || '***@' || split_part(victim_email, '@', 2),
      'classes', n_classes, 'students', n_students, 'records', n_records));

  -- الحذف التسلسلي نفسه الذي يستعمله الحذف الليلي: يمحو teachers وكل ما يتبعها وطلب الحذف.
  delete from auth.users where id = target;

  return jsonb_build_object('classes', n_classes, 'students', n_students, 'records', n_records);
end;
$$;

revoke all on function public.admin_delete_account_now(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_account_now(uuid, text, text) to authenticated;
