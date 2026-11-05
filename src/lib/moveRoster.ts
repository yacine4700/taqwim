/**
 * نقل أسماء قسم مقفل إلى قسم جديد، بحيث يُستكمل النقل نفسه بعد ضياع الردّ أو إعادة تحميل
 * الصفحة أو قتل التطبيق، دون قسم ولا تلميذ مكرر.
 *
 * محاولة النقل = سجلّ صغير محفوظ على الجهاز لكل قسم مصدر (MoveRecord):
 *   - معرّف القسم الجديد،
 *   - خريطة «معرّف التلميذ في المصدر ← معرّفه الجديد»،
 *   - قائمة من أُدرجوا وتُحقِّق من إدراجهم.
 * معرّفات فقط: لا أسماء ولا علامات ولا أي بيانات شخصية. ويُحفظ قبل أول طلب إلى الخادم؛
 * فإن تعذّر الحفظ لا يبدأ النقل. ويُحذف بعد التأكد من القسم ومن كل ما أُدرج في تلك
 * الجولة، فيمكن بعدها نقل جديد مستقل بمعرّفات جديدة.
 *
 * الإدراج كله «تجاهل التعارض» (ON CONFLICT DO NOTHING): لا يكتب فوق قسم ولا تلميذ
 * موجود. والإدراج على دفعات صغيرة، ومن تُحقِّق من دفعتهم يُسجَّلون «أُدرجوا»: فلا يعاد
 * إدراج تلميذ حذفه الأستاذ يدويًّا بعد ذلك. وبعد كل دفعة يُقرأ الخادم ليتأكد أن كل
 * معرّفاتها موجودة، فالتجاهل الصامت لا يمرّ نجاحًا.
 *
 * حدّان لا يمكن إزالتهما بلا جدول تذكير في القاعدة (ممنوع هنا): إن ضاع ردّ دفعة بعد
 * تنفيذها فهي غير مؤكَّدة، وحذف أحد تلاميذها يدويًّا قبل الاستئناف يعيده الاستئناف.
 * وتعديل اسم القسم الجديد في ورقة الاستئناف لا يُطبَّق على قسم أُنشئ سابقًا.
 *
 * يُنقل الاسم والترتيب فقط: لا علامات ولا قراءات ولا حصص ولا حالات ولا ملاحظات ولا أفواج.
 */

/** تلاميذ كل طلب إدراج. دفعة واحدة تُدرج كلها أو لا شيء، فالدفعات تُبقي التقدّم بين الطلبات. */
export const CHUNK = 25;

export type MoveRecord = {
  v: 1;
  /** القسم الجديد. */
  classId: string;
  /** معرّف التلميذ في المصدر ← معرّفه في القسم الجديد. */
  ids: Record<string, string>;
  /** معرّفات المصدر لمن أُدرجوا وتُحُقِّق منهم. */
  done: string[];
};

/** يقرأ ما حُفظ؛ أي شكل غير مفهوم = لا سجلّ (محاولة جديدة). */
export function parseMoveRecord(raw: unknown): MoveRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.classId !== "string" || !r.classId) return null;
  if (!r.ids || typeof r.ids !== "object" || Array.isArray(r.ids)) return null;
  const ids: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.ids as Record<string, unknown>)) {
    if (typeof v !== "string" || !v) return null;
    ids[k] = v;
  }
  if (!Array.isArray(r.done)) return null;
  const done = r.done.filter((x): x is string => typeof x === "string" && x in ids);
  return { v: 1, classId: r.classId, ids, done };
}

export type MoveSource = { id: string; full_name: string; position: number };

export type DbError = { message: string; code?: string | null } | null;

/** ما يحتاجه النقل من القاعدة: لا تعديل ولا حذف، إدراج بتجاهل التعارض وقراءة معرّفات. */
export type MoveDb = {
  insertClassIgnoringDuplicates(row: {
    id: string;
    teacher_id: string;
    name: string;
    position: number;
    school_id: string;
  }): Promise<{ error: DbError }>;
  insertStudentsIgnoringDuplicates(
    rows: Array<{
      id: string;
      teacher_id: string;
      class_id: string;
      full_name: string;
      position: number;
    }>,
  ): Promise<{ error: DbError }>;
  classExists(id: string): Promise<{ error: DbError; exists: boolean }>;
  /** من هذه المعرّفات موجود فعلًا في الخادم (بحسب ما يراه الأستاذ). */
  studentsPresent(ids: string[]): Promise<{ error: DbError; present: string[] }>;
};

/** تخزين السجلّ على الجهاز. save تعيد true فقط إن كُتب كتابةً دائمة. */
export type MoveStore = {
  load(): Promise<unknown>;
  save(record: MoveRecord): Promise<boolean>;
  remove(): Promise<void>;
};

