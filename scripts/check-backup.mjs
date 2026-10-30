/* اختبار «نسختي»: التصدير ثم الاستيراد ثم التحقّق، على خادم في الذاكرة يفرض
   قواعد القاعدة الحقيقية: RLS (لا يرى الأستاذ ولا يكتب إلا صفوفه)، والمفاتيح
   الفريدة، والمفاتيح الأجنبية، وقيود المجال، وschool_year الإلزامي، ومعايير
   الحساب الجديد الافتراضية (seed_teacher كما هي في القاعدة).
   المطابقة بالمحتوى والمعدّلات، لا بعدد الصفوف وحده.
   يستورد الشفرة الحقيقية (src/lib/backup.ts). */

import {
  applyImport,
  averagesOf,
  backupSheets,
  buildBackup,
  conflictCount,
  currentState,
  deriveId,
  parseBackup,
  planImport,
  planSize,
  readAccount,
  verifyImport,
} from "../src/lib/backup.ts";
import { newOp } from "../src/lib/outbox.ts";

let failed = 0;
let passed = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
}

/* ---------- خادم في الذاكرة ---------- */

let counter = 0;
const uuid = () => {
  const n = (++counter).toString(16).padStart(12, "0");
  return `aaaaaaaa-0000-4000-8000-${n}`;
};

class PgError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const TABLES = ["teachers", "schools", "classes", "class_groups", "students", "criteria", "components", "records", "readings", "tp_sessions", "tp_marks"];
const UNIQUE = {
  criteria: ["teacher_id", "code"],
  components: ["teacher_id", "code"],
  records: ["student_id", "term"],
  tp_marks: ["session_id", "student_id"],
};
const FK = {
  classes: [["school_id", "schools"]],
  class_groups: [["class_id", "classes"]],
  students: [["class_id", "classes"], ["group_id", "class_groups"]],
  records: [["student_id", "students"]],
  readings: [["student_id", "students"]],
  tp_sessions: [["class_id", "classes"], ["group_id", "class_groups"]],
  tp_marks: [["session_id", "tp_sessions"], ["student_id", "students"]],
};
const in20 = (v) => v === null || v === undefined || (v >= 0 && v <= 20);

