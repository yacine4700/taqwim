-- بيانات اختبار وأدوات التحقّق. يُشغَّل بدور supabase_admin قبل الترحيل.
-- ثلاثة حسابات: أستاذان (A وB) وحساب المشرف (M). يُنشأ الحساب كما يفعل Supabase Auth:
-- صفّ في auth.users، ومحفّز handle_new_user يُنشئ teachers، وseed_teacher المعايير.

insert into auth.users (id, email, encrypted_password, raw_user_meta_data, created_at, aud, role)
values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'a@school.dz', 'x', '{"full_name":"أستاذ أ"}', now() - interval '30 days', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'b@school.dz', 'x', '{"full_name":"أستاذة ب"}', now() - interval '20 days', 'authenticated', 'authenticated'),
  ('eeeeeeee-0000-4000-8000-00000000000e', 'admin@school.dz', 'x', '{"full_name":"المشرف"}', now() - interval '1 day', 'authenticated', 'authenticated');

do $$
declare
  t uuid;
  sc uuid; cl uuid; g uuid; st uuid; ses uuid;
  i int;
begin
  foreach t in array array['aaaaaaaa-0000-4000-8000-00000000000a'::uuid, 'bbbbbbbb-0000-4000-8000-00000000000b'::uuid] loop
    insert into public.schools (teacher_id, name) values (t, 'ثانوية ' || left(t::text, 1)) returning id into sc;
    insert into public.classes (teacher_id, name, school_id) values (t, '1 ج م ع', sc) returning id into cl;
    insert into public.class_groups (teacher_id, class_id, name) values (t, cl, 'الفوج 1') returning id into g;
    insert into public.tp_sessions (teacher_id, class_id, group_id, term) values (t, cl, g, 1) returning id into ses;
    for i in 1..3 loop
      insert into public.students (teacher_id, class_id, full_name, group_id)
      values (t, cl, 'تلميذ ' || left(t::text, 1) || i, g) returning id into st;
      insert into public.records (teacher_id, student_id, term, criteria, devoir) values (t, st, 1, '{"part":3}', 12 + i);
      insert into public.readings (teacher_id, student_id, term, score) values (t, st, 1, 2.5);
      insert into public.tp_marks (teacher_id, session_id, student_id, score) values (t, ses, st, 14);
    end loop;
  end loop;
end $$;

-- هويات الدخول كما ينشئها Supabase Auth للتسجيل بالبريد (لاختبار نسخها واستعادتها).
insert into auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at)
select gen_random_uuid(), u.id, 'email', u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), u.created_at, u.created_at
from auth.users u;

-- جلسات: A بكلمة مرور قبل دقيقتين، وA بكلمة مرور قبل 11 دقيقة، وB حديثة، وM.
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  ('5e550000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-00000000000a', now(), now(), 'aal1'),
  ('5e550000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-00000000000a', now(), now(), 'aal1'),
  ('5e550000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-00000000000b', now(), now(), 'aal1'),
  ('5e550000-0000-4000-8000-0000000000e1', 'eeeeeeee-0000-4000-8000-00000000000e', now(), now(), 'aal2');
insert into auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method) values
  (gen_random_uuid(), '5e550000-0000-4000-8000-0000000000a1', now() - interval '2 minutes', now() - interval '2 minutes', 'password'),
  (gen_random_uuid(), '5e550000-0000-4000-8000-0000000000a2', now() - interval '11 minutes', now() - interval '11 minutes', 'password'),
  (gen_random_uuid(), '5e550000-0000-4000-8000-0000000000b1', now() - interval '1 minute', now() - interval '1 minute', 'password'),
  (gen_random_uuid(), '5e550000-0000-4000-8000-0000000000e1', now() - interval '3 minutes', now() - interval '3 minutes', 'password'),
  (gen_random_uuid(), '5e550000-0000-4000-8000-0000000000e1', now() - interval '2 minutes', now() - interval '2 minutes', 'totp');

-- ---------------------------------------------------------------------------
-- أدوات الاختبار
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to public;
create table tests.results (n serial primary key, label text not null, ok boolean not null, detail text);
grant select, insert on tests.results to public;
grant usage on sequence tests.results_n_seq to public;

