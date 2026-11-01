/* اختبار منطق صفحة الإشراف (src/lib/admin.ts). يستورد الشفرة الحقيقية لا نسخةً منها.
   الصلاحية نفسها تُختبر في القاعدة (supabase/tests)؛ هنا ما تفعله الواجهة بردود القاعدة. */
import assert from "node:assert/strict";
import {
  classifyAdminError, parseAdminState, cleanCode, codeReady, cleanReason, REASON_MAX,
  msLeft, leftLabel, daysLeft, summarize, filterTeachers, adminProblemMessage,
  countWord, dueWord, attentionItems,
  parseTab, agoLabel, sortTeachers, statusCounts, filterLog, nextLogLimit, LOG_MAX,
  parseUnconfirmed, unconfirmedCounts, unconfirmedAge, unconfirmedWhyKept, unconfirmedErrorMessage,
  UNCONFIRMED_MIN_DAYS, ACTION_LABEL,
} from "../src/lib/admin.ts";
import {
  groupByYear, closesOn, graceWord, nextYearLabel, suggestYear, validateTerm, termErrorMessage, calendarIssues, termLogSummary, phaseOn, editEffect,
} from "../src/lib/adminTerms.ts";

let n = 0;
const ok = (label, fn) => { fn(); n += 1; console.log("ok ", label); };

ok("42501 مع mfa_required ⇒ إعادة الرمز", () =>
  assert.equal(classifyAdminError({ code: "42501", message: "mfa_required" }), "mfa_required"));
ok("42501 مع forbidden ⇒ رفض نهائي", () =>
  assert.equal(classifyAdminError({ code: "42501", message: "forbidden" }), "forbidden"));
ok("42501 برسالة أخرى ⇒ رفض نهائي (لا نفترض الأخف)", () =>
  assert.equal(classifyAdminError({ code: "42501", message: "permission denied" }), "forbidden"));
ok("28000 وJWT منتهٍ و401 ⇒ جلسة", () => {
  assert.equal(classifyAdminError({ code: "28000", message: "not authenticated" }), "session");
  assert.equal(classifyAdminError({ message: "JWT expired" }), "session");
  assert.equal(classifyAdminError({ status: 401, message: "" }), "session");
});
ok("انقطاع الشبكة", () => assert.equal(classifyAdminError({ message: "TypeError: Failed to fetch" }), "network"));
ok("غير معروف أو فارغ ⇒ other", () => {
  assert.equal(classifyAdminError({ code: "XX000", message: "boom" }), "other");
  assert.equal(classifyAdminError(null), "other");
});
ok("لكل حالة رسالة عربية مختلفة", () => {
  const msgs = ["mfa_required", "forbidden", "session", "network", "other"].map(adminProblemMessage);
  assert.equal(new Set(msgs).size, 5);
});

ok("parseAdminState: شكل غريب ⇒ ليس مشرفًا", () => {
  for (const v of [null, undefined, 5, "x", [], {}, { listed: "true", ready: 1 }]) {
    const s = parseAdminState(v);
    assert.equal(s.listed, false); assert.equal(s.ready, false); assert.equal(s.mfaExpiresAt, null);
  }
});
ok("parseAdminState: رد صالح", () => {
  const s = parseAdminState({ listed: true, ready: true, mfa_expires_at: "2026-10-30T10:00:00Z" });
  assert.deepEqual(s, { listed: true, ready: true, mfaExpiresAt: "2026-10-30T10:00:00Z" });
  assert.equal(parseAdminState({ listed: true, mfa_expires_at: "ليس تاريخًا" }).mfaExpiresAt, null);
});

ok("رمز التحقّق: أرقام فقط وستة", () => {
  assert.equal(cleanCode("12a3 456789"), "123456");
  assert.equal(codeReady("123456"), true);
  assert.equal(codeReady("12345"), false);
  assert.equal(codeReady("12345a"), false);
});

