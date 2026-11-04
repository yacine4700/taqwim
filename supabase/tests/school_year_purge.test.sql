-- اختبارات ترحيل 20261105100000 (قفل التنقيط في السنوات المنتهية + الحذف السنوي المحمي).
-- يُشغَّل بدور supabase_admin بعد ترحيلات المشرف والرزنامة ومدة السجلّ وهذا الترحيل، وبعد seed.sql.
-- كل التواريخ نسبة إلى السنة الدراسية الجارية (y) بتوقيت الجزائر، فلا يتعلّق الاختبار بتاريخ تشغيله.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set B '''bbbbbbbb-0000-4000-8000-00000000000b'''

truncate tests.results;

select private.school_year_of((now() at time zone 'Africa/Algiers')::date) as y \gset
select set_config('tests.a', :A, false), set_config('tests.b', :B, false);

-- نتيجة أمر: 'ok' أو رمز الخطأ ونصّه
create function tests.yr_try(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok';
exception when others then return sqlstate || ' ' || sqlerrm; end $$;

-- بصمة كل جداول التنقيط الأربعة
create function tests.yr_fp() returns text language sql as $$
  select md5(string_agg(t, '' order by t)) from (
    select r::text t from public.records r union all select g::text from public.readings g
    union all select s::text from public.tp_sessions s union all select m::text from public.tp_marks m) x
$$;

-- رزنامة فارغة: كل الفصول مفتوحة (term_open)، فلا يتعلّق الاختبار بقفل الفصل
create function tests.yr_cal() returns void language sql as $$ delete from public.term_calendar $$;
select tests.yr_cal();

-- قسم كامل: مجموعة وحصتان وتلاميذ، لكل تلميذ تنقيط وقراءة وعلامة عمل تطبيقي. يُنشأ والسنة جارية
-- (بدور الخادم) ثم يُقدَّم created_at، فلا يعترض القفل إنشاءه.
create function tests.yr_mkclass(teacher uuid, nm text, created timestamptz, n int) returns uuid
language plpgsql as $$
declare cl uuid := gen_random_uuid(); g uuid := gen_random_uuid(); s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid();
        st uuid; i int;
begin
  insert into public.classes (id, teacher_id, name) values (cl, teacher, nm);
  insert into public.class_groups (id, teacher_id, class_id, name) values (g, teacher, cl, 'فوج');
  insert into public.tp_sessions (id, teacher_id, class_id, group_id, term) values (s1, teacher, cl, g, 1), (s2, teacher, cl, g, 1);
  for i in 1..n loop
    st := gen_random_uuid();
    insert into public.students (id, teacher_id, class_id, full_name, group_id) values (st, teacher, cl, nm || ' ' || i, g);
    insert into public.records (teacher_id, student_id, term, criteria, devoir) values (teacher, st, 1, '{"part":3}', 12);
    insert into public.readings (teacher_id, student_id, term, score) values (teacher, st, 1, 2.5);
    insert into public.tp_marks (teacher_id, session_id, student_id, score) values (teacher, s1, st, 14);
  end loop;
  update public.classes set created_at = created where id = cl;
  return cl;
end $$;

select tests.yr_mkclass(:A, 'قديم1', (make_date(:y - 1, 9, 15)::timestamp) at time zone 'Africa/Algiers', 3) as c_old1 \gset
select tests.yr_mkclass(:B, 'قديم2', (make_date(:y - 1, 10, 1)::timestamp) at time zone 'Africa/Algiers', 2) as c_old2 \gset
-- 31 يوليو 23:59 بتوقيت الجزائر: آخر دقيقة في السنة المنتهية
select tests.yr_mkclass(:A, 'يوليو', ((make_date(:y, 7, 31)::timestamp) + interval '23 hours 59 minutes') at time zone 'Africa/Algiers', 1) as c_jul \gset
-- 1 أغسطس 00:00 بتوقيت الجزائر: أول لحظة في السنة الجارية
select tests.yr_mkclass(:A, 'أغسطس', (make_date(:y, 8, 1)::timestamp) at time zone 'Africa/Algiers', 1) as c_aug \gset
-- 31 يوليو 23:30 UTC = 1 أغسطس 00:30 بالجزائر: جارية (الحدّ بتوقيت الجزائر لا UTC)
select tests.yr_mkclass(:B, 'حدّ UTC', ((make_date(:y, 7, 31)::timestamp) + interval '23 hours 30 minutes') at time zone 'UTC', 1) as c_utc \gset
select tests.yr_mkclass(:A, 'جارٍ أ', now(), 2) as c_a \gset
select tests.yr_mkclass(:B, 'جارٍ ب', now(), 2) as c_b \gset

select id as st_o from public.students where class_id = :'c_old1' order by full_name limit 1 \gset
select id as st_o2 from public.students where class_id = :'c_old1' order by full_name offset 1 limit 1 \gset
select id as st_cur from public.students where class_id = :'c_a' order by full_name limit 1 \gset
select session_id as ses1 from public.tp_marks where student_id = :'st_o' \gset
select id as ses2 from public.tp_sessions where class_id = :'c_old1' and id <> :'ses1' limit 1 \gset
select m.id as mk_o from public.tp_marks m where m.session_id = :'ses1' and m.student_id = :'st_o' \gset
select id as rd_o from public.readings where student_id = :'st_o' \gset
select id as rd_cur from public.readings where student_id = :'st_cur' \gset
select set_config('tests.st', :'st_o', false), set_config('tests.st2', :'st_o2', false), set_config('tests.stc', :'st_cur', false),
       set_config('tests.ses1', :'ses1', false), set_config('tests.ses2', :'ses2', false),
       set_config('tests.mk', :'mk_o', false), set_config('tests.rd', :'rd_o', false), set_config('tests.rdc', :'rd_cur', false),
       set_config('tests.cold', :'c_old1', false), set_config('tests.ca', :'c_a', false);

-- ============================================================
-- 1) حدود السنة الدراسية (بتوقيت الجزائر)
-- ============================================================
select tests.ok('31 يوليو من السنة السابقة',   private.school_year_of(date '2026-07-31') = 2025);
select tests.ok('1 أغسطس يبدأ السنة',          private.school_year_of(date '2026-08-01') = 2026);
select tests.ok('يناير ضمن سنة أغسطس السابق',   private.school_year_of(date '2027-01-15') = 2026);
select tests.ok('31 ديسمبر',                    private.school_year_of(date '2026-12-31') = 2026);
select tests.ok('قسم السنة السابقة مقفل',        private.class_year_closed(:'c_old1'));
select tests.ok('قسم 31 يوليو 23:59 مقفل',       private.class_year_closed(:'c_jul'));
select tests.ok('قسم 1 أغسطس 00:00 جارٍ',        not private.class_year_closed(:'c_aug'));
select tests.ok('31 يوليو 23:30 UTC جارٍ (الحدّ بتوقيت الجزائر)', not private.class_year_closed(:'c_utc'));
select tests.ok('قسم جارٍ غير مقفل',             not private.class_year_closed(:'c_a'));
select tests.ok('قسم غير موجود ليس مقفلًا',       not private.class_year_closed(gen_random_uuid()));

