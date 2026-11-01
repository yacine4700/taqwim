-- التراجع عن 20261101100000: يعود الحذف الليلي إلى تعريف 20261022130000 بلا تنظيف
-- غير المؤكَّدين، وتُزال دالة التنظيف. ما حُذف قبل التراجع لا يعود (حسابات بلا بيانات).
-- سطور السجلّ purge_unconfirmed تُحوَّل إلى purge ويبقى تفصيلها، ثم يُعاد القيد السابق.
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
  if n > max_accounts then
    raise exception 'refusing to purge % accounts (limit %)', n, max_accounts using errcode = 'P0001';
  end if;

  insert into private.audit_log (actor_kind, action, target_id, detail)
  select 'system', 'purge', x, jsonb_build_object('requested_at', d.requested_at, 'purge_after', d.purge_after)
  from unnest(due) x join private.deletion_requests d on d.user_id = x;

  delete from auth.users where id = any(due);
  return n;
end;
$$;

drop function if exists private.purge_unconfirmed_accounts(interval, integer);

alter table private.audit_log drop constraint if exists audit_log_action_check;
update private.audit_log
  set action = 'purge', detail = detail || '{"was":"purge_unconfirmed"}'::jsonb
  where action = 'purge_unconfirmed';
alter table private.audit_log
  add constraint audit_log_action_check check (action in (
    'disable', 'enable', 'cancel_deletion', 'request_deletion', 'purge',
    'set_term', 'set_backup', 'set_exams', 'admin_purge'));
