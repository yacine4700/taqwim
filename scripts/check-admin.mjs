/* اختبار منطق صفحة الإشراف (src/lib/admin.ts). يستورد الشفرة الحقيقية لا نسخةً منها.
   الصلاحية نفسها تُختبر في القاعدة (supabase/tests)؛ هنا ما تفعله الواجهة بردود القاعدة. */
import assert from "node:assert/strict";
import {
  classifyAdminError, parseAdminState, cleanCode, codeReady, cleanReason, REASON_MAX,
  msLeft, leftLabel, daysLeft, summarize, filterTeachers, adminProblemMessage,
} from "../src/lib/admin.ts";

let n = 0;
const ok = (label, fn) => { fn(); n += 1; console.log("ok ", label); };

ok("42501 مع mfa_required ⇒ إعادة الرمز", () =>
  assert.equal(classifyAdminError({ code: "42501", message: "mfa_required" }), "mfa_required"));
ok("42501 مع forbidden ⇒ رفض نهائي", () =>
  assert.equal(classifyAdminError({ code: "42501", message: "forbidden" }), "forbidden"));
ok("42501 برسالة أخرى ⇒ رفض نهائي (لا نفترض الأخف)", () =>
  assert.equal(classifyAdminError({ code: "42501", message: "permission denied" }), "forbidden"));
ok("28000 وJWT منتهٍ و401 ⇒ جلسة", () => {
  assert.equal(classifyAdminError({ code: "28000", message: "not authenticated" }), "session");
  assert.equal(classifyAdminError({ message: "JWT expired" }), "session");
  assert.equal(classifyAdminError({ status: 401, message: "" }), "session");
});
ok("انقطاع الشبكة", () => assert.equal(classifyAdminError({ message: "TypeError: Failed to fetch" }), "network"));
ok("غير معروف أو فارغ ⇒ other", () => {
  assert.equal(classifyAdminError({ code: "XX000", message: "boom" }), "other");
  assert.equal(classifyAdminError(null), "other");
});
ok("لكل حالة رسالة عربية مختلفة", () => {
  const msgs = ["mfa_required", "forbidden", "session", "network", "other"].map(adminProblemMessage);
  assert.equal(new Set(msgs).size, 5);
});

ok("parseAdminState: شكل غريب ⇒ ليس مشرفًا", () => {
  for (const v of [null, undefined, 5, "x", [], {}, { listed: "true", ready: 1 }]) {
    const s = parseAdminState(v);
    assert.equal(s.listed, false); assert.equal(s.ready, false); assert.equal(s.mfaExpiresAt, null);
  }
});
ok("parseAdminState: رد صالح", () => {
  const s = parseAdminState({ listed: true, ready: true, mfa_expires_at: "2026-10-30T10:00:00Z" });
  assert.deepEqual(s, { listed: true, ready: true, mfaExpiresAt: "2026-10-30T10:00:00Z" });
  assert.equal(parseAdminState({ listed: true, mfa_expires_at: "ليس تاريخًا" }).mfaExpiresAt, null);
});

ok("رمز التحقّق: أرقام فقط وستة", () => {
  assert.equal(cleanCode("12a3 456789"), "123456");
  assert.equal(codeReady("123456"), true);
  assert.equal(codeReady("12345"), false);
  assert.equal(codeReady("12345a"), false);
});

ok("السبب: تشذيب وقصّ وإهمال الفراغ", () => {
  assert.equal(cleanReason("   "), null);
  assert.equal(cleanReason("  شكوى  "), "شكوى");
  assert.equal(cleanReason("س".repeat(500)).length, REASON_MAX);
});

const NOW = new Date("2026-10-29T12:00:00Z").getTime();
ok("الوقت المتبقي", () => {
  assert.equal(msLeft(null, NOW), 0);
  assert.equal(msLeft("ليس تاريخًا", NOW), 0);
  assert.equal(msLeft("2026-10-29T11:00:00Z", NOW), 0);
  assert.equal(leftLabel(0), "انتهى");
  assert.equal(leftLabel(30_000), "أقل من دقيقة");
  assert.equal(leftLabel(35 * 60_000), "35 د");
  assert.equal(leftLabel((11 * 60 + 40) * 60_000), "11 س 40 د");
});
ok("أيام المهلة تُقرَّب للأعلى", () => {
  assert.equal(daysLeft("2026-11-05T12:00:00Z", NOW), 7);
  assert.equal(daysLeft("2026-10-30T12:00:01Z", NOW), 2);
  assert.equal(daysLeft("2026-10-29T11:59:00Z", NOW), 0);
});

const t = (o) => ({
  id: "x", email: "a@x.dz", full_name: "أ", created_at: null, last_sign_in_at: null, status: "active",
  banned_until: null, purge_after: null, is_admin: false, classes: 1, students: 30, records: 30, last_activity: null, ...o,
});
const list = [
  t({ id: "1", full_name: "ياسين", email: "y@x.dz", last_activity: "2026-10-28T12:00:00Z" }),
  t({ id: "2", status: "disabled", email: "b@x.dz", last_activity: "2026-10-10T12:00:00Z", classes: 2, students: 50, records: 10 }),
  t({ id: "3", status: "deletion_pending", email: "c@x.dz", purge_after: "2026-11-01T00:00:00Z" }),
  t({ id: "4", is_admin: true, email: "admin@x.dz", classes: 99, students: 99, records: 99, last_activity: "2026-10-29T11:00:00Z" }),
];
ok("الإحصاءات تستثني المشرفين وتعدّ الحالات", () => {
  const s = summarize(list, NOW);
  assert.deepEqual(s, { accounts: 3, active: 1, disabled: 1, pending: 1, classes: 4, students: 110, records: 70, activeWeek: 1, activeMonth: 2, idle: 1 });
});
ok("الإحصاءات على قائمة فارغة", () => assert.equal(summarize([], NOW).accounts, 0));
ok("البحث والمرشّح", () => {
  assert.deepEqual(filterTeachers(list, "", "all").map((x) => x.id), ["1", "2", "3", "4"]);
  assert.deepEqual(filterTeachers(list, "Y@X", "all").map((x) => x.id), ["1"]);
  assert.deepEqual(filterTeachers(list, "ياسين", "all").map((x) => x.id), ["1"]);
  assert.deepEqual(filterTeachers(list, "", "disabled").map((x) => x.id), ["2"]);
  assert.deepEqual(filterTeachers(list, "c@", "active").map((x) => x.id), []);
});

console.log(`${n} اختبارًا نجحت`);
