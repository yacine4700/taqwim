/**
 * طابور الكتابة: ما أدخله الأستاذ ولم يصل الخادم بعد.
 *
 * السبب: التنقيط يجري في قاعة بتغطية ضعيفة. فلو انتظرنا الخادم عند كل ضغطة
 * لضاعت العلامة عند أول انقطاع. فصارت كل كتابة تدخل هذا الطابور أولًا —
 * فتظهر في الشاشة فورًا وتُحفظ في IndexedDB — ثم تُرسل في الخلفية.
 *
 * القاعدة التي يقوم عليها كل ما تحت: **ما يراه الأستاذ = نسخة الخادم + الطابور**.
 * فإعادة التحميل من الخادم لم تعد تمحو ما أدخله: العملية المعلّقة تُطبَّق فوق
 * النسخة الجديدة. ولا تخرج عملية من الطابور إلا بعد أن يقبلها الخادم.
 *
 * هذا الملف منطق صافٍ بلا متصفّح ولا شبكة، وله اختبارات في
 * scripts/check-outbox.mjs — والنسختان يجب أن تبقيا متطابقتين.
 */

import type { Reading, RecordRow } from "./scoring";

export type StudentPatch = {
  full_name?: string;
  note?: string | null;
  tags?: string[];
};

type OpBase = {
  id: string;
  /** وقت إدخال الأستاذ لها، لا وقت إرسالها. */
  at: number;
  tries: number;
  /** رسالة آخر فشل، تُعرض للأستاذ كما هي. */
  error: string | null;
  /**
   * رفَضها الخادم رفضًا لا تصلحه إعادة المحاولة (تلميذ محذوف مثلًا).
   * تبقى في الطابور ولا تُرسل تلقائيًا: لا نحذف عمل الأستاذ من وراء ظهره.
   */
  blocked: boolean;
  /** لا تُعاد المحاولة قبل هذا الوقت (تباعد متزايد بعد كل فشل). */
  nextTry: number;
};

/** علامات تلميذ في فصل: الصف كاملًا، فآخر عملية تُغني عمّا قبلها. */
export type RecordOp = OpBase & {
  kind: "record";
  student_id: string;
  term: number;
  criteria: Record<string, number>;
  tp: number | null;
  devoir: number | null;
  exam: number | null;
};

/** محاولة قراءة جديدة. معرّفها يُولَّد في الهاتف فالإرسال لا يكرّرها. */
export type ReadingAddOp = OpBase & { kind: "reading-add"; reading: Reading };

/** `student_id` ليس للإرسال بل ليعرف الأستاذ صاحب المحاولة في قائمة المعلّقات. */
export type ReadingDelOp = OpBase & {
  kind: "reading-del";
  reading_id: string;
  student_id: string;
};

export type StudentOp = OpBase & {
  kind: "student";
  student_id: string;
  patch: StudentPatch;
};

export type Op = RecordOp | ReadingAddOp | ReadingDelOp | StudentOp;

/** العمليتان على الشيء نفسه لهما المفتاح نفسه، فتُدمجان بدل أن تتراكما. */
export function opKey(op: Op): string {
  switch (op.kind) {
    case "record":
      return `record:${op.student_id}:${op.term}`;
    case "reading-add":
      return `reading:${op.reading.id}`;
    case "reading-del":
      return `reading:${op.reading_id}`;
    case "student":
      return `student:${op.student_id}`;
  }
}

/**
 * إدخال عملية إلى الطابور.
 *
 * - علامات تلميذ: العملية الجديدة تحمل الصف كاملًا فتحلّ محلّ القديمة.
 * - بيانات تلميذ: تُدمج الرقعتان، فتعديل الاسم لا يمحو الحالة الخاصة.
 * - حذف محاولة لم تُرسل بعد: تخرج إضافتها من الطابور ولا يُرسل حذف لشيء
 *   لا وجود له في الخادم.
 *
 * و`inFlight` معرّف العملية التي هي في الطريق الآن: لا تُمسّ، لأن الخادم قد
 * يكون قبلها فعلًا. فتُترك ويُضاف ما بعدها، والترتيب يجعل الأحدث هو الأخير.
 */
export function enqueue(queue: Op[], op: Op, inFlight: string | null = null): Op[] {
  const key = opKey(op);
  const free = (q: Op) => q.id !== inFlight;

  if (op.kind === "reading-del") {
    const pendingAdd = queue.find(
      (q) => q.kind === "reading-add" && opKey(q) === key && free(q),
    );
    if (pendingAdd) return queue.filter((q) => q.id !== pendingAdd.id);
  }

  if (op.kind === "record" || op.kind === "student") {
    const index = queue.findIndex(
      (q) => q.kind === op.kind && opKey(q) === key && free(q),
    );
    if (index >= 0) {
      const previous = queue[index];
      const merged: Op =
        op.kind === "student" && previous.kind === "student"
          ? { ...op, id: previous.id, at: op.at, patch: { ...previous.patch, ...op.patch } }
          : { ...op, id: previous.id };
      const next = [...queue];
      next[index] = { ...merged, tries: 0, error: null, blocked: false, nextTry: 0 };
      return next;
    }
  }

  return [...queue, op];
}

