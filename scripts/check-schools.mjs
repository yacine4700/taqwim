/* نسخة حرفية من منطق src/lib/schools.ts، لاختباره بالأرقام.
   النسختان يجب أن تبقيا متطابقتين، كما في check-scoring.mjs. */

function groupBySchool(classes, schools) {
  const groups = schools
    .map((school) => ({
      key: school.id,
      name: school.name,
      classes: classes.filter((c) => c.school_id === school.id),
    }))
    .filter((group) => group.classes.length > 0);

  const loose = classes.filter(
    (c) => !c.school_id || !schools.some((s) => s.id === c.school_id),
  );
  if (loose.length) {
    groups.push({
      key: "none",
      name: groups.length ? "بلا مؤسسة" : "أقسامي",
      classes: loose,
    });
  }
  return groups;
}

function groupOf(groups, classId) {
  return groups.find((g) => g.classes.some((c) => c.id === classId)) ?? null;
}

function resolveSessionClass(groups, classId) {
  if (classId && groupOf(groups, classId)) return classId;
  return groups[0]?.classes[0]?.id ?? "";
}

function firstClassOf(groups, key) {
  return groups.find((g) => g.key === key)?.classes[0]?.id ?? "";
}

let pass = 0, fail = 0;
function t(name, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
}

const A = { id: "sA", name: "الثانوية أ" };
const B = { id: "sB", name: "الثانوية ب" };
const C = { id: "sC", name: "ثانوية فارغة" };
const k = (id, school_id) => ({ id, school_id });

console.log("\n1. التجميع: بترتيب المؤسسات، وبلا مؤسسة فارغة");
const classes = [k("k1", "sB"), k("k2", "sA"), k("k3", "sB"), k("k4", "sA")];
const g = groupBySchool(classes, [A, B, C]);
t("المؤسسات بترتيبها لا بترتيب الأقسام", g.map((x) => x.key), ["sA", "sB"]);
t("المؤسسة الفارغة لا تظهر", g.some((x) => x.key === "sC"), false);
t("أقسام الأولى", g[0].classes.map((c) => c.id), ["k2", "k4"]);
t("أقسام الثانية", g[1].classes.map((c) => c.id), ["k1", "k3"]);

console.log("\n2. قسم بلا مؤسسة، أو مؤسسته حُذفت");
const g2 = groupBySchool([k("k1", "sA"), k("k2", null), k("k3", "sGone")], [A]);
t("مجموعة أخيرة باسم صريح", g2.map((x) => x.name), ["الثانوية أ", "بلا مؤسسة"]);
t("وفيها اليتيمان", g2[1].classes.map((c) => c.id), ["k2", "k3"]);
const g3 = groupBySchool([k("k1", null)], []);
t("لا مؤسسات أصلًا: «أقسامي»", g3.map((x) => x.name), ["أقسامي"]);
t("لا أقسام: لا مجموعات", groupBySchool([], [A, B]), []);

console.log("\n3. القسم الذي تُعرض به الحصة");
t("المختار الموجود يبقى", resolveSessionClass(g, "k3"), "k3");
t("فارغ → أول قسم في أول مؤسسة", resolveSessionClass(g, ""), "k2");
t("محذوف → أول قسم في أول مؤسسة", resolveSessionClass(g, "kGone"), "k2");
t("لا أقسام → فارغ", resolveSessionClass([], "k1"), "");
t("قسم بلا مؤسسة يبقى مختارًا", resolveSessionClass(g2, "k2"), "k2");

console.log("\n4. تبديل المؤسسة في الحصة");
t("أول قسم في المؤسسة المختارة", firstClassOf(g, "sB"), "k1");
t("مؤسسة غير موجودة → فارغ", firstClassOf(g, "sX"), "");
t("«بلا مؤسسة»", firstClassOf(g2, "none"), "k2");

console.log("\n5. المؤسسة التي ينتمي إليها القسم المختار");
t("قسم الثانية", groupOf(g, "k3")?.key, "sB");
t("قسم غير موجود", groupOf(g, "kGone"), null);

console.log("\n6. مؤسسة واحدة: لا قائمة مؤسسات");
const one = groupBySchool([k("k1", "sA"), k("k2", "sA")], [A, B]);
t("مجموعة واحدة فتُخفى القائمة (groups.length > 1)", one.length > 1, false);

console.log(`\n${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail ? 1 : 0);
