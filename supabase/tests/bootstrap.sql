-- أدوار ومخطّطات Supabase بالقدر الذي تحتاجه الاختبارات، بخصائص الإنتاج:
--   postgres: ليس superuser، وله BYPASSRLS وCREATEROLE (كما في الإنتاج).
--   auth: يملكه supabase_auth_admin، ولـ postgres عليه select/insert/update/delete.
-- يُشغَّل بدور supabase_admin (superuser المحلّي، كما في الإنتاج).

create role postgres login createrole bypassrls;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit;
create role supabase_auth_admin login createrole;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

grant create on database postgres to postgres;
grant all on schema public to postgres;
create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

create schema auth authorization supabase_auth_admin;
grant usage on schema auth to postgres, anon, authenticated, service_role;

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
alter function auth.uid() owner to supabase_auth_admin;
alter function auth.jwt() owner to supabase_auth_admin;
