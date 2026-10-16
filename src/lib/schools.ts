/**
 * الأقسام مجمّعة بمؤسساتها، ومن يختار منها في الحصة.
 *
 * يشترك فيها شاشة الأقسام ووثائقها وشاشة الحصة، فلا يختلف ترتيب المؤسسات
 * ولا تسمية القسم الذي بلا مؤسسة بين شاشة وأخرى. وscripts/check-schools.mjs
 * نسخة حرفية من منطقها، يجب أن تبقيا متطابقتين.
 */

export type SchoolLike = { id: string; name: string };
export type ClassLike = { id: string; school_id: string | null };
export type Group<K extends ClassLike> = { key: string; name: string; classes: K[] };

/**
 * الأقسام مرتَّبة بمؤسساتها، والمؤسسة الفارغة لا تُعرض.
 * وقسمٌ بلا مؤسسة (أو مؤسسته حُذفت) يُجمَع في آخر مجموعة باسم صريح،
 * فلا يضيع بين الأقسام.
 */
export function groupBySchool<K extends ClassLike>(
  classes: K[],
  schools: SchoolLike[],
): Group<K>[] {
  const groups = schools
    .map((school) => ({
      key: school.id,
      name: school.name,
      classes: classes.filter((c) => c.school_id === school.id),
    }))
    .filter((group) => group.classes.length > 0);

  const loose = classes.filter(
    (c) => !c.school_id || !schools.some((s) => s.id === c.school_id),
  );
  if (loose.length) {
    groups.push({
      key: "none",
      name: groups.length ? "بلا مؤسسة" : "أقسامي",
      classes: loose,
    });
  }
  return groups;
}

/** المجموعة التي فيها القسم، أو null. */
export function groupOf<K extends ClassLike>(
  groups: Group<K>[],
  classId: string,
): Group<K> | null {
  return groups.find((g) => g.classes.some((c) => c.id === classId)) ?? null;
}

/**
 * القسم الذي تُعرض به الحصة: المختار إن كان ما يزال موجودًا، وإلا أول قسم
 * في أول مؤسسة. القسم المحفوظ قد يُحذف من جهاز آخر، فلا تبقى الحصة على قسم
 * لا وجود له بقائمة فارغة.
 */
export function resolveSessionClass<K extends ClassLike>(
  groups: Group<K>[],
  classId: string,
): string {
  if (classId && groupOf(groups, classId)) return classId;
  return groups[0]?.classes[0]?.id ?? "";
}

/** أول قسم في المؤسسة المختارة: عند تبديل المؤسسة في الحصة. */
export function firstClassOf<K extends ClassLike>(
  groups: Group<K>[],
  key: string,
): string {
  return groups.find((g) => g.key === key)?.classes[0]?.id ?? "";
}