ok("السبب: تشذيب وقصّ وإهمال الفراغ", () => {
  assert.equal(cleanReason("   "), null);
  assert.equal(cleanReason("  شكوى  "), "شكوى");
  assert.equal(cleanReason("س".repeat(500)).length, REASON_MAX);
});

const NOW = new Date("2026-10-29T12:00:00Z").getTime();
ok("الوقت المتبقي", () => {
  assert.equal(msLeft(null, NOW), 0);
  assert.equal(msLeft("ليس تاريخًا", NOW), 0);
  assert.equal(msLeft("2026-10-29T11:00:00Z", NOW), 0);
  assert.equal(leftLabel(0), "انتهى");
  assert.equal(leftLabel(30_000), "أقل من دقيقة");
  assert.equal(leftLabel(35 * 60_000), "35 د");
  assert.equal(leftLabel((11 * 60 + 40) * 60_000), "11 س 40 د");
});
ok("أيام المهلة تُقرَّب للأعلى", () => {
  assert.equal(daysLeft("2026-11-05T12:00:00Z", NOW), 7);
  assert.equal(daysLeft("2026-10-30T12:00:01Z", NOW), 2);
  assert.equal(daysLeft("2026-10-29T11:59:00Z", NOW), 0);
});

const t = (o) => ({
  id: "x", email: "a@x.dz", full_name: "أ", created_at: null, last_sign_in_at: null, status: "active",
  banned_until: null, purge_after: null, is_admin: false, classes: 1, students: 30, records: 30, last_activity: null, ...o,
});
const list = [
  t({ id: "1", full_name: "ياسين", email: "y@x.dz", last_activity: "2026-10-28T12:00:00Z" }),
  t({ id: "2", status: "disabled", email: "b@x.dz", last_activity: "2026-10-10T12:00:00Z", classes: 2, students: 50, records: 10 }),
  t({ id: "3", status: "deletion_pending", email: "c@x.dz", purge_after: "2026-11-01T00:00:00Z" }),
  t({ id: "4", is_admin: true, email: "admin@x.dz", classes: 99, students: 99, records: 99, last_activity: "2026-10-29T11:00:00Z" }),
];
ok("الإحصاءات تستثني المشرفين وتعدّ الحالات", () => {
  const s = summarize(list, NOW);
  assert.deepEqual(s, { accounts: 3, active: 1, disabled: 1, pending: 1, classes: 4, students: 110, records: 70, activeWeek: 1, activeMonth: 2, idle: 1 });
});
ok("الإحصاءات على قائمة فارغة", () => assert.equal(summarize([], NOW).accounts, 0));
ok("البحث والمرشّح", () => {
  assert.deepEqual(filterTeachers(list, "", "all").map((x) => x.id), ["1", "2", "3", "4"]);
  assert.deepEqual(filterTeachers(list, "Y@X", "all").map((x) => x.id), ["1"]);
  assert.deepEqual(filterTeachers(list, "ياسين", "all").map((x) => x.id), ["1"]);
  assert.deepEqual(filterTeachers(list, "", "disabled").map((x) => x.id), ["2"]);
  assert.deepEqual(filterTeachers(list, "c@", "active").map((x) => x.id), []);
});

/* ---------- تبويب الرزنامة ---------- */
const row = (school_year, term, starts_on, ends_on, grace_days = 10) => ({ school_year, term, starts_on, ends_on, grace_days });
const CAL = [
  row("2026/2027", 1, "2026-09-01", "2026-12-17"),
  row("2026/2027", 2, "2026-12-18", "2027-03-18"),
  row("2026/2027", 3, "2027-03-19", "2027-07-08"),
];
const draft = (o = {}) => ({ starts_on: "2027-09-01", ends_on: "2027-12-16", grace_days: "10", reason: "", ...o });

