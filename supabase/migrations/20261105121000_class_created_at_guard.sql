-- حماية classes.created_at من الأستاذ. (مسوّدة للمراجعة: غير مطبَّقة في أي قاعدة.)
--
-- المشكلة: قفل التنقيط في السنة المنتهية والحذف السنوي كلاهما يحسبان سنة القسم من created_at، وهو عمود
-- يكتبه أي أستاذ (grant all + own_rows على teacher_id وحده). فـ UPDATE classes SET created_at = now()
-- يعيد فتح قسم مقفل ويُخرجه من الحذف، وإدراج قسم بتاريخ قديم يقدّم حذفه.
--
-- الحل: محفّز على classes، يسري على دوري العميل (anon وauthenticated) وحدهما:
--   * INSERT: created_at = now() دائمًا، فيُتجاهل ما يرسله العميل (التطبيق لا يرسله أصلًا).
--   * UPDATE: تغيير created_at مرفوض بـ 42501. والتحديث الذي لا يغيّره يمرّ.
-- لا أثر على غير العميل، فلا يتغيّر:
--   * الاستعادة: data.sql يعمل بـ session_replication_role = replica، والمحفّزات العادية لا تُطلَق فيه،
--     ودور التنفيذ postgres لا يخضع للمحفّز أصلًا.
--   * الصيانة بدور الخادم (postgres وservice_role وsupabase_admin وtaqwim_purger): تصحيح تاريخ قسم يبقى ممكنًا.
--   * اختبارات الترحيلات القائمة، وهي تقدّم created_at بدور الخادم.
-- SECURITY INVOKER عن قصد: current_user يجب أن يبقى دور العميل (authenticated)، ولو كانت DEFINER لرأت
-- المالك دائمًا. ولا يلزم لها EXECUTE عند الإطلاق: الصلاحية على دالة المحفّز تُفحص عند CREATE TRIGGER فقط.
-- نقل تلميذ بتعديل class_id إلى قسم أحدث يجتاز القفل بطريقة أخرى: خارج هذا الترحيل (انظر التقرير).

create function private.guard_class_created_at() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
  elsif new.created_at is distinct from old.created_at then
    raise exception 'classes.created_at is server-managed' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function private.guard_class_created_at() from public, anon, authenticated, service_role;

create trigger trg_guard_class_created_at
  before insert or update of created_at on public.classes
  for each row execute function private.guard_class_created_at();
