-- نسخة من بنية قاعدة الإنتاج لاختبار الترحيلات محليًّا.
-- وُلّدت في 2026-10-22 من كتالوج الإنتاج بقراءة فقط: بنية بلا بيانات.
-- auth: الجداول التي تمسّها الترحيلات فقط، بأعمدتها كما في الإنتاج.
-- يُطبَّق بدور postgres مطابق للإنتاج: ليس superuser، وله BYPASSRLS وCREATEROLE.
-- الفرق المعروف: الإنتاج Postgres 17.11، والاختبار المحلي 16؛ ولا خادم GoTrue ولا PostgREST هنا.

create type auth.factor_type as enum ('totp', 'webauthn', 'phone', 'recovery_code');
create type auth.factor_status as enum ('unverified', 'verified');
create type auth.aal_level as enum ('aal1', 'aal2', 'aal3');
create type public.criterion_kind as enum ('deduct', 'add', 'auto');

create sequence if not exists auth.refresh_tokens_id_seq;

create table public.class_groups (id uuid default gen_random_uuid() not null, teacher_id uuid not null, class_id uuid not null, name text, "position" smallint default 0 not null, created_at timestamp with time zone default now() not null);
create table public.classes (id uuid default gen_random_uuid() not null, teacher_id uuid not null, name text not null, level text, stream text, school_year text default '2026-2027'::text not null, "position" smallint default 0 not null, created_at timestamp with time zone default now() not null, school_id uuid, tp_target text);
create table public.components (id uuid default gen_random_uuid() not null, teacher_id uuid not null, code text not null, label text not null, weight numeric(5,2) default 1 not null, "position" smallint default 0 not null, active boolean default true not null);
create table public.criteria (id uuid default gen_random_uuid() not null, teacher_id uuid not null, code text not null, label text not null, kind public.criterion_kind default 'add'::public.criterion_kind not null, base numeric(5,2) default 0 not null, ceiling numeric(5,2) default 4 not null, "position" smallint default 0 not null);
create table public.readings (id uuid default gen_random_uuid() not null, teacher_id uuid not null, student_id uuid not null, term smallint not null, score numeric(4,2) not null, read_on date default CURRENT_DATE not null, note text, created_at timestamp with time zone default now() not null);
create table public.records (id uuid default gen_random_uuid() not null, teacher_id uuid not null, student_id uuid not null, term smallint not null, criteria jsonb default '{}'::jsonb not null, tp numeric(5,2), devoir numeric(5,2), exam numeric(5,2), updated_at timestamp with time zone default now() not null);
create table public.schools (id uuid default gen_random_uuid() not null, teacher_id uuid not null, name text not null, "position" smallint default 0 not null, created_at timestamp with time zone default now() not null);
create table public.students (id uuid default gen_random_uuid() not null, teacher_id uuid not null, class_id uuid not null, full_name text not null, "position" smallint default 0 not null, is_active boolean default true not null, created_at timestamp with time zone default now() not null, note text, tags text[] default '{}'::text[] not null, group_id uuid);
create table public.teachers (id uuid not null, full_name text default ''::text not null, subject text, school_name text, created_at timestamp with time zone default now() not null);
create table public.tp_marks (id uuid default gen_random_uuid() not null, teacher_id uuid not null, session_id uuid not null, student_id uuid not null, score numeric(4,2), absent boolean default false not null, updated_at timestamp with time zone default now() not null);
create table public.tp_sessions (id uuid default gen_random_uuid() not null, teacher_id uuid not null, class_id uuid not null, group_id uuid, term smallint not null, held_on date default CURRENT_DATE not null, title text, created_at timestamp with time zone default now() not null);

