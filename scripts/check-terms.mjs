/* اختبار الفصول (src/lib/terms.ts): الرزنامة والمهلة والقفل، ثم الحساب بالشهر احتياطًا.
   يجب أن يتطابق مع private.term_open في supabase/migrations/20261030090000.
   يحتاج Node 22.6 فأحدث مع --experimental-strip-types. */
import {
  currentTerm, termView, termNotice, closedTermOf, algiersToday, addDays, daysBetween,
  isClassYearClosed, parseYearNotice, yearBanner, dateAr, YEAR_CLOSED_SAY,
  resolveYearNotice, orderClosedClasses,
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

console.log("— السنة الدراسية: رسالة الخادم وقراءة الإشعار");
t("class_year_closed", isClassYearClosed("class_year_closed"), true);
t("رسالة PostgREST تحوي الاسم", isClassYearClosed('{"message":"class_year_closed"}'), true);
t("رسالة الفصل ليست رسالة السنة", isClassYearClosed("term_closed:2"), false);
t("فارغة", isClassYearClosed(null), false);
t("نص القفل المتفق عليه", YEAR_CLOSED_SAY, "التنقيط مغلق لهذا القسم، ويمكنك الاطلاع والتصدير وإضافة التلاميذ.");
const NOTICE = { year_start: 2027, closed: [
  { class_id: "a", purge_on: "2027-11-07" }, { class_id: "b", purge_on: "2027-11-07" } ] };
t("ردّ سليم", parseYearNotice(NOTICE), { yearStart: 2027, closed: [
  { classId: "a", purgeOn: "2027-11-07" }, { classId: "b", purgeOn: "2027-11-07" } ] });
t("لا أقسام مقفلة", parseYearNotice({ year_start: 2027, closed: [] })?.closed.length, 0);
t("null", parseYearNotice(null), null);
t("نصّ لا كائن", parseYearNotice("x"), null);
t("closed ليست مصفوفة", parseYearNotice({ closed: 1 }), null);
t("تاريخ بصيغة غريبة", parseYearNotice({ closed: [{ class_id: "a", purge_on: "7/11/2027" }] }), null);
t("معرّف ليس نصًّا", parseYearNotice({ closed: [{ class_id: 5, purge_on: "2027-11-07" }] }), null);
t("year_start مفقود لا يُسقط الباقي", parseYearNotice({ closed: [] })?.yearStart, null);

console.log("— السنة الدراسية: اللافتة");
const YN = parseYearNotice(NOTICE);
t("تاريخ بالجزائرية", dateAr("2027-11-07"), "7 نوفمبر 2027");
t("جوان وجانفي", `${dateAr("2027-06-01")}|${dateAr("2027-01-31")}`, "1 جوان 2027|31 جانفي 2027");
t("31 أوت 2027: لا لافتة قبل 1 سبتمبر", yearBanner(YN, "2027-08-31"), null);
t("1 سبتمبر 2027: لافتة info", yearBanner(YN, "2027-09-01")?.tone, "info");
t("نصّ الإعلان: يبدأ الحذف من التاريخ بعد نجاح النسخة وقد يتأخر، وآخر يوم آمن", yearBanner(YN, "2027-09-01")?.text,
  "بيانات السنة الدراسية السابقة (قسمان) مغلقة للتنقيط. يبدأ حذفها نهائيًّا ابتداءً من 7 نوفمبر 2027، بعد نجاح النسخة الاحتياطية، وقد يتأخر عن ذلك. آخر يوم آمن للتصدير: 6 نوفمبر 2027. نزّل «نسختي»، أو انقل أسماء تلاميذك إلى قسم جديد.");
t("آخر يوم آمن = اليوم السابق للتاريخ", yearBanner(YN, "2027-09-01")?.lastSafeOn, "2027-11-06");
t("قبل 15 يومًا: info", yearBanner(YN, "2027-10-23")?.tone, "info");
t("قبل 14 يومًا: warn", yearBanner(YN, "2027-10-24")?.tone, "warn");
t("قبل 14 يومًا: daysLeft", yearBanner(YN, "2027-10-24")?.daysLeft, 14);
t("قبل 14 يومًا: تُقال الأيام إلى آخر يوم آمن", yearBanner(YN, "2027-10-24")?.text.includes("يبقى 13 يومًا على ذلك."), true);
t("قبل 4 أيام: warn", yearBanner(YN, "2027-11-03")?.tone, "warn");
t("قبل 3 أيام: bad", yearBanner(YN, "2027-11-04")?.tone, "bad");
t("قبل يومين: يبقى يوم واحد", yearBanner(YN, "2027-11-05")?.text.includes("يبقى يوم واحد على ذلك."), true);
t("6 نوفمبر (آخر يوم آمن): bad وبلا «يبقى»", [yearBanner(YN, "2027-11-06")?.tone, yearBanner(YN, "2027-11-06")?.text.includes("يبقى")], ["bad", false]);
t("7 نوفمبر (تاريخ الحذف): مرّ آخر يوم آمن", [yearBanner(YN, "2027-11-07")?.tone, yearBanner(YN, "2027-11-07")?.text.includes("مرّ آخر يوم آمن للتصدير (6 نوفمبر 2027)")], ["bad", true]);
t("بعد الموعد: bad وdaysLeft سالب", [yearBanner(YN, "2027-11-09")?.tone, yearBanner(YN, "2027-11-09")?.daysLeft], ["bad", -2]);
t("قسم واحد", yearBanner(parseYearNotice({ closed: [{ class_id: "a", purge_on: "2027-11-07" }] }), "2027-09-02")?.text.startsWith("بيانات السنة الدراسية السابقة (قسم واحد) مغلقة"), true);
t("بلا أقسام مقفلة: لا لافتة", yearBanner(parseYearNotice({ closed: [] }), "2027-10-30"), null);
t("بلا إشعار (دالة غائبة): لا لافتة", yearBanner(null, "2027-10-30"), null);
const OLD = parseYearNotice({ closed: [
  { class_id: "a", purge_on: "2027-11-07" }, { class_id: "o", purge_on: "2026-11-07" }, { class_id: "p", purge_on: "2026-11-07" } ] });
t("أقدم تاريخ حذف هو المعتمد وعدد أقسامه فقط", [yearBanner(OLD, "2027-09-02")?.purgeOn, yearBanner(OLD, "2027-09-02")?.count], ["2026-11-07", 2]);
// كل نص تُنتجه اللافتة، في كل يوم من 1 سبتمبر إلى آخر السنة وما بعده: لا وعد بيوم ولا «اليوم» ولا «غدًا»،
// ويحوي دائمًا «ابتداءً من» و«وقد يتأخر» (قبل الموعد)، أو «تُحذف في أي ليلة» (بعده).
const banned = ["اليوم", "غدًا", "غداً", "غدا ", "بعد يوم", "ستُحذف", "سيُحذف"];
let sweepOk = true, sweepBad = "", sweepDays = 0;
for (let d = "2027-09-01"; d <= "2028-02-01"; d = addDays(d, 1)) {
  const b = yearBanner(YN, d);
  sweepDays++;
  if (!b) { sweepOk = false; sweepBad = `${d}: لا لافتة`; break; }
  const before = b.daysLeft > 0;
  const hit = banned.find((w) => b.text.includes(w));
  const hasNeeded = before
    ? b.text.includes("ابتداءً من") && b.text.includes("وقد يتأخر") && b.text.includes("بعد نجاح النسخة الاحتياطية") && b.text.includes("آخر يوم آمن للتصدير")
    : b.text.includes("تُحذف في أي ليلة") && b.text.includes("آخر يوم آمن للتصدير");
  if (hit || !hasNeeded) { sweepOk = false; sweepBad = `${d}: ${hit ?? "ينقص النص"} | ${b.text}`; break; }
}
t(`كل أيام ${sweepDays} يومًا: لا «اليوم/غدًا»، والنص يقول ابتداءً من/بعد النسخة/قد يتأخر/آخر يوم آمن ${sweepBad}`, sweepOk, true);

console.log("— السنة الدراسية: فشل قراءة الإشعار لا يضيّع شيئًا ولا يوحي بحالة مؤكدة");
const LAST = parseYearNotice({ year_start: 2027, closed: [{ class_id: "a", purge_on: "2027-11-07" }] });
t("نجاح: الإشعار الجديد ومؤكَّد", resolveYearNotice({ data: NOTICE, error: null }, null), { notice: YN, unconfirmed: false });
t("نجاح بقائمة فارغة يستبدل القديم ويؤكّد", resolveYearNotice({ data: { closed: [] }, error: null }, LAST).notice?.closed.length, 0);
t("فشل شبكة: آخر إشعار سليم يبقى وغير مؤكَّد", resolveYearNotice({ data: null, error: { message: "Failed to fetch" } }, LAST), { notice: LAST, unconfirmed: true });
t("فشل 500 بلا إشعار سابق: لا إشعار وغير مؤكَّد", resolveYearNotice({ data: null, error: { code: "500", message: "x" } }, null), { notice: null, unconfirmed: true });
t("ردّ غير مفهوم: كالفشل", resolveYearNotice({ data: { closed: "x" }, error: null }, LAST), { notice: LAST, unconfirmed: true });
t("ردّ null بلا خطأ: كالفشل", resolveYearNotice({ data: null, error: null }, LAST), { notice: LAST, unconfirmed: true });
t("الدالة غير موجودة (PGRST202): ميزة غير منشورة، لا تنبيه", resolveYearNotice({ data: null, error: { code: "PGRST202", message: "x" } }, null), { notice: null, unconfirmed: false });
t("الدالة غير موجودة (42883)", resolveYearNotice({ data: null, error: { code: "42883" } }, LAST), { notice: null, unconfirmed: false });
// ما يُحفظ على الجهاز = notice المُعاد: بعد فشل لا يُستبدل بـ undefined
t("المحفوظ بعد الفشل هو آخر سليم لا undefined", resolveYearNotice({ data: null, error: { message: "x" } }, LAST).notice ?? undefined, LAST);

console.log("— السنة الدراسية: ترتيب الأقسام المقفلة لزرّ النقل");
const KL = [{ id: "n", position: 0 }, { id: "a", position: 3 }, { id: "o", position: 2 }, { id: "p", position: 1 }];
t("الأقرب حذفًا أولًا ثم الترتيب", orderClosedClasses(OLD, KL).map((k) => k.id), ["p", "o", "a"]);
t("قسم مقفل غير محمَّل لا يظهر ولا يكسر", orderClosedClasses(OLD, [{ id: "a", position: 1 }]).map((k) => k.id), ["a"]);
t("بلا إشعار: قائمة فارغة", orderClosedClasses(null, KL), []);
t("لا يعدّل المصفوفة الأصلية", (orderClosedClasses(OLD, KL), KL.map((k) => k.id)), ["n", "a", "o", "p"]);

console.log("— السنة الدراسية: ربط الواجهة (فحص نصّي للمصدر؛ لا بيئة React هنا)");
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../src/app/app/AppClient.tsx", import.meta.url), "utf8");
const outboxHook = readFileSync(new URL("../src/lib/useOutbox.ts", import.meta.url), "utf8");
t("القفل العام يجمع الفصل والسنة", /const locked = termLocked \|\| yearLocked;/.test(app), true);
t("قسم التلميذ المفتوح أولًا ثم القسم المفتوح", /const activeClass = openStudent\?\.class_id \?\? openClass;/.test(app), true);
t("حصة جديدة تتحقّق من قفل قسمها", /yearClosedIds\.has\(input\.class_id\)/.test(app), true);
t("تعديل الحصة وحذفها وعلامتها تمرّ بحارس القسم والفصل", (app.match(/sessionWriteBlocked\(/g) ?? []).length, 3); // تعديل وحذف وعلامة
t("لا بقاء للحارس القديم بالفصل وحده في الحصص", /view\.terms\[(current|session)\.term as 1 \| 2 \| 3\]\?\.open\) return lockedSay/.test(app), false);
t("قراءة الإشعار تمرّ بـ resolveYearNotice وتحفظ آخر سليم", /resolveYearNotice\(\s*await supabase\.rpc\("my_year_notice"\),\s*lastYearNotice\.current/.test(app) && /yearNotice: yearResolved\.notice \?\? undefined/.test(app), true);
t("حالة غير المؤكَّد تُعرض للأستاذ", /<YearUnconfirmedNote/.test(app), true);
t("النقل لا يستعمل حذفًا تعويضيًّا", /async function moveRoster[\s\S]*?\n  }\n/.exec(app)?.[0].includes(".delete()"), false);
t("رسالة الطابور لرفض السنة", /isClassYearClosed\(result\.message\)/.test(outboxHook), true);
t("إضافة التلاميذ غير محجوبة بالقفل", /async function addStudents[\s\S]{0,400}?locked/.test(app), false);

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