ok("صيغة المهلة بالعربية", () => {
  assert.deepEqual([0, 1, 2, 3, 10, 11, 30].map(graceWord),
    ["بلا مهلة", "مهلة يوم واحد", "مهلة يومين", "مهلة 3 أيام", "مهلة 10 أيام", "مهلة 11 يومًا", "مهلة 30 يومًا"]);
});
ok("آخر يوم للتنقيط = النهاية + المهلة، عبر الشهر والسنة", () => {
  assert.equal(closesOn(row("2026/2027", 1, "2026-09-01", "2026-12-17")), "2026-12-27");
  assert.equal(closesOn(row("2026/2027", 1, "2026-09-01", "2026-12-30", 5)), "2027-01-04");
  assert.equal(closesOn(row("2026/2027", 1, "2026-09-01", "2026-12-30", 0)), "2026-12-30");
});
ok("التجميع بالسنة: الأحدث أولًا وثلاث خانات", () => {
  const g = groupByYear([...CAL, row("2027/2028", 2, "2027-12-17", "2028-03-16")]);
  assert.deepEqual(g.map((y) => y.school_year), ["2027/2028", "2026/2027"]);
  assert.deepEqual(g[0].terms.map((t) => t && t.term), [null, 2, null]);
  assert.deepEqual(g[1].terms.map((t) => t && t.term), [1, 2, 3]);
});
ok("السنة التالية بعد أحدث سنة، ومن تاريخ اليوم إن كان الجدول فارغًا", () => {
  assert.equal(nextYearLabel(CAL, "2026-10-30"), "2027/2028");
  assert.equal(nextYearLabel([], "2026-10-30"), "2026/2027");
  assert.equal(nextYearLabel([], "2027-02-10"), "2026/2027");
});
ok("اقتراح سنة جديدة: تواريخ السابقة مزاحة بسنة ومهلتها", () => {
  const s = suggestYear([row("2026/2027", 1, "2026-09-01", "2026-12-17", 12), ...CAL.slice(1)], "2027/2028");
  assert.equal(s.length, 3);
  assert.deepEqual([s[0].starts_on, s[0].ends_on, s[0].grace_days], ["2027-09-01", "2027-12-17", "12"]);
  assert.deepEqual([s[2].starts_on, s[2].ends_on], ["2028-03-19", "2028-07-08"]);
});
ok("اقتراح سنة بلا سابقة: قيم افتراضية داخل السنة", () => {
  const s = suggestYear([], "2026/2027");
  assert.equal(s[0].starts_on, "2026-09-01");
  assert.equal(s[2].ends_on, "2027-07-08");
  assert.ok(s.every((d) => validateTerm("2026/2027", 1, d).ok));
});
ok("التحقق: قيم صحيحة", () => assert.deepEqual(validateTerm("2027/2028", 1, draft()), { ok: true, grace: 10 }));
ok("التحقق: المهلة 0 و30 مقبولتان، و31 وسالبة وكسرية ونص مرفوضة", () => {
  assert.equal(validateTerm("2027/2028", 1, draft({ grace_days: "0" })).ok, true);
  assert.equal(validateTerm("2027/2028", 1, draft({ grace_days: "30" })).ok, true);
  for (const g of ["31", "-1", "2.5", "", "عشرة"]) assert.equal(validateTerm("2027/2028", 1, draft({ grace_days: g })).ok, false, g);
});
ok("التحقق: التواريخ", () => {
  assert.equal(validateTerm("2027/2028", 1, draft({ starts_on: "2027-07-01", ends_on: "2027-08-31" })).ok, true);
  assert.equal(validateTerm("2027/2028", 1, draft({ ends_on: "2027-08-01", starts_on: "2027-09-01" })).ok, false);
  assert.equal(validateTerm("2027/2028", 1, draft({ starts_on: "" })).ok, false);
  assert.equal(validateTerm("2027/2028", 1, draft({ starts_on: "2027-02-30" })).ok, false);
  assert.equal(validateTerm("2027/2028", 1, draft({ starts_on: "2027-06-30" })).ok, false);
  assert.equal(validateTerm("2027/2028", 1, draft({ starts_on: "2027-07-01" })).ok, true);
  assert.equal(validateTerm("2027/2028", 3, draft({ starts_on: "2028-03-17", ends_on: "2028-09-30" })).ok, true);
  assert.equal(validateTerm("2027/2028", 3, draft({ starts_on: "2028-03-17", ends_on: "2028-10-01" })).ok, false);
  assert.equal(validateTerm("2027/2028", 1, draft({ starts_on: "2062-09-01", ends_on: "2062-12-01" })).ok, false);
});
ok("التحقق: اسم السنة والفصل", () => {
  assert.equal(validateTerm("2027-2028", 1, draft()).ok, false);
  assert.equal(validateTerm("2027/2029", 1, draft()).ok, false);
  assert.equal(validateTerm("2027/2028", 4, draft()).ok, false);
});
ok("رسائل خطأ القاعدة", () => {
  assert.match(termErrorMessage({ code: "23P01" }), /يتداخل/);
  assert.match(termErrorMessage({ code: "22023" }), /رفضت القاعدة/);
  assert.equal(termErrorMessage({ code: "42501" }), null);
  assert.equal(termErrorMessage(null), null);
});
ok("تحذيرات: رزنامة سليمة في وسط الفصل الأول بلا تحذير", () =>
  assert.deepEqual(calendarIssues(CAL, "2026-10-30"), []));