class Server {
  constructor() {
    this.t = Object.fromEntries(TABLES.map((n) => [n, []]));
    this.failAfter = Infinity; // لاختبار الانقطاع في منتصف الاستيراد
    this.writes = 0;
  }
  signUp() {
    const id = uuid();
    this.t.teachers.push({ id, full_name: "", subject: null, school_name: null });
    const c = (code, label, kind, base, ceiling, position) =>
      this.t.criteria.push({ id: uuid(), teacher_id: id, code, label, kind, base, ceiling, position });
    c("disc", "الانضباط", "deduct", 4, 4, 1);
    c("tool", "الأدوات", "deduct", 4, 4, 2);
    c("part", "المشاركة", "add", 0, 4, 3);
    c("hw", "الواجبات", "add", 0, 4, 4);
    c("read", "قراءة المحاولات", "auto", 0, 4, 5);
    const k = (code, label, weight, position) =>
      this.t.components.push({ id: uuid(), teacher_id: id, code, label, weight, position, active: true });
    k("cc", "التقويم المستمر", 1, 1);
    k("tp", "الأعمال التطبيقية", 1, 2);
    k("devoir", "الفرض", 1, 3);
    k("exam", "الاختبار", 2, 4);
    return id;
  }
  own(table, uid) {
    return this.t[table].filter((r) => (table === "teachers" ? r.id === uid : r.teacher_id === uid));
  }
  check(table, row) {
    if (table === "records") {
      if (![1, 2, 3].includes(row.term)) throw new PgError("23514", "records_term_check");
      if (!in20(row.tp) || !in20(row.devoir) || !in20(row.exam)) throw new PgError("23514", "records mark range");
    }
    if (table === "tp_marks") {
      if (!in20(row.score)) throw new PgError("23514", "tp_marks_score_check");
      if (row.absent && row.score !== null) throw new PgError("23514", "tp_marks_absent_has_no_score");
    }
    if (table === "classes" && (row.school_year === null)) throw new PgError("23502", "null school_year");
    for (const [col, parent] of FK[table] ?? []) {
      if (row[col] != null && !this.t[parent].some((p) => p.id === row[col])) {
        throw new PgError("23503", `fk ${table}.${col}`);
      }
    }
  }
  clash(table, row, ignore) {
    if (row.id && this.t[table].some((r) => r !== ignore && r.id === row.id)) return true;
    const u = UNIQUE[table];
    return !!u && this.t[table].some((r) => r !== ignore && u.every((k) => r[k] === row[k]));
  }
  tick() {
    if (++this.writes > this.failAfter) throw new Error("انقطع الاتصال");
  }
  db(uid) {
    const s = this;
    return {
      async selectAll(table) {
        return structuredClone(s.own(table, uid));
      },
      async insert(table, rows) {
        s.tick();
        const staged = [];
        for (const raw of rows) {
          if (raw.teacher_id !== uid) throw new PgError("42501", "new row violates row-level security policy");
          const row = { ...raw };
          if (!row.id && table !== "records" && table !== "tp_marks") row.id = uuid();
          if (table === "records" || table === "tp_marks") row.id = uuid();
          if (table === "classes" && !("school_year" in row)) row.school_year = "2026-2027";
          s.check(table, row);
          if (s.clash(table, row) || staged.some((x) => x.id === row.id)) {
            throw new PgError("23505", `duplicate key in ${table}`);
          }
          staged.push(row);
        }
        s.t[table].push(...staged);
      },
      async upsert(table, rows, onConflict) {
        s.tick();
        const keys = onConflict.split(",");
        for (const raw of rows) {
          if (raw.teacher_id !== uid) throw new PgError("42501", "rls");
          const hit = s.t[table].find((r) => keys.every((k) => r[k] === raw[k]));
          if (hit && hit.teacher_id !== uid) throw new PgError("42501", "rls on conflict");
          const row = { ...hit, ...raw, id: hit?.id ?? uuid() };
          s.check(table, row);
          if (hit) Object.assign(hit, row);
          else s.t[table].push(row);
        }
      },
      async update(table, match, patch) {
        s.tick();
        const rows = s.own(table, uid).filter((r) => Object.entries(match).every(([k, v]) => r[k] === v));
        if (!rows.length) throw new Error("لم يُعدَّل شيء في الخادم");
        for (const r of rows) {
          const next = { ...r, ...patch };
          s.check(table, next);
          Object.assign(r, next);
        }
      },
    };
  }
  /** حذف تلميذ كما يفعله ON DELETE CASCADE. */
  deleteStudent(id) {
    this.t.students = this.t.students.filter((s) => s.id !== id);
    for (const tb of ["records", "readings", "tp_marks"]) this.t[tb] = this.t[tb].filter((r) => r.student_id !== id);
  }
  count(uid) {
    return Object.fromEntries(TABLES.filter((x) => x !== "teachers").map((x) => [x, this.own(x, uid).length]));
  }
}

/* ---------- حساب أ: عمل حقيقي الشكل ---------- */

const server = new Server();
const A = server.signUp();
const dbA = server.db(A);
const ins = (table, row) => dbA.insert(table, [{ ...row, teacher_id: A }]);

// أستاذ أ غيّر إعداداته: سقف المشاركة 6، معيار جديد، والاختبار معامله 3، والفرض مطفأ
await dbA.update("criteria", { code: "part" }, { ceiling: 6 });
await ins("criteria", { code: "oral", label: "التعبير الشفوي", kind: "add", base: 0, ceiling: 2, position: 6 });
await dbA.update("components", { code: "exam" }, { weight: 3 });
await dbA.update("components", { code: "devoir" }, { active: false });
await dbA.update("teachers", { id: A }, { full_name: "أ. المختبِر", subject: "علوم الطبيعة والحياة" });

