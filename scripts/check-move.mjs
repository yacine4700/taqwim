/* اختبار نقل الأسماء (src/lib/moveRoster.ts): إعادة المحاولة بلا تكرار قسم أو تلميذ.
   قاعدة وهمية بجدولين تنفّذ upsert بالمعرّف كما تفعل Postgres (ON CONFLICT)، وتحاكي ضياع
   الردّ بعد التنفيذ، وفشل الإدراج قبله، وانقطاعًا يرمي استثناء.
   يحتاج Node 22.6 فأحدث مع --experimental-strip-types. */
import { newAttempt, runMove, createSingleFlight } from "../src/lib/moveRoster.ts";

let pass = 0, fail = 0;
function t(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`); }
}

let n = 0;
const uuid = () => `id-${++n}`;

/* faults: قائمة أعطال تُستهلك بالترتيب لكل نداء: "ok" | "fail-before" | "lost-after" | "throw-after" */
function fakeDb(faults = {}) {
  const classes = new Map();
  const students = new Map();
  const calls = [];
  const take = (kind) => (faults[kind]?.shift?.() ?? "ok");
  return {
    classes, students, calls,
    upsertClass: async (row) => {
      calls.push(["class", row]);
      const f = take("class");
      if (f === "fail-before") return { error: { message: "boom" } };
      classes.set(row.id, { ...(classes.get(row.id) ?? {}), ...row });          // DO UPDATE
      if (f === "lost-after") return { error: { message: "network lost" } };
      if (f === "throw-after") throw new Error("socket closed");
      return { error: null };
    },
    insertStudentsIgnoringDuplicates: async (rows) => {
      calls.push(["students", rows]);
      const f = take("students");
      if (f === "fail-before") return { error: { message: "boom" } };
      for (const r of rows) if (!students.has(r.id)) students.set(r.id, r);       // DO NOTHING
      if (f === "lost-after") return { error: { message: "network lost" } };
      if (f === "throw-after") throw new Error("socket closed");
      return { error: null };
    },
  };
}
const NAMES = ["أحمد", "بشرى", "جمال", "دعاء"];
const attempt = () => newAttempt({ sourceId: "old", names: NAMES, schoolId: "sch", position: 7, uuid });
const input = (name = "1 جذع 3") => ({ teacherId: "T", name });
const counts = (db) => [db.classes.size, db.students.size];
const names = (db) => [...db.students.values()].sort((a, b) => a.position - b.position).map((s) => s.full_name);

console.log("— الحالة السليمة");
{
  const db = fakeDb(); const a = attempt();
  const r = await runMove(db, a, input());
  t("ينجح ويعيد معرّف القسم وعدد التلاميذ", r, { ok: true, id: a.classId, students: 4 });
  t("قسم واحد وأربعة تلاميذ بترتيب الأسماء", [counts(db), names(db)], [[1, 4], NAMES]);
  t("الأرقام 1..n", [...db.students.values()].map((s) => s.position), [1, 2, 3, 4]);
  t("حقول صف التلميذ: الاسم والترتيب والانتماء فقط", Object.keys([...db.students.values()][0]).sort(), ["class_id", "full_name", "id", "position", "teacher_id"]);
  t("حقول صف القسم: لا مستوى ولا مجموع علامات", Object.keys(db.classes.get(a.classId)).sort(), ["id", "name", "position", "school_id", "teacher_id"]);
  t("لا علامات/ملاحظات/حالات/أفواج في الصفوف المرسلة", JSON.stringify(db.calls).match(/tags|note|group_id|criteria|score/) === null, true);
}

console.log("— إعادة المحاولة بعد فشل قبل التنفيذ");
{
  const db = fakeDb({ class: ["fail-before", "ok"] }); const a = attempt();
  const r1 = await runMove(db, a, input());
  t("المحاولة الأولى تفشل برسالة إعادة آمنة", [r1.ok, r1.error?.includes("دون تكرار")], [false, true]);
  t("لم يُنشأ شيء", counts(db), [0, 0]);
  const r2 = await runMove(db, a, input());
  t("الثانية تنجح", r2.ok, true);
  t("قسم واحد وأربعة تلاميذ", counts(db), [1, 4]);
}

console.log("— ضاع ردّ الخادم بعد أن نُفِّذ إنشاء القسم");
{
  const db = fakeDb({ class: ["lost-after", "ok"] }); const a = attempt();
  const r1 = await runMove(db, a, input());
  t("الأولى تبدو فاشلة", r1.ok, false);
  t("القسم أُنشئ فعلًا بلا تلاميذ", counts(db), [1, 0]);
  const r2 = await runMove(db, a, input());
  t("الثانية تنجح", r2.ok, true);
  t("لا قسم ثانٍ، وكل التلاميذ مرة واحدة", counts(db), [1, 4]);
  t("القسم هو نفسه بالمعرّف نفسه", [...db.classes.keys()], [a.classId]);
}

console.log("— ضاع ردّ إدراج التلاميذ بعد تنفيذه");
{
  const db = fakeDb({ students: ["lost-after", "ok"] }); const a = attempt();
  const r1 = await runMove(db, a, input());
  t("الأولى تبدو فاشلة", r1.ok, false);
  t("أُدرج التلاميذ فعلًا", counts(db), [1, 4]);
  const r2 = await runMove(db, a, input());
  t("الثانية تنجح", r2.ok, true);
  t("لا تلميذ مكرر ولا قسم مكرر", counts(db), [1, 4]);
  t("الأسماء كما هي مرة واحدة", names(db), NAMES);
}

console.log("— نجح بعض الإدراجات وفشل الباقي (القسم دون تلاميذ ثم إكمال)");
{
  const db = fakeDb({ students: ["fail-before", "ok"] }); const a = attempt();
  const r1 = await runMove(db, a, input());
  t("الأولى تفشل", r1.ok, false);
  t("القسم بلا تلاميذ بعد الفشل (لا حذف تعويضي)", counts(db), [1, 0]);
  t("لا نداء حذف في واجهة القاعدة أصلًا", Object.keys(db).filter((k) => /delete|remove/i.test(k)), []);
  await runMove(db, a, input());
  t("الإعادة تكمل التلاميذ على القسم نفسه", counts(db), [1, 4]);
}
{
  // نجاح جزئي في صفوف: تلميذان موجودان مسبقًا (من إدراج سابق ناقص) ثم إعادة المحاولة
  const db = fakeDb(); const a = attempt();
  for (let i = 0; i < 2; i++) db.students.set(a.studentIds[i], { id: a.studentIds[i], full_name: "عُدِّل يدويًّا", position: i + 1 });
  db.classes.set(a.classId, { id: a.classId });
  await runMove(db, a, input());
  t("يكمل الناقص ولا يكرر الموجود", counts(db), [1, 4]);
  t("لا يُكتب فوق ما عُدِّل في تلميذ موجود", db.students.get(a.studentIds[0]).full_name, "عُدِّل يدويًّا");
}

console.log("— انقطاع يرمي استثناء");
{
  const db = fakeDb({ class: ["throw-after", "ok"], students: ["throw-after", "ok"] }); const a = attempt();
  const r1 = await runMove(db, a, input());
  t("الاستثناء يتحوّل إلى نتيجة فشل لا انهيار", [r1.ok, typeof r1.error], [false, "string"]);
  const r2 = await runMove(db, a, input());
  t("الثانية: استثناء من إدراج التلاميذ بعد تنفيذه", r2.ok, false);
  const r3 = await runMove(db, a, input());
  t("الثالثة تنجح", r3.ok, true);
  t("بعد ثلاث محاولات: قسم واحد وأربعة تلاميذ", counts(db), [1, 4]);
}

console.log("— تغيير الاسم بين المحاولتين");
{
  const db = fakeDb({ students: ["fail-before", "ok"] }); const a = attempt();
  await runMove(db, a, input("اسم أول"));
  await runMove(db, a, input("اسم ثانٍ"));
  t("القسم نفسه والاسم المحدَّث", [counts(db), db.classes.get(a.classId).name], [[1, 4], "اسم ثانٍ"]);
}

console.log("— المعرّفات");
{
  const a = attempt();
  t("معرّفات التلاميذ مختلفة عن بعضها وعن القسم", new Set([a.classId, ...a.studentIds]).size, 5);
  t("بعدد الأسماء", a.studentIds.length, NAMES.length);
  const db = fakeDb(); await runMove(db, a, input()); await runMove(db, a, input()); await runMove(db, a, input());
  t("تكرار التشغيل بعد النجاح لا يزيد شيئًا", counts(db), [1, 4]);
  const b = attempt();
  t("محاولة جديدة = معرّفات جديدة", b.classId !== a.classId, true);
}

console.log("— الضغط المزدوج");
{
  const run = createSingleFlight();
  let started = 0, release;
  const gate = new Promise((r) => (release = r));
  const task = async () => { started++; await gate; return "done"; };
  const first = run(task);
  const second = run(task);   // قبل أن تنتهي الأولى
  const third = run(task);
  release();
  t("المهمة تبدأ مرة واحدة", started, 1);
  t("الأولى تعيد نتيجتها والمتزامنتان معها تُتجاهلان", [await first, await second, await third], ["done", undefined, undefined]);
  t("بعد الانتهاء تُقبل مهمة جديدة", await run(async () => "again"), "again");
  const failing = createSingleFlight();
  await failing(async () => { throw new Error("x"); }).catch(() => {});
  t("الفشل لا يُقفل الحارس", await failing(async () => "ok"), "ok");
}

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
