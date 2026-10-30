-- التراجع عن 20261030090000_term_calendar_and_guard.
-- لا يمسّ أي علامة: يُزال المحفّز والدالتان وجدول الرزنامة فقط، فيعود التنقيط مفتوحًا في كل فصل.

drop trigger if exists trg_guard_term_write on public.records;
drop trigger if exists trg_guard_term_write on public.readings;
drop trigger if exists trg_guard_term_write on public.tp_sessions;
drop trigger if exists trg_guard_term_write on public.tp_marks;
drop function if exists private.guard_term_write();
drop function if exists private.term_open(integer, date);
drop table if exists public.term_calendar;