const sch1 = uuid(), sch2 = uuid();
await ins("schools", { id: sch1, name: "ثانوية الأولى", position: 1 });
await ins("schools", { id: sch2, name: "ثانوية الثانية", position: 2 });
const c1 = uuid(), c2 = uuid();
await ins("classes", { id: c1, name: "1 ج م ع 1", position: 1, school_id: sch1, tp_target: "criterion:oral", level: "1AS", stream: "ج م ع", school_year: "2026-2027" });
await ins("classes", { id: c2, name: "2 ع ت", position: 2, school_id: sch2, tp_target: "component", level: null, stream: null, school_year: "2026-2027" });
const g1 = uuid(), g2 = uuid();
await ins("class_groups", { id: g1, class_id: c1, name: null, position: 1 });
await ins("class_groups", { id: g2, class_id: c1, name: "الفوج ب", position: 2 });

const students = [];
for (let i = 0; i < 12; i++) {
  const id = uuid();
  students.push(id);
  await ins("students", {
    id,
    class_id: i < 8 ? c1 : c2,
    full_name: `تلميذ رقم ${i + 1}`,
    position: i + 1,
    note: i === 2 ? "يجلس في المقدّمة" : null,
    tags: i === 3 ? ["يحتاج تشجيعًا"] : [],
    group_id: i < 8 ? (i % 2 ? g2 : g1) : null,
    is_active: true,
  });
}
for (let i = 0; i < students.length; i++) {
  for (const term of [1, 2]) {
    if (term === 2 && i % 3 === 0) continue;
    await ins("records", {
      student_id: students[i], term,
      criteria: { disc: -(i % 3), part: (i % 5) + 0.5, ...(i % 4 === 0 ? { hw: 2 } : {}) },
      tp: i % 2 ? 11 + (i % 7) : null,
      devoir: 9 + (i % 9),
      exam: i === 5 ? null : 7.25 + i,
    });
  }
}
const readIds = [];
for (let i = 0; i < 10; i++) {
  const id = uuid();
  readIds.push(id);
  await ins("readings", { id, student_id: students[i % 6], term: 1, score: (i % 4) + 0.5, read_on: `2026-10-0${(i % 9) + 1}`, note: i === 1 ? "متردّد" : null });
}
const ses1 = uuid(), ses2 = uuid();
await ins("tp_sessions", { id: ses1, class_id: c1, group_id: g1, term: 1, held_on: "2026-10-05", title: "المجهر" });
await ins("tp_sessions", { id: ses2, class_id: c2, group_id: null, term: 1, held_on: "2026-10-06", title: null });
for (let i = 0; i < 8; i += 2) await ins("tp_marks", { session_id: ses1, student_id: students[i], score: i === 4 ? null : 12 + i / 2, absent: i === 4 });
for (let i = 8; i < 12; i++) await ins("tp_marks", { session_id: ses2, student_id: students[i], score: 10 + i - 8, absent: false });

/* ---------- التصدير ---------- */

