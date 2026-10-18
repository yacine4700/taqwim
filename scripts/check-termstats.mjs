/* اختبار إحصاء القسم في فصل بعينه (termStatsFor) — لمقارنة الفصل بالسابق.
   يستورد الشفرة الحقيقية. يحتاج Node 22.6 فأحدث مع --experimental-strip-types. */

import {
  applyTpTarget,
  classStats,
  componentValues,
  termAverage,
  termStatsFor,
  tpAverages,
  TP_COMPONENT,
} from "../src/lib/scoring.ts";

let pass = 0, fail = 0;
function t(name, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
}
const near = (a, b) => a !== null && b !== null && Math.abs(a - b) < 1e-9;
function tn(name, got, want) {
  if (near(got, want)) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${got}\n       want ${want}`); }
}

// الخلاصة: التقويم المستمر مطفأ هنا، فالمعدل من الفرض (×2) والاختبار (×3) وحدهما
// فيُحسب بالإصبع: (10×2 + 12×3) / 5 = 11.2
const criteria = [{ id: "p", code: "part", label: "المشاركة", kind: "add", base: 0, ceiling: 4, position: 1 }];
const components = [
  { id: "c1", code: "cc", label: "التقويم المستمر", weight: 1, position: 1, active: false },
  { id: "c2", code: "tp", label: "الأعمال التطبيقية", weight: 1, position: 2, active: false },
  { id: "c3", code: "devoir", label: "الفرض", weight: 2, position: 3, active: true },
  { id: "c4", code: "exam", label: "الاختبار", weight: 3, position: 4, active: true },
];
const students = [{ id: "A" }, { id: "B" }, { id: "C" }];
const rec = (student_id, term, devoir, exam) => ({ student_id, term, criteria: {}, tp: null, devoir, exam });
const records = [
  rec("A", 1, 10, 12),   // ف1: 11.2
  rec("B", 1, 8, 8),     // ف1: 8
  rec("A", 2, 14, 16),   // ف2: (28+48)/5 = 15.2
  rec("C", 2, 6, 9),     // ف2: (12+27)/5 = 7.8
];
const base = { students, target: null, records, readings: [], tpMarks: [], sessions: [], criteria, components };

console.log("— حساب بالإصبع");
const s1 = termStatsFor({ ...base, term: 1 });
tn("ف1: معدل A", s1.values[1], 11.2);
tn("ف1: معدل B", s1.values[0], 8);
t("ف1: منقَّطان من ثلاثة", [s1.scored, s1.total], [2, 3]);
tn("ف1: معدل القسم", s1.mean, (11.2 + 8) / 2);

const s2 = termStatsFor({ ...base, term: 2 });
t("ف2: A وC فقط", [s2.scored, s2.total], [2, 3]);
tn("ف2: معدل القسم", s2.mean, (15.2 + 7.8) / 2);

console.log("— العزل بين الفصول");
const s3 = termStatsFor({ ...base, term: 3 });
t("ف3: لا علامات فلا معدل", [s3.scored, s3.mean], [0, null]);
t("ف1 لا يرى علامات ف2", s1.values.includes(15.2) || s1.values.includes(7.8), false);

console.log("— المحاولات لا تتسرّب بين الفصول");
const reads = [
  { id: "r1", student_id: "A", term: 1, score: 3, read_on: "2026-10-01" },
  { id: "r2", student_id: "B", term: 2, score: 2, read_on: "2026-11-01" },
];
t("ف1: غير المقروء لهم", termStatsFor({ ...base, readings: reads, term: 1 }).unread, 2);
t("ف2: غير المقروء لهم", termStatsFor({ ...base, readings: reads, term: 2 }).unread, 2);
t("ف3: لا أحد قُرئ له", termStatsFor({ ...base, readings: reads, term: 3 }).unread, 3);

console.log("— معدّل الحصص يخصّ فصله");
const sessions = [{ id: "s1", class_id: "k", group_id: null, term: 1, held_on: "2026-10-05", title: null }];
const tpMarks = [{ session_id: "s1", student_id: "C", score: 18, absent: false }];
const tpComponents = components.map((c) => (c.code === "tp" ? { ...c, active: true } : c));
const withTp = { ...base, components: tpComponents, target: TP_COMPONENT, tpMarks, sessions };
const tp1 = termStatsFor({ ...withTp, term: 1 });
t("ف1: C نُقِّط بالحصص فصار منقَّطًا", tp1.scored, 3);
tn("ف1: معدل C من الحصص وحدها = 18", tp1.values[2], 18);
const tp2 = termStatsFor({ ...withTp, term: 2 });
tn("ف2: C بلا حصص فمعدله من فرضه واختباره", tp2.values[0], 7.8);

console.log("— مطابقة التركيب القديم في الفصل نفسه");
for (const term of [1, 2]) {
  const tpAvg = tpAverages(tpMarks, sessions, term);
  const averages = students.map((s) => {
    const r = applyTpTarget(records.find((x) => x.student_id === s.id && x.term === term), s.id, term, tpAvg.get(s.id) ?? null, TP_COMPONENT, criteria);
    return termAverage(tpComponents, componentValues(criteria, r, []));
  });
  const old = classStats(averages, 3);
  const now = termStatsFor({ ...withTp, term });
  t(`ف${term}: القيم نفسها`, now.values, old.values);
  t(`ف${term}: الإحصاء كله نفسه`, { ...now, unread: 0 }, { ...old, unread: 0 });
}

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