-- ============================================================
-- 2) القفل على الأستاذ المسجَّل (authenticated) في قسم مقفل
-- ============================================================
select tests.yr_fp() as fp0 \gset
select tests.claims(:A);
set role authenticated;
create temp table yr_lock (label text, res text);
insert into yr_lock select 'تنقيط جديد', tests.yr_try($$insert into public.records (teacher_id, student_id, term, criteria) values (current_setting('tests.a')::uuid, current_setting('tests.st')::uuid, 2, '{}')$$);
insert into yr_lock select 'تعديل تنقيط', tests.yr_try($$update public.records set devoir = 1 where student_id = current_setting('tests.st')::uuid and term = 1$$);
insert into yr_lock select 'upsert تنقيط', tests.yr_try($$insert into public.records (teacher_id, student_id, term, criteria, devoir) values (current_setting('tests.a')::uuid, current_setting('tests.st')::uuid, 1, '{}', 5) on conflict (student_id, term) do update set devoir = excluded.devoir$$);
insert into yr_lock select 'قراءة جديدة', tests.yr_try($$insert into public.readings (teacher_id, student_id, term, score) values (current_setting('tests.a')::uuid, current_setting('tests.st')::uuid, 1, 3)$$);
insert into yr_lock select 'تعديل قراءة', tests.yr_try($$update public.readings set score = 1 where id = current_setting('tests.rd')::uuid$$);
insert into yr_lock select 'حصة جديدة', tests.yr_try($$insert into public.tp_sessions (teacher_id, class_id, term) values (current_setting('tests.a')::uuid, current_setting('tests.cold')::uuid, 1)$$);
insert into yr_lock select 'تعديل عنوان حصة', tests.yr_try($$update public.tp_sessions set title = 'x' where id = current_setting('tests.ses2')::uuid$$);
insert into yr_lock select 'علامة عمل جديدة', tests.yr_try($$insert into public.tp_marks (teacher_id, session_id, student_id, score) values (current_setting('tests.a')::uuid, current_setting('tests.ses1')::uuid, current_setting('tests.st2')::uuid, 10)$$);
insert into yr_lock select 'تعديل علامة عمل', tests.yr_try($$update public.tp_marks set score = 1 where id = current_setting('tests.mk')::uuid$$);
insert into yr_lock select 'merge_record', tests.yr_try($$select public.merge_record(current_setting('tests.st')::uuid, 1::smallint, '{"devoir":9}'::jsonb, now())$$);
insert into yr_lock select 'نقل تنقيط من قسم مقفل إلى جارٍ', tests.yr_try($$update public.records set student_id = current_setting('tests.stc')::uuid where student_id = current_setting('tests.st')::uuid and term = 1$$);
insert into yr_lock select 'نقل قراءة من قسم جارٍ إلى مقفل', tests.yr_try($$update public.readings set student_id = current_setting('tests.st')::uuid where id = current_setting('tests.rdc')::uuid$$);
insert into yr_lock select 'نقل علامة عمل إلى حصة مقفلة', tests.yr_try($$update public.tp_marks set session_id = current_setting('tests.ses2')::uuid where id = (select id from public.tp_marks where student_id = current_setting('tests.stc')::uuid limit 1)$$);
reset role;
select tests.ok('authenticated: ' || label || ' مرفوض 23514', res = '23514 class_year_closed', res) from yr_lock;
select tests.ok('لم يتغيّر شيء بعد المحاولات المرفوضة', tests.yr_fp() = :'fp0');

