/**
 * حساب التقويم المستمر ومعدل المادة.
 *
 * القاعدة التي يقوم عليها الحساب كله: المعيار الذي لم يُقيَّم بعد يُستبعد من
 * السقف، ولا يُحسب صفرًا. فمعيار الخصم (الانضباط، الأدوات) أصله العلامة
 * الكاملة والخانة الفارغة تعني أن التلميذ لم يُخصم منه شيء، فيُحسب دائمًا؛
 * ومعيار الإضافة (المشاركة، الواجبات، القراءة) يبدأ من صفر والخانة الفارغة
 * تعني أنه لم يُقيَّم بعد، فيخرج من البسط والمقام معًا. بهذا يبقى المعدل
 * صحيحًا في منتصف الفصل بدل أن يُظهر التلميذ أضعف مما هو.
 *
 * نفس المنطق مكتوب في مناظر قاعدة البيانات (v_continuous و v_term_average)،
 * وهذه النسخة للواجهة حتى تتحدّث الأرقام فور النقر دون انتظار الخادم.
 */

export type CriterionKind = "deduct" | "add" | "auto";

export type Criterion = {
  id: string;
  code: string;
  label: string;
  kind: CriterionKind;
  base: number;
  ceiling: number;
  position: number;
};

export type Component = {
  id: string;
  code: string;
  label: string;
  weight: number;
  position: number;
  /** المركّبة المطفأة تخرج من معدل المادة بسطًا ومقامًا. */
  active: boolean;
};

export type RecordRow = {
  student_id: string;
  term: number;
  criteria: Record<string, number>;
  tp: number | null;
  devoir: number | null;
  exam: number | null;
};

export type Reading = {
  id: string;
  student_id: string;
  term: number;
  score: number;
  read_on: string;
};

/** متوسط محاولات القراءة، أو null إن لم يُقرأ له بعد. */
export function readingAverage(readings: Reading[]): number | null {
  if (!readings.length) return null;
  const total = readings.reduce((sum, r) => sum + Number(r.score), 0);
  return total / readings.length;
}

/** قيمة معيار واحد لتلميذ: من السجل، أو من المحاولات إن كان محسوبًا. */
function criterionValue(
  criterion: Criterion,
  record: RecordRow | undefined,
  readings: Reading[],
): number | null {
  if (criterion.kind === "auto") return readingAverage(readings);
  const raw = record?.criteria?.[criterion.code];
  return typeof raw === "number" ? raw : null;
}

/** التقويم المستمر على 20، أو null إن لم يُقيَّم أي معيار بعد. */
export function continuousMark(
  criteria: Criterion[],
  record: RecordRow | undefined,
  readings: Reading[],
): number | null {
  const touched = criteria.some(
    (c) => criterionValue(c, record, readings) !== null,
  );
  if (!touched) return null;

  let raw = 0;
  let ceiling = 0;
  for (const c of criteria) {
    const value = criterionValue(c, record, readings);
    const counts = c.base > 0 || value !== null;
    if (!counts) continue;
    raw += Math.max(0, Math.min(c.ceiling, c.base + (value ?? 0)));
    ceiling += c.ceiling;
  }
  return ceiling ? (raw / ceiling) * 20 : null;
}

/** المركّبات الأربع التي يحفظها جدول العلامات. */
export const MARK_FIELDS = ["tp", "devoir", "exam"] as const;
export type MarkField = (typeof MARK_FIELDS)[number];

export type ComponentValues = Record<string, number | null>;

export function componentValues(
  criteria: Criterion[],
  record: RecordRow | undefined,
  readings: Reading[],
): ComponentValues {
  return {
    cc: continuousMark(criteria, record, readings),
    tp: record?.tp ?? null,
    devoir: record?.devoir ?? null,
    exam: record?.exam ?? null,
  };
}

/**
 * معدل المادة: تخرج من القسمة المركّبة المطفأة والمركّبة غير المنقَّطة معًا.
 * نفس ما يفعله منظر v_term_average في القاعدة.
 */
export function termAverage(
  components: Component[],
  values: ComponentValues,
): number | null {
  let weighted = 0;
  let weights = 0;
  for (const component of components) {
    if (!component.active) continue;
    const value = values[component.code];
    if (value === null || value === undefined) continue;
    const weight = Number(component.weight);
    if (!Number.isFinite(weight)) continue;
    weighted += value * weight;
    weights += weight;
  }
  return weights ? weighted / weights : null;
}

export const GRADES: Array<[number, string]> = [
  [16, "ممتاز"],
  [14, "جيد جدا"],
  [12, "جيد"],
  [10, "مقبول"],
  [8, "قريب من المعدل"],
  [0, "ضعيف"],
];

export function grade(average: number | null): string {
  if (average === null) return "";
  for (const [floor, label] of GRADES) if (average >= floor) return label;
  return "";
}

export type ClassStats = {
  total: number;
  scored: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  passRate: number | null;
  unread: number;
  values: number[];
};

export function classStats(
  averages: Array<number | null>,
  unread: number,
): ClassStats {
  const values = averages.filter((a): a is number => a !== null).sort((a, b) => a - b);
  const n = values.length;
  if (!n) {
    return {
      total: averages.length, scored: 0, mean: null, median: null, sd: null,
      min: null, max: null, passRate: null, unread, values,
    };
  }
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const median = n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2;
  const passed = values.filter((v) => v >= 10).length;
  return {
    total: averages.length,
    scored: n,
    mean,
    median,
    sd: Math.sqrt(variance),
    min: values[0],
    max: values[n - 1],
    passRate: passed / n,
    unread,
    values,
  };
}

