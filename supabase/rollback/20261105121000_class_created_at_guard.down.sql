-- تراجع 20261105121000_class_created_at_guard: يزيل المحفّز والدالة. لا يمسّ بيانات.
drop trigger if exists trg_guard_class_created_at on public.classes;
drop function if exists private.guard_class_created_at();
