/**
 * قائمة القراءة غير المحفوظة لقسم واحد: من اختيروا ونقاطهم قبل «حفظ».
 *
 * كانت القراءة تبويبًا مستقلًّا بقسمه الخاص، والأستاذ يتنقّل في الحصة الواحدة
 * بين الاستماع إلى القراءة وتنقيط التقويم المستمر، فكان يعيد اختيار القسم
 * والعمود في كل ذهاب وإياب. صارت القراءة وضعًا داخل القسم، وهذه دوالّها
 * الصافية: لا React ولا شبكة، فتُختبر في scripts/check-reading.mjs.
 *
 * المسودّة تعيش لكل قسم وحده: من انتقل إلى عمود «المشاركة» ثم عاد، أو خرج
 * من القسم ورجع، يجد أسماءه ونقاطه كما تركها. وهي في الذاكرة فقط كما كانت.
 */
import { DEFAULT_READING_CODE, pickForSession } from "./scoring";

export type ReadingScore = number | "skip";

export type ReadingDraft<S extends { id: string }> = {
  picked: S[];
  scores: Record<string, ReadingScore>;
};

/** مفتاح وضع القراءة في شريط «عرض:»، بجوار `c:` للمعايير و`m:` للمركّبات. */
export const READING_COLUMN = "r:reading";

/**
 * عمود السحب لمعيار: معيار القراءة الافتراضي يبقى بمفتاحه القديم فلا يضيع مكان محفوظ
 * على هاتف، وغيره `r:<code>`.
 */
export function readingColumnKey(code: string): string {
  return code === DEFAULT_READING_CODE ? READING_COLUMN : `r:${code}`;
}

/** كود المعيار الذي يسحب له هذا العمود، أو null إن لم يكن عمود سحب. */
export function drawCodeOf(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key === READING_COLUMN) return DEFAULT_READING_CODE;
  return key.startsWith("r:") ? key.slice(2) : null;
}

/** مفتاح المسودّة: لكل قسم ولكل معيار مسودّته، فلا تختلط قائمتا معيارين. */
export function draftKey(classId: string, code: string): string {
  return `${classId}|${code}`;
}

export function emptyDraft<S extends { id: string }>(): ReadingDraft<S> {
  return { picked: [], scores: {} };
}

/** اختيار جديد بالعدل: الأقل محاولات أولًا، والعشوائية بين المتساوين فقط. */
export function pickDraft<S extends { id: string }>(
  list: S[],
  attemptsOf: (id: string) => number,
  count: number,
): ReadingDraft<S> {
  return { picked: pickForSession(list, attemptsOf, count), scores: {} };
}

/**
 * يُخرج تلميذًا ويُدخل التالي في العدل ممّن ليسوا في القائمة.
 * الغائب لا يُنقص الحصة واحدًا. إن لم يبقَ أحد يُخرَج ولا يُعوَّض.
 */
export function swapInDraft<S extends { id: string }>(
  draft: ReadingDraft<S>,
  studentId: string,
  list: S[],
  attemptsOf: (id: string) => number,
): ReadingDraft<S> {
  const already = new Set(draft.picked.map((p) => p.id));
  const [next] = pickForSession(list.filter((s) => !already.has(s.id)), attemptsOf, 1);
  const scores = { ...draft.scores };
  delete scores[studentId];
  const picked = next
    ? draft.picked.map((p) => (p.id === studentId ? next : p))
    : draft.picked.filter((p) => p.id !== studentId);
  return { picked, scores };
}

/**
 * متطوّع رفع يده: يُضاف في آخر القائمة إن لم يكن فيها، وإن كان فيها يُخرَج.
 * زرّ واحد يُدخل ويُخرج، فالنقرة الخاطئة تُصلَح بنقرة.
 */
export function toggleVolunteer<S extends { id: string }>(
  draft: ReadingDraft<S>,
  student: S,
): ReadingDraft<S> {
  if (draft.picked.some((p) => p.id === student.id)) {
    const scores = { ...draft.scores };
    delete scores[student.id];
    return { picked: draft.picked.filter((p) => p.id !== student.id), scores };
  }
  return { picked: [...draft.picked, student], scores: draft.scores };
}

export function setDraftScore<S extends { id: string }>(
  draft: ReadingDraft<S>,
  studentId: string,
  score: ReadingScore,
): ReadingDraft<S> {
  return { ...draft, scores: { ...draft.scores, [studentId]: score } };
}

/**
 * القائمة كما تُعرض: يسقط منها من لم يعد في القسم (حُذف أو نُقل من جهاز
 * آخر)، ويؤخذ الاسم من القسم لا من المسودّة فيظهر آخر تعديل له.
 */
export function liveDraft<S extends { id: string }>(
  draft: ReadingDraft<S>,
  list: S[],
): ReadingDraft<S> {
  const byId = new Map(list.map((s) => [s.id, s]));
  const picked = draft.picked.flatMap((p) => {
    const now = byId.get(p.id);
    return now ? [now] : [];
  });
  if (picked.length === draft.picked.length && picked.every((p, i) => p === draft.picked[i])) {
    return draft;
  }
  const keep = new Set(picked.map((p) => p.id));
  const scores = Object.fromEntries(Object.entries(draft.scores).filter(([id]) => keep.has(id)));
  return { picked, scores };
}

/** ما يُحفظ: من أُعطي نقطة. الغائب ومن لم يُنقَّط لا تُسجَّل له محاولة. */
export function draftEntries<S extends { id: string }>(
  draft: ReadingDraft<S>,
): Array<{ studentId: string; score: number }> {
  return draft.picked.flatMap((s) => {
    const score = draft.scores[s.id];
    return typeof score === "number" ? [{ studentId: s.id, score }] : [];
  });
}

/**
 * القسم المفتوح بعد نقرة على تبويب في الشريط السفلي.
 * الرجوع إلى «الأقسام» من تبويب آخر يعيد القسم الذي كان مفتوحًا، والنقر على
 * «الأقسام» وهو مفتوح يُغلق القسم إلى القائمة، كعادة التطبيقات.
 */
export function openClassAfterTab(
  current: string,
  target: string,
  openClass: string | null,
): string | null {
  return current === "classes" && target === "classes" ? null : openClass;
}

/**
 * المكان المحفوظ قبل الدمج قد يكون تبويب «الحصة» الذي لم يعد موجودًا:
 * يُفتح قسم تلك الحصة على وضع القراءة، فيجد الأستاذ ما تركه.
 * قسم حُذف من جهاز آخر لا يُفتح.
 */
export function migrateWhere(
  saved: { tab?: string; openClass?: string | null; sessionClass?: string },
  exists: (classId: string) => boolean,
): { tab: string | null; openClass: string | null; readingIn: string | null } {
  const openClass = saved.openClass && exists(saved.openClass) ? saved.openClass : null;
  if (saved.tab !== "session") {
    return { tab: saved.tab ?? null, openClass, readingIn: null };
  }
  const wanted = saved.sessionClass && exists(saved.sessionClass) ? saved.sessionClass : null;
  if (wanted) return { tab: "classes", openClass: wanted, readingIn: wanted };
  return { tab: "classes", openClass, readingIn: null };
}
