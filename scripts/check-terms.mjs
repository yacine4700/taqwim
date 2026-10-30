/* اختبار الفصول (src/lib/terms.ts): الرزنامة والمهلة والقفل، ثم الحساب بالشهر احتياطًا.
   يجب أن يتطابق مع private.term_open في supabase/migrations/20261030090000.
   يحتاج Node 22.6 فأحدث مع --experimental-strip-types. */
import {
  currentTerm, termView, termNotice, closedTermOf, algiersToday, addDays, daysBetween,
} from "../src/lib/terms.ts";

let pass = 0, fail = 0;
function t(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`); }
}

/* رزنامة 2026/2027 كما في الترحيل */
const CAL = [
  { school_year: "2026/2027", term: 1, starts_on: "2026-09-01", ends_on: "2026-12-17", grace_days: 10 },
  { school_year: "2026/2027", term: 2, starts_on: "2026-12-18", ends_on: "2027-03-18", grace_days: 10 },
  { school_year: "2026/2027", term: 3, starts_on: "2027-03-19", ends_on: "2027-07-08", grace_days: 10 },
];
const openSet = (d) => {
  const v = termView(CAL, d);
  return [1, 2, 3].filter((x) => v.terms[x].open);
};

console.log("— الفصل الجاري والمفتوح بالرزنامة");
t("30 أكتوبر 2026: ف1 وحده", openSet("2026-10-30"), [1]);
t("30 أكتوبر 2026: يُفتح على ف1", termView(CAL, "2026-10-30").landing, 1);
t("17 ديسمبر (آخر يوم في ف1): ف1 وحده", openSet("2026-12-17"), [1]);
t("18 ديسمبر: ف1 في مهلته وف2 بدأ", openSet("2026-12-18"), [1, 2]);
t("18 ديسمبر: يُفتح على ف2 الأحدث", termView(CAL, "2026-12-18").landing, 2);
t("27 ديسمبر (آخر يوم في المهلة): الاثنان", openSet("2026-12-27"), [1, 2]);
t("28 ديسمبر: ف1 أُغلق", openSet("2026-12-28"), [2]);
t("وسط ف2", openSet("2027-02-10"), [2]);
t("19 مارس: ف2 في مهلته وف3 بدأ", openSet("2027-03-19"), [2, 3]);
t("28 مارس: آخر يوم لمهلة ف2", openSet("2027-03-28"), [2, 3]);
t("29 مارس: ف3 وحده", openSet("2027-03-29"), [3]);
t("8 جويلية: آخر يوم في ف3", openSet("2027-07-08"), [3]);
t("18 جويلية: آخر يوم لمهلة ف3", openSet("2027-07-18"), [3]);
t("19 جويلية: لا فصل مفتوح (العطلة)", openSet("2027-07-19"), []);
t("19 جويلية: يُفتح على ف3 للاطلاع", termView(CAL, "2027-07-19").landing, 3);
t("أوت: عطلة، لا شيء مفتوح", openSet("2027-08-10"), []);
t("17 أوت 2027 (آخر يوم محكوم): مقفل", openSet("2027-08-17"), []);
t("18 أوت 2027: الرزنامة لا تغطي اليوم فيُفتح كل شيء", openSet("2027-08-18"), [1, 2, 3]);
t("قبل بداية الرزنامة (أوت 2026): كل شيء مفتوح", openSet("2026-08-20"), [1, 2, 3]);
t("بلا رزنامة: كل شيء مفتوح", termView([], "2026-10-30").terms[1].open, true);
t("بلا رزنامة: enforced=false", termView([], "2026-10-30").enforced, false);

console.log("— المراحل والمهلة");
t("وسط ف1: current", termView(CAL, "2026-10-30").terms[1].phase, "current");
t("ف2 قبل بدايته: upcoming ومقفل", [termView(CAL, "2026-10-30").terms[2].phase, termView(CAL, "2026-10-30").terms[2].open], ["upcoming", false]);
t("ف1 في المهلة: grace", termView(CAL, "2026-12-20").terms[1].phase, "grace");
t("ف1 بعد 3 أيام: بقي 7", termView(CAL, "2026-12-20").terms[1].graceLeft, 7);
t("آخر يوم: بقي 0", termView(CAL, "2026-12-27").terms[1].graceLeft, 0);
t("closesOn لـ ف1", termView(CAL, "2026-12-20").terms[1].closesOn, "2026-12-27");
t("ف1 بعد المهلة: closed", termView(CAL, "2027-01-15").terms[1].phase, "closed");
t("ف1 في فيفري: مقفل وليس upcoming", termView(CAL, "2027-02-10").terms[1].open, false);
t("ف3 في فيفري: upcoming", termView(CAL, "2027-02-10").terms[3].phase, "upcoming");

console.log("— مهلة مخصّصة");
const SHORT = CAL.map((r) => ({ ...r, grace_days: 0 }));
t("مهلة 0: ف1 يُقفل يوم 18 ديسمبر", [1, 2, 3].filter((x) => termView(SHORT, "2026-12-18").terms[x].open), [2]);
const LONG = CAL.map((r) => ({ ...r, grace_days: 30 }));
t("مهلة 30: ف1 مفتوح حتى 16 جانفي", [1, 2, 3].filter((x) => termView(LONG, "2027-01-16").terms[x].open), [1, 2]);
t("مهلة 30: ويُغلق يوم 17 جانفي", [1, 2, 3].filter((x) => termView(LONG, "2027-01-17").terms[x].open), [2]);

console.log("— التنبيهات");
t("لا تنبيه في فصل جارٍ", termNotice(1, termView(CAL, "2026-10-30")), null);
t("مهلة بعيدة: info", termNotice(1, termView(CAL, "2026-12-19"))?.tone, "info");
t("نصّ المهلة", termNotice(1, termView(CAL, "2026-12-19"))?.text, "انتهى الفصل الأول. يُغلق تنقيطه بعد 8 أيام، ثم يصير للاطلاع فقط.");
t("آخر 3 أيام: warn", termNotice(1, termView(CAL, "2026-12-24"))?.tone, "warn");
t("بقي يومان: بعد يومين", termNotice(1, termView(CAL, "2026-12-25"))?.text, "انتهى الفصل الأول. يُغلق تنقيطه بعد يومين، ثم يصير للاطلاع فقط.");
t("بقي يوم: بعد يوم واحد", termNotice(1, termView(CAL, "2026-12-26"))?.text, "انتهى الفصل الأول. يُغلق تنقيطه بعد يوم واحد، ثم يصير للاطلاع فقط.");
t("آخر يوم", termNotice(1, termView(CAL, "2026-12-27"))?.text, "انتهى الفصل الأول. اليوم آخر يوم لتنقيطه، ثم يصير للاطلاع فقط.");
t("فصل مقفل: closed", termNotice(1, termView(CAL, "2027-01-15"))?.tone, "closed");
t("فصل لم يبدأ: closed", termNotice(3, termView(CAL, "2027-01-15"))?.tone, "closed");
t("بلا رزنامة: لا تنبيه", termNotice(1, termView([], "2026-10-30")), null);

console.log("— رسالة الخادم");
t("term_closed:2", closedTermOf("term_closed:2"), 2);
t("رسالة أخرى", closedTermOf("duplicate key"), null);
t("فارغة", closedTermOf(null), null);

console.log("— التواريخ");
t("اليوم بتوقيت الجزائر قبيل منتصف الليل بتوقيت UTC", algiersToday(new Date("2026-12-17T23:30:00Z")), "2026-12-18");
t("اليوم بتوقيت الجزائر ظهرًا", algiersToday(new Date("2026-12-17T12:00:00Z")), "2026-12-17");
t("addDays عبر الشهر", addDays("2026-12-27", 5), "2027-01-01");
t("addDays عبر فيفري", addDays("2027-02-27", 2), "2027-03-01");
t("daysBetween", daysBetween("2026-12-20", "2026-12-27"), 7);

console.log("— الحساب بالشهر احتياطًا (بلا رزنامة)");
const at = (m, d) => new Date(2026, m - 1, d);
t("1 سبتمبر", currentTerm(at(9, 1)), 1);
t("31 ديسمبر", currentTerm(at(12, 31)), 1);
t("1 جانفي", currentTerm(at(1, 1)), 2);
t("31 مارس", currentTerm(at(3, 31)), 2);
t("1 أفريل", currentTerm(at(4, 1)), 3);
t("15 جوان", currentTerm(at(6, 15)), 3);
t("16 جوان", currentTerm(at(6, 16)), null);
t("أوت", currentTerm(at(8, 31)), null);
t("بلا رزنامة يُفتح على الفصل بالشهر", termView([], "2027-02-10").landing, 2);
t("بلا رزنامة في العطلة يُفتح على ف3", termView([], "2027-07-20").landing, 3);

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