ok("تحذير: فصل غائب", () => {
  const i = calendarIssues(CAL.slice(0, 2), "2026-10-30");
  assert.deepEqual(i, ["السنة 2026/2027: الفصل 3 غير مُدخَل."]);
});
ok("تحذير: فجوة بين فصلين", () => {
  const i = calendarIssues([CAL[0], row("2026/2027", 2, "2026-12-21", "2027-03-18"), CAL[2]], "2026-10-30");
  assert.equal(i.length, 1);
  assert.match(i[0], /3 أيام بين الفصل 1 والفصل 2/);
});
ok("تحذير: فجوة يوم واحد بصيغة المفرد", () => {
  const i = calendarIssues([CAL[0], row("2026/2027", 2, "2026-12-19", "2027-03-18"), CAL[2]], "2026-10-30");
  assert.match(i[0], /1 يوم بين/);
});
ok("تحذير: بلا رزنامة، أو اليوم خارجها", () => {
  assert.match(calendarIssues([], "2026-10-30")[0], /لا شيء يُقفل/);
  assert.match(calendarIssues(CAL, "2027-09-10")[0], /لا تغطي تاريخ اليوم/);
  assert.equal(calendarIssues(CAL, "2027-08-17").some((m) => /لا تغطي/.test(m)), false);
});
ok("تحذير الصيف: لم تُضَف رزنامة السنة القادمة", () => {
  assert.match(calendarIssues(CAL, "2027-07-20")[0], /لم تُضَف رزنامة السنة القادمة/);
  assert.deepEqual(calendarIssues(CAL, "2027-05-20"), []);
  const withNext = [...CAL, row("2027/2028", 1, "2027-09-01", "2027-12-16"), row("2027/2028", 2, "2027-12-17", "2028-03-16"), row("2027/2028", 3, "2028-03-17", "2028-07-06")];
  assert.deepEqual(calendarIssues(withNext, "2027-07-20"), []);
});
ok("سطر السجلّ: فصل جديد وتعديل بالقيم السابقة", () => {
  assert.equal(
    termLogSummary({ school_year: "2027/2028", term: 1, starts_on: "2027-09-01", ends_on: "2027-12-16", grace_days: 10, previous: null }),
    "2027/2028 · الفصل 1: من 2027-09-01 إلى 2027-12-16 (مهلة 10 أيام). فصل جديد",
  );
  assert.equal(
    termLogSummary({ school_year: "2026/2027", term: 1, starts_on: "2026-09-01", ends_on: "2026-12-15", grace_days: 12, previous: { starts_on: "2026-09-01", ends_on: "2026-12-17", grace_days: 10 } }),
    "2026/2027 · الفصل 1: من 2026-09-01 إلى 2026-12-15 (مهلة 12 يومًا). كان: من 2026-09-01 إلى 2026-12-17 (مهلة 10 أيام)",
  );
  assert.equal(termLogSummary({ reason: "x" }), "");
  assert.equal(termLogSummary(null), "");
});

