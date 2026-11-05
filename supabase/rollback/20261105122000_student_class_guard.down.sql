-- تراجع 20261105122000_student_class_guard: يزيل المحفّز والدالة فيعود تعديل class_id كما كان. لا يمسّ بيانات.
drop trigger if exists trg_guard_student_class_id on public.students;
drop function if exists private.guard_student_class_id();