-- الكتابة في قسم جارٍ للأستاذ نفسه مسموحة
select tests.claims(:A);
set role authenticated;
select tests.ok('قسم جارٍ: قراءة جديدة', tests.yr_try($$insert into public.readings (teacher_id, student_id, term, score) values (current_setting('tests.a')::uuid, current_setting('tests.stc')::uuid, 1, 3)$$) = 'ok');
select tests.ok('قسم جارٍ: تعديل تنقيط', tests.yr_try($$update public.records set devoir = 7 where student_id = current_setting('tests.stc')::uuid and term = 1$$) = 'ok');
select tests.ok('قسم جارٍ: حصة جديدة', tests.yr_try($$insert into public.tp_sessions (teacher_id, class_id, term) values (current_setting('tests.a')::uuid, current_setting('tests.ca')::uuid, 1)$$) = 'ok');
select tests.ok('قسم جارٍ: merge_record', tests.yr_try($$select public.merge_record(current_setting('tests.stc')::uuid, 1::smallint, '{"devoir":8}'::jsonb, now())$$) = 'ok');
reset role;

-- ============================================================
-- 3) ما لا يُقفل في القسم المقفل
-- ============================================================
select tests.claims(:A);
set role authenticated;
select tests.ok('إضافة تلميذ مسموحة', tests.yr_try($$insert into public.students (teacher_id, class_id, full_name) values (current_setting('tests.a')::uuid, current_setting('tests.cold')::uuid, 'تلميذ مضاف')$$) = 'ok');
select tests.ok('تعديل اسم تلميذ مسموح', tests.yr_try($$update public.students set note = 'ملاحظة' where id = current_setting('tests.st')::uuid$$) = 'ok');
select tests.ok('القراءة مسموحة', (select count(*) from public.records where student_id = current_setting('tests.st')::uuid) = 1);
select tests.ok('حذف قراءة مسموح', tests.yr_try($$delete from public.readings where id = current_setting('tests.rd')::uuid$$) = 'ok');
select tests.ok('حذف علامة عمل مسموح', tests.yr_try($$delete from public.tp_marks where id = current_setting('tests.mk')::uuid$$) = 'ok');
-- استثناء group_id: تفريغه وحده مسموح، وأي تغيير آخر معه مرفوض
select tests.ok('تفريغ group_id وحده مسموح', tests.yr_try($$update public.tp_sessions set group_id = null where id = current_setting('tests.ses1')::uuid$$) = 'ok');
select tests.ok('تفريغ group_id مع تغيير العنوان مرفوض', tests.yr_try($$update public.tp_sessions set title = 'x', group_id = null where id = current_setting('tests.ses2')::uuid$$) = '23514 class_year_closed');
select tests.ok('تفريغ group_id مع تغيير الفصل مرفوض', tests.yr_try($$update public.tp_sessions set term = 2, group_id = null where id = current_setting('tests.ses2')::uuid$$) = '23514 class_year_closed');
select tests.ok('تعيين group_id لقيمة غير فارغة مرفوض', tests.yr_try($$update public.tp_sessions set group_id = (select id from public.class_groups where class_id = current_setting('tests.cold')::uuid limit 1) where id = current_setting('tests.ses1')::uuid$$) = '23514 class_year_closed');
-- حذف الفوج يفرّغ group_id عبر المفتاح الأجنبي ولا يعترض عليه القفل
select tests.ok('حذف فوج في قسم مقفل ينجح', tests.yr_try($$delete from public.class_groups where class_id = current_setting('tests.cold')::uuid$$) = 'ok');
reset role;
select tests.ok('وفرّغ group_id في الحصة الثانية', (select group_id is null from public.tp_sessions where id = :'ses2'));
select tests.ok('وبقيت الحصة وعنوانها', exists (select 1 from public.tp_sessions where id = :'ses2' and title is null));

