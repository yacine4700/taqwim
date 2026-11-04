-- مدة سجلّ العمليات: سنة واحدة (قرار صاحب المشروع، 4 نوفمبر 2026)، كما تعلنه /privacy.
--
-- ما يضيفه:
--   * private.audit_hold: حجز يدوي يمنع حذف سطور حساب بعينه (تحقيق في حادثة أمنية، نزاع، طلب
--     جهة مختصّة). يُضاف ويُرفع بـ SQL من صاحب المشروع وحده، بسبب إلزامي وتاريخ انتهاء.
--   * private.trim_audit_log(): تحذف ما مضى عليه أكثر من سنة، إلا المستثنى أدناه، وتسجّل في
--     السجلّ نفسه سطرًا بعدد ما حذفت. المدة ثابتة في الدالة، لا معامل يُمرَّر: لا يستطيع المتصل
--     أن يقصّرها فيمحو سجلًّا حديثًا.
--   * صلاحية تشغيلها لدور taqwim_purger (التشغيل الليلي بعد نسخة سليمة). لا صلاحية أخرى.
--
-- ما يُحذف بعد سنة: كل أنواع السطور (disable، enable، cancel_deletion، request_deletion، purge،
-- admin_purge، purge_unconfirmed، set_term، set_backup، set_exams، trim_audit)، إلا:
--   1. سطور حساب تحت حجز ساري (target_id أو actor_id في audit_hold).
--   2. سطور حساب له طلب حذف قائم لم يُنفَّذ: إثبات الطلب يبقى ما بقي الطلب.
--   3. سطور حساب موقوف الآن: سبب الإيقاف يبقى ما بقي الإيقاف.
--
-- ما لا يمسّه: جداول التطبيق وسياساتها، ودوال الحذف القائمة، وما سواها من السجلّ.
-- ولا يحذف من النسخ الاحتياطية: ما حُذف هنا يبقى في النسخ السابقة حتى تنقضي مدّتها (نحو 13 شهرًا).
--
-- لا يعمل وحده: يناديه scripts/purge.sh في taqwim-ops بعد الحذف الليلي (تعديل منفصل).

alter table private.audit_log drop constraint if exists audit_log_action_check;
alter table private.audit_log
  add constraint audit_log_action_check check (action in (
    'disable', 'enable', 'cancel_deletion', 'request_deletion', 'purge',
    'set_term', 'set_backup', 'set_exams', 'admin_purge', 'purge_unconfirmed',
    'trim_audit'));

create table private.audit_hold (
  target_id uuid primary key,
  reason    text not null check (length(btrim(reason)) >= 5),
  added_at  timestamptz not null default now(),
  until     timestamptz not null,
  check (until > added_at)
);
revoke all on private.audit_hold from public, anon, authenticated, service_role;
comment on table private.audit_hold is
  'حجز يمنع trim_audit_log من حذف سطور حساب (تحقيق أمني أو نزاع). يُدار بـ SQL من صاحب المشروع وحده.';

create function private.trim_audit_log()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff constant timestamptz := now() - interval '1 year';
  n integer;
begin
  with gone as (
    delete from private.audit_log l
    where l.at < cutoff
      and not exists (
        select 1 from private.audit_hold h
        where h.until > now() and h.target_id in (l.target_id, l.actor_id))
      and not exists (
        select 1 from private.deletion_requests d where d.user_id = l.target_id)
      and not exists (
        select 1 from auth.users u
        where u.id = l.target_id and u.banned_until is not null and u.banned_until > now())
    returning 1
  )
  select count(*) into n from gone;

  if n > 0 then
    insert into private.audit_log (actor_kind, action, detail)
    values ('system', 'trim_audit', jsonb_build_object('deleted', n, 'older_than', cutoff));
  end if;
  return n;
end;
$$;

revoke all on function private.trim_audit_log() from public, anon, authenticated, service_role;
grant execute on function private.trim_audit_log() to taqwim_purger;

comment on function private.trim_audit_log() is
  'يحذف من private.audit_log ما مضى عليه أكثر من سنة، إلا سطور حساب محجوز أو له طلب حذف قائم أو موقوف الآن.';