ok("العدد بالعربية: صفر وواحد ومثنّى وجمع وتمييز", () => {
  assert.equal(countWord(0, "class"), "لا أقسام");
  assert.equal(countWord(1, "class"), "قسم واحد");
  assert.equal(countWord(2, "class"), "قسمان");
  assert.equal(countWord(3, "class"), "3 أقسام");
  assert.equal(countWord(10, "class"), "10 أقسام");
  assert.equal(countWord(11, "class"), "11 قسمًا");
  assert.equal(countWord(137, "student"), "137 تلميذًا");
  assert.equal(countWord(1, "student"), "تلميذ واحد");
  assert.equal(countWord(2, "record"), "سجلّان");
  assert.equal(countWord(412, "record"), "412 سجلًّا");
  assert.equal(countWord(5, "record"), "5 سجلّات");
});
ok("العدد: قيم غير صالحة تُعامل صفرًا", () => {
  assert.equal(countWord(NaN, "class"), "لا أقسام");
  assert.equal(countWord(-4, "student"), "لا تلاميذ");
  assert.equal(countWord(2.9, "class"), "قسمان");
});
ok("موعد بالأيام: اليوم وغدًا وبعد يومين وأيام ويومًا", () => {
  assert.equal(dueWord(0), "اليوم في التشغيل الليلي");
  assert.equal(dueWord(1), "غدًا");
  assert.equal(dueWord(2), "بعد يومين");
  assert.equal(dueWord(7), "بعد 7 أيام");
  assert.equal(dueWord(11), "بعد 11 يومًا");
});

const NOW2 = Date.parse("2026-10-30T09:00:00Z");
const tch = (o) => ({
  id: "x", email: "a@b.c", full_name: null, created_at: null, last_sign_in_at: null, status: "active",
  banned_until: null, purge_after: null, is_admin: false, classes: 0, students: 0, records: 0, last_activity: null, ...o,
});
ok("شريط الانتباه: لا شيء إن لم يكن ما يستحق", () =>
  assert.deepEqual(attentionItems([tch({}), tch({ status: "disabled" })], [], NOW2), []));
ok("شريط الانتباه: حذف بعد يوم ⇒ بند أحمر يفتح تبويب الحذف", () => {
  const a = attentionItems([tch({ full_name: "أحمد", status: "deletion_pending", purge_after: "2026-10-31T01:00:00Z" })], [], NOW2);
  assert.equal(a.length, 1);
  assert.equal(a[0].tab, "deletions");
  assert.equal(a[0].level, "bad");
  assert.match(a[0].text, /أحمد: غدًا/);
});
ok("شريط الانتباه: حذف بعيد ⇒ تحذير لا أحمر، والأقرب يُذكر أولًا", () => {
  const a = attentionItems([
    tch({ id: "1", email: "far@x.y", status: "deletion_pending", purge_after: "2026-11-05T00:00:00Z" }),
    tch({ id: "2", email: "near@x.y", status: "deletion_pending", purge_after: "2026-11-03T12:00:00Z" }),
  ], [], NOW2);
  assert.equal(a[0].level, "warn");
  assert.match(a[0].text, /^2 طلبات حذف معلّقة، أقربها بعد 5 أيام \(near@x\.y\)$/);
});
ok("شريط الانتباه: حساب المشرف لا يُعدّ، وتنبيهات الرزنامة تفتح تبويبها", () => {
  const a = attentionItems([tch({ is_admin: true, status: "deletion_pending", purge_after: "2026-10-31T00:00:00Z" })], ["تنبيه أ", "تنبيه ب"], NOW2);
  assert.deepEqual(a.map((x) => [x.tab, x.text]), [["calendar", "تنبيه أ"], ["calendar", "تنبيه ب"]]);
  assert.equal(new Set(a.map((x) => x.key)).size, 2);
});

