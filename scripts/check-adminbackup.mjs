/* اختبار منطق تبويب النسخ الاحتياطي (src/lib/adminBackup.ts) وتصفية السجلّ الجديدة. يستورد الشفرة الحقيقية.
   القاعدة هي الحَكَم (supabase/tests/backup_schedule.test.sql)؛ هنا القواعد المسبقة نفسها وعرض الحالة. */
import assert from "node:assert/strict";
import {
  parseBackupStatus, scheduleLabel as rawLabel, validateBackup as rawValidate, validateExamsFrom as rawExams, examWindow,
  backupErrorMessage, backupLogSummary as rawSummary, addDays, OVERRIDE_MAX_DAYS, ltr,
} from "../src/lib/adminBackup.ts";
import { parseTab, filterLog, ACTION_LABEL } from "../src/lib/admin.ts";

let n = 0;
const ok = (label, fn) => { fn(); n += 1; console.log("ok ", label); };

const clean = (x) => (typeof x === "string" ? x.replace(/[\u2066\u2069]/g, "") : x);
const scheduleLabel = (s) => { const r = rawLabel(s); return { ...r, title: clean(r.title), detail: clean(r.detail) }; };
const validateBackup = (...a) => { const r = rawValidate(...a); return r.ok ? r : { ...r, error: clean(r.error) }; };
const validateExamsFrom = (...a) => { const r = rawExams(...a); return r.ok ? r : { ...r, error: clean(r.error) }; };
const backupLogSummary = (...a) => clean(rawSummary(...a));
const T1 = { school_year: "2026/2027", term: 1, starts_on: "2026-09-01", ends_on: "2026-12-17", grace_days: 10 };
const status = (o) => ({
  schedule: "weekly", mode: "auto", until: null, reason: null, override_expired: false,
  exam_term: null, exam_school_year: null, exam_window_ends: null,
  next_weekly: null, next_exam_from: null, next_exam_term: null, ...o,
});

ok("ردّ القاعدة الصحيح يُقرأ", () => {
  const s = parseBackupStatus(status({ schedule: "paused", mode: "paused", until: "2026-11-10", reason: "عطلة" }));
  assert.equal(s.schedule, "paused");
  assert.equal(s.until, "2026-11-10");
});
ok("شكل غير متوقّع ⇒ null", () => {
  for (const bad of [null, undefined, "x", 3, {}, { schedule: "monthly", mode: "auto" }, { schedule: "weekly", mode: "stop" }])
    assert.equal(parseBackupStatus(bad), null, JSON.stringify(bad));
});
ok("ردّ قديم بلا حقول الموعد القادم يُقرأ بلا استثناء", () => {
  const s = parseBackupStatus({ schedule: "weekly", mode: "auto" });
  assert.equal(s.next_weekly, null);
  assert.match(scheduleLabel(s).detail, /كل ليلة جمعة/);
});
ok("حقول ناقصة أو بنوع خاطئ تصير null لا استثناء", () => {
  const s = parseBackupStatus({ schedule: "weekly", mode: "auto", exam_term: "1", until: 5 });
  assert.equal(s.exam_term, null);
  assert.equal(s.until, null);
});
ok("وصف الحالات الأربع", () => {
  const w = scheduleLabel(status({ next_weekly: "2026-11-06", next_exam_from: "2026-12-03", next_exam_term: 1 }));
  assert.equal(w.title, "أسبوعي (ليس يوميًّا الآن)");
  assert.match(w.detail, /النسخة القادمة: ليلة الخميس إلى الجمعة 2026-11-06/);
  assert.match(w.detail, /يبدأ النسخ اليومي في 2026-12-03 \(الفصل 1\)/);
  assert.match(scheduleLabel(status({})).detail, /لا فترة اختبارات قادمة/);
  const p = scheduleLabel(status({ schedule: "paused", mode: "paused", until: "2026-11-10", reason: "عطلة" }));
  assert.match(p.title, /موقوف حتى 2026-11-10 \(لا نسخ\)/);
  assert.equal(p.tone, "warn");
  assert.match(p.detail, /عطلة/);
  assert.match(scheduleLabel(status({ schedule: "daily_override", mode: "daily", until: "2026-11-10" })).title, /يومي \(يدوي\) حتى 2026-11-10/);
  const e = scheduleLabel(status({ schedule: "daily_exams", exam_term: 1, exam_school_year: "2026/2027", exam_window_ends: "2026-12-27" }));
  assert.match(e.title, /يومي الآن/);
  assert.match(e.detail, /ينسخ كل ليلة حتى 2026-12-27 \(الفصل 1 من 2026\/2027\)/);
});

