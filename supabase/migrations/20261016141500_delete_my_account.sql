-- حذف الأستاذ لحسابه بنفسه.
--
-- كل جداول التطبيق مرتبطة بحذف تسلسلي: auth.users ← teachers ← (schools,
-- classes, students, criteria, components, records, readings). فحذف صف الحساب
-- وحده يمحو كل ما يخصّه ولا يترك يتيمًا.
--
-- الدالة SECURITY DEFINER لأن الأستاذ لا يملك صلاحية على auth.users، لكنها
-- لا تقبل معرّفًا من المتصل: تحذف auth.uid() وحده، فلا يستطيع بها أحد حذف
-- غير نفسه. وsearch_path فارغ حتى لا تُحلّ أسماء الجداول إلى مخطّط يضعه مهاجم.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