ok("حال الفصل: قبل البداية وفيه ومهلته وبعدها (حدود الأيام)", () => {
  const r = { starts_on: "2026-09-01", ends_on: "2026-12-17", grace_days: 10 };
  assert.equal(phaseOn(r, "2026-08-31"), "upcoming");
  assert.equal(phaseOn(r, "2026-09-01"), "current");
  assert.equal(phaseOn(r, "2026-12-17"), "current");
  assert.equal(phaseOn(r, "2026-12-18"), "grace");
  assert.equal(phaseOn(r, "2026-12-27"), "grace");
  assert.equal(phaseOn(r, "2026-12-28"), "closed");
  assert.equal(phaseOn({ ...r, grace_days: 0 }, "2026-12-18"), "closed");
});
const T1 = { starts_on: "2026-09-01", ends_on: "2026-12-17", grace_days: 10 };
const D = (o = {}) => ({ starts_on: "2026-09-01", ends_on: "2026-12-17", grace_days: "10", reason: "", ...o });
ok("أثر التعديل: بلا تغيير ⇒ آخر يوم فقط ولا ملاحظات", () => {
  const e = editEffect(T1, D(), "2026-10-30");
  assert.equal(e.closes, "2026-12-27");
  assert.deepEqual(e.notes, []);
});
ok("أثر التعديل: تقديم النهاية قبل اليوم يقفل فصلًا مفتوحًا (تحذير)", () => {
  const e = editEffect(T1, D({ ends_on: "2026-10-01", grace_days: "5" }), "2026-10-30");
  assert.equal(e.closes, "2026-10-06");
  assert.equal(e.notes.length, 1);
  assert.equal(e.notes[0].level, "warn");
  assert.match(e.notes[0].text, /يُقفل اليوم/);
});
ok("أثر التعديل: تأخير البداية إلى المستقبل يقفل فصلًا مفتوحًا", () => {
  const e = editEffect(T1, D({ starts_on: "2026-11-15" }), "2026-10-30");
  assert.equal(e.notes[0].level, "warn");
  assert.match(e.notes[0].text, /لا يبدأ إلا في تاريخ لاحق/);
});
ok("أثر التعديل: فصل مقفل يُفتح (معلومة)", () => {
  const e = editEffect({ starts_on: "2026-09-01", ends_on: "2026-10-01", grace_days: 0 }, D({ ends_on: "2026-11-30" }), "2026-10-30");
  assert.equal(e.notes[0].level, "info");
  assert.match(e.notes[0].text, /يصير هذا الفصل مفتوحًا/);
});
ok("أثر التعديل: فصل غير مُدخَل يُضاف وهو يغطي اليوم ⇒ يُفتح", () => {
  const e = editEffect(null, D(), "2026-10-30");
  assert.equal(e.notes[0].level, "info");
});
ok("أثر التعديل: جاري يدخل مهلته (معلومة بآخر يوم)", () => {
  const e = editEffect(T1, D({ ends_on: "2026-10-25" }), "2026-10-30");
  assert.equal(e.notes.length, 1);
  assert.equal(e.notes[0].level, "info");
  assert.match(e.notes[0].text, /2026-11-04/);
});
ok("أثر التعديل: تقصير المهلة في فصل في مهلته تحذير، وتطويلها معلومة", () => {
  const inGrace = { starts_on: "2026-09-01", ends_on: "2026-10-25", grace_days: 10 };
  const shorter = editEffect(inGrace, D({ ends_on: "2026-10-25", grace_days: "7" }), "2026-10-30");
  assert.equal(shorter.notes[0].level, "warn");
  assert.match(shorter.notes[0].text, /من 2026-11-04 إلى 2026-11-01/);
  const longer = editEffect(inGrace, D({ ends_on: "2026-10-25", grace_days: "15" }), "2026-10-30");
  assert.equal(longer.notes[0].level, "info");
});
ok("أثر التعديل: فصل بعيد في المستقبل لا ملاحظات، وقيم ناقصة أو خاطئة لا معاينة", () => {
  assert.deepEqual(editEffect(null, D({ starts_on: "2027-09-01", ends_on: "2027-12-16" }), "2026-10-30").notes, []);
  for (const bad of [{ starts_on: "" }, { grace_days: "" }, { grace_days: "31" }, { grace_days: "x" }, { ends_on: "2026-08-01" }]) {
    assert.deepEqual(editEffect(T1, D(bad), "2026-10-30"), { closes: null, notes: [] }, JSON.stringify(bad));
  }
});

