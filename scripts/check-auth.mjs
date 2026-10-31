/* نسخة حرفية من منطق src/lib/auth.ts، لاختباره بالأرقام.
   النسختان يجب أن تبقيا متطابقتين، كما في check-scoring.mjs. */

const MIN_PASSWORD = 6;

function safeNext(value) {
  if (!value) return "/app";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/app";
  }
  const allowed = ["/app", "/reset"];
  const ok = allowed.some((p) => value === p || value.startsWith(`${p}?`));
  return ok ? value : "/app";
}

function callbackTarget(outcome, next) {
  if (outcome === "ok") return next;
  return outcome === "banned" ? "/login?error=banned" : "/login?error=link";
}

function passwordProblem(password, again) {
  if (password.length < MIN_PASSWORD) {
    return `كلمة السر قصيرة: ${MIN_PASSWORD} أحرف على الأقل.`;
  }
  if (password !== again) return "الكلمتان غير متطابقتين.";
  return null;
}

function translateAuthError(message) {
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

function confirmMatches(typed, email) {
  const want = email.trim().toLowerCase();
  if (!want) return false;
  return typed.trim().toLowerCase() === want;
}

const PRIVACY_VERSION = "2026-10-22";

function consentProblem(accepted) {
  return accepted ? null : "للمتابعة وافق على سياسة الخصوصية.";
}

function signupMetadata(name, now) {
  return {
    full_name: name,
    privacy_version: PRIVACY_VERSION,
    privacy_accepted_at: now.toISOString(),
  };
}

function changePasswordProblem(current, next, again) {
  const basic = passwordProblem(next, again);
  if (basic) return basic;
  if (next === current) return "الكلمة الجديدة مطابقة للقديمة. اختر كلمة مختلفة.";
  return null;
}

let pass = 0;
let fail = 0;
function eq(name, got, want) {
  if (got === want) pass++;
  else {
    fail++;
    console.error(`✗ ${name}\n   حصلنا: ${JSON.stringify(got)}\n   المتوقع: ${JSON.stringify(want)}`);
  }
}

/* الوجهة بعد الرابط: لا إعادة توجيه إلى خارج التطبيق */
eq("بلا وجهة", safeNext(null), "/app");
eq("وجهة فارغة", safeNext(""), "/app");
eq("/reset تُقبل", safeNext("/reset"), "/reset");
eq("/app تُقبل", safeNext("/app"), "/app");
eq("/app مع استعلام", safeNext("/app?tab=docs"), "/app?tab=docs");
eq("موقع خارجي", safeNext("https://evil.example"), "/app");
eq("بروتوكول نسبي //", safeNext("//evil.example"), "/app");
eq("شرطة معكوسة", safeNext("/\\evil.example"), "/app");
eq("مسار غير مسموح", safeNext("/api/roster"), "/app");
eq("بادئة تشبه المسموح", safeNext("/reset-evil"), "/app");
eq("بادئة /application", safeNext("/application"), "/app");

/* كلمة السر الجديدة */
eq("قصيرة", passwordProblem("12345", "12345"), "كلمة السر قصيرة: 6 أحرف على الأقل.");
eq("غير متطابقتين", passwordProblem("secret1", "secret2"), "الكلمتان غير متطابقتين.");
eq("سليمة", passwordProblem("secret1", "secret1"), null);
eq("حدّ الطول", passwordProblem("123456", "123456"), null);
eq("القصر قبل التطابق", passwordProblem("12", "34"), "كلمة السر قصيرة: 6 أحرف على الأقل.");

/* وجهة الرابط بعد تبديل الرمز */
eq("نجاح: إلى وجهته", callbackTarget("ok", "/reset"), "/reset");
eq("حساب موقوف: شرح الإيقاف لا «رابط منتهٍ»", callbackTarget("banned", "/reset"), "/login?error=banned");
eq("فشل آخر: رابط منتهٍ", callbackTarget("failed", "/app"), "/login?error=link");

/* الرسائل */
eq("دخول خاطئ", translateAuthError("Invalid login credentials"), "البريد أو كلمة السر غير صحيحة.");
eq("حساب موقوف", translateAuthError("User is banned"), "حسابك موقوف مؤقتًا. يُرجى التواصل مع صاحب التطبيق.");
eq("تجديد حساب موقوف", translateAuthError("Invalid Refresh Token: User Banned"), "حسابك موقوف مؤقتًا. يُرجى التواصل مع صاحب التطبيق.");
eq("حدّ البريد", translateAuthError("email rate limit exceeded"), "طلبات كثيرة في وقت قصير. انتظر دقيقة ثم أعد المحاولة.");
eq("كلمة قديمة", translateAuthError("New password should be different from the old password."), "اختر كلمة سر مختلفة عن القديمة.");
eq("جلسة مفقودة", translateAuthError("Auth session missing!"), "انتهت صلاحية الرابط. اطلب رابطًا جديدًا.");
eq("كلمة قصيرة من الخادم", translateAuthError("Password should be at least 6 characters"), "كلمة السر لا تصلح: 6 أحرف على الأقل.");
eq("رسالة مجهولة تمرّ كما هي", translateAuthError("boom"), "boom");
const SEND_FAILED = "تعذّر إرسال الرسالة إلى بريدك الآن. أعد المحاولة بعد قليل، وإن تكرّر فأخبر صاحب التطبيق.";
eq("فشل إرسال التأكيد (SMTP) ليس خطأ صيغة", translateAuthError("Error sending confirmation email"), SEND_FAILED);
eq("فشل إرسال الاستعادة", translateAuthError("Error sending recovery email"), SEND_FAILED);
eq("بريد غير مؤكَّد", translateAuthError("Email not confirmed"), "لم تؤكّد بريدك بعد. افتح رسالة التأكيد التي أرسلناها إليك.");
eq("صيغة بريد خاطئة تبقى كما كانت", translateAuthError('Email address "x" is invalid'), "راجع صيغة البريد الإلكتروني.");
eq("حدّ البريد يسبق فرع الإرسال", translateAuthError("email rate limit exceeded"), "طلبات كثيرة في وقت قصير. انتظر دقيقة ثم أعد المحاولة.");

/* تأكيد الحذف */
eq("البريد نفسه", confirmMatches("a@b.com", "a@b.com"), true);
eq("حالة الأحرف لا تهمّ", confirmMatches("A@B.com", "a@b.com"), true);
eq("فراغ محيط", confirmMatches("  a@b.com ", "a@b.com"), true);
eq("بريد آخر", confirmMatches("x@b.com", "a@b.com"), false);
eq("فارغ", confirmMatches("", "a@b.com"), false);
eq("بريد الحساب فارغ لا يُطابق الفارغ", confirmMatches("", ""), false);
eq("جزء من البريد", confirmMatches("a@b", "a@b.com"), false);

/* الموافقة على الخصوصية عند إنشاء الحساب */
eq("بلا موافقة تُرفض", consentProblem(false), "للمتابعة وافق على سياسة الخصوصية.");
eq("بموافقة تمرّ", consentProblem(true), null);
const meta = signupMetadata("أستاذ تجريبي", new Date("2026-10-16T13:00:00.000Z"));
eq("الاسم يُحفظ", meta.full_name, "أستاذ تجريبي");
eq("نسخة السياسة تُحفظ", meta.privacy_version, "2026-10-22");
eq("تاريخ الموافقة بصيغة ISO", meta.privacy_accepted_at, "2026-10-16T13:00:00.000Z");

/* تغيير كلمة السر من داخل الحساب */
eq("جديدة قصيرة", changePasswordProblem("oldpass1", "12345", "12345"), "كلمة السر قصيرة: 6 أحرف على الأقل.");
eq("غير متطابقتين", changePasswordProblem("oldpass1", "newpass1", "newpass2"), "الكلمتان غير متطابقتين.");
eq("كالقديمة", changePasswordProblem("samepass", "samepass", "samepass"), "الكلمة الجديدة مطابقة للقديمة. اختر كلمة مختلفة.");
eq("سليمة", changePasswordProblem("oldpass1", "newpass1", "newpass1"), null);

console.log(`auth: ${pass} نجح، ${fail} فشل`);
if (fail) process.exit(1);
