/**
 * منطق تبويب «النسخ الاحتياطي» في لوحة المشرف بلا واجهة، ويُختبر بالأرقام (scripts/check-adminbackup.mjs).
 * الحَكَم هو القاعدة (public.admin_set_backup وpublic.admin_set_exams_from)؛ هنا فحص مسبق بالقواعد
 * نفسها ليرى المشرف الخطأ قبل الإرسال، ووصف للجدولة الحالية بعبارة مفهومة.
 *
 * ملف قائم بذاته ليُختبر دون محمِّل مسارات.
 */

export type BackupMode = "auto" | "daily" | "paused";
export type BackupSchedule = "weekly" | "daily_exams" | "daily_override" | "paused";

export type BackupStatus = {
  schedule: BackupSchedule;
  mode: BackupMode;
  until: string | null;
  reason: string | null;
  override_expired: boolean;
  exam_term: number | null;
  exam_school_year: string | null;
  exam_window_ends: string | null;
  /** أقرب جمعة بعد اليوم، وأقرب بداية اختبارات بعد اليوم (قد تكون null قبل ترحيل 20261030150000). */
  next_weekly: string | null;
  next_exam_from: string | null;
  next_exam_term: number | null;
};

/** أقصى مدة لتجاوز يدوي، كما في القاعدة. */
export const OVERRIDE_MAX_DAYS = 30;
/** بداية الاختبارات الافتراضية: قبل نهاية الفصل بهذا العدد من الأيام (كما في القاعدة). */
export const EXAMS_DEFAULT_DAYS_BEFORE_END = 14;

const DAY = 86_400_000;
const ms = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(ms(s)) === s;
export const addDays = (s: string, n: number) => iso(ms(s) + n * DAY);

/** يعزل التاريخ من اتجاه الجملة العربية، وإلا يُعرض 2026-11-12 معكوسًا (12-11-2026) في العنوان. */
export const ltr = (d: string) => `\u2066${d}\u2069`;

const SCHEDULES: readonly BackupSchedule[] = ["weekly", "daily_exams", "daily_override", "paused"];
const MODES: readonly BackupMode[] = ["auto", "daily", "paused"];

/** يقرأ ردّ admin_backup_status بحذر؛ null إن لم يكن بالشكل المتوقّع. */
export function parseBackupStatus(data: unknown): BackupStatus | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!SCHEDULES.includes(d.schedule as BackupSchedule) || !MODES.includes(d.mode as BackupMode)) return null;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    schedule: d.schedule as BackupSchedule,
    mode: d.mode as BackupMode,
    until: str(d.until),
    reason: str(d.reason),
    override_expired: d.override_expired === true,
    exam_term: typeof d.exam_term === "number" ? d.exam_term : null,
    exam_school_year: str(d.exam_school_year),
    exam_window_ends: str(d.exam_window_ends),
    next_weekly: str(d.next_weekly),
    next_exam_from: str(d.next_exam_from),
    next_exam_term: typeof d.next_exam_term === "number" ? d.next_exam_term : null,
  };
}

/** عنوان الحالة وسطر شرحها. */
export function scheduleLabel(s: BackupStatus): { title: string; detail: string; tone: "ok" | "warn" } {
  switch (s.schedule) {
    case "paused":
      return {
        title: `موقوف حتى ${ltr(s.until ?? "؟")} (لا نسخ)`,
        detail: `${s.reason ? `السبب: ${s.reason}. ` : ""}يعود النسخ وحده بعد هذا التاريخ.`,
        tone: "warn",
      };
    case "daily_override":
      return {
        title: `يومي (يدوي) حتى ${ltr(s.until ?? "؟")}`,
        detail: `${s.reason ? `السبب: ${s.reason}. ` : ""}ثم يعود إلى الجدولة العادية.`,
        tone: "ok",
      };
    case "daily_exams":
      return {
        title: "يومي الآن (فترة الاختبارات)",
        detail: `ينسخ كل ليلة${s.exam_window_ends ? ` حتى ${ltr(s.exam_window_ends)}` : ""} (الفصل ${s.exam_term ?? "؟"} من ${
          s.exam_school_year ?? "؟"
        }).`,
        tone: "ok",
      };
    default: {
      const parts = [
        s.next_weekly ? `النسخة القادمة: ليلة الخميس إلى الجمعة ${ltr(s.next_weekly)}.` : "النسخ كل ليلة جمعة.",
        s.next_exam_from
          ? `يبدأ النسخ اليومي في ${ltr(s.next_exam_from)}${s.next_exam_term ? ` (الفصل ${s.next_exam_term})` : ""}.`
          : "لا فترة اختبارات قادمة في الرزنامة.",
        "وتُضاف نسخة في أي ليلة إن كُتب أكثر من 50 تنقيطًا منذ آخر نسخة.",
      ];
      return { title: "أسبوعي (ليس يوميًّا الآن)", detail: parts.join(" "), tone: "ok" };
    }
  }
}

