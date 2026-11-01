/* اختبار المزامنة: تصنيف الفشل (شبكة / جلسة / رفض)، ومصير العملية بعده،
   وبوّابة الخروج (لا خروج والطابور فيه ما لم يُحفظ في ملف).
   يستورد الشفرة الحقيقية (src/lib/outbox.ts)، فلا تنفصل النسخة المختبَرة عن
   المنشورة. يحتاج Node 22.6 فأحدث مع --experimental-strip-types وخطّاف
   scripts/ts-resolve.mjs (انظر "check" في package.json). */

import {
  afterFailure,
  applyRecords,
  applyReadings,
  canSignOut,
  createLandedLog,
  classifyFailure,
  enqueue,
  isPermanent,
  mayFailSilently,
  newOp,
  writesBlocked,
  opFingerprint,
} from "../src/lib/outbox.ts";

let failed = 0;
let passed = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
}

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const rec = (student, criteria, extra = {}) =>
  newOp("record", { student_id: student, term: 1, criteria, tp: null, devoir: null, exam: null, ...extra });

console.log("— تصنيف الفشل");
t("استثناء fetch (لم يصل الطلب) → شبكة", classifyFailure({ thrown: true, hasSession: true }), "network");
t("بلا رمز ولا حالة → شبكة", classifyFailure({ hasSession: true }), "network");
t("مهلة الخادم 57014 → شبكة", classifyFailure({ code: "57014", status: 500, hasSession: true }), "network");
t("الخادم 503 بلا رمز → شبكة", classifyFailure({ status: 503, hasSession: true }), "network");
t("الرمز منتهٍ PGRST301 → جلسة", classifyFailure({ code: "PGRST301", status: 401, hasSession: true }), "auth");
t("حالة 401 وحدها → جلسة", classifyFailure({ status: 401, hasSession: true }), "auth");
t("دخول بلا رمز ممنوع PGRST302 → جلسة", classifyFailure({ code: "PGRST302", hasSession: false }), "auth");
t("RLS 42501 بلا جلسة (طلب بدور anon) → جلسة لا رفض", classifyFailure({ code: "42501", status: 401, hasSession: false }), "auth");
t("RLS 42501 بلا جلسة وحالة 403 → جلسة", classifyFailure({ code: "42501", status: 403, hasSession: false }), "auth");
t("RLS 42501 والجلسة سليمة → رفض حقيقي", classifyFailure({ code: "42501", status: 403, hasSession: true }), "rejected");
t("403 بلا رمز والجلسة سليمة → رفض حقيقي", classifyFailure({ status: 403, hasSession: true }), "rejected");
t("تلميذ محذوف 23503 → رفض", classifyFailure({ code: "23503", status: 409, hasSession: true }), "rejected");
t("قيمة خارج المجال 23514 → رفض", classifyFailure({ code: "23514", hasSession: true }), "rejected");
t("عمود مجهول PGRST204 → رفض", classifyFailure({ code: "PGRST204", status: 400, hasSession: true }), "rejected");
t("isPermanent كما كان (اختبارات check-outbox لم تتغيّر)", [isPermanent("42501"), isPermanent("PGRST301"), isPermanent(undefined)], [true, false, false]);

console.log("— مصير العملية بعد الفشل");
const base = { ...rec(S1, { part: 2 }), tries: 1 };
const auth = afterFailure(base, "auth", "انتهت الجلسة", 1_000);
t("جلسة: لا تُعلَّم متعثّرة", auth.op.blocked, false);
t("جلسة: لا تُحسب محاولة", auth.op.tries, 1);
t("جلسة: لا تأخير (تُرسل فور العودة)", auth.op.nextTry, base.nextTry);
t("جلسة: تتوقّف الجولة ويُطلب الدخول", [auth.stop, auth.needsLogin], [true, true]);
t("جلسة: المحتوى نفسه (العلامة لم تُمسّ)", opFingerprint(auth.op), opFingerprint(base));
t("جلسة: المعرّف نفسه", auth.op.id, base.id);

const net = afterFailure(base, "network", "تعذّر الاتصال", 1_000);
t("شبكة: محاولة تُحسب وتأخير متزايد", [net.op.tries, net.op.nextTry > 1_000, net.op.blocked], [2, true, false]);
t("شبكة: تتوقّف الجولة بلا طلب دخول", [net.stop, net.needsLogin], [true, false]);