-- ============================================================
-- 4) anon وservice_role والمالك: القفل لا يعتمد على RLS ولا على auth.uid()
-- ============================================================
select tests.yr_fp() as fp1 \gset
select set_config('request.jwt.claims', '', false);
set role anon;
create temp table yr_anon (label text, res text);
insert into yr_anon select 'تنقيط', tests.yr_try($$insert into public.records (teacher_id, student_id, term, criteria) values (current_setting('tests.a')::uuid, current_setting('tests.st')::uuid, 3, '{}')$$);
insert into yr_anon select 'تعديل تنقيط', tests.yr_try($$update public.records set devoir = 1 where student_id = current_setting('tests.st')::uuid$$);
insert into yr_anon select 'قراءة', tests.yr_try($$insert into public.readings (teacher_id, student_id, term, score) values (current_setting('tests.a')::uuid, current_setting('tests.st')::uuid, 1, 3)$$);
insert into yr_anon select 'حصة', tests.yr_try($$insert into public.tp_sessions (teacher_id, class_id, term) values (current_setting('tests.a')::uuid, current_setting('tests.cold')::uuid, 1)$$);
insert into yr_anon select 'merge_record', tests.yr_try($$select public.merge_record(current_setting('tests.st')::uuid, 1::smallint, '{"devoir":9}'::jsonb, now())$$);
reset role;
-- تعديل anon لا يرى صفوفًا تحت RLS فينجح دون أثر (صفر صفوف)؛ يُثبَت عدم الأثر بالبصمة بعد المحاولات
select tests.ok('anon: ' || label || ' مرفوض', res <> 'ok', res) from yr_anon where label <> 'تعديل تنقيط';

