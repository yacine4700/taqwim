/* نسخة حرفية من منطق src/lib/scoring.ts، لاختباره بالأرقام */

function readingAverage(readings) {
  if (!readings.length) return null;
  return readings.reduce((s, r) => s + Number(r.score), 0) / readings.length;
}

function criterionValue(c, record, readings) {
  if (c.kind === "auto") return readingAverage(readings);
  const raw = record?.criteria?.[c.code];
  return typeof raw === "number" ? raw : null;
}

function continuousMark(criteria, record, readings) {
  const touched = criteria.some((c) => criterionValue(c, record, readings) !== null);
  if (!touched) return null;
  let raw = 0, ceiling = 0;
  for (const c of criteria) {
    const value = criterionValue(c, record, readings);
    const counts = c.base > 0 || value !== null;
    if (!counts) continue;
    raw += Math.max(0, Math.min(c.ceiling, c.base + (value ?? 0)));
    ceiling += c.ceiling;
  }
  return ceiling ? (raw / ceiling) * 20 : null;
}

function componentValues(criteria, record, readings) {
  return {
    cc: continuousMark(criteria, record, readings),
    tp: record?.tp ?? null,
    devoir: record?.devoir ?? null,
    exam: record?.exam ?? null,
  };
}

function termAverage(components, values) {
  let weighted = 0, weights = 0;
  for (const c of components) {
    if (!c.active) continue;
    const value = values[c.code];
    if (value === null || value === undefined) continue;
    const w = Number(c.weight);
    if (!Number.isFinite(w)) continue;
    weighted += value * w;
    weights += w;
  }
  return weights ? weighted / weights : null;
}

function criteriaTotal(cs) { return cs.reduce((s, c) => s + Number(c.ceiling), 0); }

function optionsFor(criterion) {
  const span = Number(criterion.ceiling);
  if (!Number.isFinite(span) || span <= 0) return [0];
  const step = span <= 5 ? 0.5 : span <= 10 ? 1 : 2;
  const out = [];
  for (let v = 0; v <= span + 1e-9; v += step) out.push(Number(v.toFixed(2)));
  if (out[out.length - 1] !== span) out.push(span);
  return criterion.kind === "deduct" ? out.map((v) => (v === 0 ? 0 : -v)) : out;
}

/* ---------- الإعداد الافتراضي ---------- */
const DEF = [
  { code: "disc", kind: "deduct", base: 4, ceiling: 4 },
  { code: "tool", kind: "deduct", base: 4, ceiling: 4 },
  { code: "part", kind: "add", base: 0, ceiling: 4 },
  { code: "hw", kind: "add", base: 0, ceiling: 4 },
  { code: "read", kind: "auto", base: 0, ceiling: 4 },
];
const COMPS = [
  { code: "cc", weight: 1, active: true },
  { code: "tp", weight: 1, active: true },
  { code: "devoir", weight: 1, active: true },
  { code: "exam", weight: 2, active: true },
];

let pass = 0, fail = 0;
const near = (a, b) => a === null || b === null ? a === b : Math.abs(a - b) < 0.005;
function t(name, got, want) {
  const label = typeof got === "number" ? got.toFixed(2) : String(got);
  if (typeof got === "number" || typeof want === "number"
        ? near(got, want)
        : got === want) { pass++; console.log(`  ok   ${name}  = ${label}`); }
  else { fail++; console.log(`  FAIL ${name}  got ${got} want ${want}`); }
}

console.log("\n1. مطابقة نتائج القاعدة الحقيقية");
t("disc=-0.5 لا شيء غيره", continuousMark(DEF, { criteria: { disc: -0.5 } }, []), 18.75);
t("disc=-4, part=1", continuousMark(DEF, { criteria: { disc: -4, part: 1 } }, []), 8.3333);
t("قراءة 2 بلا سجل", continuousMark(DEF, undefined, [{ score: 2 }]), 16.6667);

console.log("\n2. القاعدة: المعيار غير المقيَّم يخرج ولا يُحسب صفرًا");
t("لا شيء مطلقًا → null", continuousMark(DEF, undefined, []), null);
t("كل المعايير كاملة", continuousMark(DEF, { criteria: { part: 4, hw: 4 } }, [{ score: 4 }]), 20);
t("خصم 1 من الانضباط وحده", continuousMark(DEF, { criteria: { disc: -1 } }, []), 17.5);
t("part=0 صريحة تُحسب", continuousMark(DEF, { criteria: { part: 0 } }, []), 13.3333);

console.log("\n3. التقييد: لا يتجاوز السقف ولا ينزل تحت الصفر");
t("خصم أكبر من السقف", continuousMark(DEF, { criteria: { disc: -9 } }, []), 10);
t("إضافة أكبر من السقف", continuousMark(DEF, { criteria: { part: 99 } }, []), 20);

console.log("\n4. المجموع ≠ 20 → تحويل");
const T25 = DEF.map((c) => c.code === "exam" ? c : { ...c, ceiling: 5, base: c.base > 0 ? 5 : 0 });
t("مجموع 25، خصم 1", continuousMark(T25, { criteria: { disc: -1 } }, []), 18);
t("مجموع 25 كامل", continuousMark(T25, { criteria: { part: 5, hw: 5 } }, [{ score: 5 }]), 20);
const T10 = [{ code: "a", kind: "deduct", base: 6, ceiling: 6 }, { code: "b", kind: "add", base: 0, ceiling: 4 }];
t("مجموع 10، خصم 3 و b=2", continuousMark(T10, { criteria: { a: -3, b: 2 } }, []), 10);
t("المجموع صحيح", criteriaTotal(DEF), 20);

