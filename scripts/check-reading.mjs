/* اختبار القراءة داخل القسم (src/lib/readingDraft.ts): الاختيار بالعدل،
   والتبديل، والمتطوّع، وما يُحفظ، وبقاء القسم مفتوحًا عند تبديل التبويب،
   وترحيل المكان المحفوظ من تبويب «الحصة» القديم.
   يستورد الشفرة الحقيقية. يحتاج Node 22.6 فأحدث مع --experimental-strip-types
   وخطّاف scripts/ts-resolve.mjs. */

import {
  DEFAULT_READING_CODE,
  autoCriteria,
  continuousMark,
  readingsFor,
} from "../src/lib/scoring.ts";
import {
  READING_COLUMN,
  drawCodeOf,
  draftKey,
  readingColumnKey,
  draftEntries,
  emptyDraft,
  liveDraft,
  migrateWhere,
  openClassAfterTab,
  pickDraft,
  setDraftScore,
  swapInDraft,
  toggleVolunteer,
} from "../src/lib/readingDraft.ts";

let failed = 0;
let passed = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
}

const st = (id, name = id) => ({ id, full_name: name });
const A = st("a"), B = st("b"), C = st("c"), D = st("d"), E = st("e");
const list = [A, B, C, D, E];
const attempts = { a: 2, b: 0, c: 1, d: 0, e: 3 };
const attemptsOf = (id) => attempts[id] ?? 0;
const ids = (d) => d.picked.map((p) => p.id);

console.log("— الاختيار بالعدل");
for (let i = 0; i < 20; i++) {
  const d = pickDraft(list, attemptsOf, 3);
  if (JSON.stringify([...ids(d)].sort()) !== JSON.stringify(["b", "c", "d"])) {
    t("الأقل محاولات أولًا (20 مرة)", [...ids(d)].sort(), ["b", "c", "d"]);
    break;
  }
  if (i === 19) t("الأقل محاولات أولًا (20 مرة)", true, true);
}
t("اختيار جديد يبدأ بلا نقاط", pickDraft(list, attemptsOf, 2).scores, {});
t("العدد أكبر من القسم: القسم كله", pickDraft([A, B], attemptsOf, 5).picked.length, 2);
t("المفتاح في شريط العرض", READING_COLUMN.startsWith("r:"), true);

console.log("— التبديل");
let d = { picked: [B, D], scores: { b: 3, d: 2 } };
let s = swapInDraft(d, "b", list, attemptsOf);
t("الغائب يُستبدل بالتالي في العدل (c: محاولة واحدة)", ids(s), ["c", "d"]);
t("نقطة المُخرَج تُمحى، وتبقى نقطة غيره", s.scores, { d: 2 });
s = swapInDraft({ picked: [A, B], scores: {} }, "a", [A, B], attemptsOf);
t("لا أحد يعوّضه: يُخرَج ولا تُكرَّر الأسماء", ids(s), ["b"]);

console.log("— المتطوّع");
d = { picked: [B, D], scores: { b: 4 } };
let v = toggleVolunteer(d, E);
t("يُضاف في آخر القائمة ولو كان أكثرهم محاولات", ids(v), ["b", "d", "e"]);
t("إضافته لا تمسّ النقاط", v.scores, { b: 4 });
v = toggleVolunteer(setDraftScore(v, "e", 3), E);
t("النقرة الثانية تُخرجه ونقطته", [ids(v), v.scores], [["b", "d"], { b: 4 }]);
v = toggleVolunteer(emptyDraft(), C);
t("متطوّع قبل أي اختيار: القائمة به وحده", ids(v), ["c"]);
t("لا تكرار: من في القائمة يُخرَج لا يُضاف ثانية", ids(toggleVolunteer({ picked: [C], scores: {} }, C)), []);

console.log("— ما يُحفظ");
d = { picked: [B, D, E], scores: { b: 0, d: "skip" } };
t("الصفر محاولة، والغائب ومن لم يُنقَّط لا", draftEntries(d), [{ studentId: "b", score: 0 }]);
t("بترتيب القائمة", draftEntries({ picked: [E, B], scores: { b: 2, e: 4 } }), [
  { studentId: "e", score: 4 },
  { studentId: "b", score: 2 },
]);

