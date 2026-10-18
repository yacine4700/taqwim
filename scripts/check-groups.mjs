/* اختبار الأفواج وحصص الأعمال التطبيقية.
   على عكس بقية الاختبارات يستورد الشفرة الحقيقية (src/lib/*.ts) لا نسخةً منها،
   فلا تنفصل النسخة المختبَرة عن النسخة المنشورة. يحتاج Node 22.6 فأحدث مع
   --experimental-strip-types (انظر "check" في package.json). */

import {
  applyTpTarget,
  canTargetCriterion,
  continuousMark,
  componentValues,
  criterionTarget,
  describeTarget,
  targetCriterionCode,
  termAverage,
  tpAverages,
} from "../src/lib/scoring.ts";
import {
  assignment,
  cleanGroupName,
  distribute,
  groupCountProblem,
  groupLabel,
  membership,
  shuffled,
} from "../src/lib/groups.ts";
import {
  applyTpMarks,
  applyTpSessions,
  enqueue,
  opKey,
  opSessionId,
  opStudentId,
  pending,
  pendingLabel,
} from "../src/lib/outbox.ts";

let pass = 0, fail = 0;
function t(name, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
}
const near = (a, b) => a !== null && b !== null && Math.abs(a - b) < 1e-9;
function tn(name, got, want) {
  const same = near(got, want) || (got === null && want === null);
  if (same) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${got}\n       want ${want}`); }
}

/* ---- معطيات مشتركة ---- */
const D = { id: "d", code: "disc", label: "الانضباط", kind: "deduct", base: 4, ceiling: 4, position: 1 };
const P = { id: "p", code: "part", label: "المشاركة", kind: "add", base: 0, ceiling: 4, position: 2 };
const L = { id: "l", code: "labs", label: "الأعمال", kind: "add", base: 0, ceiling: 4, position: 3 };
const R = { id: "r", code: "read", label: "القراءة", kind: "auto", base: 0, ceiling: 4, position: 4 };
const criteria = [D, P, L];
const components = [
  { id: "c1", code: "cc", label: "التقويم المستمر", weight: 1, position: 1, active: true },
  { id: "c2", code: "tp", label: "الأعمال التطبيقية", weight: 1, position: 2, active: true },
  { id: "c3", code: "devoir", label: "الفرض", weight: 1, position: 3, active: true },
  { id: "c4", code: "exam", label: "الاختبار", weight: 2, position: 4, active: true },
];
const sess = (id, term = 1, group = null) => ({
  id, class_id: "k1", group_id: group, term, held_on: "2026-10-18", title: null,
});
const mark = (session, student, score, absent = false) => ({
  session_id: session, student_id: student, score, absent,
});
const rec = (student, extra = {}) => ({
  student_id: student, term: 1, criteria: {}, tp: null, devoir: null, exam: null, ...extra,
});

console.log("\n1. معدّل الحصص: غير المنقَّط والغائب يخرجان ولا يُحسبان صفرًا");
{
  const sessions = [sess("a"), sess("b"), sess("c"), sess("t2", 2)];
  const marks = [
    mark("a", "s1", 15), mark("b", "s1", 17),
    mark("a", "s2", 10), mark("b", "s2", null, true),
    mark("a", "s3", null, true),
    mark("t2", "s1", 2),
    mark("ghost", "s1", 20),
  ];
  const avg = tpAverages(marks, sessions, 1);
  tn("15 و17 = 16", avg.get("s1") ?? null, 16);
  tn("10 وغياب في الثانية = 10 لا 5", avg.get("s2") ?? null, 10);
  t("غائب في كل حصصه: لا معدّل له", avg.has("s3"), false);
  t("تلميذ بلا صفوف: لا معدّل له", avg.has("s9"), false);
  tn("حصة الفصل الثاني لا تدخل الفصل الأول", avg.get("s1") ?? null, 16);
  tn("وتدخل في فصلها", tpAverages(marks, sessions, 2).get("s1") ?? null, 2);
  t("حصة لا وجود لها (صف يتيم) لا تُحسب", [...avg.keys()].sort(), ["s1", "s2"]);
  const zero = tpAverages([mark("a", "z", 0), mark("b", "z", 10)], sessions, 1);
  tn("الصفر المقيَّم يدخل: 0 و10 = 5", zero.get("z") ?? null, 5);
}

console.log("\n2. الهدف مركّبة الأعمال التطبيقية: tp = المعدّل");
{
  const out = applyTpTarget(rec("s1", { tp: 9, devoir: 11 }), "s1", 1, 16, "component", criteria);
  t("tp يحلّ محل اليدوي", out.tp, 16);
  t("بقية المركّبات كما هي", [out.devoir, out.exam], [11, null]);
  const made = applyTpTarget(undefined, "s1", 1, 14, "component", criteria);
  t("بلا سجل: يُصنع سجل للعرض", [made.student_id, made.term, made.tp], ["s1", 1, 14]);
  const same = rec("s1", { tp: 9 });
  t("بلا معدّل: السجل نفسه (اليدوي يبقى)", applyTpTarget(same, "s1", 1, null, "component", criteria), same);
  t("بلا هدف: السجل نفسه", applyTpTarget(same, "s1", 1, 16, null, criteria), same);
  t("لا يعدّل السجل الأصلي (للعرض لا للكتابة)", same.tp, 9);
  t("بلا سجل وبلا معدّل: undefined", applyTpTarget(undefined, "s1", 1, null, "component", criteria), undefined);
}

console.log("\n2ب. الهدف معيار إضافة: المعدّل ÷ 20 × السقف");
{
  const target = criterionTarget("labs");
  t("كود الهدف", targetCriterionCode(target), "labs");
  t("هدف المركّبة ليس معيارًا", targetCriterionCode("component"), null);
  const out = applyTpTarget(rec("s1", { criteria: { part: 2 } }), "s1", 1, 16, target, criteria);
  tn("16/20 × 4 = 3.2", out.criteria.labs, 3.2);
  t("بقية المعايير كما هي", out.criteria.part, 2);
  const ceil10 = applyTpTarget(undefined, "s1", 1, 15, target, [{ ...L, ceiling: 10 }]);
  tn("السقف 10: 15/20 × 10 = 7.5", ceil10.criteria.labs, 7.5);
  const full = applyTpTarget(undefined, "s1", 1, 20, target, criteria);
  tn("20 يبلغ السقف لا يتجاوزه", full.criteria.labs, 4);
  const manual = rec("s1", { criteria: { labs: 1 } });
  tn("المعدّل يحلّ محل القيمة اليدوية في العرض", applyTpTarget(manual, "s1", 1, 16, target, criteria).criteria.labs, 3.2);
  t("وتبقى القيمة اليدوية في السجل الأصلي", manual.criteria.labs, 1);

  const deduct = applyTpTarget(rec("s1"), "s1", 1, 16, criterionTarget("disc"), criteria);
  t("معيار خصم لا يصلح هدفًا: لا أثر", deduct.criteria, {});
  const auto = applyTpTarget(rec("s1"), "s1", 1, 16, criterionTarget("read"), [...criteria, R]);
  t("معيار القراءة لا يصلح هدفًا", auto.criteria, {});
  const gone = applyTpTarget(rec("s1"), "s1", 1, 16, criterionTarget("deleted"), criteria);
  t("معيار محذوف: لا أثر ولا خطأ", gone.criteria, {});
  t("canTargetCriterion", [canTargetCriterion(L), canTargetCriterion(D), canTargetCriterion(R)], [true, false, false]);
}

console.log("\n3. الحساب: المقيَّم يدخل، وغير المقيَّم يخرج (القاعدة نفسها)");
{
  const target = criterionTarget("labs");
  const eff = applyTpTarget(rec("s1"), "s1", 1, 16, target, criteria);
  // الانضباط غير مُخصَم = 4/4، والأعمال 3.2/4: (4 + 3.2) / 8 × 20 = 18
  tn("الأعمال المعدّلة تدخل التقويم المستمر", continuousMark(criteria, eff, []), 18);
  const without = rec("s1");
  // بلا معدّل: معيار الأعمال غير مقيَّم فيخرج، والانضباط وحده لا يكفي مقيَّمًا
  t("بلا معدّل: لا معيار مقيَّم فلا تقويم", continuousMark(criteria, without, []), null);
  tn("ومع معيار آخر مقيَّم يخرج الأعمال من السقف", continuousMark(criteria, rec("s1", { criteria: { part: 4 } }), []), 20);

  const zeroAvg = applyTpTarget(rec("s1"), "s1", 1, 0, target, criteria);
  tn("معدّل صفر مقيَّم يُحسب صفرًا (≠ غير مقيَّم)", continuousMark(criteria, zeroAvg, []), 10);

  // مركّبة tp: تدخل معدّل المادة بمعاملها، وغير المنقَّط يخرج بسطًا ومقامًا
  const comp = applyTpTarget(rec("s1", { devoir: 10, exam: 12 }), "s1", 1, 16, "component", criteria);
  tn("(16 + 10 + 12×2) / 4 = 12.5", termAverage(components, componentValues(criteria, comp, [])), 12.5);
  const noTp = rec("s1", { devoir: 10, exam: 12 });
  tn("بلا معدّل: tp يخرج: (10 + 24) / 3", termAverage(components, componentValues(criteria, noTp, [])), 34 / 3);
}

console.log("\n3ب. الوصف الذي يقرؤه الأستاذ");
{
  t("لم يُربط", describeTarget(null, criteria, components), { ok: false, label: "لم يُربط بعد" });
  t("مركّبة مفعَّلة", describeTarget("component", criteria, components), { ok: true, label: "الأعمال التطبيقية" });
  const off = components.map((c) => (c.code === "tp" ? { ...c, active: false } : c));
  t("مركّبة مطفأة تُنبَّه لا تُخفى", describeTarget("component", criteria, off).ok, false);
  t("معيار سليم", describeTarget(criterionTarget("labs"), criteria, components), { ok: true, label: "الأعمال" });
  t("معيار محذوف", describeTarget(criterionTarget("zzz"), criteria, components).ok, false);
  t("معيار صار خصمًا", describeTarget(criterionTarget("disc"), criteria, components).ok, false);
}

console.log("\n4. الأفواج: التقسيم والتسمية");
{
  t("7 في فوجين: 4 ثم 3", distribute([1, 2, 3, 4, 5, 6, 7], 2).map((b) => b.length), [4, 3]);
  t("7 في 3: 3 و2 و2", distribute([1, 2, 3, 4, 5, 6, 7], 3).map((b) => b.length), [3, 2, 2]);
  t("12 في 4 متساوية", distribute([...Array(12).keys()], 4).map((b) => b.length), [3, 3, 3, 3]);
  t("الترتيب محفوظ", distribute([1, 2, 3, 4, 5], 2), [[1, 2, 3], [4, 5]]);
  t("فوج واحد يأخذ الكل", distribute([1, 2], 1), [[1, 2]]);
  t("عدد غير صالح", distribute([1, 2], 0), []);
  t("فروق الحجم لا تتجاوز واحدًا (1..40 تلميذًا × 2..8 أفواج)", (() => {
    let bad = 0;
    for (let n = 1; n <= 40; n++) for (let k = 1; k <= 8; k++) {
      const sizes = distribute([...Array(n).keys()], k).map((b) => b.length);
      if (Math.max(...sizes) - Math.min(...sizes) > 1) bad++;
      if (sizes.reduce((a, b) => a + b, 0) !== n) bad++;
    }
    return bad;
  })(), 0);

  const seq = [0.1, 0.9, 0.5, 0.3];
  let i = 0;
  const mixed = shuffled([1, 2, 3, 4, 5], () => seq[i++ % seq.length]);
  t("الخلط يحفظ العناصر", [...mixed].sort(), [1, 2, 3, 4, 5]);
  const original = [1, 2, 3];
  shuffled(original);
  t("الخلط لا يغيّر الأصل", original, [1, 2, 3]);

  t("اسم فارغ يعود افتراضيًا", groupLabel({ name: null }, 0), "فوج 1");
  t("الترتيب يحدّد الرقم", groupLabel({ name: "  " }, 1), "فوج 2");
  t("الاسم المُسمّى يظهر", groupLabel({ name: "ب" }, 1), "ب");
  t("تنظيف الفراغات", cleanGroupName("  الفوج   الأول "), "الفوج الأول");
  t("الفارغ يصير null", cleanGroupName("   "), null);
  t("الطول محدود", cleanGroupName("ا".repeat(100))?.length, 40);

  t("فوج واحد مرفوض", groupCountProblem(1, 30) !== "", true);
  t("فوجان مقبولان", groupCountProblem(2, 30), "");
  t("أكثر من الحدّ", groupCountProblem(9, 30) !== "", true);
  t("أكثر من التلاميذ", groupCountProblem(4, 3) !== "", true);
  t("عدد كسري", groupCountProblem(2.5, 30) !== "", true);
}

console.log("\n4ب. العضوية والتوزيع");
{
  const groups = [{ id: "g1" }, { id: "g2" }];
  const students = [
    { id: "a", group_id: "g1" }, { id: "b", group_id: "g2" }, { id: "c", group_id: null },
    { id: "d", group_id: "gone" }, { id: "e", group_id: "g1" },
  ];
  const m = membership(students, groups);
  t("تلاميذ الفوج الأول بترتيب القسم", m.byGroup.get("g1"), ["a", "e"]);
  t("الثاني", m.byGroup.get("g2"), ["b"]);
  t("بلا فوج + فوج محذوف", m.ungrouped, ["c", "d"]);
  t("لا أحد يضيع", [...m.byGroup.values()].flat().length + m.ungrouped.length, students.length);
  t("فوج فارغ يظهر بقائمة فارغة", membership([], groups).byGroup.get("g2"), []);

  const plan = assignment(["s1", "s2", "s3", "s4", "s5"], ["g1", "g2"]);
  t("كل تلميذ يأخذ فوجًا", plan.length, 5);
  t("الكتلة الأولى للفوج الأول", plan.filter((p) => p.group_id === "g1").map((p) => p.student_id), ["s1", "s2", "s3"]);
  t("والثانية للثاني", plan.filter((p) => p.group_id === "g2").map((p) => p.student_id), ["s4", "s5"]);
}

console.log("\n5. الطابور: حصة وعلامة");
{
  let seq = 0;
  const base = () => ({ id: `op${++seq}`, at: 1000 + seq, tries: 0, error: null, blocked: false, nextTry: 0 });
  const sessionOp = (id, title = null) => ({ ...base(), kind: "tp-session", session: { ...sess(id), title } });
  const markOp = (session, student, score, absent = false) => ({
    ...base(), kind: "tp-mark", session_id: session, student_id: student, score, absent,
  });

  t("مفتاح الحصة", opKey(sessionOp("x")), "tpsession:x");
  t("مفتاح العلامة", opKey(markOp("x", "s1", 12)), "tpmark:x:s1");
  t("صاحب العلامة", [opStudentId(markOp("x", "s1", 12)), opSessionId(markOp("x", "s1", 12))], ["s1", "x"]);
  t("الحصة ليست لتلميذ", [opStudentId(sessionOp("x")), opSessionId(sessionOp("x"))], [null, "x"]);

  let q = [];
  q = enqueue(q, sessionOp("x"));
  q = enqueue(q, markOp("x", "s1", 10));
  q = enqueue(q, markOp("x", "s1", 11));
  q = enqueue(q, markOp("x", "s1", 14));
  t("ثلاث ضغطات على التلميذ نفسه في الحصة = عملية واحدة", q.filter((o) => o.kind === "tp-mark").length, 1);
  t("تحمل آخر قيمة", q.find((o) => o.kind === "tp-mark").score, 14);
  q = enqueue(q, markOp("x", "s2", 9));
  q = enqueue(q, markOp("y", "s1", 9));
  t("تلميذ آخر وحصة أخرى: مستقلّتان", q.filter((o) => o.kind === "tp-mark").length, 3);
  t("الحصة تسبق علامتها", q.findIndex((o) => o.kind === "tp-session") < q.findIndex((o) => o.kind === "tp-mark"), true);

  const blocked = [{ ...markOp("x", "s1", 5), blocked: true, tries: 3, error: "رفض", nextTry: 9e9 }];
  const again = enqueue(blocked, markOp("x", "s1", 6));
  t("الدمج يصفّر المحاولات", [again[0].blocked, again[0].tries, again[0].score], [false, 0, 6]);

  const flying = [markOp("x", "s1", 5)];
  const next = enqueue(flying, markOp("x", "s1", 6), flying[0].id);
  t("ما هو في الطريق لا يُمسّ", [next.length, next[0].score, next[1].score], [2, 5, 6]);

  const edited = enqueue([sessionOp("x", "أ")], sessionOp("x", "ب"));
  t("تعديل حصة لم تُرسل يدمج", [edited.length, edited[0].session.title], [1, "ب"]);

  t("العلامات علامات والحصة تعديل", (({ marks, edits }) => [marks, edits])(pending(q)), [3, 1]);
  t("نصّ المؤشّر", pendingLabel([markOp("x", "s1", 1), markOp("x", "s2", 1)]), "علامتان لم تُرسل");
}

console.log("\n5ب. تطبيق الطابور فوق نسخة الخادم");
{
  let seq = 100;
  const base = () => ({ id: `op${++seq}`, at: 1000 + seq, tries: 0, error: null, blocked: false, nextTry: 0 });
  const markOp = (session, student, score, absent = false) => ({
    ...base(), kind: "tp-mark", session_id: session, student_id: student, score, absent,
  });
  const server = [mark("x", "s1", 10), mark("x", "s2", 12)];

  t("علامة جديدة تُضاف", applyTpMarks(server, [markOp("x", "s3", 8)]).length, 3);
  t("المعلّقة تحلّ محل المخزَّنة", applyTpMarks(server, [markOp("x", "s1", 18)]).find((m) => m.student_id === "s1").score, 18);
  t("الغياب علامة فارغة وغياب", applyTpMarks(server, [markOp("x", "s1", null, true)]).find((m) => m.student_id === "s1"), mark("x", "s1", null, true));
  t("الغياب يغلب علامة معها", applyTpMarks(server, [markOp("x", "s1", 15, true)]).find((m) => m.student_id === "s1").score, null);
  const cleared = applyTpMarks(server, [markOp("x", "s1", null, false)]);
  t("المسح يُخرج الصف: يعود «لم يُقيَّم» لا صفرًا", cleared.some((m) => m.student_id === "s1"), false);
  t("والباقي لا يُمسّ", cleared.length, 1);
  t("بلا عمليات: النسخة نفسها", applyTpMarks(server, []), server);
  tn("المسح لا يترك صفرًا في المعدّل", tpAverages(cleared, [sess("x")], 1).get("s2") ?? null, 12);
  t("وصاحب المسح بلا معدّل", tpAverages(cleared, [sess("x")], 1).has("s1"), false);

  const sessions = [sess("x")];
  const added = applyTpSessions(sessions, [{ ...base(), kind: "tp-session", session: sess("y") }]);
  t("حصة جديدة تظهر فورًا", added.map((s) => s.id), ["x", "y"]);
  const renamed = applyTpSessions(sessions, [{ ...base(), kind: "tp-session", session: { ...sess("x"), title: "مخبر" } }]);
  t("وتعديل حصة قائمة يحلّ محلّها", [renamed.length, renamed[0].title], [1, "مخبر"]);
  t("بلا عمليات: النسخة نفسها", applyTpSessions(sessions, []), sessions);
}

console.log(`\n${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail ? 1 : 0);