create table auth.identities (provider_id text not null, user_id uuid not null, identity_data jsonb not null, provider text not null, last_sign_in_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, email text generated always as (lower((identity_data ->> 'email'::text))) stored, id uuid default gen_random_uuid() not null);
create table auth.mfa_amr_claims (session_id uuid not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, authentication_method text not null, id uuid not null);
create table auth.mfa_factors (id uuid not null, user_id uuid not null, friendly_name text, factor_type auth.factor_type not null, status auth.factor_status not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, secret text, phone text, last_challenged_at timestamp with time zone, web_authn_credential jsonb, web_authn_aaguid uuid, last_webauthn_challenge_data jsonb);
create table auth.refresh_tokens (instance_id uuid, id bigint default nextval('auth.refresh_tokens_id_seq'::regclass) not null, token character varying(255), user_id character varying(255), revoked boolean, created_at timestamp with time zone, updated_at timestamp with time zone, parent character varying(255), session_id uuid);
create table auth.sessions (id uuid not null, user_id uuid not null, created_at timestamp with time zone, updated_at timestamp with time zone, factor_id uuid, aal auth.aal_level, not_after timestamp with time zone, refreshed_at timestamp without time zone, user_agent text, ip inet, tag text, oauth_client_id uuid, refresh_token_hmac_key text, refresh_token_counter bigint, scopes text);
create table auth.users (instance_id uuid, id uuid not null, aud character varying(255), role character varying(255), email character varying(255), encrypted_password character varying(255), email_confirmed_at timestamp with time zone, invited_at timestamp with time zone, confirmation_token character varying(255), confirmation_sent_at timestamp with time zone, recovery_token character varying(255), recovery_sent_at timestamp with time zone, email_change_token_new character varying(255), email_change character varying(255), email_change_sent_at timestamp with time zone, last_sign_in_at timestamp with time zone, raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin boolean, created_at timestamp with time zone, updated_at timestamp with time zone, phone text default NULL::character varying, phone_confirmed_at timestamp with time zone, phone_change text default ''::character varying, phone_change_token character varying(255) default ''::character varying, phone_change_sent_at timestamp with time zone, confirmed_at timestamp with time zone generated always as (LEAST(email_confirmed_at, phone_confirmed_at)) stored, email_change_token_current character varying(255) default ''::character varying, email_change_confirm_status smallint default 0, banned_until timestamp with time zone, reauthentication_token character varying(255) default ''::character varying, reauthentication_sent_at timestamp with time zone, is_sso_user boolean default false not null, deleted_at timestamp with time zone, is_anonymous boolean default false not null);