console.log("— التصدير");
const accountA = await readAccount(dbA);
const pendingA = [
  newOp("record", { student_id: students[1], term: 1, criteria: { disc: 0, part: 4 }, tp: 15, devoir: 10, exam: 12 }),
  newOp("tp-session", { session: { id: "bbbbbbbb-0000-4000-8000-000000000001", class_id: c1, group_id: g2, term: 1, held_on: "2026-10-20", title: "عرض" } }),
  newOp("tp-mark", { session_id: "bbbbbbbb-0000-4000-8000-000000000001", student_id: students[1], score: 17, absent: false }),
  newOp("student", { student_id: "cccccccc-0000-4000-8000-000000000009", patch: { note: "لتلميذ لا وجود له" } }),
];
pendingA[0].tries = 5;
pendingA[0].blocked = true;
const backupA = buildBackup({ source: "server", teacher: { id: A, email: "a@example.dz", ...accountA.profile }, data: accountA.data, pending: pendingA, now: new Date("2026-10-21T10:00:00Z") });
const fileText = JSON.stringify(backupA);
t("الملف يحمل كل الجداول بأعدادها", [backupA.data.classes.length, backupA.data.students.length, backupA.data.records.length, backupA.data.readings.length, backupA.data.tp_sessions.length, backupA.data.tp_marks.length, backupA.data.class_groups.length, backupA.data.schools.length], [2, 12, 20, 10, 2, 8, 2, 2]);
t("الحالة الخاصة والملاحظة في الملف", [backupA.data.students[2].note, backupA.data.students[3].tags], ["يجلس في المقدّمة", ["يحتاج تشجيعًا"]]);
t("الإعدادات المخصّصة في الملف", [backupA.data.criteria.find((c) => c.code === "part").ceiling, backupA.data.components.find((c) => c.code === "exam").weight, backupA.data.components.find((c) => c.code === "devoir").active], [6, 3, false]);
t("لا teacher_id في صفوف الملف", JSON.stringify(backupA.data).includes("teacher_id"), false);
t("المعلّقات منفصلة ونظيفة من حالة المحاولات", [backupA.pending.length, backupA.pending[0].tries, backupA.pending[0].blocked], [4, 0, false]);

const parsed = parseBackup(fileText);
t("الملف يُقرأ من جديد", parsed.ok, true);
t("القراءة تعيد البيانات كما هي", JSON.stringify(parsed.backup.data), JSON.stringify(backupA.data));

/* ---------- استيراد في حساب جديد (بعد ضياع الحساب الأول) ---------- */

console.log("— الاستعادة في حساب جديد");
const B = server.signUp();
const dbB = server.db(B);
const countsABefore = server.count(A);
const stateB = await currentState(dbB, B);
const planB = await planImport(parsed.backup, stateB);
t("الملف من حساب آخر يُعلَّم", planB.foreign, true);
t("كل الصفوف جديدة على الحساب", [planB.insert.classes.length, planB.insert.students.length, planB.insert.records.length, planB.insert.tp_marks.length], [2, 12, 20, 8]);
t("المعيار الجديد يُضاف، والمختلف تعارضٌ لا يُكتب فوقه", [planB.insert.criteria.map((c) => c.code), planB.conflicts.criteria.map((c) => c.key)], [["oral"], ["part"]]);
t("مركّبتان مختلفتان تعارض", planB.conflicts.components.map((c) => c.key).sort(), ["devoir", "exam"]);
t("معرّفات جديدة مشتقّة لا الأصلية", planB.insert.students.every((s) => !students.includes(s.id)), true);
t("المعرّف المشتق ثابت", planB.idMap.get(students[0]), await deriveId(B, students[0]));
t("العلاقات تتبع المعرّفات", planB.insert.students[0].class_id, planB.idMap.get(c1));
t("بيانات الأستاذ الفارغة تُملأ", planB.profileFill, { full_name: "أ. المختبِر", subject: "علوم الطبيعة والحياة" });
t("المعلّقة اليتيمة لا تُعاد", [planB.pending.length, planB.pendingOrphans], [3, 1]);
t("المعلّقة المترجمة تشير إلى التلميذ الجديد", planB.pending[0].student_id, planB.idMap.get(students[1]));
t("علامة الحصة المعلّقة تتبع حصتها المعلّقة", planB.pending[2].session_id, planB.pending[1].session.id);

const noReplace = { replaceSettings: false, replaceMarks: false };
const withSettings = { replaceSettings: true, replaceMarks: false };
const resB = await applyImport(dbB, planB, B, withSettings);
t("الاستيراد نجح", resB.ok, true);
const verB = await verifyImport(dbB, planB, withSettings);
t("التحقّق بالمحتوى: كل ما كُتب مطابق", [verB.ok, verB.problems], [true, []]);
t("التحقّق فحص كل صفّ مكتوب", verB.checked >= planSize(planB), true);

