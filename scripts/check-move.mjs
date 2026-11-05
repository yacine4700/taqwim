/* اختبار نقل الأسماء (src/lib/moveRoster.ts): استكمال المحاولة نفسها بعد ضياع الردّ أو إعادة
   التحميل، دون تكرار قسم أو تلميذ ودون كتابة فوق موجود.
   قاعدة وهمية بجدولين تحاكي ON CONFLICT DO NOTHING، وتخزين محلي وهمي يبقى بين «إعادات التحميل»
   (إعادة التحميل = استدعاء runMove من جديد بالتخزين نفسه ودون أي حالة في الذاكرة).
   يحتاج Node 22.6 فأحدث مع --experimental-strip-types. */
import { runMove, parseMoveRecord, createSingleFlight, CHUNK } from "../src/lib/moveRoster.ts";
import { kvSetDurable, kvGet } from "../src/lib/localdb.ts";

let pass = 0, fail = 0;
function t(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`); }
}

let n = 0;
const uuid = () => `id-${++n}`;

/* faults: لكل دالة قائمة تُستهلك بالترتيب: "ok" | "fail-before" | "lost-after" | "throw-after" | "skip-silently" */
function fakeDb(faults = {}) {
  const classes = new Map();
  const students = new Map();
  const calls = [];
  const take = (kind) => (faults[kind]?.shift?.() ?? "ok");
  return {
    classes, students, calls,
    insertClassIgnoringDuplicates: async (row) => {
      calls.push(["class", row]);
      const f = take("class");
      if (f === "fail-before") return { error: { message: "boom" } };
      if (!classes.has(row.id)) classes.set(row.id, { ...row });                   // DO NOTHING
      if (f === "lost-after") return { error: { message: "network lost" } };
      if (f === "throw-after") throw new Error("socket closed");
      return { error: null };
    },
    insertStudentsIgnoringDuplicates: async (rows) => {
      calls.push(["students", rows]);
      const f = take("students");
      if (f === "fail-before") return { error: { message: "boom" } };
      if (f !== "skip-silently") for (const r of rows) if (!students.has(r.id)) students.set(r.id, { ...r }); // DO NOTHING
      if (f === "lost-after") return { error: { message: "network lost" } };
      if (f === "throw-after") throw new Error("socket closed");
      return { error: null };
    },
    classExists: async (id) => {
      calls.push(["classExists", id]);
      const f = take("exists");
      if (f === "fail-before") return { error: { message: "boom" }, exists: false };
      return { error: null, exists: classes.has(id) };
    },
    studentsPresent: async (ids) => {
      calls.push(["present", ids]);
      const f = take("present");
      if (f === "fail-before") return { error: { message: "boom" }, present: [] };
      return { error: null, present: ids.filter((i) => students.has(i)) };
    },
  };
}

/* تخزين محلي وهمي. saveFails: عدد المرات التي تفشل فيها الكتابة قبل أن تنجح (Infinity = دائمًا). */
function fakeStore({ saveFails = 0 } = {}) {
  let data = null;
  const log = [];
  let fails = saveFails;
  return {
    log,
    get raw() { return data; },
    setFails(k) { fails = k; },
    load: async () => (data === null ? null : JSON.parse(data)),
    save: async (rec) => {
      if (fails > 0) { fails--; log.push("save-failed"); return false; }
      data = JSON.stringify(rec); log.push(["save", JSON.parse(data)]); return true;
    },
    remove: async () => { data = null; log.push("remove"); },
  };
}

const mk = (count, prefix = "s") => Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i + 1}`, full_name: `تلميذ ${i + 1}`, position: i + 1 }));
const run = (db, store, students, name = "1 جذع 3") =>
  runMove({ db, store, uuid, teacherId: "T" }, { name, schoolId: "sch", position: 7, students });
const counts = (db) => [db.classes.size, db.students.size];
const firstCall = (db, kind) => db.calls.findIndex((c) => c[0] === kind);

