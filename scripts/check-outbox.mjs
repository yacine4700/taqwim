/* نسخة حرفية من منطق src/lib/outbox.ts، لاختباره بالأرقام.
   النسختان يجب أن تبقيا متطابقتين، كما في check-scoring.mjs. */

function opKey(op) {
  switch (op.kind) {
    case "record": return `record:${op.student_id}:${op.term}`;
    case "reading-add": return `reading:${op.reading.id}`;
    case "reading-del": return `reading:${op.reading_id}`;
    case "student": return `student:${op.student_id}`;
  }
}

function enqueue(queue, op, inFlight = null) {
  const key = opKey(op);
  const free = (q) => q.id !== inFlight;

  if (op.kind === "reading-del") {
    const pendingAdd = queue.find((q) => q.kind === "reading-add" && opKey(q) === key && free(q));
    if (pendingAdd) return queue.filter((q) => q.id !== pendingAdd.id);
  }

  if (op.kind === "record" || op.kind === "student") {
    const index = queue.findIndex((q) => q.kind === op.kind && opKey(q) === key && free(q));
    if (index >= 0) {
      const previous = queue[index];
      const merged =
        op.kind === "student" && previous.kind === "student"
          ? { ...op, id: previous.id, at: op.at, patch: { ...previous.patch, ...op.patch } }
          : { ...op, id: previous.id };
      const next = [...queue];
      next[index] = { ...merged, tries: 0, error: null, blocked: false, nextTry: 0 };
      return next;
    }
  }

  return [...queue, op];
}

function applyRecords(base, queue) {
  const ops = queue.filter((op) => op.kind === "record");
  if (!ops.length) return base;
  const out = [...base];
  for (const op of ops) {
    const row = {
      student_id: op.student_id, term: op.term, criteria: op.criteria,
      tp: op.tp, devoir: op.devoir, exam: op.exam,
    };
    const i = out.findIndex((r) => r.student_id === op.student_id && r.term === op.term);
    if (i >= 0) out[i] = row; else out.push(row);
  }
  return out;
}

function applyReadings(base, queue) {
  const ops = queue.filter((op) => op.kind === "reading-add" || op.kind === "reading-del");
  if (!ops.length) return base;
  let out = [...base];
  for (const op of ops) {
    if (op.kind === "reading-add") {
      if (!out.some((r) => r.id === op.reading.id)) out.push(op.reading);
    } else {
      out = out.filter((r) => r.id !== op.reading_id);
    }
  }
  return out;
}

function applyStudents(base, queue) {
  const ops = queue.filter((op) => op.kind === "student");
  if (!ops.length) return base;
  let out = base;
  for (const op of ops) {
    if (!out.some((s) => s.id === op.student_id)) continue;
    out = out.map((s) => (s.id === op.student_id ? { ...s, ...op.patch } : s));
  }
  return out;
}

function pending(queue) {
  const out = { marks: 0, reads: 0, edits: 0, total: 0, blocked: 0 };
  for (const op of queue) {
    if (op.blocked) out.blocked++;
    if (op.kind === "record") out.marks++;
    else if (op.kind === "student") out.edits++;
    else out.reads++;
    out.total++;
  }
  return out;
}

