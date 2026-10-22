-- بعد prod-schema.sql: الملكيّات كما في الإنتاج.
do $$
declare r record;
begin
  for r in select c.oid::regclass as t from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'S') loop
    execute format('alter table %s owner to postgres', r.t);
  end loop;
  for r in select c.oid::regclass as t from pg_class c
           where c.relnamespace = 'auth'::regnamespace and c.relkind in ('r', 'S') loop
    execute format('alter table %s owner to supabase_auth_admin', r.t);
  end loop;
end $$;
alter type public.criterion_kind owner to postgres;
alter function public.delete_my_account() owner to postgres;
alter function public.handle_new_user() owner to postgres;
alter function public.seed_teacher() owner to postgres;
-- كما في الإنتاج (aclexplode على auth.*): كل الصلاحيات عدا MAINTAIN غير الموجودة في 16.
grant all on all tables in schema auth to postgres;
grant all on all sequences in schema auth to postgres;  -- التصدير الليلي في الإنتاج يقرأ هذا التسلسل بدور postgres

-- الصلاحيات الافتراضية كما في الإنتاج (pg_default_acl): كل دالة أو جدول جديد في
-- public يصير مفتوحًا لـ anon وauthenticated وservice_role ما لم يُسحب صراحةً.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