console.log("— الحالة السليمة");
{
  const db = fakeDb(), store = fakeStore(), src = mk(4);
  const r = await run(db, store, src);
  t("ينجح بقسم وأربعة تلاميذ", [r.ok, r.students, counts(db)], [true, 4, [1, 4]]);
  t("معرّف النتيجة هو القسم المُنشأ", [...db.classes.keys()], [r.id]);
  t("السجلّ المحلي يُحذف بعد النجاح", store.raw, null);
  t("ترتيب التلاميذ 1..n بترتيب المصدر", [...db.students.values()].map((s) => s.position), [1, 2, 3, 4]);
  t("الأسماء كما في المصدر", [...db.students.values()].map((s) => s.full_name), src.map((s) => s.full_name));
  t("حقول صف التلميذ: الاسم والترتيب والانتماء فقط", Object.keys([...db.students.values()][0]).sort(), ["class_id", "full_name", "id", "position", "teacher_id"]);
  t("حقول صف القسم: الاسم والترتيب والمؤسسة فقط", Object.keys([...db.classes.values()][0]).sort(), ["id", "name", "position", "school_id", "teacher_id"]);
  t("لا علامات/ملاحظات/حالات/أفواج في الطلبات", JSON.stringify(db.calls).match(/tags|note|group_id|criteria|score/) === null, true);
}

console.log("— السجلّ المحلي: معرّفات فقط ويُحفظ قبل أول طلب");
{
  const db = fakeDb(), store = fakeStore(), src = mk(3);
  await run(db, store, src);
  const saves = store.log.filter((x) => Array.isArray(x));
  t("حُفظ السجلّ مرة على الأقل", saves.length >= 1, true);
  const text = JSON.stringify(store.log);
  t("لا أسماء تلاميذ ولا اسم القسم في أي ما حُفظ", src.every((s) => !text.includes(s.full_name)) && !text.includes("جذع"), true);
  t("الحقول المحفوظة: v وclassId وids وdone فقط", Object.keys(saves[0][1]).sort(), ["classId", "done", "ids", "v"]);
  // الحفظ الأول سبق أول طلب: نعيد التشغيل بقاعدة تسجّل ترتيب الأحداث
  const order = [];
  const store2 = fakeStore(); const db2 = fakeDb();
  const save = store2.save; store2.save = async (r) => { order.push("save"); return save(r); };
  for (const k of ["insertClassIgnoringDuplicates", "insertStudentsIgnoringDuplicates", "classExists", "studentsPresent"]) {
    const f = db2[k]; db2[k] = async (...a) => { order.push(k); return f(...a); };
  }
  await run(db2, store2, mk(2));
  t("أول حدث هو الحفظ المحلي", order[0], "save");
  t("ولا طلب إلى القاعدة قبله", order.indexOf("insertClassIgnoringDuplicates") > order.indexOf("save"), true);
}

console.log("— فشل التخزين المحلي قبل البدء");
{
  const db = fakeDb(), store = fakeStore({ saveFails: Infinity });
  const r = await run(db, store, mk(3));
  t("لا يبدأ: فشل برسالة الحفظ", [r.ok, r.error.includes("الحفظ على هذا الجهاز")], [false, true]);
  t("ولا طلب واحد إلى القاعدة", db.calls.length, 0);
  t("لا قسم ولا تلاميذ", counts(db), [0, 0]);
  store.setFails(0);
  const r2 = await run(db, store, mk(3));
  t("حين يعود التخزين يبدأ ويكتمل", [r2.ok, counts(db)], [true, [1, 3]]);
}
{
  // kvSetDurable الحقيقي بلا IndexedDB (كنافذة خاصة أو بيئة بلا تخزين): false، ولا يدّعي النجاح
  t("kvSetDurable بلا IndexedDB تعيد false", await kvSetDurable("move:test", { a: 1 }), false);
  t("ولا تترك قيمة في الذاكرة كأنها حُفظت", await kvGet("move:test"), null);
}

