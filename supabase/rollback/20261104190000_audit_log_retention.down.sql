-- التراجع عن 20261104190000: تُحذف الدالة وجدول الحجز، ويعود قيد الأفعال كما كان.
-- سطور trim_audit (عدد ما حُذف وتاريخه) لا تُحذف: تُحوَّل إلى purge مع أثرها في detail، كما فعل
-- تراجع purge_unconfirmed، فلا يضيع إثبات أن تقليمًا جرى.
drop function if exists private.trim_audit_log();
drop table if exists private.audit_hold;
update private.audit_log
  set action = 'purge', detail = detail || jsonb_build_object('was', 'trim_audit')
  where action = 'trim_audit';
alter table private.audit_log drop constraint if exists audit_log_action_check;
alter table private.audit_log
  add constraint audit_log_action_check check (action in (
    'disable', 'enable', 'cancel_deletion', 'request_deletion', 'purge',
    'set_term', 'set_backup', 'set_exams', 'admin_purge', 'purge_unconfirmed'));
