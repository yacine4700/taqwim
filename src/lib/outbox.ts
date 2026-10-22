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

import type { Reading, RecordRow, TpMark, TpSession } from "./scoring";

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

/**
 * حصة أعمال تطبيقية جديدة أو معدَّلة. معرّفها يُولَّد في الهاتف، فتُنشأ في
 * قاعة لا تغطية فيها وتُنقَّط فورًا، والإرسال (upsert) لا يكرّرها. وهي قبل
 * علاماتها في الطابور دائمًا، فلا تصل علامة إلى حصة لم تُنشأ بعد.
 */
export type TpSessionOp = OpBase & { kind: "tp-session"; session: TpSession };

/**
 * علامة تلميذ في حصة. صفٌّ واحد لكل (حصة، تلميذ): الجديدة تحلّ محل القديمة.
 * `score = null` مع `absent = false` تعني «مسح»: يُحذف الصف في الخادم ويعود
 * التلميذ إلى «لم يُقيَّم»، لا إلى صفر.
 */
export type TpMarkOp = OpBase & {
  kind: "tp-mark";
  session_id: string;
  student_id: string;
  score: number | null;
  absent: boolean;
};

export type Op =
  | RecordOp
  | ReadingAddOp
  | ReadingDelOp
  | StudentOp
  | TpSessionOp
  | TpMarkOp;

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
    case "tp-session":
      return `tpsession:${op.session.id}`;
    case "tp-mark":
      return `tpmark:${op.session_id}:${op.student_id}`;
  }
}

/** التلميذ صاحب العملية، أو null إن لم تكن لتلميذ (حصة جديدة). */
export function opStudentId(op: Op): string | null {
  switch (op.kind) {
    case "reading-add":
      return op.reading.student_id;
    case "tp-session":
      return null;
    default:
      return op.student_id;
  }
}

