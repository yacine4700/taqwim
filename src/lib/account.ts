/**
 * حالة الحساب: مهلة الحذف والإيقاف. منطق صغير بلا واجهة، يُختبر بالأرقام
 * (scripts/check-account.mjs).
 */

/** مهلة الحذف بالأيام. القاعدة هي ما يفرضها؛ هذا للعرض فقط. */
export const DELETION_GRACE_DAYS = 7;

export const BANNED_MESSAGE = "حسابك موقوف مؤقتًا. يُرجى التواصل مع صاحب التطبيق.";

type Err = { code?: string | null; message?: string | null; status?: number | null } | null | undefined;

/** رفض Supabase Auth لحساب موقوف (عند الدخول أو تجديد الجلسة). */
export function isBannedError(error: Err): boolean {
  if (!error) return false;
  if (error.code === "user_banned") return true;
  return /user (is )?banned/i.test(error.message ?? "");
}

/** رسالة طلب الحذف بالعربية. */
export function deletionErrorMessage(error: Err): string {
  if (!error) return "";
  const m = (error.message ?? "").toLowerCase();
  if (m.includes("reauth_required")) {
    return "لم نتأكّد من كلمة المرور. أدخلها من جديد ثم اضغط مرة أخرى.";
  }
  if (m.includes("invalid login") || error.code === "invalid_credentials") {
    return "كلمة المرور غير صحيحة.";
  }
  if (isBannedError(error)) return BANNED_MESSAGE;
  if (error.code === "PGRST202" || m.includes("could not find")) {
    return "الحذف غير مُفعَّل على الخادم بعد، ولم يُحذف شيء. أبلغ صاحب التطبيق.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "طلبات كثيرة في وقت قصير. انتظر دقيقة ثم أعد المحاولة.";
  }
  return "تعذّر الطلب، ولم يُحذف شيء. أعد المحاولة.";
}

/** «الأحد 29 أكتوبر 2026»؛ وnull لقيمة غير صالحة. */
export function purgeDateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ar-DZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** ما تعيده my_account_status: موعد الحذف إن كان مجدولًا، وإلا null. */
export function pendingPurge(status: unknown): string | null {
  if (!status || typeof status !== "object") return null;
  const v = (status as Record<string, unknown>).purge_after;
  return typeof v === "string" && v ? v : null;
}
