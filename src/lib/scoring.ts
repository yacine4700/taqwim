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

export type ComponentValues = {
  cc: number | null;
  tp: number | null;
  devoir: number | null;
  exam: number | null;
};

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

/** معدل المادة: المركّبة غير المنقَّطة تخرج من القسمة. */
export function termAverage(
  components: Component[],
  values: ComponentValues,
): number | null {
  let weighted = 0;
  let weights = 0;
  for (const component of components) {
    const value = values[component.code as keyof ComponentValues];
    if (value === null || value === undefined) continue;
    weighted += value * component.weight;
    weights += component.weight;
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