export type MoveResult = { ok: true; id: string; students: number } | { ok: false; error: string };

const RETRY_SAFE = "لم يكتمل النقل. أعد المحاولة: يُكمَّل ما نقص دون تكرار قسم ولا تلميذ.";
const NO_STORAGE =
  "تعذّر الحفظ على هذا الجهاز، فلم يبدأ النقل. جرّب خارج النافذة الخاصة أو بعد تفريغ مساحة، ثم أعد المحاولة.";

export async function runMove(
  deps: { db: MoveDb; store: MoveStore; uuid: () => string; teacherId: string },
  input: { name: string; schoolId: string; position: number; students: readonly MoveSource[] },
): Promise<MoveResult> {
  const { db, store, uuid, teacherId } = deps;
  const students = [...input.students].sort((a, b) => a.position - b.position);
  if (students.length === 0) return { ok: false, error: "لا تلاميذ في هذا القسم." };

  try {
    // 1) السجلّ: يُستعاد إن وُجد، ويُوسَّع بمن ظهر في المصدر، ويُحفظ قبل أي طلب.
    const saved = parseMoveRecord(await store.load());
    const record: MoveRecord = saved
      ? { ...saved, ids: { ...saved.ids }, done: [...saved.done] }
      : { v: 1, classId: uuid(), ids: {}, done: [] };
    let changed = !saved;
    for (const s of students) {
      if (!record.ids[s.id]) {
        record.ids[s.id] = uuid();
        changed = true;
      }
    }

    // قسم أُنشئ ثم حذفه الأستاذ بكامله: ما سُجّل «أُدرج» ذهب معه، فيُعاد كله.
    if (saved && record.done.length > 0) {
      const there = await db.classExists(record.classId);
      if (there.error) return { ok: false, error: RETRY_SAFE };
      if (!there.exists) {
        record.done = [];
        changed = true;
      }
    }

    if (changed && !(await store.save(record))) return { ok: false, error: NO_STORAGE };

    // 2) القسم: تجاهل التعارض، فلا يُكتب فوق قسم موجود (اسمه وترتيبه ومؤسسته).
    const made = await db.insertClassIgnoringDuplicates({
      id: record.classId,
      teacher_id: teacherId,
      name: input.name,
      position: input.position,
      school_id: input.schoolId,
    });
    if (made.error) return { ok: false, error: RETRY_SAFE };

    // 3) التلاميذ: من لم يُسجَّل إدراجهم، على دفعات؛ كل دفعة تُقرأ بعدها للتأكد.
    const done = new Set(record.done);
    const pending = students.filter((s) => !done.has(s.id));
    for (let from = 0; from < pending.length; from += CHUNK) {
      const chunk = pending.slice(from, from + CHUNK);
      const rows = chunk.map((s) => ({
        id: record.ids[s.id],
        teacher_id: teacherId,
        class_id: record.classId,
        full_name: s.full_name,
        position: students.indexOf(s) + 1,
      }));
      const added = await db.insertStudentsIgnoringDuplicates(rows);
      if (added.error) return { ok: false, error: RETRY_SAFE };
      const seen = await db.studentsPresent(rows.map((r) => r.id));
      if (seen.error) return { ok: false, error: RETRY_SAFE };
      const present = new Set(seen.present);
      if (!rows.every((r) => present.has(r.id))) return { ok: false, error: RETRY_SAFE };
      for (const s of chunk) done.add(s.id);
      record.done = [...done];
      // تقدّم بين الدفعات: فشل حفظه لا يوقف النقل، ثمنه أن تُعاد دفعة إن انقطع الاتصال لاحقًا.
      await store.save(record);
    }

    // 4) التأكد من القسم قبل حذف السجلّ.
    const final = await db.classExists(record.classId);
    if (final.error || !final.exists) return { ok: false, error: RETRY_SAFE };
    await store.remove();
    return { ok: true, id: record.classId, students: students.length };
  } catch {
    // انقطاع في منتصف طلب: قد يكون نُفِّذ أو لم يُنفَّذ. السجلّ والمعرّفات الثابتة تجعل الإعادة آمنة.
    return { ok: false, error: RETRY_SAFE };
  }
}

/**
 * حارس الضغط المزدوج: بينما تعمل المهمة تُتجاهل أي استدعاءات أخرى. يُحفظ في useRef
 * (لا في حالة React) لأن الحالة لا تتحدّث بين ضغطتين متتاليتين قبل إعادة الرسم.
 */
export function createSingleFlight() {
  let running = false;
  return async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (running) return undefined;
    running = true;
    try {
      return await task();
    } finally {
      running = false;
    }
  };
}