console.log("— القائمة الحيّة");
d = { picked: [B, D], scores: { b: 3, d: 1 } };
t("لا تغيير: المسودّة نفسها", liveDraft(d, list) === d, true);
let live = liveDraft(d, [A, B, C, E]);
t("تلميذ حُذف من جهاز آخر يسقط ونقطته", [ids(live), live.scores], [["b"], { b: 3 }]);
live = liveDraft(d, [st("b", "اسم مصحّح"), D]);
t("الاسم يؤخذ من القسم بآخر تعديل", live.picked[0].full_name, "اسم مصحّح");

console.log("— تبديل التبويب");
t("من «الحصة» أو الإحصاء إلى الأقسام: القسم يبقى مفتوحًا", openClassAfterTab("stats", "classes", "k1"), "k1");
t("النقر على «الأقسام» وهو فيه: يُغلق القسم", openClassAfterTab("classes", "classes", "k1"), null);
t("من الأقسام إلى الإعدادات: القسم محفوظ للرجوع", openClassAfterTab("classes", "settings", "k1"), "k1");

console.log("— ترحيل المكان المحفوظ");
const exists = (id) => id === "k1" || id === "k2";
t("كان في «الحصة»: يُفتح قسم الحصة على القراءة",
  migrateWhere({ tab: "session", openClass: "k1", sessionClass: "k2" }, exists),
  { tab: "classes", openClass: "k2", readingIn: "k2" });
t("قسم الحصة حُذف: الأقسام والقسم المفتوح إن بقي",
  migrateWhere({ tab: "session", openClass: "k1", sessionClass: "gone" }, exists),
  { tab: "classes", openClass: "k1", readingIn: null });
t("تبويب آخر: كما هو",
  migrateWhere({ tab: "stats", openClass: "k1", sessionClass: "k2" }, exists),
  { tab: "stats", openClass: "k1", readingIn: null });
t("قسم مفتوح حُذف لا يُفتح",
  migrateWhere({ tab: "classes", openClass: "gone" }, exists),
  { tab: "classes", openClass: null, readingIn: null });

console.log("— أعمدة السحب لكل معيار");
t("معيار القراءة يبقى بمفتاحه القديم", readingColumnKey("read"), READING_COLUMN);
t("غيره r:<code>", readingColumnKey("oral"), "r:oral");
t("كود المفتاح القديم", drawCodeOf(READING_COLUMN), DEFAULT_READING_CODE);
t("كود مفتاح معيار", drawCodeOf("r:oral"), "oral");
t("عمود معيار عادي ليس سحبًا", drawCodeOf("c:part"), null);
t("لا عمود مفتوح", drawCodeOf(null), null);
t("مسودّتان لمعيارين في قسم واحد", draftKey("k1", "read") !== draftKey("k1", "oral"), true);
t("المعايير من نوع السحب", autoCriteria([{ code: "a", kind: "add" }, { code: "oral", kind: "auto" }]).map((c) => c.code), ["oral"]);
t("محاولة قديمة بلا كود تُحسب للقراءة", readingsFor([{ score: 1 }, { score: 2, criterion_code: "oral" }], "read").length, 1);
const crit = (code, kind = "auto") => ({ id: code, code, label: code, kind, base: 0, ceiling: 4, position: 0 });
t("المحاكاة بالشفرة الحقيقية: القراءة 2.5 والشفوية 3 لا يتكرران",
  Math.round(continuousMark([crit("read"), crit("oral")], undefined, [
    { id: "1", student_id: "s", term: 1, score: 2.5, read_on: "x", criterion_code: "read" },
    { id: "2", student_id: "s", term: 1, score: 4, read_on: "x", criterion_code: "oral" },
    { id: "3", student_id: "s", term: 1, score: 2, read_on: "x", criterion_code: "oral" },
  ]) * 100) / 100, 13.75); // (2.5+3) على سقفين 8، لا (2.5+2.83)×2

console.log(`\n${passed} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
