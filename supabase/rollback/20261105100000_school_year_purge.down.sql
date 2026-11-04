-- تراجع 20261105100000_school_year_purge: يزيل القفل والدوال ويعيد قائمة أفعال السجلّ.
-- لا يمسّ بيانات الأساتذة. ويرفض التراجع إن وُجدت سطور year_purge في السجلّ: السجلّ لا يُحذف
-- منه شيء بقرار آلي، فيُقرَّر أمرها يدويًّا (تحويلها أو الإبقاء على الفعل) قبل التراجع.
do $$
begin
  if exists (select 1 from private.audit_log where action = 'year_purge') then
    raise exception 'year_purge rows exist in private.audit_log: decide their fate before rolling back';
  end if;
end $$;

drop function if exists public.my_year_notice();
drop function if exists private.purge_old_school_years(bigint, integer);
drop function if exists private.purge_old_school_years_at(date, bigint, integer);

drop trigger if exists trg_guard_year_write on public.records;
drop trigger if exists trg_guard_year_write on public.readings;
drop trigger if exists trg_guard_year_write on public.tp_sessions;
drop trigger if exists trg_guard_year_write on public.tp_marks;
drop function if exists private.guard_year_write();
drop function if exists private.class_year_closed(uuid);
drop function if exists private.school_year_of(date);

alter table private.audit_log drop constraint if exists audit_log_action_check;
alter table private.audit_log
  add constraint audit_log_action_check check (action in (
    'disable', 'enable', 'cancel_deletion', 'request_deletion', 'purge',
    'set_term', 'set_backup', 'set_exams', 'admin_purge', 'purge_unconfirmed',
    'trim_audit'));
