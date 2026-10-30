/**
 * منطق صفحة الإشراف بلا واجهة، يُختبر بالأرقام (scripts/check-admin.mjs يستورده كما هو).
 * الصلاحية نفسها لا تُحسب هنا: القاعدة هي التي تقرّر (private.require_admin)، وما في
 * هذا الملف يفسّر ما تردّه ويعرض الأعداد.
 */

export type AdminStatus = "active" | "disabled" | "deletion_pending";

export type AdminTeacher = {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  status: AdminStatus;
  banned_until: string | null;
  purge_after: string | null;
  is_admin: boolean;
  classes: number;
  students: number;
  records: number;
  last_activity: string | null;
};

export type AdminLogRow = {
  at: string;
  actor_kind: "admin" | "teacher" | "system";
  action: string;
  target_email: string | null;
  detail: ({ reason?: string } & import("./adminTerms").TermLogDetail) | null;
};

/** أقصى طول للسبب. القاعدة تقصّ عند هذا الحدّ نفسه. */
export const REASON_MAX = 300;

/** ما تردّه am_i_admin، مقروءًا بحذر: أي شكل آخر يُعامل كأنه «ليس مشرفًا». */
export type AdminState = { listed: boolean; ready: boolean; mfaExpiresAt: string | null };

export function parseAdminState(value: unknown): AdminState {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const exp = typeof v.mfa_expires_at === "string" ? v.mfa_expires_at : null;
  return {
    listed: v.listed === true,
    ready: v.ready === true,
    mfaExpiresAt: exp && !Number.isNaN(new Date(exp).getTime()) ? exp : null,
  };
}

/** ما الذي حدث؟ يقرّر الواجهة: إعادة الرمز، أو الدخول من جديد، أو رفض نهائي، أو إعادة محاولة. */
export type AdminProblem = "mfa_required" | "forbidden" | "session" | "network" | "other";

type Err = { code?: string | null; message?: string | null; status?: number | null } | null | undefined;

export function classifyAdminError(error: Err): AdminProblem {
  if (!error) return "other";
  const m = (error.message ?? "").toLowerCase();
  if (error.code === "42501") return m.includes("mfa_required") ? "mfa_required" : "forbidden";
  if (
    error.code === "28000" ||
    error.status === 401 ||
    m.includes("jwt") ||
    m.includes("not authenticated") ||
    m.includes("refresh token") ||
    m.includes("auth session missing")
  ) {
    return "session";
  }
  if (m.includes("failed to fetch") || m.includes("network") || m.includes("load failed")) return "network";
  return "other";
}

export function adminProblemMessage(problem: AdminProblem): string {
  switch (problem) {
    case "mfa_required":
      return "انتهت صلاحية التحقّق الثنائي. أدخل الرمز من جديد.";
    case "forbidden":
      return "لا صلاحية لهذا الحساب.";
    case "session":
      return "انتهت الجلسة. ادخل من جديد.";
    case "network":
      return "لا اتصال بالخادم. تحقّق من الشبكة ثم أعد المحاولة.";
    default:
      return "تعذّرت العملية. أعد المحاولة.";
  }
}

/** رمز التحقّق: ستة أرقام لا غير. */
export function cleanCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}
export function codeReady(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/** السبب المكتوب: مشذَّب ومقصوص، وnull إن كان فارغًا (فلا يُرسل). */
export function cleanReason(raw: string): string | null {
  const t = raw.trim().slice(0, REASON_MAX);
  return t === "" ? null : t;
}

const DAY = 24 * 60 * 60 * 1000;

/** ما تبقّى بالدقائق حتى لحظة، أو 0 إن انقضت أو كانت غير صالحة. */
export function msLeft(iso: string | null, now: number): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, t - now);
}

/** «11 س 40 د» أو «35 د» أو «أقل من دقيقة». */
export function leftLabel(ms: number): string {
  if (ms <= 0) return "انتهى";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "أقل من دقيقة";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} س ${m} د` : `${m} د`;
}

/** أيام المهلة المتبقية (تقريب للأعلى)، وصفر إن انقضت. */
export function daysLeft(purgeAfter: string | null, now: number): number {
  return Math.ceil(msLeft(purgeAfter, now) / DAY);
}

export type AdminStats = {
  accounts: number;
  active: number;
  disabled: number;
  pending: number;
  classes: number;
  students: number;
  records: number;
  activeWeek: number;
  activeMonth: number;
  idle: number;
};

/**
 * إحصاءات الأساتذة (دون حسابات المشرفين). «نشط في أسبوع / شهر» حسب آخر نشاط تنقيط؛
 * و«خامل» من لا نشاط له قط. أعداد فقط: لا شيء من محتوى البيانات.
 */
export function summarize(list: AdminTeacher[], now: number): AdminStats {
  const s: AdminStats = {
    accounts: 0, active: 0, disabled: 0, pending: 0,
    classes: 0, students: 0, records: 0, activeWeek: 0, activeMonth: 0, idle: 0,
  };
  for (const t of list) {
    if (t.is_admin) continue;
    s.accounts += 1;
    if (t.status === "active") s.active += 1;
    else if (t.status === "disabled") s.disabled += 1;
    else s.pending += 1;
    s.classes += t.classes;
    s.students += t.students;
    s.records += t.records;
    const last = t.last_activity ? new Date(t.last_activity).getTime() : NaN;
    if (Number.isNaN(last)) s.idle += 1;
    else {
      if (now - last <= 7 * DAY) s.activeWeek += 1;
      if (now - last <= 30 * DAY) s.activeMonth += 1;
    }
  }
  return s;
}

export type StatusFilter = "all" | AdminStatus;

/** بحث بالاسم أو البريد (لا يفرّق حالة الأحرف) مع مرشّح الحالة. */
export function filterTeachers(list: AdminTeacher[], query: string, status: StatusFilter): AdminTeacher[] {
  const q = query.trim().toLowerCase();
  return list.filter((t) => {
    if (status !== "all" && t.status !== status) return false;
    if (!q) return true;
    return (t.full_name ?? "").toLowerCase().includes(q) || (t.email ?? "").toLowerCase().includes(q);
  });
}

export const ACTION_LABEL: Record<string, string> = {
  disable: "إيقاف حساب",
  enable: "إعادة تفعيل",
  cancel_deletion: "إلغاء حذف",
  request_deletion: "طلب حذف",
  purge: "حذف نهائي",
  set_term: "تعديل الرزنامة",
};

export const ACTOR_LABEL: Record<AdminLogRow["actor_kind"], string> = {
  admin: "المشرف",
  teacher: "الأستاذ",
  system: "التشغيل الليلي",
};

export const STATUS_LABEL: Record<AdminStatus, string> = {
  active: "نشط",
  disabled: "موقوف",
  deletion_pending: "حذف مجدول",
};
