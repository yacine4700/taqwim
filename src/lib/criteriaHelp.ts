/**
 * شرح طرق احتساب المعيار في الإعدادات، بأمثلة تُحسب ولا تُكتب بيد.
 *
 * المثال يأخذ العلامة القصوى الحقيقية للمعيار، ويُحسب بدوال scoring.ts نفسها،
 * فلا يقول الشرح شيئًا يخالف ما يفعله الحساب: لو صار المعيار من 2 صار المثال
 * من 2. اختباره scripts/check-criteriahelp.mjs يقارنه بـ continuousMark.
 *
 * لا منطق حساب جديد هنا: نصوص فقط.
 */

import {
  continuousMark,
  readingAverage,
  shownValue,
  stepFor,
  type Criterion,
  type CriterionKind,
  type Reading,
} from "./scoring";

/** الأسماء الظاهرة على أزرار الطريقة. مأخوذة من الواجهة السابقة حرفيًّا. */
export const KIND_NAME: Record<CriterionKind, string> = {
  deduct: "يبدأ كاملًا ويُخصم منه",
  add: "يبدأ من 0 ويُضاف إليه",
  auto: "بالسحب في الحصة",
};

function n(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** نصف أو ربع العلامة القصوى، مقرّبًا إلى خطوة العدّاد ولا يقلّ عنها. */
function part(ceiling: number, ratio: number): number {
  const step = stepFor({ ceiling });
  const raw = Math.round((ceiling * ratio) / step) * step;
  return Math.min(ceiling, Math.max(step, Number(raw.toFixed(2))));
}

export type KindExplain = {
  /** معنى الخانة الفارغة: القاعدة التي يجب ألّا يسيء الأستاذ فهمها. */
  rule: string;
  /** الجملة نفسها مختصرة لسطر البطاقة؛ والكاملة في نافذة المساعدة. المعنى واحد. */
  short: string;
  /** مثال رقمي قصير بالعلامة القصوى الحقيقية. */
  example: string;
};

export function explainKind(kind: CriterionKind, ceilingIn: number): KindExplain {
  const ceiling = Number(ceilingIn) > 0 ? Number(ceilingIn) : 4;
  const C = n(ceiling);
  if (kind === "deduct") {
    const cut = part(ceiling, 0.25);
    const left = shownValue({ kind: "deduct", base: ceiling, ceiling }, -cut) ?? ceiling;
    return {
      rule: `يُحسب لكل تلميذ دائمًا: الخانة الفارغة تعني العلامة الكاملة (${C}).`,
      short: `يُحسب دائمًا: الخانة الفارغة تعني العلامة الكاملة (${C}).`,
      example: `مثال: لم يُخصم منه شيء ← ${C} من ${C}. خُصم منه ${n(cut)} ← ${n(left)} من ${C}.`,
    };
  }
  if (kind === "add") {
    const got = part(ceiling, 0.75);
    return {
      rule: "لا يُحسب حتى تُنقّطه: الخانة الفارغة تخرج من القسمة ولا تُحسب صفرًا.",
      short: "الخانة الفارغة تخرج من القسمة ولا تُحسب صفرًا.",
      example: `مثال: نقّطته ${n(got)} ← ${n(got)} من ${C}. لم تنقّطه بعد ← لا يدخل الحساب.`,
    };
  }
  const a = ceiling;
  const b = part(ceiling, 0.5);
  const avg = readingAverage([{ score: a }, { score: b }] as Reading[]) ?? 0;
  return {
    rule: "لا تُدخله بيدك: علامته متوسط محاولاته حين تسحب الأسماء في الحصة. ومن لم يُسحب بعد لا يُحسب.",
    short: "علامته متوسط محاولاته في الحصة، ولمعيار واحد فقط.",
    example: `مثال: محاولتان ${n(a)} و${n(b)} من ${C} ← ${n(avg)} من ${C}. ومعيار واحد فقط يكون بالسحب.`,
  };
}

/**
 * مثال نافذة «كيف تعمل؟»: ثلاثة معايير من 4، تلميذ نُقّط في المشاركة وحدها.
 * الانضباط (خصم) يُحسب كاملًا، والواجبات (إضافة، فارغة) تخرج من القسمة.
 */
export const WALKTHROUGH = (() => {
  const criteria: Criterion[] = [
    { id: "1", code: "a", label: "الانضباط", kind: "deduct", base: 4, ceiling: 4, position: 1 },
    { id: "2", code: "b", label: "المشاركة", kind: "add", base: 0, ceiling: 4, position: 2 },
    { id: "3", code: "c", label: "الواجبات", kind: "add", base: 0, ceiling: 4, position: 3 },
  ];
  const record = { student_id: "s", term: 1, criteria: { b: 3 }, tp: null, devoir: null, exam: null };
  const mark = continuousMark(criteria, record, []) ?? 0;
  const lead = "الانضباط فارغ ← 4 من 4، والمشاركة 3 من 4، والواجبات فارغة فتخرج من القسمة:";
  // العملية الحسابية تُعرض مقطعًا واحدًا من اليسار إلى اليمين، وبعدها «من 20».
  const expr = `(4 + 3) ÷ 8 × 20 = ${n(mark)}`;
  const formula = `${expr} من 20.`;
  return { criteria, record, mark, lead, expr, formula, text: `${lead} ${formula}` };
})();