set role service_role;
create temp table yr_svc (label text, res text);
insert into yr_svc select 'تنقيط', tests.yr_try($$insert into public.records (teacher_id, student_id, term, criteria) values (current_setting('tests.a')::uuid, current_setting('tests.st')::uuid, 3, '{}')$$);
insert into yr_svc select 'تعديل تنقيط', tests.yr_try($$update public.records set devoir = 1 where student_id = current_setting('tests.st')::uuid$$);
insert into yr_svc select 'قراءة', tests.yr_try($$insert into public.readings (teacher_id, student_id, term, score) values (current_setting('tests.a')::uuid, current_setting('tests.st')::uuid, 1, 3)$$);
insert into yr_svc select 'حصة', tests.yr_try($$insert into public.tp_sessions (teacher_id, class_id, term) values (current_setting('tests.a')::uuid, current_setting('tests.cold')::uuid, 1)$$);
insert into yr_svc select 'علامة عمل', tests.yr_try($$insert into public.tp_marks (teacher_id, session_id, student_id, score) values (current_setting('tests.a')::uuid, current_setting('tests.ses1')::uuid, current_setting('tests.st2')::uuid, 10)$$);
reset role;
select tests.ok('service_role (يتجاوز RLS، بلا JWT): ' || label || ' مرفوض 23514', res = '23514 class_year_closed', res) from yr_svc;

set role postgres;
create temp table yr_pg (label text, res text);
insert into yr_pg select 'تنقيط', tests.yr_try($$insert into public.records (teacher_id, student_id, term, criteria) values (current_setting('tests.a')::uuid, current_setting('tests.st')::uuid, 3, '{}')$$);
insert into yr_pg select 'قراءة', tests.yr_try($$insert into public.readings (teacher_id, student_id, term, score) values (current_setting('tests.a')::uuid, current_setting('tests.st')::uuid, 1, 3)$$);
reset role;
select tests.ok('postgres (المالك): ' || label || ' مرفوض 23514', res = '23514 class_year_closed', res) from yr_pg;
select tests.ok('supabase_admin (superuser): تنقيط مرفوض 23514',
  tests.yr_try($$insert into public.records (teacher_id, student_id, term, criteria) values (current_setting('tests.a')::uuid, current_setting('tests.st')::uuid, 3, '{}')$$) = '23514 class_year_closed');
select tests.ok('لم يتغيّر شيء بعد محاولات anon وservice_role والمالك', tests.yr_fp() = :'fp1');

-- مسار الاستعادة المصمَّم: data.sql يبدأ بـ session_replication_role = replica فلا يعمل المحفّز
set session_replication_role = replica;
select tests.ok('الاستعادة (replica): إدخال في قسم مقفل ينجح',
  tests.yr_try($$insert into public.readings (id, teacher_id, student_id, term, score) values ('77777777-0000-4000-8000-000000000001', current_setting('tests.a')::uuid, current_setting('tests.st')::uuid, 1, 4)$$) = 'ok');
reset session_replication_role;
delete from public.readings where id = '77777777-0000-4000-8000-000000000001';

-- ============================================================
-- 5) إشعار الأستاذ: معرّفات أقسامه المقفلة فقط
-- ============================================================
select tests.claims(:A);
set role authenticated;
select public.my_year_notice() as notice_a \gset
reset role;
select tests.claims(:B);
set role authenticated;
select public.my_year_notice() as notice_b \gset
reset role;
select tests.ok('الإشعار: قسما A المقفلان فقط', (select count(*) = 2 from jsonb_array_elements((:'notice_a'::jsonb) -> 'closed')));
select tests.ok('الإشعار: تاريخ الحذف 7 نوفمبر من السنة التالية',
  (:'notice_a'::jsonb) -> 'closed' @> jsonb_build_array(jsonb_build_object('class_id', :'c_old1', 'purge_on', make_date(:y, 11, 7))));
select tests.ok('الإشعار: لا يظهر قسم جارٍ', not ((:'notice_a'::jsonb)::text like '%' || :'c_aug' || '%'));
select tests.ok('الإشعار: لا يظهر قسم أستاذ آخر', not ((:'notice_a'::jsonb)::text like '%' || :'c_old2' || '%'));
select tests.ok('الإشعار: B يرى قسمه المقفل فقط', (select count(*) = 1 from jsonb_array_elements((:'notice_b'::jsonb) -> 'closed'))
  and (:'notice_b'::jsonb)::text like '%' || :'c_old2' || '%' and not ((:'notice_b'::jsonb)::text like '%' || :'c_old1' || '%'));