console.log("\n5. معدل المادة: المركّبة المطفأة والفارغة تخرجان");
const full = { criteria: { part: 4, hw: 4 }, tp: 12, devoir: 14, exam: 16 };
t("الكل منقَّط", termAverage(COMPS, componentValues(DEF, full, [{ score: 4 }])), (20 + 12 + 14 + 32) / 5);
const noTp = COMPS.map((c) => c.code === "tp" ? { ...c, active: false } : c);
t("tp مطفأة ولها علامة", termAverage(noTp, componentValues(DEF, full, [{ score: 4 }])), (20 + 14 + 32) / 4);
t("tp مفعّلة بلا علامة", termAverage(COMPS, componentValues(DEF, { ...full, tp: null }, [{ score: 4 }])), (20 + 14 + 32) / 4);
t("الاختبار وحده", termAverage(COMPS, { cc: null, tp: null, devoir: null, exam: 13 }), 13);
t("لا شيء منقَّط", termAverage(COMPS, { cc: null, tp: null, devoir: null, exam: null }), null);
t("كل المعاملات صفر", termAverage(COMPS.map((c) => ({ ...c, weight: 0 })), { cc: 10, tp: 10, devoir: 10, exam: 10 }), null);
t("مركّبة بمعامل 0", termAverage([{ code: "cc", weight: 1, active: true }, { code: "exam", weight: 0, active: true }], { cc: 12, exam: 20 }), 12);

console.log("\n6. خيارات التنقيط مولَّدة من السقف");
const show = (c) => JSON.stringify(optionsFor(c));
console.log("  خصم /4 :", show({ kind: "deduct", ceiling: 4 }));
console.log("  إضافة /4:", show({ kind: "add", ceiling: 4 }));
console.log("  إضافة /6:", show({ kind: "add", ceiling: 6 }));
console.log("  إضافة /20:", show({ kind: "add", ceiling: 20 }));
console.log("  إضافة /2.5:", show({ kind: "add", ceiling: 2.5 }));
for (const ceiling of [0.5, 1, 2.5, 3, 4, 5, 6, 7, 10, 12, 20]) {
  for (const kind of ["add", "deduct"]) {
    const o = optionsFor({ kind, ceiling });
    const bad = o.some((v) => Math.abs(v) > ceiling + 1e-9)
      || !o.includes(0)
      || !o.some((v) => Math.abs(Math.abs(v) - ceiling) < 1e-9)
      || o.length > 14;
    if (bad) { fail++; console.log(`  FAIL ${kind}/${ceiling}: ${JSON.stringify(o)}`); } else pass++;
  }
}
console.log(`  ok   كل السقوف تعطي خيارات داخل المجال، فيها 0 والسقف، وأقل من 15 زرًا`);

console.log("\n7. عدّاد المعيار: ما يُخزَّن عند كل ضغطة");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function stepFor(c) { const s = Number(c.ceiling); return s <= 5 ? 0.5 : s <= 10 ? 1 : 2; }
/** يحاكي bump في CriterionCounter ويرجع القيمة المخزَّنة الجديدة. */
function bump(c, value, dir) {
  const ceiling = Number(c.ceiling), base = Number(c.base), step = stepFor(c) * dir;
  const assessed = value !== null;
  const shown = c.kind === "deduct"
    ? clamp(base + (value ?? 0), 0, ceiling)
    : assessed ? clamp(value, 0, ceiling) : null;
  if (c.kind === "deduct") return Number((clamp((shown ?? ceiling) + step, 0, ceiling) - base).toFixed(2));
  if (!assessed && step < 0) return value;
  return Number(clamp((shown ?? 0) + step, 0, ceiling).toFixed(2));
}
const D = { code: "disc", kind: "deduct", base: 4, ceiling: 4 };
const A = { code: "part", kind: "add", base: 0, ceiling: 4 };
const seen = (c, v) => c.kind === "deduct"
  ? clamp(Number(c.base) + (v ?? 0), 0, c.ceiling)
  : (v === null ? null : clamp(v, 0, c.ceiling));

// معيار الخصم: يبدأ كاملًا فينزل بالضغط، والعلامة المعروضة تطابق المخزَّنة
let v = null;
const downs = [];
for (let i = 0; i < 9; i++) { v = bump(D, v, -1); downs.push(`${seen(D, v)}(${v})`); }
t("الخصم ينزل إلى 0 ويتوقف", seen(D, v), 0);
console.log("       ", downs.join(" → "));
v = bump(D, v, +1); t("ثم يعود بزائد", seen(D, v), 0.5);

// معيار الإضافة: «لم يُقيَّم» ليس صفرًا
v = null;
t("ناقص على غير المقيَّم لا يفعل شيئًا", bump(A, v, -1), null);
v = bump(A, v, +1); t("أول زائد يجعله 0.5", v, 0.5);
for (let i = 0; i < 20; i++) v = bump(A, v, +1);
t("لا يتجاوز السقف", v, 4);
v = bump(A, 0.5, -1); t("ينزل إلى صفر مقيَّم", v, 0);
t("صفر مقيَّم ≠ غير مقيَّم", continuousMark([A, D], { criteria: { part: 0 } }, []) !== continuousMark([A, D], { criteria: {} }, []), true);

// كل علامة يُنتجها العدّاد تبقى داخل المجال بعد الحساب
let bad = 0;
for (const c of [D, A, { ...D, ceiling: 6, base: 6 }, { ...A, ceiling: 12 }]) {
  let cur = null;
  for (let i = 0; i < 30; i++) {
    cur = bump(c, cur, i % 3 === 0 ? +1 : -1);
    const s = seen(c, cur);
    if (s !== null && (s < 0 || s > Number(c.ceiling))) bad++;
  }
}
t("لا علامة خارج [0, السقف] بعد 120 ضغطة", bad, 0);

console.log(`\n${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail ? 1 : 0);
