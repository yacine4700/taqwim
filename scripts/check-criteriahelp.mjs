/* اختبار شرح طرق الاحتساب (src/lib/criteriaHelp.ts): كل رقم في المثال يجب أن
   يطابق ما يحسبه scoring.ts فعلًا، بأي علامة قصوى. يحتاج --experimental-strip-types. */
import { explainKind, KIND_NAME, WALKTHROUGH } from "../src/lib/criteriaHelp.ts";
import { continuousMark, shownValue } from "../src/lib/scoring.ts";

let pass = 0, fail = 0;
function t(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`); }
}
const crit = (kind, ceiling, code = "x") => ({
  id: code, code, label: code, kind, ceiling, base: kind === "deduct" ? ceiling : 0, position: 1,
});

console.log("— أسماء الطرق لم تتغيّر");
t("خصم", KIND_NAME.deduct, "يبدأ كاملًا ويُخصم منه");
t("إضافة", KIND_NAME.add, "يبدأ من 0 ويُضاف إليه");
t("سحب", KIND_NAME.auto, "بالسحب في الحصة");

console.log("— القاعدة الأصلية محفوظة بمعناها");
t("الخصم: الفارغة = الكاملة", explainKind("deduct", 4).rule,
  "يُحسب لكل تلميذ دائمًا: الخانة الفارغة تعني العلامة الكاملة (4).");
t("الإضافة: الفارغة تخرج", explainKind("add", 4).rule,
  "لا يُحسب حتى تُنقّطه: الخانة الفارغة تخرج من القسمة ولا تُحسب صفرًا.");

console.log("— الجملة المختصرة تحفظ المعنى");
t("خصم: دائمًا + الفارغة = الكاملة", explainKind("deduct", 4).short,
  "يُحسب دائمًا: الخانة الفارغة تعني العلامة الكاملة (4).");
t("خصم يتبع العلامة القصوى", explainKind("deduct", 6).short.includes("(6)"), true);
t("إضافة: تخرج من القسمة ولا تُحسب صفرًا", explainKind("add", 4).short,
  "الخانة الفارغة تخرج من القسمة ولا تُحسب صفرًا.");
t("سحب: متوسط ومعيار واحد", explainKind("auto", 4).short,
  "علامته متوسط محاولاته في الحصة، ولمعيار واحد فقط.");
for (const k of ["deduct", "add", "auto"]) {
  t(`${k}: المختصرة أقصر من الكاملة`, explainKind(k, 4).short.length < explainKind(k, 4).rule.length, true);
}

console.log("— أمثلة بعلامة قصوى 4");
t("خصم 4", explainKind("deduct", 4).example, "مثال: لم يُخصم منه شيء ← 4 من 4. خُصم منه 1 ← 3 من 4.");
t("إضافة 4", explainKind("add", 4).example, "مثال: نقّطته 3 ← 3 من 4. لم تنقّطه بعد ← لا يدخل الحساب.");
t("سحب 4", explainKind("auto", 4).example, "مثال: محاولتان 4 و2 من 4 ← 3 من 4. ومعيار واحد فقط يكون بالسحب.");

console.log("— الأمثلة تتبع العلامة القصوى ولا تخرج عنها");
for (const C of [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 20]) {
  const ex = explainKind("deduct", C).example;
  const nums = [...ex.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  t(`خصم ${C}: لا رقم فوق القصوى`, nums.every((v) => v <= C), true);
  // ما يبقى بعد الخصم هو ما يعرضه العدّاد فعلًا
  const cut = nums[2], left = nums[3];
  t(`خصم ${C}: الباقي = shownValue`, left, shownValue(crit("deduct", C), -cut));
  // والباقي يدخل الحساب كما يقول المثال: معيار وحيد ← left/C × 20
  t(`خصم ${C}: يطابق continuousMark`,
    Number(continuousMark([crit("deduct", C)], { criteria: { x: -cut } }, []).toFixed(6)),
    Number(((left / C) * 20).toFixed(6)));
  const add = [...explainKind("add", C).example.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  t(`إضافة ${C}: لا رقم فوق القصوى`, add.every((v) => v <= C), true);
  const au = [...explainKind("auto", C).example.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  t(`سحب ${C}: المتوسط صحيح`, au[3], Number(((au[0] + au[1]) / 2).toFixed(2)));
}
t("قصوى غير صالحة تُعامل 4", explainKind("add", 0).example, explainKind("add", 4).example);

console.log("— مثال النافذة الإرشادية");
t("17.5 من 20", WALKTHROUGH.mark, 17.5);
t("يطابق continuousMark", continuousMark(WALKTHROUGH.criteria, WALKTHROUGH.record, []), 17.5);
t("النصّ يذكر النتيجة", WALKTHROUGH.text.endsWith("= 17.5 من 20."), true);
// لو حُسبت الواجبات الفارغة صفرًا لكانت 7/12 × 20 ≈ 11.67: المثال يُظهر الفرق
t("الفارغة ليست صفرًا", WALKTHROUGH.mark !== (7 / 12) * 20, true);

console.log(`\n${pass} ok, ${fail} fail`);
if (fail) process.exit(1);
