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
  /**
   * كود المعيار (من نوع auto) الذي تنتمي إليه المحاولة. غائب في محاولة سُجّلت قبل أن
   * تنتمي المحاولات إلى معايير (طابور قديم على هاتف)، وتُعامَل كمحاولة معيار القراءة.
   * القاعدة تفعل الشيء نفسه بقيمة افتراضية: يجب أن يبقيا متطابقين.
   */
  criterion_code?: string;
  /**
   * وقت تسجيل المحاولة في الخادم، أو وقت حفظها في الهاتف ما دامت في الطابور.
   * لا يُرسل: القاعدة تضع وقتها. يُستعمل لمعرفة آخر من قرأ فقط.
   */
  created_at?: string;
};

/** كود معيار القراءة الافتراضي، وهو ما تأخذه المحاولة بلا كود. */
export const DEFAULT_READING_CODE = "read";

export function readingCode(reading: Reading): string {
  return reading.criterion_code ?? DEFAULT_READING_CODE;
}

/** محاولات معيار واحد وحده. */
export function readingsFor(readings: Reading[], code: string): Reading[] {
  return readings.filter((r) => readingCode(r) === code);
}

/** المعايير التي تُحسب من محاولات السحب في الحصة. */
export function autoCriteria(criteria: Criterion[]): Criterion[] {
  return criteria.filter((c) => c.kind === "auto");
}

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
  if (criterion.kind === "auto") return readingAverage(readingsFor(readings, criterion.code));
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
 * كم تلميذًا يقرأ قبل أن يعود من قرأ. يعود التلميذ إلى الاختيار بعد أن يقرأ بعده
 * ثمانية آخرون من القسم نفسه في المعيار نفسه (طلب الأستاذ، 7 نوفمبر 2026).
 */
export const READING_COOLDOWN = 8;

/**
 * وقت المحاولة للترتيب: وقت تسجيلها، وإلا يومها (محاولة من نسخة أقدم بلا وقت).
 * «2026-11-07» تسبق «2026-11-07T…» في المقارنة النصية، فالمحاولة بلا وقت تُعدّ أقدم
 * من محاولات يومها ذات الوقت، وهذا يكفي.
 */
export function readingTime(reading: Reading): string {
  return reading.created_at ?? reading.read_on;
}

/**
 * آخر من قرؤوا، الأحدث أولًا وبلا تكرار، وعددهم `cooldown` على الأكثر.
 * `readings` محاولات قسم واحد ومعيار واحد. المحفوظة معًا في دفعة واحدة تتساوى
 * في الوقت، فيُقدَّم الأخير في القائمة.
 */
export function recentReaders(readings: Reading[], cooldown = READING_COOLDOWN): string[] {
  const ordered = readings
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ta = readingTime(a.r), tb = readingTime(b.r);
      return ta === tb ? b.i - a.i : ta < tb ? 1 : -1;
    });
  const out: string[] = [];
  for (const { r } of ordered) {
    if (out.length >= cooldown) break;
    if (!out.includes(r.student_id)) out.push(r.student_id);
  }
  return out;
}

/**
 * ترشيح تلاميذ الحصة (الخيار «ج»، 7 نوفمبر 2026):
 *
 * 1. من قرأ مؤخّرًا (`recent`: آخر ثمانية، الأحدث أولًا) لا يُختار. إن لم يبقَ من
 *    غيرهم ما يكفي العدد يعود أقدمهم أولًا، فلا تُعطى قائمة ناقصة في قسم صغير.
 * 2. من الباقين اختيار عشوائي مرجَّح: كل محاولة زائدة على أقلّهم تُنصّف الحظّ.
 *    فمن لم يقرأ قطّ حظّه ضعف من قرأ مرة وأربعة أضعاف من قرأ مرتين، ومع ذلك
 *    قد يُختار من قرأ. هذا يُبقي الاختيار غير متوقَّع دون أن يُهمل أحدًا طويلًا.
 *
 * كانت القاعدة قبله «الأقل محاولات أولًا والعشوائية بين المتساوين»، فلا يعود
 * أحد إلا بعد أن يقرأ القسم كله، وكان التلاميذ يعرفون أنهم في مأمن بعد قراءتهم.
 *
 * السحب بلا إرجاع بطريقة Efraimidis–Spirakis: لكل تلميذ مفتاح ln(u)/w ويؤخذ
 * الأكبر. `random` يُمرَّر في الاختبارات.
 */
