-- التراجع عن 20261022130000_admin_and_deletion_grace.
--
-- ما لا يعود كما كان (اقرأ قبل التشغيل):
--   1. طلبات الحذف المعلّقة تُلغى: أصحابها يبقون أساتذة نشطين ولا تُحذف حساباتهم.
--   2. سجلّ العمليات (private.audit_log) وقائمة المشرفين يُحذفان. إن احتجتهما فانسخهما
--      أولًا (select * from private.audit_log) — النسخ الليلية لا تشملهما إلا بعد
--      إضافة private إلى التصدير.
--   3. الحسابات التي أوقفها المشرف: يُرفع عنها الإيقاف هنا (banned_until = null)، لأنه
--      لن تبقى أداة لرفعه بعد التراجع. أما الجلسات التي حُذفت عند الإيقاف فلا تعود:
--      يدخل أصحابها من جديد.
--   4. الحسابات التي حُذفت نهائيًّا بعد انتهاء مهلتها لا تعود بالتراجع؛ مصدرها النسخ.
--   5. delete_my_account تعود متاحة: الحذف يصير فوريًّا كما كان.
--
-- حاجز: لا يعمل إن وُجدت طلبات حذف معلّقة أو حسابات موقوفة، إلا إذا ضُبط قبل التشغيل:
--   set taqwim.rollback_confirm = 'yes';

do $$
declare
  pending integer;
  disabled integer;
begin
  select count(*) into pending from private.deletion_requests;
  select count(*) into disabled
  from auth.users u
  where u.banned_until > now()
    and (select l.action from private.audit_log l
         where l.target_id = u.id and l.action in ('disable', 'enable')
         order by l.id desc limit 1) = 'disable';

  if (pending > 0 or disabled > 0)
     and coalesce(current_setting('taqwim.rollback_confirm', true), '') <> 'yes' then
    raise exception 'rollback blocked: % pending deletion request(s), % disabled account(s). Read the header, then set taqwim.rollback_confirm = ''yes''.',
      pending, disabled;
  end if;

  -- رفع الإيقاف عمّن أوقفه المشرف فقط (لا من أوقفته لوحة Supabase لسبب آخر).
  update auth.users u set banned_until = null
  where u.banned_until > now()
    and (select l.action from private.audit_log l
         where l.target_id = u.id and l.action in ('disable', 'enable')
         order by l.id desc limit 1) = 'disable';
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['teachers', 'schools', 'classes', 'class_groups', 'students',
                           'criteria', 'components', 'records', 'readings',
                           'tp_sessions', 'tp_marks'] loop
    execute format('drop policy if exists guard_read on public.%I', t);
    execute format('drop policy if exists guard_insert on public.%I', t);
    execute format('drop policy if exists guard_update on public.%I', t);
    execute format('drop policy if exists guard_delete on public.%I', t);
  end loop;
end $$;

drop function if exists public.request_account_deletion();
drop function if exists public.cancel_account_deletion();
drop function if exists public.my_account_status();
drop function if exists public.admin_list_teachers();
drop function if exists public.admin_set_disabled(uuid, boolean);
drop function if exists public.admin_cancel_deletion(uuid);
drop function if exists public.admin_log_recent(integer);

revoke all on schema private from taqwim_purger;
revoke all on function private.purge_deleted_accounts(integer) from taqwim_purger;
drop role if exists taqwim_purger;

drop schema private cascade;

grant execute on function public.delete_my_account() to authenticated;