console.log("— نجاح جزئي ثم إعادة تحميل التطبيق");
{
  const total = CHUNK * 2 + 10;      // ثلاث دفعات
  const src = mk(total), store = fakeStore();
  const db = fakeDb({ students: ["ok", "fail-before"] });     // الدفعة الأولى تنجح، الثانية تفشل
  const r1 = await run(db, store, src);
  t("الأولى تفشل في الدفعة الثانية", [r1.ok, counts(db)], [false, [1, CHUNK]]);
  const rec = parseMoveRecord(store.raw ? JSON.parse(store.raw) : null);
  t("السجلّ يبقى ومعه دفعة واحدة مسجَّلة", [rec !== null, rec?.done.length, Object.keys(rec?.ids ?? {}).length], [true, CHUNK, total]);
  const firstClassId = [...db.classes.keys()][0];
  // «إعادة تحميل»: لا شيء من الذاكرة، فقط التخزين والقاعدة
  db.calls.length = 0;
  const r2 = await run(db, store, src);
  t("بعد إعادة التحميل يكتمل على القسم نفسه", [r2.ok, r2.id === firstClassId, counts(db)], [true, true, [1, total]]);
  const reinserted = db.calls.filter((c) => c[0] === "students").flatMap((c) => c[1]).map((r) => r.full_name);
  t("لم يُعاد إدراج الدفعة الأولى", reinserted.length, total - CHUNK);
  t("لا تلميذ مكرر بالاسم", new Set([...db.students.values()].map((s) => s.full_name)).size, total);
  t("السجلّ محذوف بعد الاكتمال", store.raw, null);
}

console.log("— ضياع الردّ بعد إنشاء القسم");
{
  const db = fakeDb({ class: ["lost-after"] }), store = fakeStore(), src = mk(4);
  const r1 = await run(db, store, src);
  t("الأولى تبدو فاشلة والقسم أُنشئ فعلًا", [r1.ok, counts(db)], [false, [1, 0]]);
  const r2 = await run(db, store, src);       // بعد إعادة تحميل
  t("الثانية تكمل بلا قسم ثانٍ", [r2.ok, counts(db)], [true, [1, 4]]);
}

console.log("— ضياع الردّ بعد إدراج التلاميذ");
{
  const db = fakeDb({ students: ["lost-after"] }), store = fakeStore(), src = mk(4);
  const r1 = await run(db, store, src);
  t("الأولى تبدو فاشلة والتلاميذ أُدرجوا فعلًا", [r1.ok, counts(db)], [false, [1, 4]]);
  t("السجلّ باقٍ وبلا «أُدرجوا» (غير مؤكَّد)", JSON.parse(store.raw).done, []);
  const r2 = await run(db, store, src);
  t("الثانية تنجح بلا تكرار", [r2.ok, counts(db)], [true, [1, 4]]);
}

console.log("— إعادة المحاولة أكثر من مرة");
{
  const db = fakeDb({ class: ["fail-before"], students: ["throw-after", "fail-before"], present: ["ok"] }), store = fakeStore(), src = mk(6);
  const results = [];
  for (let i = 0; i < 4; i++) results.push((await run(db, store, src)).ok);
  t("فشل ثلاثًا ثم نجح", results, [false, false, false, true]);
  t("بعد أربع محاولات: قسم واحد وستة تلاميذ", counts(db), [1, 6]);
  t("القسم الواحد هو نفسه في كل المحاولات", new Set(db.calls.filter((c) => c[0] === "class").map((c) => c[1].id)).size, 1);
  const again = await run(db, store, src);
  t("نقل بعد الاكتمال بالمصدر نفسه يُعدّ نقلًا جديدًا مستقلًّا (انظر أدناه)", again.ok, true);
}

