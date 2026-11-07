/* اختبار مجموعتي الأعمدة (src/lib/columnGroups.ts): الافتراضي، وما يُتذكَّر،
   وعمود مفتوح داخل مجموعة مطويّة، وقراءة ما حُفظ على الجهاز.
   يحتاج Node 22.6 فأحدث مع --experimental-strip-types. */
import { NO_GROUP_PREFS, groupExpanded, parseGroupPrefs, setGroup } from "../src/lib/columnGroups.ts";

let pass = 0, fail = 0;
function t(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`); }
}
const ctx = (examSeason = false, holdsOpenColumn = false) => ({ examSeason, holdsOpenColumn });

console.log("— الافتراضي");
t("معايير التقويم مفتوحة", groupExpanded(NO_GROUP_PREFS, "criteria", ctx()), true);
t("علامات الفصل مطويّة", groupExpanded(NO_GROUP_PREFS, "marks", ctx()), false);
t("وتُفتح افتراضيًا في فترة الاختبارات", groupExpanded(NO_GROUP_PREFS, "marks", ctx(true)), true);
t("فترة الاختبارات لا تمسّ معايير التقويم", groupExpanded(NO_GROUP_PREFS, "criteria", ctx(true)), true);

console.log("— ما اختاره الأستاذ يغلب الافتراضي");
let p = setGroup(NO_GROUP_PREFS, "marks", true);
t("فتح علامات الفصل خارج الاختبارات: مفتوحة", groupExpanded(p, "marks", ctx()), true);
t("ولا يمسّ المجموعة الأخرى", p.criteria, null);
p = setGroup(NO_GROUP_PREFS, "marks", false);
t("طيّها في فترة الاختبارات: تبقى مطويّة", groupExpanded(p, "marks", ctx(true)), false);
p = setGroup(NO_GROUP_PREFS, "criteria", false);
t("طيّ معايير التقويم", groupExpanded(p, "criteria", ctx()), false);
t("الاختيار نفسه لا ينشئ كائنًا جديدًا", setGroup(p, "criteria", false) === p, true);

console.log("— عمود مفتوح");
p = setGroup(NO_GROUP_PREFS, "marks", false);
t("عمود مفتوح داخل مجموعة مطويّة: تُعرض مفتوحة", groupExpanded(p, "marks", ctx(false, true)), true);
t("ولا يتغيّر اختياره المحفوظ بذلك", p.marks, false);
p = setGroup(NO_GROUP_PREFS, "criteria", false);
t("المعيار المفتوح يُظهر مجموعته المطويّة", groupExpanded(p, "criteria", ctx(false, true)), true);

console.log("— قراءة ما حُفظ");
t("سليم", parseGroupPrefs({ criteria: false, marks: true }), { criteria: false, marks: true });
t("ناقص: الباقي افتراضي", parseGroupPrefs({ marks: true }), { criteria: null, marks: true });
t("من نسخة أقدم بلا الحقل", parseGroupPrefs(undefined), { criteria: null, marks: null });
t("تالف", parseGroupPrefs("x"), { criteria: null, marks: null });
t("قيم غير منطقية تُهمَل", parseGroupPrefs({ criteria: 1, marks: "yes" }), { criteria: null, marks: null });
t("null", parseGroupPrefs(null), { criteria: null, marks: null });

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
