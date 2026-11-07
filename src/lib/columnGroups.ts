/**
 * مجموعتا الأعمدة في القسم: «معايير التقويم» (عمل كل حصة) و«علامات الفصل»
 * (الفرض والاختبار والأعمال التطبيقية، مرة في الفصل تقريبًا). كل مجموعة تُفتح
 * وتُطوى، ويتذكّر التطبيق آخر حالة اختارها الأستاذ لكلٍّ منهما على جهازه.
 *
 * دوالّ صافية بلا React، يفحصها scripts/check-colgroups.mjs.
 */

export type ColumnGroup = "criteria" | "marks";

/** اختيار الأستاذ لكل مجموعة: true مفتوحة، false مطويّة، null لم يختر بعد فيُطبَّق الافتراضي. */
export type GroupPrefs = Record<ColumnGroup, boolean | null>;

export const NO_GROUP_PREFS: GroupPrefs = { criteria: null, marks: null };

/**
 * مفتوحة أم مطويّة كما تُعرض.
 * الافتراضي: معايير التقويم مفتوحة، وعلامات الفصل مطويّة إلا في فترة الاختبارات.
 * ومن فيها عمود مفتوح تُعرض مفتوحة مهما كان اختياره (عمود مفتوح داخل قائمة مطويّة
 * يُفقد الأستاذ مكانه)، ولا يُغيَّر اختياره المحفوظ بذلك.
 */
export function groupExpanded(
  prefs: GroupPrefs,
  group: ColumnGroup,
  ctx: { examSeason: boolean; holdsOpenColumn: boolean },
): boolean {
  if (ctx.holdsOpenColumn) return true;
  const chosen = prefs[group];
  if (chosen !== null) return chosen;
  return group === "criteria" ? true : ctx.examSeason;
}

/** نقرة على رأس المجموعة: تقلب ما يُعرض الآن، فتصير اختيارًا صريحًا. */
export function setGroup(prefs: GroupPrefs, group: ColumnGroup, open: boolean): GroupPrefs {
  return prefs[group] === open ? prefs : { ...prefs, [group]: open };
}

/** ما قُرئ من الجهاز: أي شيء غير منطقي يعود إلى الافتراضي (نسخة أقدم أو ملف تالف). */
export function parseGroupPrefs(raw: unknown): GroupPrefs {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    criteria: typeof o.criteria === "boolean" ? o.criteria : null,
    marks: typeof o.marks === "boolean" ? o.marks : null,
  };
}