ok("التبويب من الرابط: المعروف يُقبل وغيره يعود إلى الحسابات", () => {
  assert.equal(parseTab("?tab=calendar"), "calendar");
  assert.equal(parseTab("?x=1&tab=log"), "log");
  assert.equal(parseTab("?tab=deletions"), "deletions");
  assert.equal(parseTab("?tab=admin"), "accounts");
  assert.equal(parseTab(""), "accounts");
});
ok("منذ: الآن ودقائق وساعة وساعات", () => {
  assert.equal(agoLabel(20_000), "الآن");
  assert.equal(agoLabel(-5), "الآن");
  assert.equal(agoLabel(5 * 60_000), "منذ 5 د");
  assert.equal(agoLabel(60 * 60_000), "منذ ساعة");
  assert.equal(agoLabel(3 * 3600_000 + 100), "منذ 3 س");
});
ok("ترتيب الحسابات: الأحدث نشاطًا، ثم من لم ينقّط، والمشرف أخيرًا، ولا تُعدَّل القائمة الأصلية", () => {
  const list = [
    tch({ id: "a", email: "admin@x", is_admin: true, last_activity: "2026-10-30T00:00:00Z" }),
    tch({ id: "b", email: "idle@x", last_activity: null }),
    tch({ id: "c", email: "old@x", last_activity: "2026-09-01T00:00:00Z" }),
    tch({ id: "d", email: "new@x", last_activity: "2026-10-29T00:00:00Z" }),
    tch({ id: "e", email: "idle2@x", last_activity: null }),
  ];
  assert.deepEqual(sortTeachers(list).map((x) => x.id), ["d", "c", "b", "e", "a"]);
  assert.equal(list[0].id, "a");
});
ok("أعداد الشرائح تُحسب على القائمة كاملة", () => {
  const c = statusCounts([tch({}), tch({ status: "disabled" }), tch({ status: "disabled" }), tch({ status: "deletion_pending" })]);
  assert.deepEqual(c, { all: 4, active: 1, disabled: 2, deletion_pending: 1 });
});
const LOGS = [
  { at: "2026-10-30T08:00:00Z", actor_kind: "admin", action: "set_term", target_email: null, detail: null },
  { at: "2026-10-29T08:00:00Z", actor_kind: "admin", action: "disable", target_email: "a@b", detail: null },
  { at: "2026-10-28T02:00:00Z", actor_kind: "system", action: "purge", target_email: "c@d", detail: null },
  { at: "2026-10-27T08:00:00Z", actor_kind: "teacher", action: "request_deletion", target_email: "e@f", detail: null },
];
ok("تصفية السجلّ: الرزنامة والحسابات والتشغيل الليلي والكل", () => {
  assert.deepEqual(filterLog(LOGS, "calendar").map((r) => r.action), ["set_term"]);
  assert.deepEqual(filterLog(LOGS, "accounts").map((r) => r.action), ["disable", "request_deletion"]);
  assert.deepEqual(filterLog(LOGS, "system").map((r) => r.action), ["purge"]);
  assert.equal(filterLog(LOGS, "all").length, 4);
});
ok("المزيد من السجلّ: دفعات من 60 ولا يتجاوز حدّ القاعدة", () => {
  assert.equal(nextLogLimit(60), 120);
  assert.equal(nextLogLimit(180), LOG_MAX);
  assert.equal(nextLogLimit(LOG_MAX), LOG_MAX);
});


