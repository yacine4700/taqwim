-- التراجع عن 20261030170000: تُزال دالة الحذف الفوري. ما حُذف بها لا يُستعاد إلا من نسخة احتياطية.
-- سطور السجلّ admin_purge السابقة تبقى، فلا يُضيَّق قيد الأفعال.
drop function if exists public.admin_delete_account_now(uuid, text, text);
