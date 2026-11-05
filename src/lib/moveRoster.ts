/**
 * نقل أسماء قسم مقفل إلى قسم جديد، بحيث تكون إعادة المحاولة آمنة من التكرار.
 *
 * المعرّفات يولّدها الجهاز مرة واحدة لكل «محاولة» (MoveAttempt) وتُعاد بها كل مرة:
 *  - القسم: upsert بمعرّفه، فالمحاولة الثانية تحدّث القسم نفسه (حتى لو تغيّر الاسم).
 *  - التلاميذ: upsert بمعرّفاتهم مع تجاهل المكرَّر، فلا يتكرر تلميذ نجح إدراجه
 *    ولا يُمسّ ما عُدّل فيه بعد إدراجه.
 * فإن ضاع ردّ الخادم بعد أن نفّذ، أو نجح القسم وفشل التلاميذ، تُكمل إعادة المحاولة
 * ما نقص دون قسم ثانٍ ودون تلميذ مكرر. ولا حذف تعويضي: فشل الحذف نفسه كان سيترك
 * بيانات غير متوقعة، والإكمال بإعادة المحاولة أبسط وأمتن.
 *
 * يُنقل الاسم والترتيب فقط: لا علامات ولا قراءات ولا حصص ولا حالات ولا ملاحظات
 * ولا أفواج (تشهد بذلك حقول الصفوف المرسَلة أدناه).
 */

export type MoveAttempt = {
  /** القسم القديم الذي تُنقل أسماؤه. */
  sourceId: string;
  /** معرّف القسم الجديد، ثابت بين المحاولات. */
  classId: string;
  /** معرّفات التلاميذ الجدد بترتيب الأسماء، ثابتة بين المحاولات. */
  studentIds: string[];
  names: string[];
  schoolId: string;
  position: number;
};

export function newAttempt(args: {
  sourceId: string;
  names: string[];
  schoolId: string;
  position: number;
  uuid: () => string;
}): MoveAttempt {
  return {
    sourceId: args.sourceId,
    classId: args.uuid(),
    studentIds: args.names.map(() => args.uuid()),
    names: [...args.names],
    schoolId: args.schoolId,
    position: args.position,
  };
}

export type DbError = { message: string; code?: string | null } | null;

/** ما يحتاجه النقل من القاعدة: لا حذف فيه عن قصد. */
export type MoveDb = {
  upsertClass(row: {
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
};

export type MoveResult = { ok: true; id: string; students: number } | { ok: false; error: string };

const RETRY_SAFE =
  "لم يكتمل النقل. أعد المحاولة: يُكمَّل ما نقص دون تكرار قسم ولا تلميذ.";

/** ينفّذ المحاولة (أو يكملها). النتيجة تُقرأ بالنص لا بالقاعدة: فشلٌ يعني «أعد المحاولة». */
export async function runMove(
  db: MoveDb,
  attempt: MoveAttempt,
  input: { teacherId: string; name: string },
): Promise<MoveResult> {
  try {
    const made = await db.upsertClass({
      id: attempt.classId,
      teacher_id: input.teacherId,
      name: input.name,
      position: attempt.position,
      school_id: attempt.schoolId,
    });
    if (made.error) return { ok: false, error: RETRY_SAFE };

    const rows = attempt.names.map((full_name, i) => ({
      id: attempt.studentIds[i],
      teacher_id: input.teacherId,
      class_id: attempt.classId,
      full_name,
      position: i + 1,
    }));
    const added = await db.insertStudentsIgnoringDuplicates(rows);
    if (added.error) return { ok: false, error: RETRY_SAFE };
    return { ok: true, id: attempt.classId, students: rows.length };
  } catch {
    // انقطاع الاتصال في منتصف الطلب: قد يكون نُفِّذ أو لم يُنفَّذ. المعرّفات الثابتة تجعل الإعادة آمنة.
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