-- ما ترسله PostgREST بعد التحقّق من توقيع JWT.
create function tests.claims(uid uuid, sid uuid default null, aal text default 'aal1')
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', uid, 'role', 'authenticated', 'aal', aal, 'session_id', sid))::text,
    false);
$$;

create function tests.ok(label text, cond boolean, detail text default null)
returns void language sql as $$
  insert into tests.results (label, ok, detail) values (label, coalesce(cond, false), detail);
$$;

-- يجب أن يفشل الأمر بحالة SQLSTATE المحدّدة. ما نفّذه يُلغى (subtransaction).
create function tests.fails(label text, stmt text, state text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    insert into tests.results (label, ok, detail)
    values (label, sqlstate = state, sqlstate || ': ' || sqlerrm);
    return;
  end;
  insert into tests.results (label, ok, detail) values (label, false, 'نجح ولم يكن يجب');
end $$;

create function tests.val(stmt text)
returns text language plpgsql as $$
declare v text;
begin
  execute stmt into v;
  return v;
end $$;

-- بصمة كل بيانات أستاذ (بدور superuser، فلا RLS).
create function tests.fp(uid uuid)
returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(t::text, ',' order by t::text) from public.teachers t where id = uid),
    (select string_agg(t::text, ',' order by t::text) from public.schools t where teacher_id = uid),
    (select string_agg(t::text, ',' order by t::text) from public.classes t where teacher_id = uid),
    (select string_agg(t::text, ',' order by t::text) from public.class_groups t where teacher_id = uid),
    (select string_agg(t::text, ',' order by t::text) from public.students t where teacher_id = uid),
    (select string_agg(t::text, ',' order by t::text) from public.criteria t where teacher_id = uid),
    (select string_agg(t::text, ',' order by t::text) from public.components t where teacher_id = uid),
    (select string_agg(t::text, ',' order by t::text) from public.records t where teacher_id = uid),
    (select string_agg(t::text, ',' order by t::text) from public.readings t where teacher_id = uid),
    (select string_agg(t::text, ',' order by t::text) from public.tp_sessions t where teacher_id = uid),
    (select string_agg(t::text, ',' order by t::text) from public.tp_marks t where teacher_id = uid)));
$$;

create function tests.rows_of(uid uuid)
returns integer language sql as $$
  select (select count(*) from public.teachers where id = uid)::int
       + (select count(*) from public.schools where teacher_id = uid)::int
       + (select count(*) from public.classes where teacher_id = uid)::int
       + (select count(*) from public.class_groups where teacher_id = uid)::int
       + (select count(*) from public.students where teacher_id = uid)::int
       + (select count(*) from public.criteria where teacher_id = uid)::int
       + (select count(*) from public.components where teacher_id = uid)::int
       + (select count(*) from public.records where teacher_id = uid)::int
       + (select count(*) from public.readings where teacher_id = uid)::int
       + (select count(*) from public.tp_sessions where teacher_id = uid)::int
       + (select count(*) from public.tp_marks where teacher_id = uid)::int;
$$;

-- بنية public كما تراها التطبيقات: للمقارنة قبل الترحيل وبعد التراجع.
create function tests.structure()
returns text language sql as $$
  select (concat_ws(E'\n#\n',
    (select string_agg(concat_ws(':', tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' order by tablename, policyname) from pg_policies where schemaname = 'public'),
    (select string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce((select string_agg(x::text, ',' order by x::text) from unnest(p.proacl) x), ''), E'\n' order by p.oid::regprocedure::text) from pg_proc p where p.pronamespace = 'public'::regnamespace),
    (select string_agg(concat_ws(':', table_name, grantee, privilege_type), E'\n' order by table_name, grantee, privilege_type) from information_schema.role_table_grants where table_schema = 'public'),
    (select string_agg(nspname, ',' order by nspname) from pg_namespace where nspname not like 'pg_%'),
    (select string_agg(rolname, ',' order by rolname) from pg_roles where rolname not like 'pg_%')));
$$;