const bad = afterFailure(base, "rejected", "violates check", 1_000);
t("رفض: تُعلَّم متعثّرة ولا تُحذف", [bad.op.blocked, bad.op.error], [true, "violates check"]);
t("رفض: الجولة تكمل بالعمليات الأخرى", bad.stop, false);

console.log("— سيناريو: انتهاء الجلسة في منتصف الطابور ثم العودة");
// ثلاث علامات؛ الأولى تصل، الثانية تُرفض بالجلسة، فتتوقّف الجولة ولا تُمسّ الثالثة.
let queue = [rec(S1, { part: 1 }), rec(S2, { part: 3 }), newOp("student", { student_id: S1, patch: { note: "x" } })];
const before = queue.map(opFingerprint);
queue = queue.slice(1); // الأولى قبلها الخادم
const r = afterFailure(queue[0], classifyFailure({ code: "PGRST301", status: 401, hasSession: true }), "انتهت", 5);
queue = [r.op, ...queue.slice(1)];
t("بعد انتهاء الجلسة: العمليتان الباقيتان بمحتواهما", queue.map(opFingerprint), before.slice(1));
t("بعد انتهاء الجلسة: لا متعثّرة فلا يلزم «أعد» يدويًا", queue.filter((op) => op.blocked).length, 0);
t("الجولة توقّفت قبل الثالثة", r.stop, true);

console.log("— بصمة العملية وبوّابة الخروج");
const a = rec(S1, { part: 2, disc: -1 });
const b = { ...a, criteria: { disc: -1, part: 2 } };
t("ترتيب المفاتيح لا يغيّر البصمة", opFingerprint(a), opFingerprint(b));
t("حالة المحاولات لا تغيّر البصمة", opFingerprint({ ...a, tries: 4, error: "x", nextTry: 99, blocked: true }), opFingerprint(a));
t("تغيير قيمة معيار داخلي يغيّر البصمة", opFingerprint(a) === opFingerprint({ ...a, criteria: { part: 3, disc: -1 } }), false);

const q1 = [a, newOp("student", { student_id: S2, patch: { full_name: "س" } })];
const exported = new Set(q1.map(opFingerprint));
t("الطابور فارغ → الخروج مسموح", canSignOut([], new Set()), true);
t("معلّقات لم تُصدَّر → الخروج ممنوع", canSignOut(q1, new Set()), false);
t("كل المعلّقات في الملف → الخروج مسموح", canSignOut(q1, exported), true);
// تعديل لاحق يُدمج في العملية نفسها (المعرّف نفسه، محتوى جديد): الملف صار قديمًا
const q2 = enqueue(q1, rec(S1, { part: 4, disc: -1 }));
t("الدمج يُبقي المعرّف", q2[0].id, q1[0].id);
t("تعديل بعد التصدير → الخروج ممنوع حتى يُصدَّر من جديد", canSignOut(q2, exported), false);
t("عملية جديدة بعد التصدير → الخروج ممنوع", canSignOut([...q1, rec(S2, { part: 1 })], exported), false);
t("عملية وصلت الخادم بعد التصدير → الخروج مسموح", canSignOut([q1[1]], exported), true);

// — حساب مجمَّد (مهلة حذف أو إيقاف): لا تعثّر ولا محاولة تُحسب، والطابور يتوقّف
{
  const op = rec(S1, { part: 2 });
  const out = afterFailure({ ...op, tries: 2 }, "frozen", "مجمَّد", 1000);
  t("مجمَّد: لا تُعلَّم متعثّرة", out.op.blocked, false);
  t("مجمَّد: لا تُحسب محاولة", out.op.tries, 2);
  t("مجمَّد: لا تأخير قبل الإرسال بعد الإلغاء", out.op.nextTry, op.nextTry);
  t("مجمَّد: تتوقّف الجولة", out.stop, true);
  t("مجمَّد: لا يُطلب دخول", out.needsLogin, false);
  t("مجمَّد: المحتوى لم يتغيّر (فلا تكرار ولا ضياع)", opFingerprint(out.op), opFingerprint(op));
}
t("حذف محاولة قراءة قد يضيع بصمت", mayFailSilently(newOp("reading-del", { reading_id: "r1" })), true);
t("مسح علامة حصة قد يضيع بصمت", mayFailSilently(newOp("tp-mark", { session_id: "s", student_id: S1, score: null, absent: false })), true);
t("تعديل التلميذ قد يضيع بصمت", mayFailSilently(newOp("student", { student_id: S1, patch: { note: "x" } })), true);
t("علامة حصة ليست حذفًا", mayFailSilently(newOp("tp-mark", { session_id: "s", student_id: S1, score: 12, absent: false })), false);
t("غياب ليس حذفًا", mayFailSilently(newOp("tp-mark", { session_id: "s", student_id: S1, score: null, absent: true })), false);
t("علامات الفصل upsert: الرفض صريح", mayFailSilently(rec(S1, { part: 1 })), false);
t("الحالة: مجمَّد", writesBlocked({ purge_after: "x", writes_blocked: true }), true);
t("الحالة: غير مجمَّد", writesBlocked({ purge_after: null, writes_blocked: false }), false);
t("الحالة: ردّ قديم بلا الحقل", writesBlocked({ purge_after: null }), false);
t("الحالة: لا ردّ", writesBlocked(null), false);

