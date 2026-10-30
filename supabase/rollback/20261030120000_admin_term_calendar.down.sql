-- التراجع عن 20261030120000_admin_term_calendar.
-- يُزال تعديل الرزنامة من لوحة المشرف فقط. الرزنامة وما فيها من تواريخ تبقى كما هي،
-- وسجلّ التعديلات السابقة (set_term) يبقى، فلا يُضيَّق قيد الأفعال في السجلّ.
drop function if exists public.admin_set_term(text, integer, date, date, integer, text);