const TODAY = "2026-10-30";
ok("auto لا يحتاج شيئًا", () => assert.equal(validateBackup("auto", "", "", TODAY).ok, true));
ok("التوقيف: غدًا ممكن، واليوم نفسه لا", () => {
  assert.equal(validateBackup("paused", "2026-10-31", "عطلة", TODAY).ok, true);
  assert.equal(validateBackup("paused", "2026-10-30", "عطلة", TODAY).ok, false);
  assert.equal(validateBackup("paused", "2026-10-01", "عطلة", TODAY).ok, false);
});
ok("30 يومًا بالضبط ممكنة، و31 لا", () => {
  assert.equal(OVERRIDE_MAX_DAYS, 30);
  assert.equal(validateBackup("daily", "2026-11-29", "x", TODAY).ok, true);
  const r = validateBackup("daily", "2026-11-30", "x", TODAY);
  assert.equal(r.ok, false);
  assert.match(r.error, /2026-11-29/);
});
ok("السبب إلزامي ولو فراغات", () => {
  assert.equal(validateBackup("paused", "2026-11-05", "", TODAY).ok, false);
  assert.equal(validateBackup("daily", "2026-11-05", "   ", TODAY).ok, false);
});
ok("تاريخ غير صحيح أو فارغ مرفوض", () => {
  for (const u of ["", "2026-13-01", "2026-02-30", "غدا", "2026/11/05"])
    assert.equal(validateBackup("paused", u, "x", TODAY).ok, false, u);
});
ok("التواريخ في النصوص معزولة اتجاهيًّا (لا تنعكس في العنوان العربي)", () => {
  assert.equal(ltr("2026-11-12"), "\u20662026-11-12\u2069");
  assert.ok(rawLabel(status({ schedule: "paused", mode: "paused", until: "2026-11-12", reason: "x" })).title.includes(ltr("2026-11-12")));
  assert.ok(rawLabel(status({ next_weekly: "2026-11-06" })).detail.includes(ltr("2026-11-06")));
  assert.ok(rawSummary("set_backup", { mode: "paused", until: "2026-11-10" }).includes(ltr("2026-11-10")));
});
ok("عبور نهاية السنة في addDays", () => assert.equal(addDays("2026-12-31", 1), "2027-01-01"));

ok("نافذة الاختبارات الافتراضية: 14 يومًا قبل النهاية إلى النهاية + المهلة", () => {
  assert.deepEqual(examWindow(T1), { from: "2026-12-03", to: "2026-12-27", isDefault: true });
});
ok("نافذة بتاريخ مكتوب", () => {
  assert.deepEqual(examWindow({ ...T1, exams_from: "2026-11-19" }), { from: "2026-11-19", to: "2026-12-27", isDefault: false });
});
ok("ف2 وف3 كما في القاعدة", () => {
  assert.equal(examWindow({ ...T1, term: 2, starts_on: "2026-12-18", ends_on: "2027-03-18" }).from, "2027-03-04");
  assert.equal(examWindow({ ...T1, term: 3, starts_on: "2027-03-19", ends_on: "2027-07-08" }).from, "2027-06-24");
});
ok("بداية الاختبارات: داخل الفصل فقط، وفارغ = الافتراضي", () => {
  assert.equal(validateExamsFrom(T1, "").ok, true);
  assert.equal(validateExamsFrom(T1, "2026-09-01").ok, true);
  assert.equal(validateExamsFrom(T1, "2026-12-17").ok, true);
  assert.equal(validateExamsFrom(T1, "2026-08-31").ok, false);
  assert.equal(validateExamsFrom(T1, "2026-12-18").ok, false);
  assert.equal(validateExamsFrom(T1, "2026-02-30").ok, false);
});
ok("أخطاء القاعدة", () => {
  assert.match(backupErrorMessage({ code: "22023" }), /رفضت/);
  assert.match(backupErrorMessage({ code: "23514" }), /حدود الفصل/);
  assert.equal(backupErrorMessage({ code: "42501" }), null);
  assert.equal(backupErrorMessage(null), null);
});

ok("سطر السجلّ للتوقيف والعودة", () => {
  assert.equal(
    backupLogSummary("set_backup", { mode: "paused", until: "2026-11-10", previous: { mode: "auto", until: null } }),
    "موقوف حتى 2026-11-10. كان: عادي (أسبوعي)");
  assert.equal(backupLogSummary("set_backup", { mode: "auto", previous: { mode: "daily", until: "2026-11-03" } }),
    "عادي (أسبوعي). كان: يومي حتى 2026-11-03");
});
ok("سطر السجلّ لبداية الاختبارات", () => {
  assert.equal(backupLogSummary("set_exams", { school_year: "2026/2027", term: 1, exams_from: "2026-11-19", previous: null }),
    "2026/2027 · الفصل 1: بداية الاختبارات 2026-11-19");
  assert.match(backupLogSummary("set_exams", { school_year: "2026/2027", term: 1, exams_from: null, previous: "2026-11-19" }), /الافتراضي\. كانت: 2026-11-19/);
  assert.equal(backupLogSummary("set_backup", null), "");
  assert.equal(backupLogSummary("other", { mode: "paused" }), "");
});

const LOGS = [
  { action: "set_backup", actor_kind: "admin" }, { action: "set_exams", actor_kind: "admin" },
  { action: "set_term", actor_kind: "admin" }, { action: "disable", actor_kind: "admin" },
  { action: "purge", actor_kind: "system" },
];
ok("تصفية السجلّ: النسخ والرزنامة والحسابات منفصلة", () => {
  assert.deepEqual(filterLog(LOGS, "backup").map((r) => r.action), ["set_backup"]);
  assert.deepEqual(filterLog(LOGS, "calendar").map((r) => r.action), ["set_exams", "set_term"].sort((a, b) => LOGS.findIndex((x) => x.action === a) - LOGS.findIndex((x) => x.action === b)));
  assert.deepEqual(filterLog(LOGS, "accounts").map((r) => r.action), ["disable"]);
  assert.equal(filterLog(LOGS, "all").length, 5);
});
ok("تسميات الأفعال والتبويب في الرابط", () => {
  assert.ok(ACTION_LABEL.set_backup && ACTION_LABEL.set_exams);
  assert.equal(parseTab("?tab=backup"), "backup");
  assert.equal(parseTab("?tab=nope"), "accounts");
});

console.log(`${n} اختبارًا نجحت`);