console.log("— تغيير بيانات القسم الجديد يدويًّا ثم إعادة المحاولة");
{
  const src = mk(6), store = fakeStore();
  const db = fakeDb({ students: ["ok", "fail-before"] });
  const big = mk(CHUNK + 3);
  await run(db, store, big);                                  // الدفعة الأولى أُدرجت، الثانية فشلت
  const classId = [...db.classes.keys()][0];
  db.classes.get(classId).name = "اسم عدّلته يدويًّا";
  db.classes.get(classId).position = 99;
  const first = [...db.students.values()][0];
  first.full_name = "اسم عدّلته يدويًّا";
  first.position = 50;
  await run(db, store, big, "اسم ثانٍ في ورقة الاستئناف");
  t("اسم القسم وترتيبه لم يُكتب فوقهما", [db.classes.get(classId).name, db.classes.get(classId).position], ["اسم عدّلته يدويًّا", 99]);
  t("التلميذ المُعدَّل لم يُكتب فوقه", [first.full_name, first.position], ["اسم عدّلته يدويًّا", 50]);
  t("والمجموع صحيح", counts(db), [1, CHUNK + 3]);
}

console.log("— تلميذ حُذف يدويًّا من القسم الجديد");
{
  const total = CHUNK + 5, src = mk(total), store = fakeStore();
  const db = fakeDb({ students: ["ok", "fail-before"] });
  await run(db, store, src);                                   // الدفعة الأولى مؤكَّدة
  const gone = [...db.students.values()][0];
  db.students.delete(gone.id);                                 // حذفه الأستاذ من الدفعة المؤكَّدة
  db.calls.length = 0;
  const r = await run(db, store, src);
  t("يكتمل", r.ok, true);
  t("من أُدرج وتُحُقِّق منه ثم حُذف يدويًّا لا يعود", db.students.has(gone.id), false);
  t("والباقي كله موجود", db.students.size, total - 1);
}
{
  // الحدّ المعلَن: دفعة ضاع ردّها (غير مؤكَّدة) ثم حُذف أحد تلاميذها يدويًّا قبل الاستئناف: يعود.
  const src = mk(3), store = fakeStore();
  const db = fakeDb({ students: ["lost-after"] });
  await run(db, store, src);
  const gone = [...db.students.values()][0];
  db.students.delete(gone.id);
  await run(db, store, src);
  t("[حدّ معلَن] تلميذ دفعةٍ ضاع ردّها وحُذف يدويًّا يعود عند الاستئناف", db.students.has(gone.id), true);
}

console.log("— حُذف القسم الجديد بكامله أثناء محاولة ناقصة");
{
  const total = CHUNK + 4, src = mk(total), store = fakeStore();
  const db = fakeDb({ students: ["ok", "fail-before"] });
  await run(db, store, src);
  const classId = [...db.classes.keys()][0];
  db.classes.delete(classId);
  for (const [id, s] of db.students) if (s.class_id === classId) db.students.delete(id);   // cascade
  const r = await run(db, store, src);
  t("يُعاد إنشاء القسم وكل تلاميذه", [r.ok, r.id, counts(db)], [true, classId, [1, total]]);
}

console.log("— تلاميذ جدد في المصدر أثناء محاولة ناقصة");
{
  const store = fakeStore(), src = mk(CHUNK + 2);
  const db = fakeDb({ students: ["ok", "fail-before"] });
  await run(db, store, src);
  const before = JSON.parse(store.raw);
  const grown = [...src, { id: "new1", full_name: "وافد جديد", position: 99 }];
  const events = [];
  const save = store.save; store.save = async (r) => { events.push(["save", Object.keys(r.ids).length]); return save(r); };
  const ins = db.insertStudentsIgnoringDuplicates; db.insertStudentsIgnoringDuplicates = async (rows) => { events.push(["insert", rows.length]); return ins(rows); };
  const r = await run(db, store, grown);
  t("يكتمل بمن أضيف", [r.ok, counts(db)], [true, [1, CHUNK + 3]]);
  t("معرّفه أُضيف للسجلّ وحُفظ قبل أول إدراج", events[0], ["save", Object.keys(before.ids).length + 1]);
  t("معرّفات من سبقوه لم تتغيّر", Object.entries(before.ids).every(([k, v]) => [...db.students.keys()].includes(v)), true);
}