export function pickForSession<T extends { id: string }>(
  students: T[],
  attemptsOf: (studentId: string) => number,
  count: number,
  recent: string[] = [],
  random: () => number = Math.random,
): T[] {
  if (count <= 0 || students.length === 0) return [];
  const present = new Set(students.map((s) => s.id));
  // من قرأ مؤخّرًا وما يزال في القائمة، الأحدث أولًا.
  const blocked = recent.filter((id) => present.has(id));
  // يبقى ممنوعًا من الأحدث ما لا يُنقص الباقين عن العدد، ويُطلق الأقدم.
  const keep = Math.max(0, Math.min(blocked.length, students.length - count));
  const resting = new Set(blocked.slice(0, keep));
  const eligible = students.filter((s) => !resting.has(s.id));

  const least = Math.min(...eligible.map((s) => attemptsOf(s.id)));
  const keyed = eligible.map((student) => {
    const weight = Math.pow(2, -(attemptsOf(student.id) - least));
    // 1 - random() في (0, 1]، فلا log(0).
    return { student, key: Math.log(1 - random()) / weight };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, count).map((k) => k.student);
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

/* ---------- حصص الأعمال التطبيقية ---------- */

/**
 * القسم يُقسَّم إلى أفواج، وكل فوج يُنقَّط في حصص أعمال تطبيقية. معدّل حصص
 * التلميذ في الفصل **يُحسب ولا يُخزَّن**، ثم يغذّي الخانة التي اختارها الأستاذ
 * لقسمه: مركّبة الأعمال التطبيقية (records.tp) أو معيارًا من التقويم المستمر.
 *
 * وهو يتبع القاعدة نفسها التي يقوم عليها كل ما فوق: الحصة التي لم تُنقَّط
 * لتلميذ، أو غاب فيها، **تخرج من المعدّل ولا تُحسب صفرًا**. ومن لم يُنقَّط في
 * أي حصة لا قيمة له، فتبقى علامته اليدوية إن وُجدت ولا يُمحى شيء.
 *
 * نفس المنطق مكتوب في منظر v_tp_avg ومنظرَي v_continuous وv_term_average.
 */

export type TpSession = {
  id: string;
  class_id: string;
  /** للتنظيم لا للحساب: العلامات مفتاحها التلميذ. */
  group_id: string | null;
  term: number;
  held_on: string;
  title: string | null;
};

/** صفٌّ لتلميذ نُقِّط أو عُلِّم غائبًا. «غير مقيَّم» = لا صف. */
export type TpMark = {
  session_id: string;
  student_id: string;
  /** من 20. null مع absent = true تعني غائبًا. */
  score: number | null;
  absent: boolean;
};

/** الهدف: null لا ربط، 'component' مركّبة الأعمال التطبيقية، أو 'criterion:<code>'. */
export type TpTarget = string | null;

export const TP_COMPONENT = "component";

export function criterionTarget(code: string): string {
  return `criterion:${code}`;
}

/** كود المعيار الهدف، أو null إن لم يكن الهدف معيارًا. */
export function targetCriterionCode(target: TpTarget): string | null {
  return target && target.startsWith("criterion:") ? target.slice("criterion:".length) : null;
}

/** معيار الإضافة بنقطة انطلاق صفر وحده يصلح هدفًا: القيمة تُحوَّل إلى سقفه. */
export function canTargetCriterion(
  criterion: Pick<Criterion, "kind" | "base">,
): boolean {
  return criterion.kind === "add" && Number(criterion.base) === 0;
}

/**
 * معدّل كل تلميذ على حصصه المنقَّطة في الفصل، مفتاحه معرّف التلميذ.
 * التلميذ الغائب عن كل حصصه أو غير المنقَّط ليس فيها: لا مفتاح له.
 */
export function tpAverages(
  marks: TpMark[],
  sessions: TpSession[],
  term: number,
): Map<string, number> {
  const inTerm = new Set(sessions.filter((s) => s.term === term).map((s) => s.id));
  const sums = new Map<string, { total: number; n: number }>();
  for (const mark of marks) {
    if (!inTerm.has(mark.session_id)) continue;
    if (mark.absent || mark.score === null || mark.score === undefined) continue;
    const value = Number(mark.score);
    if (!Number.isFinite(value)) continue;
    const entry = sums.get(mark.student_id) ?? { total: 0, n: 0 };
    entry.total += value;
    entry.n += 1;
    sums.set(mark.student_id, entry);
  }
  const out = new Map<string, number>();
  for (const [id, { total, n }] of sums) out.set(id, total / n);
  return out;
}

/**
 * السجل كما يُعرض ويُحسب منه، لا كما يُكتب. لا تُمرَّر نتيجته إلى saveRecord
 * أبدًا: القيمة المحسوبة ليست علامة أدخلها الأستاذ، ولو كُتبت لثبّتت معدّل
 * اليوم في الخانة وانفصلت عن الحصص.
 *
 * - بلا معدّل أو بلا هدف: السجل كما هو.
 * - 'component': tp = المعدّل.
 * - 'criterion:<code>': قيمة المعيار = المعدّل ÷ 20 × سقفه. وإن كان المعيار
 *   محذوفًا أو ليس إضافةً بنقطة صفر فلا أثر، بدل أن تُكتب قيمة بمعنى خاطئ.
 */
export function applyTpTarget(
  record: RecordRow | undefined,
  studentId: string,
  term: number,
  average: number | null | undefined,
  target: TpTarget,
  criteria: Criterion[],
): RecordRow | undefined {
  if (average === null || average === undefined || !target) return record;
  const base: RecordRow = record ?? {
    student_id: studentId,
    term,
    criteria: {},
    tp: null,
    devoir: null,
    exam: null,
  };
  if (target === TP_COMPONENT) return { ...base, tp: average };

  const code = targetCriterionCode(target);
  if (code === null) return record;
  const criterion = criteria.find((c) => c.code === code);
  if (!criterion || !canTargetCriterion(criterion)) return record;
  return {
    ...base,
    criteria: { ...base.criteria, [code]: (average / 20) * Number(criterion.ceiling) },
  };
}

/** وجهة الهدف كما يقرؤها الأستاذ، أو null إن لم يُضبط أو صار مكسورًا. */
export function describeTarget(
  target: TpTarget,
  criteria: Criterion[],
  components: Component[],
): { ok: boolean; label: string } {
  if (!target) return { ok: false, label: "لم يُربط بعد" };
  if (target === TP_COMPONENT) {
    const tp = components.find((c) => c.code === "tp");
    if (!tp) return { ok: false, label: "مركّبة الأعمال التطبيقية غير موجودة" };
    return tp.active
      ? { ok: true, label: tp.label }
      : { ok: false, label: `${tp.label} (مطفأة: لا تدخل المعدّل)` };
  }
  const code = targetCriterionCode(target);
  const criterion = code === null ? undefined : criteria.find((c) => c.code === code);
  if (!criterion) return { ok: false, label: "المعيار المربوط حُذف" };
  if (!canTargetCriterion(criterion)) {
    return { ok: false, label: `${criterion.label} (لم يعد معيار إضافة)` };
  }
  return { ok: true, label: criterion.label };
}

/**
 * إحصاء قسم في فصل بعينه، لا في الفصل المعروض وحده.
 *
 * شاشة القسم تحسب المعدل للفصل المختار في الرأس، فلا يُقارَن فصلان فيها. وهذه
 * الدالة تُركّب الحساب نفسه (معدّل الحصص يحلّ محل خانته، ثم المعيار فالمعدل)
 * لأيّ فصل، فتُقارَن النتيجتان على المعايير والمعاملات ذاتها.
 */
export function termStatsFor(args: {
  term: number;
  students: Array<{ id: string }>;
  /** وجهة معدّل حصص القسم، كما في إعداد القسم. */
  target: TpTarget;
  records: RecordRow[];
  readings: Reading[];
  tpMarks: TpMark[];
  sessions: TpSession[];
  criteria: Criterion[];
  components: Component[];
}): ClassStats {
  const { term, students, target, records, readings, tpMarks, sessions, criteria, components } =
    args;

  const recordOf = new Map<string, RecordRow>();
  for (const r of records) if (r.term === term) recordOf.set(r.student_id, r);

  const readingsOf = new Map<string, Reading[]>();
  for (const r of readings) {
    if (r.term !== term) continue;
    const list = readingsOf.get(r.student_id);
    if (list) list.push(r);
    else readingsOf.set(r.student_id, [r]);
  }

  const tp = tpAverages(tpMarks, sessions, term);

  const averages = students.map((s) => {
    const record = applyTpTarget(
      recordOf.get(s.id),
      s.id,
      term,
      tp.get(s.id) ?? null,
      target,
      criteria,
    );
    return termAverage(components, componentValues(criteria, record, readingsOf.get(s.id) ?? []));
  });
  const unread = students.filter((s) => (readingsOf.get(s.id)?.length ?? 0) === 0).length;
  return classStats(averages, unread);
}