/* ---------- تطبيق الطابور فوق نسخة الخادم ---------- */

export function applyRecords(base: RecordRow[], queue: Op[]): RecordRow[] {
  const ops = queue.filter((op): op is RecordOp => op.kind === "record");
  if (!ops.length) return base;
  const out = [...base];
  for (const op of ops) {
    const row: RecordRow = {
      student_id: op.student_id,
      term: op.term,
      criteria: op.criteria,
      tp: op.tp,
      devoir: op.devoir,
      exam: op.exam,
    };
    const index = out.findIndex(
      (r) => r.student_id === op.student_id && r.term === op.term,
    );
    if (index >= 0) out[index] = row;
    else out.push(row);
  }
  return out;
}

export function applyReadings(base: Reading[], queue: Op[]): Reading[] {
  const ops = queue.filter(
    (op): op is ReadingAddOp | ReadingDelOp =>
      op.kind === "reading-add" || op.kind === "reading-del",
  );
  if (!ops.length) return base;
  let out = [...base];
  for (const op of ops) {
    if (op.kind === "reading-add") {
      if (!out.some((r) => r.id === op.reading.id)) out.push(op.reading);
    } else {
      out = out.filter((r) => r.id !== op.reading_id);
    }
  }
  return out;
}

export function applyStudents<T extends { id: string }>(base: T[], queue: Op[]): T[] {
  const ops = queue.filter((op): op is StudentOp => op.kind === "student");
  if (!ops.length) return base;
  let out = base;
  for (const op of ops) {
    if (!out.some((s) => s.id === op.student_id)) continue;
    out = out.map((s) => (s.id === op.student_id ? { ...s, ...op.patch } : s));
  }
  return out;
}

/* ---------- ما يُعرض للأستاذ ---------- */

export type Pending = {
  /** علامات التقويم المستمر والمركّبات. */
  marks: number;
  /** محاولات القراءة، إضافةً وحذفًا. */
  reads: number;
  /** أسماء التلاميذ وحالاتهم الخاصة. */
  edits: number;
  total: number;
  /** ما رفضه الخادم رفضًا نهائيًا وينتظر قرار الأستاذ. */
  blocked: number;
};

export function pending(queue: Op[]): Pending {
  const out: Pending = { marks: 0, reads: 0, edits: 0, total: 0, blocked: 0 };
  for (const op of queue) {
    if (op.blocked) out.blocked++;
    if (op.kind === "record") out.marks++;
    else if (op.kind === "student") out.edits++;
    else out.reads++;
    out.total++;
  }
  return out;
}

/** صيغة العدد في العربية: مفرد ومثنّى وجمع قلّة وجمع كثرة. */
export function countWord(
  n: number,
  one: string,
  two: string,
  few: string,
  many: string,
): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** «3 علامات لم تُرسل» — نصّ المؤشّر كما يقرؤه الأستاذ. */
export function pendingLabel(queue: Op[]): string {
  const p = pending(queue);
  if (!p.total) return "";
  const parts: string[] = [];
  if (p.marks) parts.push(countWord(p.marks, "علامة", "علامتان", "علامات", "علامة"));
  if (p.reads) parts.push(countWord(p.reads, "محاولة", "محاولتان", "محاولات", "محاولة"));
  if (p.edits) parts.push(countWord(p.edits, "تعديل", "تعديلان", "تعديلات", "تعديلًا"));
  return `${parts.join(" و")} لم تُرسل`;
}

/* ---------- تصنيف خطأ الخادم ---------- */

/**
 * الفرق الذي يقرّر المصير: الشبكة أم الرفض؟
 *
 * انقطاع الشبكة يأتي بلا رمز حالة — فالعملية تبقى وتُعاد المحاولة. أما رمز
 * Postgres (مخالفة قيد، أو صلاحية) فلن تصلحه إعادة المحاولة مهما طالت، فتُعلَّم
 * «متعثّرة» وتُعرض على الأستاذ. وفي الحالتين لا تُحذف علامة أدخلها.
 */
export function isPermanent(code: string | null | undefined): boolean {
  if (!code) return false;
  // 22 = قيمة خاطئة، 23 = مخالفة قيد، 42 = صلاحية أو خطأ في الطلب
  return /^(22|23|42)/.test(code) || code === "PGRST204";
}

/** تباعد متزايد بين المحاولات، بسقف دقيقة واحدة. */
export function backoff(tries: number, now: number): number {
  return now + Math.min(60_000, 2_000 * 2 ** Math.max(0, tries - 1));
}

export function uid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // سياق غير آمن أو متصفّح قديم: معرّف عشوائي يكفي للتمييز محليًا
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function newOp<T extends Op["kind"]>(
  kind: T,
  rest: Omit<Extract<Op, { kind: T }>, keyof OpBase | "kind">,
): Extract<Op, { kind: T }> {
  return {
    kind,
    id: uid(),
    at: Date.now(),
    tries: 0,
    error: null,
    blocked: false,
    nextTry: 0,
    ...rest,
  } as Extract<Op, { kind: T }>;
}