console.log("— الإدراج الصامت لا يمرّ نجاحًا");
{
  const db = fakeDb({ students: ["skip-silently"] }), store = fakeStore();
  const r = await run(db, store, mk(3));
  t("التحقّق بعد الإدراج يكشف الناقص فيفشل", [r.ok, counts(db)], [false, [1, 0]]);
  t("والسجلّ لا يُحذف", store.raw !== null, true);
  const db2 = fakeDb({ present: ["fail-before"] });
  const r2 = await run(db2, fakeStore(), mk(2));
  t("وفشل قراءة التحقّق فشل لا نجاح", r2.ok, false);
  const db3 = fakeDb({ exists: ["fail-before"] });
  const s3 = fakeStore();
  const r3 = await run(db3, s3, mk(2));
  t("وفشل التحقّق الأخير من القسم لا يحذف السجلّ", [r3.ok, s3.raw !== null], [false, true]);
}

console.log("— نقل جديد مستقل بعد اكتمال السابق");
{
  const db = fakeDb(), store = fakeStore(), src = mk(5);
  const r1 = await run(db, store, src);
  const r2 = await run(db, store, src);
  t("قسمان مختلفان", [r1.ok, r2.ok, r1.id !== r2.id, db.classes.size], [true, true, true, 2]);
  t("عشرة تلاميذ بمعرّفات مختلفة (لا تداخل بين النقلين)", [db.students.size, new Set([...db.students.keys()]).size], [10, 10]);
}

console.log("— سجلّ تالف أو غريب");
{
  t("أشكال غير مفهومة = لا سجلّ", [null, "x", [], { v: 2 }, { v: 1, classId: "c", ids: [], done: [] }, { v: 1, classId: "c", ids: { a: 5 }, done: [] }].map(parseMoveRecord), [null, null, null, null, null, null]);
  t("done تُنقّى من معرّفات ليست في الخريطة", parseMoveRecord({ v: 1, classId: "c", ids: { a: "x" }, done: ["a", "zzz", 3] })?.done, ["a"]);
  const db = fakeDb(), store = fakeStore();
  store.save = ((orig) => orig)(store.save);
  const bad = { load: async () => ({ junk: true }), save: store.save, remove: store.remove };
  const r = await run(db, bad, mk(2));
  t("سجلّ تالف يبدأ محاولة جديدة بدل أن ينهار", [r.ok, counts(db)], [true, [1, 2]]);
}

console.log("— لا حذف في واجهة القاعدة");
{
  const db = fakeDb();
  t("لا دالة حذف أو تعديل أصلًا", Object.keys(db).filter((k) => /delete|remove|update/i.test(k)), []);
}

console.log("— الضغط المزدوج");
{
  const runOnce = createSingleFlight();
  let started = 0, release;
  const gate = new Promise((r) => (release = r));
  const task = async () => { started++; await gate; return "done"; };
  const first = runOnce(task), second = runOnce(task), third = runOnce(task);
  release();
  t("المهمة تبدأ مرة واحدة", started, 1);
  t("الأولى تعيد نتيجتها والمتزامنتان معها تُتجاهلان", [await first, await second, await third], ["done", undefined, undefined]);
  t("بعد الانتهاء تُقبل مهمة جديدة", await runOnce(async () => "again"), "again");
  const failing = createSingleFlight();
  await failing(async () => { throw new Error("x"); }).catch(() => {});
  t("الفشل لا يُقفل الحارس", await failing(async () => "ok"), "ok");
}

console.log("— ربط الواجهة (فحص نصّي مساند، لا يغني عن اختبار CI للطلب)");
{
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/app/app/AppClient.tsx", import.meta.url), "utf8");
  const start = src.indexOf("async function moveRoster(");
  const body = src.slice(start, src.indexOf("\n  }\n", start));
  t("القسم والتلاميذ بتجاهل التعارض", (body.match(/ignoreDuplicates: true/g) ?? []).length, 2);
  t("لا DO UPDATE ولا حذف ولا تعديل في دالة النقل", /ignoreDuplicates: false|\.delete\(|\.update\(/.test(body), false);
  t("الحفظ المحلي المؤكَّد (kvSetDurable) لا kvSet", /save: \(record\) => kvSetDurable\(/.test(body) && !/\bkvSet\(/.test(body), true);
}

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