select tests.ok('الإشعار: معرّف القسم وتاريخ الحذف فقط (مفتاحان لكل قسم، ولا عدد ولا اسم)',
  (select bool_and((select array_agg(k order by k) from jsonb_object_keys(e) k) = array['class_id', 'purge_on'])
   from jsonb_array_elements((:'notice_a'::jsonb) -> 'closed') e)
  and not ((:'notice_a'::jsonb)::text like '%قديم%'));
select set_config('request.jwt.claims', '', false);

-- ============================================================
-- 6) الصلاحيات
-- ============================================================
select tests.ok('الأدوار الثلاثة لا تنفّذ دوال الحذف ولا المحفّز ولا مساعدات السنة',
  not exists (
    select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(role),
      (values ('private.purge_old_school_years_at(date,bigint,integer)'), ('private.purge_old_school_years(bigint,integer)'),
              ('private.guard_year_write()'), ('private.class_year_closed(uuid)'), ('private.school_year_of(date)')) f(fn)
    where has_function_privilege(r.role, f.fn, 'execute')));
select tests.ok('الأستاذ ينفّذ my_year_notice وanon لا', has_function_privilege('authenticated', 'public.my_year_notice()', 'execute')
  and not has_function_privilege('anon', 'public.my_year_notice()', 'execute'));
select tests.ok('taqwim_purger ينفّذ الغلاف وحده',
  has_function_privilege('taqwim_purger', 'private.purge_old_school_years(bigint,integer)', 'execute')
  and not has_function_privilege('taqwim_purger', 'private.purge_old_school_years_at(date,bigint,integer)', 'execute')
  and not has_function_privilege('taqwim_purger', 'private.guard_year_write()', 'execute'));
select tests.ok('taqwim_purger بلا صلاحية على الجداول', not exists (
  select 1 from pg_class c where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace) and c.relkind in ('r', 'p')
    and has_table_privilege('taqwim_purger', c.oid, 'select,insert,update,delete')));

set role authenticated;
select tests.ok('الأستاذ لا يشغّل الحذف', tests.yr_try($$select private.purge_old_school_years(null, 100)$$) like '42501%');
reset role;
set role taqwim_purger;
select tests.ok('دور الحذف لا يستدعي الطبقة الداخلية ولا يمرّر تاريخًا', tests.yr_try($$select private.purge_old_school_years_at(current_date, null, 100)$$) like '42501%');
select tests.ok('دور الحذف لا يقرأ classes مباشرة', tests.yr_try($$select * from public.classes$$) like '42501%');
reset role;

-- ============================================================
-- 7) الحذف: السلسلة كاملة
-- ============================================================
delete from private.audit_log;
select count(*) as teachers0 from public.teachers \gset
select (select count(*) from public.schools) as schools0, (select count(*) from public.criteria) as criteria0, (select count(*) from public.components) as comps0 \gset
select (select count(*) from public.students where class_id in (:'c_a', :'c_b', :'c_aug', :'c_utc')) as keep_students0,
       (select count(*) from public.records r join public.students s on s.id = r.student_id where s.class_id in (:'c_a', :'c_b', :'c_aug', :'c_utc')) as keep_records0 \gset

-- (أ) الدور الحقيقي ينفّذ الغلاف: baseline بلا حذف (اليوم الحقيقي)، ثم regression بخط أساس مختلَق
set role taqwim_purger;
select private.purge_old_school_years(null, 100) as w1 \gset
select split_part(:'w1', '|', 3)::bigint as w1_id \gset
select private.purge_old_school_years(:w1_id, 100) as w2 \gset
reset role;
select tests.ok('الغلاف بالدور الحقيقي: baseline', :'w1' like 'year-purge|baseline|%|0|0|0');
select tests.ok('الغلاف: تشغيل ثانٍ في اليوم نفسه already_ran', :'w2' = format('year-purge|already_ran|%s|0|0|0', :w1_id));
select tests.ok('لم يُحذف قسم بعد استدعاء الغلاف', (select count(*) = 3 from public.classes where id in (:'c_old1', :'c_old2', :'c_jul')));
delete from private.audit_log;