console.log("— سباق القراءة والإرسال (العلامة لا ترجع إلى قيمتها القديمة)");
{
  // الحالة التي رآها الأستاذ: الخادم يقبل التعديل بينما قراءة بدأت قبله تحمل القيمة القديمة.
  const log = createLandedLog();
  const old = [{ student_id: S1, term: 1, criteria: { part: 1 }, tp: null, devoir: null, exam: null }];
  const edit = rec(S1, { part: 4 });

  const ticket = log.begin();            // بدأت القراءة وأخذت القيمة القديمة
  log.land(edit);                         // قبل الخادمُ التعديل وخرج من الطابور
  // بلا السجلّ: القراءة تكتب القديم فوق الجديد (هذا ما كان يحدث)
  t("بلا السجلّ: ترجع العلامة القديمة", applyRecords(old, [])[0].criteria, { part: 1 });
  // مع السجلّ: يُعاد تطبيق ما قُبل بعد بدء القراءة
  t("مع السجلّ: تبقى العلامة الجديدة", applyRecords(old, log.since(ticket))[0].criteria, { part: 4 });
  log.end(ticket);
}
{
  // ما قُبل قبل بدء القراءة لا يُعاد تطبيقه: القراءة رأته في الخادم
  const log = createLandedLog();
  const other = log.begin();
  log.land(rec(S1, { part: 2 }));
  const later = log.begin();
  t("قراءة بدأت بعد القبول لا تعيد تطبيقه", log.since(later).length, 0);
  t("القراءة الأقدم ما تزال تراه", log.since(other).length, 1);
  log.end(other);
  t("بعد انتهاء الأقدم يسقط ما لا تحتاجه الباقية", log.since(later).length, 0);
  log.end(later);
}
{
  // ترتيب القبول محفوظ: الأحدث هو الأخير فيغلب
  const log = createLandedLog();
  const ticket = log.begin();
  log.land(rec(S1, { part: 2 }));
  log.land(rec(S1, { part: 5 }));
  t("الأحدث يغلب عند إعادة التطبيق", applyRecords([], log.since(ticket))[0].criteria, { part: 5 });
  log.end(ticket);
}
{
  // لا قراءة جارية: لا يُحفظ شيء فلا يكبر السجلّ
  const log = createLandedLog();
  log.land(rec(S1, { part: 3 }));
  const ticket = log.begin();
  t("ما قُبل دون قراءة جارية لا يُحفظ", log.since(ticket).length, 0);
  log.end(ticket);
}
{
  // فشل القراءة (end بلا since) لا يترك بقايا
  const log = createLandedLog();
  const a = log.begin();
  log.land(rec(S1, { part: 3 }));
  log.end(a);
  const b = log.begin();
  t("بعد انتهاء كل القراءات يُفرَّغ السجلّ", log.since(b).length, 0);
  log.end(b);
}
{
  // الحذف: محاولة حذفها الخادم أثناء قراءة لا تعود من قراءة قديمة
  const log = createLandedLog();
  const stale = [{ id: "r1", student_id: S1, term: 1, score: 3, read_on: "2026-11-01", criterion_code: "read" }];
  const ticket = log.begin();
  log.land(newOp("reading-del", { reading_id: "r1", student_id: S1 }));
  t("حذف قُبل أثناء القراءة لا يعود", applyReadings(stale, log.since(ticket)), []);
  log.end(ticket);
}

console.log(`\n${passed} ok, ${failed} failed`);
if (failed) process.exit(1);