export type BackupCheck = { ok: true } | { ok: false; error: string };

/** القواعد نفسها التي تفرضها public.admin_set_backup. */
export function validateBackup(mode: BackupMode, until: string, reason: string, today: string): BackupCheck {
  if (mode === "auto") return { ok: true };
  if (!isIso(until)) return { ok: false, error: "اكتب تاريخ الانتهاء" };
  if (ms(until) < ms(today) + DAY) return { ok: false, error: "تاريخ الانتهاء من الغد فصاعدًا" };
  if (ms(until) > ms(today) + OVERRIDE_MAX_DAYS * DAY) {
    return { ok: false, error: `أقصى مدة ${OVERRIDE_MAX_DAYS} يومًا (حتى ${ltr(addDays(today, OVERRIDE_MAX_DAYS))})` };
  }
  if (reason.trim().length === 0) return { ok: false, error: "اكتب السبب" };
  return { ok: true };
}

export type ExamRow = {
  school_year: string;
  term: number;
  starts_on: string;
  ends_on: string;
  grace_days: number;
  exams_from?: string | null;
};

/** نافذة النسخ اليومي لفصل: من بداية الاختبارات إلى نهاية الفصل + المهلة. */
export function examWindow(r: ExamRow): { from: string; to: string; isDefault: boolean } {
  return {
    from: r.exams_from ?? addDays(r.ends_on, -EXAMS_DEFAULT_DAYS_BEFORE_END),
    to: addDays(r.ends_on, r.grace_days),
    isDefault: !r.exams_from,
  };
}

/** القواعد نفسها التي تفرضها public.admin_set_exams_from. فارغ = العودة إلى الافتراضي. */
export function validateExamsFrom(r: ExamRow, value: string): BackupCheck {
  if (value.trim() === "") return { ok: true };
  if (!isIso(value)) return { ok: false, error: "اكتب تاريخًا صحيحًا" };
  if (ms(value) < ms(r.starts_on) || ms(value) > ms(r.ends_on)) {
    return { ok: false, error: `يجب أن يكون بين ${ltr(r.starts_on)} و${ltr(r.ends_on)}` };
  }
  return { ok: true };
}

/** خطأ القاعدة بعبارة المشرف، أو null إن لم يكن من أخطاء هذه الشاشة. */
export function backupErrorMessage(error: { code?: string | null; message?: string | null } | null | undefined): string | null {
  if (!error) return null;
  if (error.code === "22023") return "رفضت القاعدة القيم المكتوبة. راجع التاريخ والسبب.";
  if (error.code === "23514") return "يخالف هذا التاريخ حدود الفصل. راجع الرزنامة.";
  return null;
}

export type BackupLogDetail = {
  mode?: BackupMode;
  until?: string | null;
  school_year?: string;
  term?: number;
  exams_from?: string | null;
  previous?: { mode?: BackupMode; until?: string | null } | string | null;
};

const MODE_WORD: Record<BackupMode, string> = { auto: "عادي (أسبوعي)", daily: "يومي", paused: "موقوف" };

/** سطر السجلّ لتعديل النسخ أو بداية الاختبارات. */
export function backupLogSummary(action: string, d: BackupLogDetail | null | undefined): string {
  if (!d) return "";
  if (action === "set_backup" && d.mode) {
    const now = d.mode === "auto" ? MODE_WORD.auto : `${MODE_WORD[d.mode]} حتى ${ltr(d.until ?? "؟")}`;
    const prev = d.previous && typeof d.previous === "object" && d.previous.mode ? d.previous : null;
    return prev
      ? `${now}. كان: ${prev.mode === "auto" ? MODE_WORD.auto : `${MODE_WORD[prev.mode!]} حتى ${ltr(prev.until ?? "؟")}`}`
      : now;
  }
  if (action === "set_exams" && d.term !== undefined) {
    const prev = typeof d.previous === "string" ? d.previous : null;
    return `${d.school_year ?? ""} · الفصل ${d.term}: بداية الاختبارات ${d.exams_from ? ltr(d.exams_from) : "الافتراضي"}${
      prev ? `. كانت: ${ltr(prev)}` : ""
    }`;
  }
  return "";
}
