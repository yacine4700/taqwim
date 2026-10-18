/**
 * أفواج القسم: منطق صافٍ بلا متصفّح ولا شبكة، وله اختبارات في
 * scripts/check-groups.mjs تستورد هذا الملف نفسه لا نسخةً منه.
 *
 * الفوج ثابت طوال السنة، واسمه اختياري. التلميذ في فوج واحد على الأكثر،
 * ومن لم يُوزَّع يبقى «بلا فوج» ولا يضيع.
 */

export type Group = {
  id: string;
  class_id: string;
  /** اختياري: الفارغ يُعرض «فوج 1» بحسب ترتيب الفوج. */
  name: string | null;
  position: number;
};

export const MAX_GROUP_NAME = 40;
export const MAX_GROUPS = 8;

/** اسم الفوج للعرض: ما سمّاه الأستاذ، وإلا «فوج» ورقمه بحسب ترتيبه. */
export function groupLabel(group: Pick<Group, "name">, index: number): string {
  const name = group.name?.trim();
  return name ? name : `فوج ${index + 1}`;
}

/** الاسم كما يُحفظ: فراغاته موحَّدة، والفارغ يصير null فيعود الاسم الافتراضي. */
export function cleanGroupName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_GROUP_NAME).trim();
  return name === "" ? null : name;
}

/** عدد الأفواج المقبول: 2 إلى MAX_GROUPS، أو رسالة تشرح الرفض. */
export function groupCountProblem(count: number, students: number): string {
  if (!Number.isInteger(count) || count < 2) return "اختر فوجين على الأقل.";
  if (count > MAX_GROUPS) return `الحدّ الأقصى ${MAX_GROUPS} أفواج.`;
  if (count > students) return "الأفواج أكثر من التلاميذ.";
  return "";
}

/**
 * تقسيم قائمة إلى `count` كتل متتالية متقاربة الحجم: الفرق بين أكبرها وأصغرها
 * لا يتجاوز واحدًا، والأكبر أولًا (7 في فوجين: 4 ثم 3). ترتيب العناصر محفوظ،
 * فتقسيمُ قائمة القسم يبقي كل فوج متصلًا في الورقة.
 */
export function distribute<T>(items: readonly T[], count: number): T[][] {
  if (!Number.isInteger(count) || count < 1) return [];
  const size = Math.floor(items.length / count);
  const extra = items.length % count;
  const out: T[][] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const take = size + (i < extra ? 1 : 0);
    out.push(items.slice(at, at + take));
    at += take;
  }
  return out;
}

/** خلط فيشر–ييتس بنسخة جديدة، و`random` قابل للحقن ليُختبر. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type Membership = {
  /** معرّفات تلاميذ كل فوج بترتيب القسم. */
  byGroup: Map<string, string[]>;
  /** من لا فوج له، أو فوجه لم يعد موجودًا. */
  ungrouped: string[];
};

/** من في أي فوج. فوجٌ محذوف أو من قسم آخر يُحسب «بلا فوج» لا يُترك معلّقًا. */
export function membership(
  students: ReadonlyArray<{ id: string; group_id: string | null }>,
  groups: ReadonlyArray<Pick<Group, "id">>,
): Membership {
  const byGroup = new Map<string, string[]>(groups.map((g) => [g.id, []]));
  const ungrouped: string[] = [];
  for (const student of students) {
    const bucket = student.group_id ? byGroup.get(student.group_id) : undefined;
    if (bucket) bucket.push(student.id);
    else ungrouped.push(student.id);
  }
  return { byGroup, ungrouped };
}

/**
 * التوزيع الذي يُكتب: لكل تلميذ فوجه الجديد. كلّ من في القائمة يأخذ فوجًا،
 * فلا يبقى أحد معلّقًا بين توزيعين.
 */
export function assignment(
  orderedStudentIds: readonly string[],
  groupIds: readonly string[],
): Array<{ student_id: string; group_id: string }> {
  const blocks = distribute(orderedStudentIds, groupIds.length);
  return blocks.flatMap((block, i) =>
    block.map((student_id) => ({ student_id, group_id: groupIds[i] })),
  );
}
