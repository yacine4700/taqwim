/**
 * منطق الدخول الصغير الذي يستحق اختبارًا بالأرقام (scripts/check-auth.mjs
 * نسخة حرفية منه): الوجهة بعد رابط البريد، وتحقّق كلمة السر الجديدة.
 */

export const MIN_PASSWORD = 6;

/**
 * الوجهة بعد تبديل الرمز. تُقبل مسارات التطبيق وحدها: وجهة تأتي من الرابط
 * لا يجوز أن تقود إلى موقع آخر (إعادة توجيه مفتوحة).
 */
export function safeNext(value: string | null | undefined): string {
  if (!value) return "/app";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/app";
  }
  const allowed = ["/app", "/reset"];
  const ok = allowed.some((p) => value === p || value.startsWith(`${p}?`));
  return ok ? value : "/app";
}

/**
 * وجهة /auth/callback بعد محاولة تبديل الرمز: النجاح إلى وجهته، والحساب الموقوف إلى شرحه،
 * وما سواه إلى «رابط منتهٍ». كان كل فشل يُعامَل رابطًا فاسدًا، فيُقال للموقوف إن رابطه انتهى
 * ويطلب رابطًا بعد رابط بلا جدوى.
 */
export function callbackTarget(outcome: "ok" | "banned" | "failed", next: string): string {
  if (outcome === "ok") return next;
  return outcome === "banned" ? "/login?error=banned" : "/login?error=link";
}

/** رسالة بالعربية إن كانت كلمتا السر غير صالحتين، وإلا null. */
export function passwordProblem(password: string, again: string): string | null {
  if (password.length < MIN_PASSWORD) {
    return `كلمة السر قصيرة: ${MIN_PASSWORD} أحرف على الأقل.`;
  }
  if (password !== again) return "الكلمتان غير متطابقتين.";
  return null;
}

export function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  // Supabase Auth: "User is banned" (دخول)، "Invalid Refresh Token: User Banned" (تجديد)
  if (m.includes("user is banned") || m.includes("user banned")) {
    return "حسابك موقوف مؤقتًا. يُرجى التواصل مع صاحب التطبيق.";
  }
  if (m.includes("invalid login")) return "البريد أو كلمة السر غير صحيحة.";
  if (m.includes("already registered")) return "هذا البريد مسجّل. سجّل الدخول به.";
  if (m.includes("rate limit") || m.includes("too many") || m.includes("seconds")) {
    return "طلبات كثيرة في وقت قصير. انتظر دقيقة ثم أعد المحاولة.";
  }
  if (m.includes("different from the old")) {
    return "اختر كلمة سر مختلفة عن القديمة.";
  }
  if (m.includes("session") && m.includes("missing")) {
    return "انتهت صلاحية الرابط. اطلب رابطًا جديدًا.";
  }
  // فشل الإرسال من جهة الخادم (SMTP): "Error sending confirmation email" وأخواتها.
  // يجب أن يسبق فرع «email» وإلا ظهر للأستاذ أن بريده خاطئ وهو صحيح.
  if (m.includes("error sending")) {
    return "تعذّر إرسال الرسالة إلى بريدك الآن. أعد المحاولة بعد قليل، وإن تكرّر فأخبر صاحب التطبيق.";
  }
  if (m.includes("email not confirmed")) {
    return "لم تؤكّد بريدك بعد. افتح رسالة التأكيد التي أرسلناها إليك.";
  }
  if (m.includes("password")) return `كلمة السر لا تصلح: ${MIN_PASSWORD} أحرف على الأقل.`;
  if (m.includes("email")) return "راجع صيغة البريد الإلكتروني.";
  return message;
}

/**
 * تأكيد الحذف بكتابة البريد: عملية لا رجعة فيها لا تكفيها نقرة. المقارنة لا
 * تفرّق بين حالة الأحرف ولا تعبأ بالفراغ المحيط، فلوحة المفاتيح في الهاتف
 * تكبّر الحرف الأول وتضيف فراغًا.
 */
export function confirmMatches(typed: string, email: string): boolean {
  const want = email.trim().toLowerCase();
  if (!want) return false;
  return typed.trim().toLowerCase() === want;
}

/**
 * نسخة سياسة الخصوصية التي يوافق عليها المسجِّل. تُسجَّل مع الموافقة في بيانات
 * المستخدم، فإذا تغيّرت السياسة جوهريًا غُيّر هذا الرقم وعُرف من وافق على أي نسخة.
 */
export const PRIVACY_VERSION = "2026-10-22";

/** الموافقة شرط إنشاء الحساب: لا تُملأ عنه، ولا يكفيها وسم HTML وحده. */
export function consentProblem(accepted: boolean): string | null {
  return accepted ? null : "للمتابعة وافق على سياسة الخصوصية.";
}

/** بيانات المستخدم عند إنشاء الحساب: الاسم، وأثر الموافقة (النسخة والتاريخ). */
export function signupMetadata(name: string, now: Date) {
  return {
    full_name: name,
    privacy_version: PRIVACY_VERSION,
    privacy_accepted_at: now.toISOString(),
  };
}

/** تغيير كلمة السر من داخل الحساب: القصر ثم التطابق ثم ألّا تكون كالقديمة. */
export function changePasswordProblem(
  current: string,
  next: string,
  again: string,
): string | null {
  const basic = passwordProblem(next, again);
  if (basic) return basic;
  if (next === current) return "الكلمة الجديدة مطابقة للقديمة. اختر كلمة مختلفة.";
  return null;
}
