-- التراجع عن 20261101100000: تُزال دالتا المشرف ودالة التعريف. ما حُذف بها قبل التراجع لا يعود
-- (حسابات بلا بيانات). سطور السجلّ purge_unconfirmed تُحوَّل إلى purge ويبقى تفصيلها ثم يُعاد القيد السابق.
drop function if exists public.admin_purge_unconfirmed(integer);
drop function if exists public.admin_unconfirmed_accounts();
drop function if exists private.stale_unconfirmed(interval);

alter table private.audit_log drop constraint if exists audit_log_action_check;
update private.audit_log
  set action = 'purge', detail = detail || '{"was":"purge_unconfirmed"}'::jsonb
  where action = 'purge_unconfirmed';
alter table private.audit_log
  add constraint audit_log_action_check check (action in (
    'disable', 'enable', 'cancel_deletion', 'request_deletion', 'purge',
    'set_term', 'set_backup', 'set_exams', 'admin_purge'));
