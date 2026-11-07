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
  recentReaders,
  READING_COOLDOWN,
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

// عشوائية ثابتة البذرة: النتائج نفسها في كل تشغيل.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const sorted = (d) => [...ids(d)].sort();

console.log("— الاختيار: قرعة مرجَّحة");
t("العدد ثمانية", READING_COOLDOWN, 8);
t("اختيار جديد يبدأ بلا نقاط", pickDraft(list, attemptsOf, 2).scores, {});
t("العدد أكبر من القسم: القسم كله", pickDraft([A, B], attemptsOf, 5).picked.length, 2);
t("العدد صفر: لا أحد", pickDraft(list, attemptsOf, 0).picked, []);
{
  let dup = false;
  const rnd = seeded(1);
  for (let i = 0; i < 200; i++) {
    const p = ids(pickDraft(list, attemptsOf, 4, [], rnd));
    if (new Set(p).size !== p.length || p.length !== 4) dup = true;
  }
  t("لا تكرار في القائمة الواحدة (200 مرة)", dup, false);
}
{
  // b بلا محاولة، c بمحاولة: حظّ b ضعف حظّ c، أي الثلثان.
  const rnd = seeded(7);
  const two = [B, C];
  let bWins = 0;
  const N = 6000;
  for (let i = 0; i < N; i++) if (ids(pickDraft(two, attemptsOf, 1, [], rnd))[0] === "b") bWins++;
  const share = bWins / N;
  t(`الأقل محاولة حظّه ضعف من قرأ مرة (${share.toFixed(3)} قرب 0.667)`, share > 0.64 && share < 0.69, true);
  t("ومن قرأ قد يُختار مع ذلك", bWins < N, true);
}
{
  // e بثلاث محاولات أكثر من b: حظّه الثُّمن.
  const rnd = seeded(11);
  let eWins = 0;
  const N = 9000;
  for (let i = 0; i < N; i++) if (ids(pickDraft([B, E], attemptsOf, 1, [], rnd))[0] === "e") eWins++;
  const share = eWins / N;
  t(`ثلاث محاولات زائدة: الحظّ 1/9 (${share.toFixed(3)} قرب 0.111)`, share > 0.095 && share < 0.13, true);
}

console.log("— من قرأ لا يعود قبل ثمانية");
{
  const ten = "abcdefghij".split("").map((x) => st(x));
  const recent = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const rnd = seeded(3);
  let ok = true;
  for (let i = 0; i < 100; i++) {
    if (JSON.stringify(sorted(pickDraft(ten, () => 0, 2, recent, rnd))) !== '["i","j"]') ok = false;
  }
  t("قسم من 10 وآخر 8 قرؤوا: لا يُختار إلا الاثنان الباقيان", ok, true);
  let some = false;
  for (let i = 0; i < 100; i++) if (ids(pickDraft(ten, () => 0, 3, recent, rnd)).includes("h")) some = true;
  let early = false;
  for (let i = 0; i < 100; i++) if (ids(pickDraft(ten, () => 0, 3, recent, rnd)).some((x) => "abcdefg".includes(x))) early = true;
  t("نقص العدد: يعود أقدمهم (h) وحده", [some, early], [true, false]);
}
{
  // قسم صغير: 5 تلاميذ، قرأ منهم أربعة (a الأحدث). العدد 3: يبقى ممنوعًا a وb.
  const rnd = seeded(5);
  let ok = true;
  for (let i = 0; i < 100; i++) {
    if (JSON.stringify(sorted(pickDraft(list, () => 0, 3, ["a", "b", "c", "d"], rnd))) !== '["c","d","e"]') ok = false;
  }
  t("قسم صغير: لا تُعطى قائمة ناقصة، ويبقى الأحدث ممنوعًا", ok, true);
}
t("من خرج من القسم لا يُحسب في الممنوعين", sorted(pickDraft([A, B], () => 0, 1, ["x", "y", "a"], seeded(2))), ["b"]);

console.log("— آخر من قرؤوا");
{
  const r = (id, student_id, created_at, read_on = "2026-11-01") => ({ id, student_id, term: 1, score: 3, read_on, created_at });
  const rows = [
    r("1", "a", "2026-11-01T08:00:00Z"),
    r("2", "b", "2026-11-02T08:00:00Z"),
    r("3", "a", "2026-11-03T08:00:00Z"),
    r("4", "c", "2026-11-03T08:00:00Z"),
  ];
  t("الأحدث أولًا وبلا تكرار؛ المتساويان: الأخير في القائمة أولًا", recentReaders(rows), ["c", "a", "b"]);
  t("الحدّ", recentReaders(rows, 2), ["c", "a"]);
  const old = { id: "5", student_id: "d", term: 1, score: 2, read_on: "2026-11-03" };
  t("محاولة بلا وقت تُرتَّب بيومها وتسبق محاولات يومها ذات الوقت", recentReaders([...rows, old]), ["c", "a", "d", "b"]);
  const many = "abcdefghijk".split("").map((x, i) => r(String(i), x, `2026-11-0${1 + Math.floor(i / 2)}T0${i % 10}:00:00Z`));
  t("ثمانية على الأكثر", recentReaders(many).length, 8);
}

console.log("— التبديل");
let d = { picked: [B, D], scores: { b: 3, d: 2 } };
let s = swapInDraft(d, "b", list, attemptsOf);
t("الغائب يُستبدل بمن ليس في القائمة", ["a", "c", "e"].includes(ids(s)[0]) && ids(s)[1] === "d", true);
t("نقطة المُخرَج تُمحى، وتبقى نقطة غيره", s.scores, { d: 2 });
{
  const rnd = seeded(9);
  let ok = true;
  for (let i = 0; i < 100; i++) {
    const x = swapInDraft({ picked: [B, D], scores: {} }, "b", list, attemptsOf, ["c", "a"], rnd);
    if (ids(x)[0] !== "e") ok = false;
  }
  t("البديل لا يكون ممّن قرأ مؤخّرًا إن وُجد غيره", ok, true);
}
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
