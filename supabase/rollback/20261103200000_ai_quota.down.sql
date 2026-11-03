-- التراجع عن 20261103200000: تُحذف الدالة والجدول. ما فيه عدّادات أيام لا علامات.
-- الخادم إن لم يجد الدالة (PGRST202) قرأ بلا حدّ كما كان قبل الترحيل.
drop function if exists public.consume_ai_quota(text);
drop table if exists private.ai_usage;