const afterB = await readAccount(dbB);
const avgFile = averagesOf(parsed.backup.data);
const avgB = averagesOf(afterB.data);
let sameAvg = 0, diffAvg = 0;
for (const [key, value] of avgFile) {
  const [old, term] = key.split(":");
  const got = avgB.get(`${planB.idMap.get(old)}:${term}`);
  const close = (x, y) => (x === null && y === null) || (x !== null && y !== null && Math.abs(x - y) < 1e-9);
  if (got && close(got.avg, value.avg) && close(got.cc, value.cc)) sameAvg++;
  else diffAvg++;
}
t("كل معدّل وتقويم مستمر بعد الاستعادة = ما في الملف", [sameAvg, diffAvg], [avgFile.size, 0]);
t("المعدّلات محسوبة فعلًا (ليست فارغة)", [...avgFile.values()].filter((v) => v.avg !== null).length > 15, true);
t("الحالة الخاصة عادت", afterB.data.students.find((s) => s.id === planB.idMap.get(students[2])).note, "يجلس في المقدّمة");
t("لم يُمسّ حساب أ", server.count(A), countsABefore);
const importedIds = new Set([...planB.idMap.values()]);
const importedRows = TABLES.filter((x) => x !== "teachers").flatMap((x) => server.t[x].filter((r) => importedIds.has(r.id) || importedIds.has(r.student_id)));
t("كل صفّ مستورد باسم الحساب الحالي وحده", [importedRows.length > 40, importedRows.every((r) => r.teacher_id === B)], [true, true]);

console.log("— إعادة الاستيراد نفسه لا تكرّر");
const planB2 = await planImport(parsed.backup, await currentState(dbB, B));
t("لا شيء يُكتب في المرة الثانية", planSize(planB2), 0);
t("ولا تعارض بعد استبدال الإعدادات", conflictCount(planB2), { settings: 0, marks: 0 });
const countB = server.count(B);
await applyImport(dbB, planB2, B, noReplace);
t("الأعداد لم تتغيّر", server.count(B), countB);

/* ---------- الاستعادة بعد خطأ في الحساب نفسه ---------- */

console.log("— استرجاع ما حُذف وما عُدّل بالخطأ في الحساب نفسه");
const lost = students[4];
server.deleteStudent(lost);
await dbA.upsert("records", [{ teacher_id: A, student_id: students[0], term: 1, criteria: { disc: 0, part: 0.5 }, tp: null, devoir: 1, exam: 1 }], "student_id,term");
const planA = await planImport(parsed.backup, await currentState(dbA, A));
t("ملف الحساب نفسه ليس غريبًا", planA.foreign, false);
t("التلميذ المحذوف يعود وحده", planA.insert.students.length, 1);
t("الموجود يُترك بمعرّفه الأصلي", [planA.kept.students, planA.idMap.get(students[0])], [11, students[0]]);
t("علامات المحذوف تعود معه", [planA.insert.records.length, planA.insert.tp_marks.length, planA.insert.readings.length], [2, 1, 1]);
t("العلامة المعدَّلة بالخطأ تعارضٌ لا تُكتب تلقائيًا", planA.conflicts.records.map((c) => c.key), [`${students[0]}:1`]);
t("العلامة المختلفة تُعرض باسم التلميذ", planA.conflicts.records[0].label, "تلميذ رقم 1 — الفصل 1");

const resA1 = await applyImport(dbA, planA, A, noReplace);
t("الاستيراد دون استبدال", resA1.ok, true);
t("بلا موافقة: العلامة المعدَّلة كما هي", (await readAccount(dbA)).data.records.find((r) => r.student_id === students[0] && r.term === 1).devoir, 1);
const verA1 = await verifyImport(dbA, planA, noReplace);
t("التحقّق بعد الاسترجاع", verA1.ok, true);

