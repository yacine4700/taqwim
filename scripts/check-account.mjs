// اختبار src/lib/account.ts (حالة الحساب: مهلة الحذف والإيقاف).
import { BANNED_MESSAGE, deletionErrorMessage, isBannedError, pendingPurge, purgeDateLabel } from "../src/lib/account.ts";

let ok = 0, bad = 0;
const eq = (label, got, want) => {
  if (got === want) ok++;
  else { bad++; console.log(`FAIL ${label}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`); }
};

eq("حظر برمز Supabase", isBannedError({ code: "user_banned", message: "x" }), true);
eq("حظر عند الدخول", isBannedError({ message: "User is banned" }), true);
eq("حظر عند التجديد", isBannedError({ message: "Invalid Refresh Token: User Banned" }), true);
eq("خطأ آخر ليس حظرًا", isBannedError({ message: "Invalid login credentials" }), false);
eq("لا خطأ", isBannedError(null), false);

eq("كلمة مرور قديمة", deletionErrorMessage({ code: "P0001", message: "reauth_required" }), "لم نتأكّد من كلمة المرور. أدخلها من جديد ثم اضغط مرة أخرى.");
eq("كلمة مرور خاطئة", deletionErrorMessage({ code: "invalid_credentials", message: "Invalid login credentials" }), "كلمة المرور غير صحيحة.");
eq("حساب موقوف", deletionErrorMessage({ message: "User is banned" }), BANNED_MESSAGE);
eq("الدالة غير موجودة", deletionErrorMessage({ code: "PGRST202", message: "Could not find the function" }), "الحذف غير مُفعَّل على الخادم بعد، ولم يُحذف شيء. أبلغ صاحب التطبيق.");
eq("خطأ مجهول لا يقول إن شيئًا حُذف", deletionErrorMessage({ message: "boom" }).includes("لم يُحذف شيء"), true);

eq("موعد مجدول", pendingPurge({ deletion_requested_at: "2026-10-22T10:00:00Z", purge_after: "2026-10-29T10:00:00Z" }), "2026-10-29T10:00:00Z");
eq("غير مجدول", pendingPurge({ deletion_requested_at: null, purge_after: null }), null);
eq("ردّ فارغ (قبل الترحيل)", pendingPurge(null), null);
eq("ردّ غريب", pendingPurge("x"), null);

eq("تاريخ غير صالح", purgeDateLabel("nope"), null);
eq("تاريخ صالح يُكتب", typeof purgeDateLabel("2026-10-29T10:00:00Z"), "string");

console.log(`account: ${ok} نجح، ${bad} فشل`);
process.exit(bad ? 1 : 0);