/**
 * ترشيح تلاميذ الحصة: الأقل محاولات أولًا، والاختيار عشوائي بين المتساوين.
 * العشوائية الخالصة تُهمل بعض التلاميذ طوال الفصل وتكرّر غيرهم، وهذا يضمن
 * تغطية القسم كله بالتساوي مع بقاء الاختيار غير متوقَّع للتلاميذ.
 */
export function pickForSession<T extends { id: string }>(
  students: T[],
  attemptsOf: (studentId: string) => number,
  count: number,
): T[] {
  const groups = new Map<number, T[]>();
  for (const student of students) {
    const n = attemptsOf(student.id);
    const group = groups.get(n);
    if (group) group.push(student);
    else groups.set(n, [student]);
  }
  const picked: T[] = [];
  for (const n of [...groups.keys()].sort((a, b) => a - b)) {
    const group = [...groups.get(n)!];
    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }
    for (const student of group) {
      if (picked.length >= count) break;
      picked.push(student);
    }
    if (picked.length >= count) break;
  }
  return picked;
}

export function fmt(value: number | null, digits = 2): string {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

/* ---------- إعداد المعايير ---------- */

/** مجموع سقوف المعايير كما ضبطها الأستاذ. المعتاد 20. */
export function criteriaTotal(criteria: Criterion[]): number {
  return criteria.reduce((sum, c) => sum + Number(c.ceiling), 0);
}

export type TotalCheck = {
  total: number;
  exact: boolean;
  /** نص التنبيه، أو سلسلة فارغة إن كان المجموع 20 بالضبط. */
  warning: string;
};

/**
 * المجموع لا يلزم أن يكون 20: الحساب يقسم على مجموع سقوف المعايير المحسوبة
 * ثم يضرب في 20، فالنقطة تُحوَّل إلى 20 في كل الأحوال. لكن الأستاذ يحتاج أن
 * يعرف أن التحويل يجري، لأن «خصم نقطة» من مجموع 25 ليس خصم نقطة من 20.
 */
export function checkTotal(criteria: Criterion[]): TotalCheck {
  const total = criteriaTotal(criteria);
  const exact = Math.abs(total - 20) < 1e-9;
  if (criteria.length === 0) {
    return { total, exact: false, warning: "لا معايير: التقويم المستمر لن يُحسب." };
  }
  if (exact) return { total, exact, warning: "" };
  const side = total < 20 ? "أقل" : "أكثر";
  return {
    total,
    exact,
    warning:
      `المجموع ${trim(total)} وهو ${side} من 20، ` +
      `فسيحوّل البرنامج النقطة إلى 20 (× ${trim(20 / total)}).`,
  };
}

function trim(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** خطوة العدّاد: تكبر مع السقف حتى لا يطول الضغط على الزرّ. */
export function stepFor(criterion: Pick<Criterion, "ceiling">): number {
  const span = Number(criterion.ceiling);
  if (!Number.isFinite(span) || span <= 0) return 0.5;
  return span <= 5 ? 0.5 : span <= 10 ? 1 : 2;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/* ---------- العدّاد ---------- */

/**
 * العلامة كما تُعرض في العدّاد، لا كما تُخزَّن.
 *
 * المخزَّن في معيار الخصم هو مقدار الخصم (سالب)، والمعروض هو ما بقي للتلميذ.
 * وفي معيار الإضافة المخزَّن هو المعروض نفسه، و`null` تعني «لم يُقيَّم» —
 * وهي ليست صفرًا: الصفر يدخل الحساب وغير المقيَّم يخرج منه.
 */
export function shownValue(
  criterion: Pick<Criterion, "kind" | "base" | "ceiling">,
  value: number | null,
): number | null {
  const ceiling = Number(criterion.ceiling);
  if (criterion.kind === "deduct") {
    return clamp(Number(criterion.base) + (value ?? 0), 0, ceiling);
  }
  return value === null ? null : clamp(value, 0, ceiling);
}

/**
 * القيمة المخزَّنة بعد ضغطة واحدة على ناقص أو زائد.
 *
 * ناقصٌ على معيار إضافة لم يُقيَّم بعد لا يفعل شيئًا: الطريق إلى «غير مقيَّم»
 * هو زرّ «مسح» وحده، فلا يصير الفارغ صفرًا بضغطة في غير محلّها.
 */
export function bump(
  criterion: Pick<Criterion, "kind" | "base" | "ceiling">,
  value: number | null,
  delta: number,
): number | null {
  const ceiling = Number(criterion.ceiling);
  const base = Number(criterion.base);
  const shown = shownValue(criterion, value);
  if (criterion.kind === "deduct") {
    return Number((clamp((shown ?? ceiling) + delta, 0, ceiling) - base).toFixed(2));
  }
  if (value === null && delta < 0) return null;
  return Number(clamp((shown ?? 0) + delta, 0, ceiling).toFixed(2));
}

/**
 * خيارات التنقيط لمعيار واحد، مولَّدة من سقفه لا من قائمة ثابتة:
 * معيار الخصم يعطي 0 ثم قيمًا سالبة حتى −السقف، ومعيار الإضافة من 0 إلى السقف.
 * تُستعمل الآن في سلّم محاولات القراءة في الحصة.
 */
export function optionsFor(criterion: Criterion): number[] {
  const span = Number(criterion.ceiling);
  if (!Number.isFinite(span) || span <= 0) return [0];
  const step = stepFor(criterion);
  const out: number[] = [];
  for (let v = 0; v <= span + 1e-9; v += step) out.push(Number(v.toFixed(2)));
  if (out[out.length - 1] !== span) out.push(span);
  return criterion.kind === "deduct" ? out.map((v) => (v === 0 ? 0 : -v)) : out;
}