const planA2 = await planImport(parsed.backup, await currentState(dbA, A));
t("المحذوف لم يعد ناقصًا", planA2.insert.students.length, 0);
const resA2 = await applyImport(dbA, planA2, A, { replaceSettings: false, replaceMarks: true });
t("بموافقة صريحة: تُستبدل العلامة المختلفة", resA2.ok, true);
const fixed = (await readAccount(dbA)).data.records.find((r) => r.student_id === students[0] && r.term === 1);
const original = backupA.data.records.find((r) => r.student_id === students[0] && r.term === 1);
t("العلامة عادت إلى ما في الملف", [fixed.devoir, fixed.exam, fixed.criteria], [original.devoir, original.exam, original.criteria]);
t("التحقّق بعد الاستبدال", (await verifyImport(dbA, planA2, { replaceSettings: false, replaceMarks: true })).ok, true);

/* ---------- انقطاع في منتصف الاستيراد ---------- */

console.log("— انقطاع في منتصف الاستيراد ثم إعادته");
const C = server.signUp();
const dbC = server.db(C);
const planC = await planImport(parsed.backup, await currentState(dbC, C));
server.writes = 0;
server.failAfter = 4;
const half = await applyImport(dbC, planC, C, noReplace);
server.failAfter = Infinity;
t("الفشل يُقال ولا يُخفى", [half.ok, half.written > 0, half.problem], [false, true, "انقطع الاتصال"]);
const planC2 = await planImport(parsed.backup, await currentState(dbC, C));
t("الخطة الثانية تُكمل ما بقي فقط", planSize(planC2) + half.written, planSize(planC));
const rest = await applyImport(dbC, planC2, C, noReplace);
t("الإكمال نجح", rest.ok, true);
t("بلا تكرار بعد الإكمال", server.count(C).students, 12);
t("التحقّق بعد الإكمال", (await verifyImport(dbC, planC2, noReplace)).ok, true);

/* ---------- العزل ---------- */

console.log("— لا كتابة في حساب غير الحساب الحالي");
const sneaky = structuredClone(planC2);
sneaky.insert.schools = [{ id: uuid(), name: "دخيلة", position: 9 }];
// applyImport يكتب teacher_id = الحساب الممرَّر؛ وإن مُرِّر حساب غير حساب الجلسة رفضته RLS
const forged = await applyImport(dbC, sneaky, A, noReplace);
t("RLS ترفض الكتابة باسم حساب آخر", [forged.ok, /row-level security/.test(forged.problem ?? "")], [false, true]);
t("ولم يُكتب شيء في حساب أ", server.own("schools", A).some((s) => s.name === "دخيلة"), false);

/* ---------- ملفات تالفة ---------- */

