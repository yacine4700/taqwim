-- التراجع عن 20261030140000_backup_schedule.
-- تُزال الجدولة ودوال المشرف الخاصة بها. لا علامة تُمسّ. سجلّ التعديلات السابقة يبقى،
-- فلا يُضيَّق قيد الأفعال في السجلّ. بعد التراجع يعود سير العمل إلى النسخ كل ليلة
-- إن حُذفت خطوة القرار منه، أو يفشل في خطوة القرار فينسخ (فشل الاستعلام يُحسب نسخًا).
drop function if exists public.admin_set_exams_from(text, integer, date, text);
drop function if exists public.admin_set_backup(text, date, text);
drop function if exists public.admin_backup_status();
drop function if exists private.backup_decision(timestamptz, timestamptz, integer);
drop table if exists private.backup_control;
alter table public.term_calendar drop constraint if exists term_calendar_exams_within;
alter table public.term_calendar drop column if exists exams_from;