function countWord(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

function pendingLabel(queue) {
  const p = pending(queue);
  if (!p.total) return "";
  const parts = [];
  if (p.marks) parts.push(countWord(p.marks, "علامة", "علامتان", "علامات", "علامة"));
  if (p.reads) parts.push(countWord(p.reads, "محاولة", "محاولتان", "محاولات", "محاولة"));
  if (p.edits) parts.push(countWord(p.edits, "تعديل", "تعديلان", "تعديلات", "تعديلًا"));
  return `${parts.join(" و")} لم تُرسل`;
}

function isPermanent(code) {
  if (!code) return false;
  return /^(22|23|42)/.test(code) || code === "PGRST204";
}

function backoff(tries, now) {
  return now + Math.min(60_000, 2_000 * 2 ** Math.max(0, tries - 1));
}

/* ---------- أدوات الاختبار ---------- */

let seq = 0;
const base = () => ({ id: `op${++seq}`, at: 1000 + seq, tries: 0, error: null, blocked: false, nextTry: 0 });
const rec = (student, term, criteria, marks = {}) => ({
  ...base(), kind: "record", student_id: student, term,
  criteria, tp: null, devoir: null, exam: null, ...marks,
});
const addRead = (id, student, score) => ({
  ...base(), kind: "reading-add",
  reading: { id, student_id: student, term: 1, score, read_on: "2026-10-15" },
});
const delRead = (id, student) => ({ ...base(), kind: "reading-del", reading_id: id, student_id: student });
const stu = (student, patch) => ({ ...base(), kind: "student", student_id: student, patch });

let pass = 0, fail = 0;
function t(name, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
}

console.log("\n1. الطابور: العلامة الأحدث تحلّ محلّ أختها، ولا تتراكم");
let q = [];
q = enqueue(q, rec("s1", 1, { disc: -1 }));
q = enqueue(q, rec("s1", 1, { disc: -2 }));
q = enqueue(q, rec("s1", 1, { disc: -2, part: 3 }));
t("ثلاث ضغطات على التلميذ نفسه = عملية واحدة", q.length, 1);
t("وتحمل آخر قيمة", q[0].criteria, { disc: -2, part: 3 });
q = enqueue(q, rec("s1", 2, { disc: -1 }));
q = enqueue(q, rec("s2", 1, { disc: -1 }));
t("فصل آخر وتلميذ آخر: عمليات مستقلّة", q.length, 3);

console.log("\n2. الدمج يصفّر المحاولات: العلامة الجديدة تستحقّ محاولة جديدة");
let q2 = [{ ...rec("s1", 1, { disc: -1 }), tries: 4, error: "فشل", blocked: true, nextTry: 9e9 }];
q2 = enqueue(q2, rec("s1", 1, { disc: -3 }));
t("تعود قابلة للإرسال", [q2[0].tries, q2[0].blocked, q2[0].nextTry], [0, false, 0]);
t("وتحتفظ بمعرّف العملية القديمة", q2[0].id, "op6");

console.log("\n3. العملية التي في الطريق لا تُمسّ");
let q3 = [rec("s1", 1, { disc: -1 })];
const flying = q3[0].id;
q3 = enqueue(q3, rec("s1", 1, { disc: -5 }), flying);
t("تُضاف بجانبها لا فوقها", q3.length, 2);
t("والأحدث هو الأخير فيغلب عند التطبيق", applyRecords([], q3)[0].criteria, { disc: -5 });

console.log("\n4. حذف محاولة لم تُرسل بعد: تخرج إضافتها ولا يُرسل حذف لشيء غائب");
let q4 = [];
q4 = enqueue(q4, addRead("r1", "s1", 3));
q4 = enqueue(q4, addRead("r2", "s1", 4));
q4 = enqueue(q4, delRead("r1", "s1"));
t("بقيت واحدة", q4.length, 1);
t("وهي الثانية", q4[0].reading.id, "r2");
let q5 = [addRead("r9", "s1", 2)];
q5 = enqueue(q5, delRead("r9", "s1"), q5[0].id);
t("لكن إن كانت في الطريق فالحذف يُرسل خلفها", q5.map((o) => o.kind), ["reading-add", "reading-del"]);
let q6 = enqueue([], delRead("rX", "s1"));
t("حذف محاولة محفوظة في الخادم يدخل الطابور", q6.length, 1);

console.log("\n5. تعديلات التلميذ تُدمج ولا يمحو بعضها بعضًا");
let q7 = [];
q7 = enqueue(q7, stu("s1", { tags: ["غياب متكرر"] }));
q7 = enqueue(q7, stu("s1", { full_name: "بن عمر أمين" }));
t("رقعة واحدة", q7.length, 1);
t("فيها الاثنتان", q7[0].patch, { tags: ["غياب متكرر"], full_name: "بن عمر أمين" });
q7 = enqueue(q7, stu("s1", { tags: [] }));
t("والأحدث يغلب على الحقل نفسه", q7[0].patch.tags, []);

console.log("\n6. ما يراه الأستاذ = نسخة الخادم + الطابور");
const server = [{ student_id: "s1", term: 1, criteria: { disc: -1 }, tp: 12, devoir: null, exam: null }];
const queued = [rec("s1", 1, { disc: -1, part: 2 }, { tp: 12 })];
t("العملية المعلّقة تغلب على صفّ الخادم", applyRecords(server, queued), [
  { student_id: "s1", term: 1, criteria: { disc: -1, part: 2 }, tp: 12, devoir: null, exam: null },
]);
t("ولا تلمس نسخة الخادم نفسها", server[0].criteria, { disc: -1 });
t("طابور فارغ يُرجع النسخة كما هي", applyRecords(server, []), server);

const serverReads = [{ id: "r0", student_id: "s1", term: 1, score: 3, read_on: "2026-10-01" }];
const readQ = [addRead("r1", "s1", 4), delRead("r0", "s1")];
t("إضافة وحذف معًا", applyReadings(serverReads, readQ).map((r) => r.id), ["r1"]);
t("إعادة تطبيق الإضافة لا تكرّرها", applyReadings([{ id: "r1", student_id: "s1", term: 1, score: 4, read_on: "2026-10-15" }], [addRead("r1", "s1", 4)]).length, 1);

const serverStudents = [{ id: "s1", full_name: "قديم", tags: [], note: null }];
t("تعديل التلميذ يظهر فورًا", applyStudents(serverStudents, [stu("s1", { full_name: "جديد" })])[0].full_name, "جديد");
t("تعديل تلميذ محذوف يُتجاهل بلا انهيار", applyStudents(serverStudents, [stu("sX", { full_name: "لا أحد" })]), serverStudents);

console.log("\n7. ترتيب التطبيق: الأقدم ثم الأحدث");
const twice = [rec("s1", 1, { part: 1 }), rec("s1", 1, { part: 4 })];
t("الأخير هو الباقي", applyRecords([], twice)[0].criteria, { part: 4 });

console.log("\n8. مؤشّر «س علامة لم تُرسل»");
t("لا شيء", pendingLabel([]), "");
t("واحدة", pendingLabel([rec("s1", 1, {})]), "علامة لم تُرسل");
t("اثنتان", pendingLabel([rec("s1", 1, {}), rec("s2", 1, {})]), "علامتان لم تُرسل");
t("ثلاث", pendingLabel([rec("s1", 1, {}), rec("s2", 1, {}), rec("s3", 1, {})]), "3 علامات لم تُرسل");
t("إحدى عشرة", pendingLabel(Array.from({ length: 11 }, (_, i) => rec(`s${i}`, 1, {}))), "11 علامة لم تُرسل");
t("علامات ومحاولات", pendingLabel([rec("s1", 1, {}), addRead("r1", "s1", 3), addRead("r2", "s2", 3)]), "علامة ومحاولتان لم تُرسل");
t("العدّ يفصل المتعثّر", pending([rec("s1", 1, {}), { ...rec("s2", 1, {}), blocked: true }]), { marks: 2, reads: 0, edits: 0, total: 2, blocked: 1 });

console.log("\n9. تصنيف خطأ الخادم: شبكة تُعاد، ورفضٌ يُعرض على الأستاذ");
t("انقطاع بلا رمز → يُعاد", isPermanent(undefined), false);
t("رمز فارغ → يُعاد", isPermanent(""), false);
t("مهلة الخادم 57014 → يُعاد", isPermanent("57014"), false);
t("انتهاء الجلسة PGRST301 → يُعاد بعد تجديدها", isPermanent("PGRST301"), false);
t("تلميذ محذوف 23503 → متعثّرة", isPermanent("23503"), true);
t("خارج المجال 23514 → متعثّرة", isPermanent("23514"), true);
t("ممنوع بـRLS 42501 → متعثّرة", isPermanent("42501"), true);
t("عمود غير موجود PGRST204 → متعثّرة", isPermanent("PGRST204"), true);

console.log("\n10. التباعد بين المحاولات يكبر ولا يتجاوز الدقيقة");
t("الأولى بعد ثانيتين", backoff(1, 0), 2_000);
t("الثانية بعد أربع", backoff(2, 0), 4_000);
t("الخامسة بعد 32", backoff(5, 0), 32_000);
const capped = [10, 20, 99].every((n) => backoff(n, 0) === 60_000);
t("ثم تثبت عند دقيقة", capped, true);
t("ولا تنزل تحت الصفر", backoff(0, 0) >= 0, true);

console.log("\n11. علامات قسم كامل لا تضيع ولا تتضخّم");
let heavy = [];
for (let round = 0; round < 5; round++) {
  for (let i = 0; i < 36; i++) heavy = enqueue(heavy, rec(`s${i}`, 1, { part: round }));
}
t("36 تلميذًا × 5 جولات = 36 عملية", heavy.length, 36);
t("وكلّها آخر قيمة", heavy.every((o) => o.criteria.part === 4), true);
const applied = applyRecords([], heavy);
t("وتظهر كلها في الشاشة", applied.length, 36);

console.log(`\n${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail ? 1 : 0);