console.log("— رفض الملفات التالفة قبل أن يُمسّ شيء");
const mutate = (fn) => {
  const copy = structuredClone(backupA);
  fn(copy);
  return parseBackup(JSON.stringify(copy));
};
t("ليس JSON", parseBackup("{نص").ok, false);
t("ملف آخر لا علاقة له", parseBackup(JSON.stringify({ hello: 1 })).ok, false);
const newer = mutate((b) => (b.version = 99));
t("إصدار أحدث يُرفض بشرح", [newer.ok, /أحدث/.test(newer.problem)], [false, true]);
t("تلميذ يشير إلى قسم مفقود", mutate((b) => (b.data.students[0].class_id = "dddddddd-0000-4000-8000-000000000000")).ok, false);
t("معرّف مكرّر", mutate((b) => (b.data.students[1].id = b.data.students[0].id)).ok, false);
t("علامة فوق 20", mutate((b) => (b.data.records[0].exam = 21)).ok, false);
t("غائب وله علامة", mutate((b) => { const m = b.data.tp_marks.find((x) => x.absent); m.score = 5; }).ok, false);
t("فوج من قسم آخر", mutate((b) => (b.data.students[9].group_id = g1)).ok, false);
t("علامتان للتلميذ والفصل نفسيهما", mutate((b) => b.data.records.push({ ...b.data.records[0] })).ok, false);
t("جدول مفقود", mutate((b) => delete b.data.readings).ok, false);
const oldReadings = mutate((b) => { for (const r of b.data.readings) delete r.criterion_code; });
t("ملف قديم بلا criterion_code يُقبل وتأخذ محاولاته معيار القراءة", [oldReadings.ok, oldReadings.ok && oldReadings.backup.data.readings.every((r) => r.criterion_code === "read")], [true, true]);
t("الملف الجديد يحمل كود المعيار", backupA.data.readings.every((r) => typeof r.criterion_code === "string" && r.criterion_code.length > 0), true);
t("كود معيار فارغ يُرفض", mutate((b) => (b.data.readings[0].criterion_code = "")).ok, false);
t("نوع معيار مجهول", mutate((b) => (b.data.criteria[0].kind = "magic")).ok, false);
const strangeOps = mutate((b) => b.pending.push({ id: "x", at: 1, kind: "future-op" }));
t("معلّقة مجهولة النوع تُترك وتُعدّ، والملف يُقبل", [strangeOps.ok, strangeOps.droppedPending], [true, 1]);
t("الرفض يقول أين", mutate((b) => (b.data.students[0].class_id = "dddddddd-0000-4000-8000-000000000000")).problem, "التلميذ «تلميذ رقم 1»: يشير إلى قسم ليس في الملف.");

/* ---------- نسخة الجهاز (دون اتصال) ---------- */

console.log("— ملف من نسخة الجهاز (ينقصه ما لا يحفظه الجهاز)");
const deviceData = structuredClone(backupA.data);
for (const k of deviceData.classes) { k.level = null; k.stream = null; k.school_year = null; }
for (const r of deviceData.readings) r.note = null;
const deviceFile = parseBackup(JSON.stringify(buildBackup({ source: "device", teacher: backupA.teacher, data: deviceData, pending: [] })));
t("ملف الجهاز يُقرأ", deviceFile.ok, true);
const D = server.signUp();
const dbD = server.db(D);
const planD = await planImport(deviceFile.backup, await currentState(dbD, D));
const resD = await applyImport(dbD, planD, D, withSettings);
t("القسم بلا سنة دراسية يأخذ قيمة القاعدة ولا يفشل", [resD.ok, server.own("classes", D).every((k) => k.school_year === "2026-2027")], [true, true]);
t("التحقّق لملف الجهاز", (await verifyImport(dbD, planD, withSettings)).ok, true);

/* ---------- Excel ---------- */

console.log("— محتوى ملف Excel المقروء");
const sheets = backupSheets(parsed.backup, (g, i) => g.name ?? `الفوج ${i + 1}`);
t("ورقة تعريف وورقة لكل قسم", sheets.map((s) => s.name), ["اقرأني", "1 ج م ع 1", "2 ع ت"]);
const s1 = sheets[1].rows;
t("رأس الورقة: المركّبات النشطة فقط والمعدل لكل فصل", s1[0], ["الرقم", "الاسم واللقب", "الفوج", "التقويم المستمر ف1", "الأعمال التطبيقية ف1", "الاختبار ف1", "المعدل ف1", "التقويم المستمر ف2", "الأعمال التطبيقية ف2", "الاختبار ف2", "المعدل ف2"]);
t("سطر لكل تلميذ", s1.length - 1, 8);
const avg0 = avgFile.get(`${students[0]}:1`).avg;
t("المعدل في Excel هو معدل التطبيق مقرّبًا", s1[1][6], Math.round(avg0 * 100) / 100);
t("لا حالات خاصة ولا ملاحظات في Excel", JSON.stringify(sheets).includes("يجلس في المقدّمة") || JSON.stringify(sheets).includes("يحتاج تشجيعًا"), false);
t("اسم الفوج بلا اسم يُرقَّم", s1[1][2], "الفوج 1");

console.log(`\n${passed} ok, ${failed} failed`);
if (failed) process.exit(1);