/* حسابات لم تؤكّد بريدها */
const UNC = [
  { id: "1", email: "a@x.dz", full_name: null, created_at: "2026-10-20T10:00:00Z", days_old: 12, deletable: true },
  { id: "2", email: "b@x.dz", full_name: "ب", created_at: "2026-10-30T10:00:00Z", days_old: "2", deletable: false },
  { id: "3", email: null, full_name: "", created_at: "2026-10-01T10:00:00Z", days_old: 30, deletable: false },
];
ok("parseUnconfirmed: غير القائمة ⇒ فارغة، وأعداد الأيام أرقام", () => {
  for (const v of [null, undefined, 5, "x", {}]) assert.deepEqual(parseUnconfirmed(v), []);
  const rows = parseUnconfirmed(UNC);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].days_old, 2);
  assert.equal(rows[2].full_name, null);
  assert.deepEqual(parseUnconfirmed([null, 1, { id: 7 }, { id: "z" }]).map((r) => r.id), ["z"]);
});
ok("unconfirmedCounts: الكل والقابل للحذف", () =>
  assert.deepEqual(unconfirmedCounts(parseUnconfirmed(UNC)), { total: 3, deletable: 1 }));
ok("unconfirmedAge: كلمات الأيام", () => {
  assert.equal(unconfirmedAge(0), "اليوم");
  assert.equal(unconfirmedAge(1), "منذ يوم");
  assert.equal(unconfirmedAge(2), "منذ يومين");
  assert.equal(unconfirmedAge(5), "منذ 5 أيام");
  assert.equal(unconfirmedAge(12), "منذ 12 يومًا");
});
ok("unconfirmedWhyKept: الحديث بما بقي، والقديم المحميّ بسببه، والقابل بلا شيء", () => {
  const [a, b, c] = parseUnconfirmed(UNC);
  assert.equal(unconfirmedWhyKept(a), "");
  assert.equal(unconfirmedWhyKept(b), `حديث: يُحذف بعد ${UNCONFIRMED_MIN_DAYS - 2} أيام`);
  assert.ok(unconfirmedWhyKept(c).startsWith("محميّ"));
  assert.equal(unconfirmedWhyKept({ ...b, days_old: 6 }), "حديث: يُحذف بعد 1 يوم".replace("1 يوم", "1 يوم"));
});
ok("unconfirmedErrorMessage: تغيّر القائمة والحدّ، وغيرهما null فيُعالج كبقية الأخطاء", () => {
  assert.ok(unconfirmedErrorMessage({ message: "unconfirmed_changed" }).includes("لم يُحذف شيء"));
  assert.ok(unconfirmedErrorMessage({ message: "too_many" }).includes("50"));
  assert.equal(unconfirmedErrorMessage({ code: "42501", message: "mfa_required" }), null);
  assert.equal(unconfirmedErrorMessage(null), null);
});
ok("فعل السجلّ purge_unconfirmed له تسمية عربية، ويقع في «الحسابات» لا «التشغيل الليلي»", () => {
  assert.equal(ACTION_LABEL.purge_unconfirmed, "حذف حساب لم يؤكّد بريده");
  const row = { at: "2026-11-01T10:00:00Z", actor_kind: "admin", action: "purge_unconfirmed", target_email: null, detail: { created_at: "x" } };
  assert.equal(filterLog([row], "accounts").length, 1);
  assert.equal(filterLog([row], "system").length, 0);
});

console.log(`${n} اختبارًا نجحت`);