alter table auth.identities add constraint identities_pkey PRIMARY KEY (id);
alter table auth.mfa_amr_claims add constraint amr_id_pk PRIMARY KEY (id);
alter table auth.mfa_amr_claims add constraint mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);
alter table auth.mfa_factors add constraint mfa_factors_pkey PRIMARY KEY (id);
alter table auth.refresh_tokens add constraint refresh_tokens_pkey PRIMARY KEY (id);
alter table auth.sessions add constraint sessions_pkey PRIMARY KEY (id);
alter table auth.users add constraint users_pkey PRIMARY KEY (id);
alter table public.class_groups add constraint class_groups_id_class_key UNIQUE (id, class_id);
alter table public.class_groups add constraint class_groups_name_not_blank CHECK (((name IS NULL) OR (btrim(name) <> ''::text)));
alter table public.class_groups add constraint class_groups_pkey PRIMARY KEY (id);
alter table public.classes add constraint classes_pkey PRIMARY KEY (id);
alter table public.classes add constraint classes_tp_target_check CHECK (((tp_target IS NULL) OR (tp_target = 'component'::text) OR (tp_target ~~ 'criterion:%'::text)));
alter table public.components add constraint components_pkey PRIMARY KEY (id);
alter table public.components add constraint components_teacher_id_code_key UNIQUE (teacher_id, code);
alter table public.components add constraint components_weight_check CHECK ((weight >= (0)::numeric));
alter table public.criteria add constraint criteria_base_check CHECK ((base >= (0)::numeric));
alter table public.criteria add constraint criteria_ceiling_check CHECK ((ceiling > (0)::numeric));
alter table public.criteria add constraint criteria_pkey PRIMARY KEY (id);
alter table public.criteria add constraint criteria_teacher_id_code_key UNIQUE (teacher_id, code);
alter table public.readings add constraint readings_pkey PRIMARY KEY (id);
alter table public.readings add constraint readings_score_check CHECK ((score >= (0)::numeric));
alter table public.readings add constraint readings_term_check CHECK (((term >= 1) AND (term <= 3)));
alter table public.records add constraint records_devoir_check CHECK (((devoir >= (0)::numeric) AND (devoir <= (20)::numeric)));
alter table public.records add constraint records_exam_check CHECK (((exam >= (0)::numeric) AND (exam <= (20)::numeric)));
alter table public.records add constraint records_pkey PRIMARY KEY (id);
alter table public.records add constraint records_student_id_term_key UNIQUE (student_id, term);
alter table public.records add constraint records_term_check CHECK (((term >= 1) AND (term <= 3)));
alter table public.records add constraint records_tp_check CHECK (((tp >= (0)::numeric) AND (tp <= (20)::numeric)));
alter table public.schools add constraint schools_pkey PRIMARY KEY (id);
alter table public.students add constraint students_pkey PRIMARY KEY (id);
alter table public.teachers add constraint teachers_pkey PRIMARY KEY (id);
alter table public.tp_marks add constraint tp_marks_absent_has_no_score CHECK (((NOT absent) OR (score IS NULL)));
alter table public.tp_marks add constraint tp_marks_pkey PRIMARY KEY (id);
alter table public.tp_marks add constraint tp_marks_score_check CHECK (((score IS NULL) OR ((score >= (0)::numeric) AND (score <= (20)::numeric))));
alter table public.tp_marks add constraint tp_marks_session_student_key UNIQUE (session_id, student_id);
alter table public.tp_sessions add constraint tp_sessions_pkey PRIMARY KEY (id);
alter table public.tp_sessions add constraint tp_sessions_term_check CHECK (((term >= 1) AND (term <= 3)));
alter table public.tp_sessions add constraint tp_sessions_title_not_blank CHECK (((title IS NULL) OR (btrim(title) <> ''::text)));
alter table auth.identities add constraint identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table auth.mfa_amr_claims add constraint mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;
alter table auth.mfa_factors add constraint mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table auth.refresh_tokens add constraint refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;
alter table auth.sessions add constraint sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.class_groups add constraint class_groups_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;
alter table public.class_groups add constraint class_groups_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
alter table public.classes add constraint classes_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE SET NULL;
alter table public.classes add constraint classes_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
alter table public.components add constraint components_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
alter table public.criteria add constraint criteria_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
alter table public.readings add constraint readings_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
alter table public.readings add constraint readings_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
alter table public.records add constraint records_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
alter table public.records add constraint records_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
alter table public.schools add constraint schools_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
alter table public.students add constraint students_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;
alter table public.students add constraint students_group_fkey FOREIGN KEY (group_id, class_id) REFERENCES public.class_groups(id, class_id) ON DELETE SET NULL (group_id);
alter table public.students add constraint students_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
alter table public.teachers add constraint teachers_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.tp_marks add constraint tp_marks_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.tp_sessions(id) ON DELETE CASCADE;
alter table public.tp_marks add constraint tp_marks_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
alter table public.tp_marks add constraint tp_marks_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
alter table public.tp_sessions add constraint tp_sessions_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;
alter table public.tp_sessions add constraint tp_sessions_group_fkey FOREIGN KEY (group_id, class_id) REFERENCES public.class_groups(id, class_id) ON DELETE SET NULL (group_id);
alter table public.tp_sessions add constraint tp_sessions_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.delete_my_account()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  insert into public.teachers (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.seed_teacher()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  insert into public.criteria (teacher_id, code, label, kind, base, ceiling, position) values
    (new.id,'disc','الانضباط','deduct',4,4,1),
    (new.id,'tool','الأدوات','deduct',4,4,2),
    (new.id,'part','المشاركة','add',0,4,3),
    (new.id,'hw','الواجبات','add',0,4,4),
    (new.id,'read','قراءة المحاولات','auto',0,4,5);
  insert into public.components (teacher_id, code, label, weight, position) values
    (new.id,'cc','التقويم المستمر',1,1),
    (new.id,'tp','الأعمال التطبيقية',1,2),
    (new.id,'devoir','الفرض',1,3),
    (new.id,'exam','الاختبار',2,4);
  return new;
end $function$;

CREATE TRIGGER trg_seed_teacher AFTER INSERT ON public.teachers FOR EACH ROW EXECUTE FUNCTION public.seed_teacher();
CREATE TRIGGER trg_handle_new_user AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

do $$ declare t text; begin
  foreach t in array array['students','components','teachers','criteria','records','classes','readings','class_groups','tp_sessions','tp_marks','schools'] loop
    execute format('alter table public.%I enable row level security', t);
    -- كما في الإنتاج: كل الصلاحيات للأدوار الثلاثة، وRLS هي ما يحمي.
    execute format('grant all on public.%I to anon, authenticated, service_role', t);
  end loop;
end $$;

create policy own_rows on public.class_groups as permissive for all to public using ((teacher_id = ( SELECT auth.uid() AS uid))) with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy own_rows on public.classes as permissive for all to authenticated using ((teacher_id = ( SELECT auth.uid() AS uid))) with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy own_rows on public.components as permissive for all to authenticated using ((teacher_id = ( SELECT auth.uid() AS uid))) with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy own_rows on public.criteria as permissive for all to authenticated using ((teacher_id = ( SELECT auth.uid() AS uid))) with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy own_rows on public.readings as permissive for all to authenticated using ((teacher_id = ( SELECT auth.uid() AS uid))) with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy own_rows on public.records as permissive for all to authenticated using ((teacher_id = ( SELECT auth.uid() AS uid))) with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy own_rows on public.schools as permissive for all to public using ((teacher_id = ( SELECT auth.uid() AS uid))) with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy own_rows on public.students as permissive for all to authenticated using ((teacher_id = ( SELECT auth.uid() AS uid))) with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy own_profile on public.teachers as permissive for all to authenticated using ((id = ( SELECT auth.uid() AS uid))) with check ((id = ( SELECT auth.uid() AS uid)));
create policy own_rows on public.tp_marks as permissive for all to public using ((teacher_id = ( SELECT auth.uid() AS uid))) with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy own_rows on public.tp_sessions as permissive for all to public using ((teacher_id = ( SELECT auth.uid() AS uid))) with check ((teacher_id = ( SELECT auth.uid() AS uid)));

revoke all on function public.delete_my_account() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.seed_teacher() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.delete_my_account() to service_role;
grant execute on function public.handle_new_user() to service_role;
grant execute on function public.seed_teacher() to service_role;
