// اختبار src/lib/pwned.ts (فحص كلمات السر المسرَّبة). بلا شبكة: الخادم مزيّف.
import { sha1Hex, countInRange, pwnedCount, leakedPasswordProblem, PWNED_MESSAGE, PWNED_RANGE } from "../src/lib/pwned.ts";

let ok = 0, bad = 0;
const eq = (label, got, want) => {
  if (got === want) ok++;
  else { bad++; console.log(`FAIL ${label}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`); }
};

// بصمة معروفة: SHA-1("password")
const H = "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8";
eq("بصمة SHA-1", await sha1Hex("password"), H);
eq("بصمة نصّ عربي بطول 40", (await sha1Hex("كلمةسر")).length, 40);

const suffix = H.slice(5);
const body = [
  "0018A45C4D1DEF81644B54AB7F969B88D65:1",
  `${suffix}:52256179`,
  "00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0",
].join("\r\n");
eq("عدد في الجواب", countInRange(body, suffix), 52256179);
eq("بحث بأحرف صغيرة", countInRange(body, suffix.toLowerCase()), 52256179);
eq("غير موجود", countInRange(body, "F".repeat(35)), 0);
eq("سطر حشو بعدد 0", countInRange(body, "00D4F6E8FA6EECAD2A3AA415EEC418D38EC"), 0);
eq("جواب فارغ", countInRange("", suffix), 0);
eq("سطر بلا نقطتين", countInRange(`${suffix}\n`, suffix), 0);

// خادم مزيّف يسجّل ما طُلب منه
const seen = [];
const server = (text, status = 200) => async (url, init) => {
  seen.push({ url, init });
  return new Response(text, { status });
};

eq("مسرَّبة", await pwnedCount("password", server(body)), 52256179);
eq("يُرسل أول 5 أحرف فقط", seen[0].url, PWNED_RANGE + "5BAA6");
eq("كلمة السر لا تخرج", seen[0].url.slice(PWNED_RANGE.length).includes("password"), false);
eq("لا جسم في الطلب", seen[0].init.body, undefined);
eq("بقية البصمة لا تخرج", seen[0].url.includes(suffix), false);
eq("رأس الحشو", seen[0].init.headers["Add-Padding"], "true");

eq("سليمة", await pwnedCount("password", server("0018A45C4D1DEF81644B54AB7F969B88D65:3")), 0);
eq("خطأ الخادم = لم نعرف", await pwnedCount("password", server("x", 503)), null);
eq("لا شبكة = لم نعرف", await pwnedCount("password", async () => { throw new TypeError("Failed to fetch"); }), null);
eq("كلمة فارغة لا تُرسل", await pwnedCount("", server(body)), null);

// المهلة: خادم لا يجيب إلا بعد الإلغاء
const hang = (url, init) => new Promise((_, reject) => {
  init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
});
const t0 = Date.now();
eq("مهلة = لم نعرف", await pwnedCount("password", hang, 50), null);
eq("المهلة لا تتأخّر", Date.now() - t0 < 1000, true);

eq("رسالة المنع", await leakedPasswordProblem("password", server(body)), PWNED_MESSAGE);
eq("لا منع للسليمة", await leakedPasswordProblem("password", server("")), null);
eq("لا منع عند التعذّر", await leakedPasswordProblem("password", server("x", 500)), null);

console.log(`pwned: ${ok} نجح، ${bad} فشل`);
process.exit(bad ? 1 : 0);