-- (ب) السلسلة بتواريخ مُمرَّرة
select private.purge_old_school_years_at(make_date(:y, 11, 5), null, 100) as r0 \gset
select split_part(:'r0', '|', 3)::bigint as f0 \gset
select tests.ok('خط الأساس الأول: baseline بلا حذف', :'r0' like 'year-purge|baseline|%|0|0|0' and (select count(*) = 3 from public.classes where id in (:'c_old1', :'c_old2', :'c_jul')));
select count(*) as rows_a from private.audit_log where action = 'year_purge' \gset
select private.purge_old_school_years_at(make_date(:y, 11, 5), :f0, 100) as r0b \gset
select tests.ok('تشغيل ثانٍ في اليوم نفسه: already_ran بلا سطر جديد',
  :'r0b' = format('year-purge|already_ran|%s|0|0|0', :f0) and (select count(*) = :rows_a from private.audit_log where action = 'year_purge'));

select private.purge_old_school_years_at(make_date(:y, 11, 6), :f0, 100) as r1 \gset
select split_part(:'r1', '|', 3)::bigint as f1 \gset
select tests.ok('قبل 7 نوفمبر: ok بصفر أقسام وسطر إحصائي', :'r1' like 'year-purge|ok|%|0|0|0'
  and (select count(*) = 3 from public.classes where id in (:'c_old1', :'c_old2', :'c_jul')));

-- regression: سطر غير موجود، وسطر موجود لكنه ليس year_purge، وتسلسل أقل من الأساس
insert into private.audit_log (actor_kind, action) values ('system', 'trim_audit') returning id as other_id \gset
select private.purge_old_school_years_at(make_date(:y, 11, 7), 999999999, 100) as g1 \gset
select private.purge_old_school_years_at(make_date(:y, 11, 7), :other_id, 100) as g2 \gset
select pg_sequence_last_value('private.audit_log_id_seq'::regclass) as seq_saved \gset
select setval('private.audit_log_id_seq', :f1 - 1);
select private.purge_old_school_years_at(make_date(:y, 11, 7), :f1, 100) as g3 \gset
select setval('private.audit_log_id_seq', :seq_saved);
select tests.ok('خط أساس غير موجود: regression', :'g1' = 'year-purge|regression|0|0|0|0');
select tests.ok('سطر موجود ليس year_purge: regression', :'g2' = 'year-purge|regression|0|0|0|0');
select tests.ok('تسلسل أقل من خط الأساس: regression', :'g3' = 'year-purge|regression|0|0|0|0');
select tests.ok('regression لا يحذف ولا يكتب سطرًا',
  (select count(*) = 3 from public.classes where id in (:'c_old1', :'c_old2', :'c_jul'))
  and (select count(*) = 2 from private.audit_log where action = 'year_purge'));

-- ما سيُحذف فعلًا، محسوبًا قبل التنفيذ
select (select count(*) from public.students where class_id in (:'c_old1', :'c_old2', :'c_jul')) as exp_stu,
       (select count(*) from public.records r join public.students s on s.id = r.student_id where s.class_id in (:'c_old1', :'c_old2', :'c_jul'))
     + (select count(*) from public.readings g join public.students s on s.id = g.student_id where s.class_id in (:'c_old1', :'c_old2', :'c_jul'))
     + (select count(*) from public.tp_marks m join public.tp_sessions t on t.id = m.session_id where t.class_id in (:'c_old1', :'c_old2', :'c_jul')) as exp_mrk \gset
select private.purge_old_school_years_at(make_date(:y, 11, 7), :f1, 100) as r2 \gset
select split_part(:'r2', '|', 3)::bigint as f2 \gset
select tests.ok('7 نوفمبر: ok وتُحذف الأقسام الثلاثة القديمة بأعدادها الصحيحة',
  :'r2' = format('year-purge|ok|%s|3|%s|%s', :f2, :exp_stu, :exp_mrk), :'r2');