/** الحصة صاحبة العملية، أو null إن لم تكن لحصة. */
export function opSessionId(op: Op): string | null {
  if (op.kind === "tp-session") return op.session.id;
  if (op.kind === "tp-mark") return op.session_id;
  return null;
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

  if (
    op.kind === "record" ||
    op.kind === "student" ||
    op.kind === "tp-mark" ||
    op.kind === "tp-session"
  ) {
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

/** حصص الأعمال التطبيقية فوق نسخة الخادم: الجديدة تُضاف والمعدَّلة تحلّ محلّها. */
export function applyTpSessions(base: TpSession[], queue: Op[]): TpSession[] {
  const ops = queue.filter((op): op is TpSessionOp => op.kind === "tp-session");
  if (!ops.length) return base;
  const out = [...base];
  for (const op of ops) {
    const index = out.findIndex((s) => s.id === op.session.id);
    if (index >= 0) out[index] = op.session;
    else out.push(op.session);
  }
  return out;
}

/**
 * علامات الحصص فوق نسخة الخادم. المسح (بلا علامة ولا غياب) يُخرج الصف من
 * العرض كما يُخرجه الخادم، فيعود التلميذ «لم يُقيَّم» لا صفرًا.
 */
export function applyTpMarks(base: TpMark[], queue: Op[]): TpMark[] {
  const ops = queue.filter((op): op is TpMarkOp => op.kind === "tp-mark");
  if (!ops.length) return base;
  let out = [...base];
  for (const op of ops) {
    const same = (m: TpMark) => m.session_id === op.session_id && m.student_id === op.student_id;
    if (op.score === null && !op.absent) {
      out = out.filter((m) => !same(m));
      continue;
    }
    const row: TpMark = {
      session_id: op.session_id,
      student_id: op.student_id,
      score: op.absent ? null : op.score,
      absent: op.absent,
    };
    const index = out.findIndex(same);
    if (index >= 0) out[index] = row;
    else out.push(row);
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
    if (op.kind === "record" || op.kind === "tp-mark") out.marks++;
    else if (op.kind === "student" || op.kind === "tp-session") out.edits++;
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

/**
 * ما يُقال للأستاذ على شاشة الخطأ: علاماته المعلّقة محفوظة على الجهاز.
 * فارغ إن لم يكن شيء معلّقًا: لا نؤكّد «كل شيء وصل» لأن الطابور قد
 * يكون غير مقروء، ونكتفي بألّا نخيفه بلا سبب.
 */
export function savedNotice(queue: Op[]): string {
  if (!pending(queue).total) return "";
  return `${pendingLabel(queue)} بعد. هي محفوظة على هذا الجهاز ولن تضيع، وتُرسل تلقائيًا حين تعود الصفحة إلى العمل.`;
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

/**
 * سبب الفشل كما يقرّر مصير العملية. ثلاثة لا اثنان:
 *
 * - "network": الشبكة أو الخادم مؤقتًا. تبقى العملية وتُعاد بتباعد.
 * - "auth": الجلسة انتهت أو لم تعد لصاحب الطابور. لا ذنب للعملية: لا تُعلَّم
 *   متعثّرة ولا تُحسب محاولة، بل يتوقّف الطابور كله حتى يعود الأستاذ إلى
 *   حسابه، ثم يُستأنف وحده.
 * - "rejected": رفضٌ حقيقي والجلسة سليمة (قيد، أو صلاحية على صف ليس له).
 *   تُعلَّم متعثّرة ويقرّر فيها الأستاذ.
 *
 * - "frozen": الحساب مجدول للحذف أو موقوف، فالقاعدة تمنع كل كتابة (سياسات
 *   guard_*). لا ذنب للعملية: تبقى كما هي بلا محاولة تُحسب، ويتوقّف الطابور حتى
 *   يُلغى الحذف أو يُرفع الإيقاف. لا يستنتجه classifyFailure من الرمز وحده:
 *   useOutbox يسأل الخادم (my_account_status) عند 42501.
 *
 * والفرق بين الثانية والثالثة في رمز 42501 (منعته RLS) هو وجود الجلسة: بلا
 * جلسة يُرسَل الطلب بدور anon فتمنعه RLS، وليس ذلك رفضًا للعلامة نفسها.
 */
export type FailureKind = "network" | "auth" | "rejected" | "frozen";

export function classifyFailure(failure: {
  code?: string | null;
  status?: number | null;
  /** للمتصل جلسة صالحة لصاحب الطابور لحظة الإرسال. */
  hasSession: boolean;
  /** استثناء من fetch نفسه: لم يصل الطلب أصلًا. */
  thrown?: boolean;
}): FailureKind {
  if (failure.thrown) return "network";
  const code = failure.code ?? "";
  const status = failure.status ?? 0;
  // PGRST301 رمز منتهٍ أو غير صالح، 302 دخول بلا رمز ممنوع، 303 ادعاءات الرمز مرفوضة
  if (status === 401 || /^PGRST30[123]$/.test(code)) return "auth";
  if (code === "42501" || status === 403) return failure.hasSession ? "rejected" : "auth";
  if (isPermanent(code)) return "rejected";
  return "network";
}

/**
 * العملية بعد فشلها، وهل تتوقّف الجولة. منطق صافٍ يستعمله useOutbox، وله
 * اختبارات في scripts/check-sync.mjs.
 */
export function afterFailure(
  op: Op,
  kind: FailureKind,
  message: string,
  now: number,
): { op: Op; stop: boolean; needsLogin: boolean } {
  if (kind === "auth") {
    // لا محاولة تُحسب ولا تأخير: تُرسل فور عودة الجلسة
    return { op: { ...op, error: message }, stop: true, needsLogin: true };
  }
  if (kind === "frozen") {
    // كالجلسة المنتهية: لا تُعلَّم متعثّرة ولا تُحسب محاولة، وتُرسل بعد الإلغاء.
    return { op: { ...op, error: message }, stop: true, needsLogin: false };
  }
  if (kind === "rejected") {
    return {
      op: { ...op, blocked: true, error: message, tries: op.tries + 1 },
      stop: false,
      needsLogin: false,
    };
  }
  // الشبكة ساقطة: بقية الطابور ستسقط مثلها، فنتوقّف ونعيد لاحقًا.
  return {
    op: { ...op, tries: op.tries + 1, error: message, nextTry: backoff(op.tries + 1, now) },
    stop: true,
    needsLogin: false,
  };
}

/**
 * بصمة العملية بمحتواها لا بمعرّفها: الدمج في enqueue يُبقي المعرّف ويغيّر
 * المحتوى، فملفٌّ صُدِّر قبل تعديلٍ لاحق لا يحمل التعديل وإن تطابق المعرّف.
 * حقول المحاولات خارجها: لا تغيّر ما أدخله الأستاذ.
 */
export function opFingerprint(op: Op): string {
  const { tries: _t, error: _e, blocked: _b, nextTry: _n, ...content } = op;
  return stableJson(content);
}

/** JSON بمفاتيح مرتّبة على كل المستويات: الكائنان المتساويان بصمتهما واحدة. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * الخروج يمسح طابور الجهاز، فلا يُسمح به وفي الطابور ما لم يصل الخادم ولم
 * يُحفظ في ملف. `exported` بصمات العمليات التي ضمّها آخر ملف نُزِّل.
 */
export function canSignOut(queue: Op[], exported: ReadonlySet<string>): boolean {
  return queue.every((op) => exported.has(opFingerprint(op)));
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

/**
 * عمليات قد «تنجح» على صفر صفوف حين تمنعها RLS: الحذف (محاولة قراءة، مسح علامة
 * حصة) وتعديل بيانات التلميذ. لا يُرجع الخادم فيها خطأً، فلو أُرسلت والحساب
 * مجمَّد (مجدول للحذف أو موقوف) لخرج الحذف من الطابور ولم يُحذف شيء، ولعُلِّم
 * التعديل متعثّرًا. فقبل إرسال جولة فيها واحدة منها يُسأل الخادم عن الحساب.
 * أما الإضافة والتحديث بـ upsert فترفضهما القاعدة بخطأ صريح (42501).
 */
export function mayFailSilently(op: Op): boolean {
  if (op.kind === "reading-del" || op.kind === "student") return true;
  if (op.kind === "tp-mark") return op.score === null && !op.absent;
  return false;
}

/** ردّ my_account_status: هل الكتابة ممنوعة على هذا الحساب الآن؟ */
export function writesBlocked(status: unknown): boolean {
  if (!status || typeof status !== "object") return false;
  return (status as Record<string, unknown>).writes_blocked === true;
}
