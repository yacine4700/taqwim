-- منع الأستاذ من تغيير students.class_id بعد إنشاء التلميذ. (مسوّدة للمراجعة: غير مطبَّقة في أي قاعدة.)
--
-- المشكلة: قفل التنقيط في السنة المنتهية والحذف السنوي يحسبان سنة التلميذ من قسمه الحالي. فمن عدّل
-- class_id لتلاميذ قسم قديم إلى قسم جارٍ نقل معهم سجلاتهم وقراءاتهم وعلاماتهم (كلها مفتاحها التلميذ لا
-- القسم) إلى قسم مفتوح: فتح الكتابة عليها وأخرجها من الحذف السنوي. وحتى نقل بين قسمين للأستاذ نفسه يخلط
-- حصص tp_marks وأقسام التلاميذ التي يشترطها ترحيل الملكية.
--
-- التطبيق لا ينقل تلميذًا أصلًا (فُحص كل مسار كتابة في الشيفرة، انظر التقرير): نقل الأسماء ينشئ قسمًا
-- وتلاميذ جددًا بمعرّفات جديدة ولا يلمس القديمين. فالمنع لا يكسر وظيفة.
--
-- الحل: محفّز BEFORE UPDATE OF class_id على students، يسري على دوري العميل (anon وauthenticated) وحدهما:
--   * الإدراج والحذف وتعديل بقية الحقول (الاسم، الملاحظة، الوسوم، الفوج، الترتيب...) كما هي.
--   * أي UPDATE تغيّر فيه class_id (IS DISTINCT FROM) يُرفض بـ 42501. وتعيينه إلى قيمته نفسها يمرّ.
--   * أدوار الخادم (postgres وservice_role وsupabase_admin وtaqwim_purger) لا تتأثر، فتصحيح يدوي ممكن.
--   * الاستعادة: data.sql يعمل بـ session_replication_role = replica فلا تُطلَق المحفّزات العادية.
--     وهي إدراج لا تعديل أصلًا.
--   * الحذف المتتالي وon delete set null (group_id) لا يمسّان class_id، ويعملان بصلاحية المالك.
-- SECURITY INVOKER عن قصد (كما في guard_class_created_at): current_user يجب أن يبقى دور العميل.

create function private.guard_student_class_id() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     and new.class_id is distinct from old.class_id then
    raise exception 'students.class_id is immutable' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function private.guard_student_class_id() from public, anon, authenticated, service_role;

create trigger trg_guard_student_class_id
  before update of class_id on public.students
  for each row execute function private.guard_student_class_id();