select tests.ok('اختفى كل ما يتبع الأقسام المحذوفة', not exists (select 1 from public.classes where id in (:'c_old1', :'c_old2', :'c_jul'))
  and not exists (select 1 from public.students where class_id in (:'c_old1', :'c_old2', :'c_jul'))
  and not exists (select 1 from public.class_groups where class_id in (:'c_old1', :'c_old2', :'c_jul'))
  and not exists (select 1 from public.tp_sessions where class_id in (:'c_old1', :'c_old2', :'c_jul'))
  and not exists (select 1 from public.records where student_id in (:'st_o', :'st_o2')));
select tests.ok('أقسام السنة الجارية سليمة (بما فيها 1 أغسطس 00:00 وحدّ UTC)',
  (select count(*) = 4 from public.classes where id in (:'c_a', :'c_b', :'c_aug', :'c_utc'))
  and (select count(*) from public.students where class_id in (:'c_a', :'c_b', :'c_aug', :'c_utc')) = :keep_students0
  and (select count(*) from public.records r join public.students s on s.id = r.student_id where s.class_id in (:'c_a', :'c_b', :'c_aug', :'c_utc')) = :keep_records0);
select tests.ok('حسابات الأساتذة والمؤسسات والمعايير والمكوّنات كما هي',
  (select count(*) from public.teachers) = :teachers0 and (select count(*) from public.schools) = :schools0
  and (select count(*) from public.criteria) = :criteria0 and (select count(*) from public.components) = :comps0);

select private.purge_old_school_years_at(make_date(:y, 11, 7), :f2, 100) as r3 \gset
select tests.ok('تشغيل ثانٍ في يوم الحذف: already_ran', :'r3' like 'year-purge|already_ran|%|0|0|0');
select private.purge_old_school_years_at(make_date(:y, 11, 8), :f2, 100) as r4 \gset
select split_part(:'r4', '|', 3)::bigint as f4 \gset
select tests.ok('اليوم التالي: ok بصفر أقسام ويكتب سطرًا', :'r4' like 'year-purge|ok|%|0|0|0');

-- السجلّ إحصائي فقط
select tests.ok('سطور year_purge: خمسة مفاتيح فقط وأرقام وحالة',
  (select bool_and(
      (select array_agg(k order by k) from jsonb_object_keys(l.detail) k) = array['classes', 'marks', 'on_date', 'status', 'students']
      and l.target_id is null and l.actor_id is null and l.actor_kind = 'system')
   from private.audit_log l where l.action = 'year_purge'));
select tests.ok('لا اسم تلميذ ولا قسم في السجلّ', not exists (select 1 from private.audit_log where detail::text like '%قديم%' or detail::text like '%تلميذ%'));

-- (ج) السقف: 101 قسم قديم
insert into public.classes (teacher_id, name, created_at)
select :A, 'سقف ' || i, (make_date(:y - 1, 9, 20)::timestamp) at time zone 'Africa/Algiers' from generate_series(1, 101) i;
select tests.ok('p_max خارج 1..100 يرفع خطأ', tests.yr_try($$select private.purge_old_school_years_at(date '2030-11-07', null, 0)$$) like 'P0001%'
  and tests.yr_try($$select private.purge_old_school_years_at(date '2030-11-07', null, 101)$$) like 'P0001%');
select private.purge_old_school_years_at(make_date(:y, 11, 9), :f4, 100) as r5 \gset
select split_part(:'r5', '|', 3)::bigint as f5 \gset
select tests.ok('السقف: يُحذف 100 ويبقى قسم', :'r5' like 'year-purge|ok|%|100|0|0' and (select count(*) = 1 from public.classes where name like 'سقف %'));
select private.purge_old_school_years_at(make_date(:y, 11, 10), :f5, 100) as r6 \gset
select tests.ok('ثم يُحذف الأخير في التشغيل التالي', :'r6' like 'year-purge|ok|%|1|0|0' and not exists (select 1 from public.classes where name like 'سقف %'));

-- ============================================================
\pset format aligned
\pset footer off
select n, case when ok then 'ok' else 'FAIL' end as r, label, case when ok then '' else coalesce(detail, '') end as detail
from tests.results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from tests.results \gset
\echo :passed passed, :failed failed
select :failed = 0 as all_passed \gset
\if :all_passed
\else
  \echo 'FAILED'
  select 1 / 0;
\endif
