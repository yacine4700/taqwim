/**
 * «نسختي»: ملف يحمله الأستاذ فيه كل عمله، ويُستعاد منه.
 *
 * لماذا: كل ما يحفظه التطبيق في مشروع Supabase واحد. لو ضاع المشروع أو
 * الحساب، يبقى عند الأستاذ ملفٌّ يعيد منه أقسامه وتلاميذه وعلاماته — ملكه
 * هو، على هاتفه أو بريده، لا يعتمد على أحد.
 *
 * ما في الملف (format "taqwim-backup"، version 1):
 *   المؤسسات، الأقسام، الأفواج، التلاميذ (بحالاتهم الخاصة وملاحظاتهم)،
 *   المعايير والمركّبات (بإعداداتها)، علامات الفصول، محاولات القراءة،
 *   حصص الأعمال التطبيقية وعلاماتها، بيانات الأستاذ، وما لم يُرسل بعد من
 *   طابور الجهاز (pending) منفصلًا عن نسخة الخادم.
 *
 * قواعد الاستيراد (planImport):
 *   1. لا يكتب فوق شيء موجود دون موافقة صريحة: الموجود يُترك، والمختلف
 *      يُعرض «تعارضًا» ولا يُمسّ ما لم يختر الأستاذ الاستبدال.
 *   2. لا يكرّر: الصف الموجود بمعرّفه يُترك. وما ليس موجودًا يأخذ معرّفًا
 *      ثابتًا مشتقًّا من (الأستاذ الحالي، المعرّف الأصلي)، فاستيراد الملف
 *      نفسه مرتين لا ينشئ نسختين، وملفُّ حسابٍ آخر لا يصطدم بصفوف صاحبه.
 *   3. يحفظ العلاقات: كل معرّف يُترجم مرة واحدة، والإشارات إليه تتبعه.
 *   4. المعايير والمركّبات تُطابَق بالكود لا بالمعرّف: كل حساب جديد يُنشأ
 *      بمعايير افتراضية بمعرّفات أخرى، والعلامات مفتاحها كود المعيار.
 *   5. الكتابة كلها باسم الأستاذ الحالي (teacher_id = حسابه)، ومعها RLS في
 *      القاعدة: لا يُكتب صف في حساب غيره بأي حال.
 *
 * منطق صافٍ بلا شبكة. الشبكة في backupDb.ts، والاختبارات في
 * scripts/check-backup.mjs (تستورد هذا الملف نفسه).
 */

import type { Op } from "./outbox";
import {
  applyTpTarget,
  componentValues,
  DEFAULT_READING_CODE,
  termAverage,
  tpAverages,
  type CriterionKind,
  type Reading,
} from "./scoring";

export const BACKUP_FORMAT = "taqwim-backup";
export const BACKUP_VERSION = 1;
/** حدّ حجم الملف المقبول: أكبر من حساب أي أستاذ بكثير، وأصغر من أن يجمّد الهاتف. */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

/* ---------- صفوف الملف ---------- */

export type BSchool = { id: string; name: string; position: number };
export type BClass = {
  id: string;
  name: string;
  position: number;
  school_id: string | null;
  tp_target: string | null;
  level: string | null;
  stream: string | null;
  school_year: string | null;
};
export type BGroup = { id: string; class_id: string; name: string | null; position: number };
export type BStudent = {
  id: string;
  class_id: string;
  full_name: string;
  position: number;
  note: string | null;
  tags: string[];
  group_id: string | null;
  is_active: boolean;
};
export type BCriterion = {
  code: string;
  label: string;
  kind: CriterionKind;
  base: number;
  ceiling: number;
  position: number;
};
export type BComponent = {
  code: string;
  label: string;
  weight: number;
  position: number;
  active: boolean;
};
export type BRecord = {
  student_id: string;
  term: number;
  criteria: Record<string, number>;
  tp: number | null;
  devoir: number | null;
  exam: number | null;
};
export type BReading = {
  id: string;
  student_id: string;
  term: number;
  score: number;
  read_on: string;
  note: string | null;
  /** معيار السحب الذي تنتمي إليه المحاولة؛ نسخة قديمة بلا هذا الحقل تعني معيار القراءة. */
  criterion_code: string;
};
export type BSession = {
  id: string;
  class_id: string;
  group_id: string | null;
  term: number;
  held_on: string;
  title: string | null;
};
export type BTpMark = {
  session_id: string;
  student_id: string;
  score: number | null;
  absent: boolean;
};

/** أسماء المفاتيح هي أسماء جداول القاعدة: من يستعيد يدويًا يعرف أين يذهب كل شيء. */
export type BackupData = {
  schools: BSchool[];
  classes: BClass[];
  class_groups: BGroup[];
  students: BStudent[];
  criteria: BCriterion[];
  components: BComponent[];
  records: BRecord[];
  readings: BReading[];
  tp_sessions: BSession[];
  tp_marks: BTpMark[];
};

export type BTeacher = {
  /** الحساب الذي صُدِّر منه الملف، للمقارنة عند الاستيراد لا للكتابة. */
  id: string;
  email: string;
  full_name: string;
  subject: string | null;
  school_name: string | null;
};

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exported_at: string;
  /**
   * "server": نُسخ من الخادم لحظة التصدير، كاملًا.
   * "device": نُسخ من نسخة الجهاز (لا شبكة): ينقصه ما لا يحفظه الجهاز
   * (المستوى والشعبة والسنة الدراسية للقسم، وملاحظة محاولة القراءة).
   */
  source: "server" | "device";
  teacher: BTeacher;
  data: BackupData;
  /** ما لم يصل الخادم بعد. ليس جزءًا من data: لم يُحفظ في الخادم قط. */
  pending: Op[];
};

export const EMPTY_DATA: BackupData = {
  schools: [],
  classes: [],
  class_groups: [],
  students: [],
  criteria: [],
  components: [],
  records: [],
  readings: [],
  tp_sessions: [],
  tp_marks: [],
};

/* ---------- البناء: من صفوف الخادم أو نسخة الجهاز إلى صفوف الملف ---------- */

type Loose = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" ? v : v == null ? null : String(v);
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

/**
 * صفوف من أي مصدر إلى صيغة الملف. ما ينقص (نسخة جهاز أقدم) يأخذ قيمته
 * الافتراضية في القاعدة، لا يُخترع.
 */
export function normalizeData(raw: Partial<Record<keyof BackupData, Loose[]>>): BackupData {
  const rows = (k: keyof BackupData) => (Array.isArray(raw[k]) ? (raw[k] as Loose[]) : []);
  return {
    schools: rows("schools").map((r) => ({ id: str(r.id), name: str(r.name), position: num(r.position ?? 0) })),
    classes: rows("classes").map((r) => ({
      id: str(r.id),
      name: str(r.name),
      position: num(r.position ?? 0),
      school_id: strOrNull(r.school_id),
      tp_target: strOrNull(r.tp_target),
      level: strOrNull(r.level),
      stream: strOrNull(r.stream),
      school_year: strOrNull(r.school_year),
    })),
    class_groups: rows("class_groups").map((r) => ({
      id: str(r.id),
      class_id: str(r.class_id),
      name: strOrNull(r.name),
      position: num(r.position ?? 0),
    })),
    students: rows("students").map((r) => ({
      id: str(r.id),
      class_id: str(r.class_id),
      full_name: str(r.full_name),
      position: num(r.position ?? 0),
      note: strOrNull(r.note),
      tags: Array.isArray(r.tags) ? r.tags.map(str) : [],
      group_id: strOrNull(r.group_id),
      is_active: r.is_active === undefined || r.is_active === null ? true : r.is_active === true,
    })),
    criteria: rows("criteria").map((r) => ({
      code: str(r.code),
      label: str(r.label),
      kind: str(r.kind) as CriterionKind,
      base: num(r.base),
      ceiling: num(r.ceiling),
      position: num(r.position ?? 0),
    })),
    components: rows("components").map((r) => ({
      code: str(r.code),
      label: str(r.label),
      weight: num(r.weight),
      position: num(r.position ?? 0),
      active: r.active === undefined || r.active === null ? true : r.active === true,
    })),
    records: rows("records").map((r) => ({
      student_id: str(r.student_id),
      term: num(r.term),
      criteria: Object.fromEntries(
        Object.entries((r.criteria as Loose | null) ?? {}).map(([k, v]) => [k, Number(v)]),
      ),
      tp: numOrNull(r.tp),
      devoir: numOrNull(r.devoir),
      exam: numOrNull(r.exam),
    })),
    readings: rows("readings").map((r) => ({
      id: str(r.id),
      student_id: str(r.student_id),
      term: num(r.term),
      score: num(r.score),
      read_on: str(r.read_on).slice(0, 10),
      note: strOrNull(r.note),
      criterion_code: typeof r.criterion_code === "string" && r.criterion_code ? r.criterion_code : DEFAULT_READING_CODE,
    })),
    tp_sessions: rows("tp_sessions").map((r) => ({
      id: str(r.id),
      class_id: str(r.class_id),
      group_id: strOrNull(r.group_id),
      term: num(r.term),
      held_on: str(r.held_on).slice(0, 10),
      title: strOrNull(r.title),
    })),
    tp_marks: rows("tp_marks").map((r) => ({
      session_id: str(r.session_id),
      student_id: str(r.student_id),
      score: numOrNull(r.score),
      absent: r.absent === true,
    })),
  };
}

export function buildBackup(args: {
  source: Backup["source"];
  teacher: BTeacher;
  data: BackupData;
  pending: Op[];
  now?: Date;
}): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: (args.now ?? new Date()).toISOString(),
    source: args.source,
    teacher: args.teacher,
    data: args.data,
    // نسخة نظيفة: حالة المحاولات لا تعني شيئًا في جهاز آخر
    pending: args.pending.map((op) => ({ ...op, tries: 0, error: null, blocked: false, nextTry: 0 })),
  };
}

/** اسم الملف: التاريخ والساعة بتوقيت الجهاز، فلا يكتب ملفٌّ فوق ملف أقدم. */
export function backupFileName(now: Date, ext: "json" | "xlsx"): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `نسختي-دفتر-التقويم-${stamp}.${ext}`;
}

/** ما في الملف بالعدد، كما يُعرض قبل التصدير والاستيراد. */
export function backupCounts(data: BackupData) {
  return {
    classes: data.classes.length,
    students: data.students.length,
    records: data.records.length,
    readings: data.readings.length,
    sessions: data.tp_sessions.length,
    tpMarks: data.tp_marks.length,
  };
}

/* ---------- القراءة والتحقّق ---------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: CriterionKind[] = ["deduct", "add", "auto"];

export type ParseResult =
  | { ok: true; backup: Backup; droppedPending: number }
  | { ok: false; problem: string };

class Bad extends Error {}

function need(cond: unknown, problem: string): asserts cond {
  if (!cond) throw new Bad(problem);
}

const isObj = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const inRange = (v: unknown, lo: number, hi: number) => finite(v) && v >= lo && v <= hi;
const mark20 = (v: unknown) => v === null || inRange(v, 0, 20);
const term = (v: unknown) => v === 1 || v === 2 || v === 3;
const optText = (v: unknown) => v === null || typeof v === "string";

/**
 * قراءة ملف «نسختي» والتحقّق منه قبل أن يُمسّ شيء. يرفض الملف كله إن كانت
 * بنيته أو علاقاته مكسورة — استيراد نصف ملف أسوأ من رفضه — ويقول أين.
 * العمليات المعلّقة وحدها تُترك منفردة إن فسدت، ويُذكر عددها.
 */
export function parseBackup(text: string): ParseResult {
  try {
    need(text.length <= MAX_BACKUP_BYTES, "الملف أكبر من أن يكون نسخة من هذا التطبيق.");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Bad("هذا ليس ملف «نسختي»: محتواه ليس JSON صالحًا.");
    }
    need(isObj(raw) && raw.format === BACKUP_FORMAT, "هذا ليس ملف «نسختي» من دفتر التقويم المستمر.");
    need(Number.isInteger(raw.version) && (raw.version as number) >= 1, "رقم إصدار الملف غير صالح.");
    need(
      (raw.version as number) <= BACKUP_VERSION,
      "هذا الملف صدر عن إصدار أحدث من التطبيق. حدّث الصفحة ثم أعد الاستيراد.",
    );
    need(raw.source === "server" || raw.source === "device", "مصدر الملف غير معروف.");
    need(typeof raw.exported_at === "string", "تاريخ التصدير مفقود.");
    need(isObj(raw.teacher) && typeof raw.teacher.id === "string", "بيانات الأستاذ مفقودة.");
    need(isObj(raw.data), "الملف بلا بيانات.");

    const d = raw.data as Loose;
    const tables: Array<keyof BackupData> = [
      "schools", "classes", "class_groups", "students", "criteria",
      "components", "records", "readings", "tp_sessions", "tp_marks",
    ];
    for (const t of tables) need(Array.isArray(d[t]), `جدول «${t}» مفقود من الملف.`);
    for (const t of tables) {
      (d[t] as unknown[]).forEach((row, i) => need(isObj(row), `الصف ${i + 1} في «${t}» تالف.`));
    }
    const rows = (t: keyof BackupData) => d[t] as Loose[];

    const ids = (t: keyof BackupData, what: string) => {
      const set = new Set<string>();
      rows(t).forEach((r, i) => {
        need(typeof r.id === "string" && UUID.test(r.id), `${what} رقم ${i + 1}: معرّف غير صالح.`);
        need(!set.has(r.id as string), `${what} رقم ${i + 1}: معرّف مكرّر.`);
        set.add(r.id as string);
      });
      return set;
    };
    const schools = ids("schools", "المؤسسة");
    const classes = ids("classes", "القسم");
    const groups = ids("class_groups", "الفوج");
    const students = ids("students", "التلميذ");
    ids("readings", "محاولة القراءة");
    const sessions = ids("tp_sessions", "حصة الأعمال التطبيقية");

    const groupClass = new Map(rows("class_groups").map((g) => [g.id as string, g.class_id]));

    rows("schools").forEach((r, i) =>
      need(typeof r.name === "string" && r.name.trim() !== "", `المؤسسة رقم ${i + 1}: بلا اسم.`));
    rows("classes").forEach((r, i) => {
      need(typeof r.name === "string" && r.name.trim() !== "", `القسم رقم ${i + 1}: بلا اسم.`);
      need(r.school_id === null || schools.has(r.school_id as string),
        `القسم «${str(r.name)}»: يشير إلى مؤسسة ليست في الملف.`);
      need(r.tp_target === null || r.tp_target === "component" ||
        (typeof r.tp_target === "string" && r.tp_target.startsWith("criterion:")),
        `القسم «${str(r.name)}»: وجهة الأعمال التطبيقية غير صالحة.`);
      for (const f of ["level", "stream", "school_year"]) {
        need(r[f] === undefined || optText(r[f]), `القسم «${str(r.name)}»: حقل ${f} غير صالح.`);
      }
    });
    rows("class_groups").forEach((r, i) => {
      need(classes.has(r.class_id as string), `الفوج رقم ${i + 1}: يشير إلى قسم ليس في الملف.`);
      need(optText(r.name), `الفوج رقم ${i + 1}: اسم غير صالح.`);
    });
    rows("students").forEach((r, i) => {
      const who = typeof r.full_name === "string" && r.full_name ? `«${r.full_name}»` : `رقم ${i + 1}`;
      need(typeof r.full_name === "string" && r.full_name.trim() !== "", `التلميذ رقم ${i + 1}: بلا اسم.`);
      need(classes.has(r.class_id as string), `التلميذ ${who}: يشير إلى قسم ليس في الملف.`);
      need(optText(r.note), `التلميذ ${who}: ملاحظة غير صالحة.`);
      need(Array.isArray(r.tags) && r.tags.every((t) => typeof t === "string"), `التلميذ ${who}: حالات غير صالحة.`);
      need(r.group_id === null || (groups.has(r.group_id as string) && groupClass.get(r.group_id as string) === r.class_id),
        `التلميذ ${who}: فوجه ليس من قسمه.`);
    });

    const codes = (t: "criteria" | "components", what: string) => {
      const set = new Set<string>();
      rows(t).forEach((r, i) => {
        need(typeof r.code === "string" && r.code.trim() !== "", `${what} رقم ${i + 1}: بلا كود.`);
        need(!set.has(r.code as string), `${what} «${str(r.code)}»: كود مكرّر.`);
        need(typeof r.label === "string", `${what} «${str(r.code)}»: بلا اسم.`);
        set.add(r.code as string);
      });
    };
    codes("criteria", "المعيار");
    codes("components", "المركّبة");
    rows("criteria").forEach((r) => {
      need(KINDS.includes(r.kind as CriterionKind), `المعيار «${str(r.code)}»: نوع غير معروف.`);
      need(finite(r.base) && r.base >= 0, `المعيار «${str(r.code)}»: نقطة انطلاق غير صالحة.`);
      need(finite(r.ceiling) && r.ceiling > 0, `المعيار «${str(r.code)}»: سقف غير صالح.`);
    });
    rows("components").forEach((r) => {
      need(finite(r.weight) && r.weight >= 0, `المركّبة «${str(r.code)}»: معامل غير صالح.`);
      need(typeof r.active === "boolean", `المركّبة «${str(r.code)}»: حالة غير صالحة.`);
    });

    const recordKeys = new Set<string>();
    rows("records").forEach((r, i) => {
      need(students.has(r.student_id as string), `العلامات رقم ${i + 1}: لتلميذ ليس في الملف.`);
      need(term(r.term), `العلامات رقم ${i + 1}: فصل غير صالح.`);
      const key = `${r.student_id}:${r.term}`;
      need(!recordKeys.has(key), `العلامات رقم ${i + 1}: مكرّرة للتلميذ والفصل نفسيهما.`);
      recordKeys.add(key);
      need(isObj(r.criteria) && Object.values(r.criteria).every(finite),
        `العلامات رقم ${i + 1}: قيم معايير غير صالحة.`);
      for (const f of ["tp", "devoir", "exam"]) {
        need(mark20(r[f]), `العلامات رقم ${i + 1}: ${f} خارج 0 إلى 20.`);
      }
    });
    rows("readings").forEach((r, i) => {
      need(students.has(r.student_id as string), `محاولة القراءة رقم ${i + 1}: لتلميذ ليس في الملف.`);
      need(term(r.term), `محاولة القراءة رقم ${i + 1}: فصل غير صالح.`);
      need(finite(r.score) && r.score >= 0, `محاولة القراءة رقم ${i + 1}: نقطة غير صالحة.`);
      need(typeof r.read_on === "string" && DATE.test(r.read_on), `محاولة القراءة رقم ${i + 1}: تاريخ غير صالح.`);
      need(r.note === undefined || optText(r.note), `محاولة القراءة رقم ${i + 1}: ملاحظة غير صالحة.`);
      need(r.criterion_code === undefined || (typeof r.criterion_code === "string" && r.criterion_code.length > 0 && r.criterion_code.length <= 40),
        `محاولة القراءة رقم ${i + 1}: معيار غير صالح.`);
    });
    rows("tp_sessions").forEach((r, i) => {
      need(classes.has(r.class_id as string), `حصة الأعمال التطبيقية رقم ${i + 1}: لقسم ليس في الملف.`);
      need(r.group_id === null || (groups.has(r.group_id as string) && groupClass.get(r.group_id as string) === r.class_id),
        `حصة الأعمال التطبيقية رقم ${i + 1}: فوجها ليس من قسمها.`);
      need(term(r.term), `حصة الأعمال التطبيقية رقم ${i + 1}: فصل غير صالح.`);
      need(typeof r.held_on === "string" && DATE.test(r.held_on), `حصة الأعمال التطبيقية رقم ${i + 1}: تاريخ غير صالح.`);
      need(optText(r.title), `حصة الأعمال التطبيقية رقم ${i + 1}: عنوان غير صالح.`);
    });
    const markKeys = new Set<string>();
    rows("tp_marks").forEach((r, i) => {
      need(sessions.has(r.session_id as string), `علامة حصة رقم ${i + 1}: لحصة ليست في الملف.`);
      need(students.has(r.student_id as string), `علامة حصة رقم ${i + 1}: لتلميذ ليس في الملف.`);
      const key = `${r.session_id}:${r.student_id}`;
      need(!markKeys.has(key), `علامة حصة رقم ${i + 1}: مكرّرة.`);
      markKeys.add(key);
      need(typeof r.absent === "boolean" && mark20(r.score), `علامة حصة رقم ${i + 1}: قيمة غير صالحة.`);
      need(!r.absent || r.score === null, `علامة حصة رقم ${i + 1}: غائب وله علامة.`);
    });

    const rawPending = Array.isArray(raw.pending) ? raw.pending : [];
    const pending = rawPending.filter(validOp) as Op[];
    const t = raw.teacher as Loose;
    const backup: Backup = {
      format: BACKUP_FORMAT,
      version: raw.version as number,
      exported_at: raw.exported_at as string,
      source: raw.source,
      teacher: {
        id: str(t.id),
        email: str(t.email),
        full_name: str(t.full_name),
        subject: strOrNull(t.subject),
        school_name: strOrNull(t.school_name),
      },
      data: normalizeData(d as Partial<Record<keyof BackupData, Loose[]>>),
      pending,
    };
    return { ok: true, backup, droppedPending: rawPending.length - pending.length };
  } catch (problem) {
    if (problem instanceof Bad) return { ok: false, problem: problem.message };
    return { ok: false, problem: "تعذّرت قراءة الملف." };
  }
}

/** عملية طابور سليمة البنية؟ ما لا يعرفه هذا الإصدار يُترك ولا يُخمَّن. */
function validOp(v: unknown): boolean {
  if (!isObj(v) || typeof v.id !== "string" || !finite(v.at)) return false;
  const id = (x: unknown) => typeof x === "string" && UUID.test(x);
  switch (v.kind) {
    case "record":
      return id(v.student_id) && term(v.term) && isObj(v.criteria) &&
        Object.values(v.criteria).every(finite) && mark20(v.tp) && mark20(v.devoir) && mark20(v.exam);
    case "reading-add":
      return isObj(v.reading) && id(v.reading.id) && id(v.reading.student_id) &&
        term(v.reading.term) && finite(v.reading.score) && typeof v.reading.read_on === "string";
    case "reading-del":
      return id(v.reading_id) && id(v.student_id);
    case "student":
      return id(v.student_id) && isObj(v.patch);
    case "tp-session":
      return isObj(v.session) && id(v.session.id) && id(v.session.class_id) &&
        (v.session.group_id === null || id(v.session.group_id)) && term(v.session.term) &&
        typeof v.session.held_on === "string";
    case "tp-mark":
      return id(v.session_id) && id(v.student_id) && mark20(v.score) && typeof v.absent === "boolean";
    default:
      return false;
  }
}

/* ---------- المعرّفات المشتقّة ---------- */

/**
 * معرّف ثابت لصفٍّ مستورد: SHA-256 لـ(الأستاذ الحالي، المعرّف الأصلي)، بصيغة
 * UUID (الإصدار 8، المخصّص). ثابتٌ فلا يتكرّر الاستيراد، وخاصٌّ بالأستاذ
 * فلا يصطدم ملفّ حسابٍ آخر بصفوف صاحبه.
 */
export async function deriveId(teacherId: string, originalId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`taqwim-import:${teacherId}:${originalId}`);
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)).slice(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x80;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* ---------- خطة الاستيراد ---------- */

/** ما في الحساب الآن، مقروءًا من الخادم قبل الاستيراد. المعايير والمركّبات بمعرّفاتها للاستبدال. */
export type CurrentState = {
  teacherId: string;
  profile: { full_name: string; subject: string | null; school_name: string | null };
  data: Omit<BackupData, "criteria" | "components"> & {
    criteria: Array<BCriterion & { id: string }>;
    components: Array<BComponent & { id: string }>;
  };
};

export type Conflict<T> = { key: string; label: string; current: T; incoming: T; id?: string };

export type ImportPlan = {
  /** المعرّف في الملف ← المعرّف في الحساب (هو نفسه إن كان موجودًا). */
  idMap: Map<string, string>;
  insert: BackupData;
  /** ما في الملف وموجود في الحساب بمحتواه نفسه أو بمعرّفه: يُترك. */
  kept: Record<"schools" | "classes" | "class_groups" | "students" | "readings" | "tp_sessions" | "criteria" | "components" | "records" | "tp_marks", number>;
  conflicts: {
    criteria: Conflict<BCriterion>[];
    components: Conflict<BComponent>[];
    records: Conflict<BRecord>[];
    tp_marks: Conflict<BTpMark>[];
  };
  /** حقول بيانات الأستاذ الفارغة في الحساب، تُملأ من الملف. لا يُستبدل حقل مملوء. */
  profileFill: Partial<CurrentState["profile"]>;
  /** العمليات المعلّقة بعد ترجمة معرّفاتها، جاهزة لإعادة الإدخال في الطابور. */
  pending: Op[];
  /** عمليات معلّقة تشير إلى ما ليس في الملف ولا في الحساب: لا تُعاد. */
  pendingOrphans: number;
  /** الملف صُدِّر من حساب آخر. */
  foreign: boolean;
};

const sameNum = (a: number | null, b: number | null) =>
  a === b || (a !== null && b !== null && Math.abs(a - b) < 1e-9);

export function sameRecord(a: BRecord, b: BRecord): boolean {
  const keys = new Set([...Object.keys(a.criteria), ...Object.keys(b.criteria)]);
  for (const k of keys) if (!sameNum(a.criteria[k] ?? null, b.criteria[k] ?? null)) return false;
  return sameNum(a.tp, b.tp) && sameNum(a.devoir, b.devoir) && sameNum(a.exam, b.exam);
}

export function sameTpMark(a: BTpMark, b: BTpMark): boolean {
  return a.absent === b.absent && sameNum(a.score, b.score);
}

function sameCriterion(a: BCriterion, b: BCriterion): boolean {
  return a.label === b.label && a.kind === b.kind && sameNum(a.base, b.base) && sameNum(a.ceiling, b.ceiling);
}

function sameComponent(a: BComponent, b: BComponent): boolean {
  return a.label === b.label && a.active === b.active && sameNum(a.weight, b.weight);
}

/** كل معرّف يظهر في الملف، بياناتٍ وطابورًا. */
function allIds(backup: Backup): string[] {
  const d = backup.data;
  const out = new Set<string>();
  for (const r of [...d.schools, ...d.classes, ...d.class_groups, ...d.students, ...d.readings, ...d.tp_sessions]) {
    out.add(r.id);
  }
  for (const op of backup.pending) {
    if (op.kind === "reading-add") out.add(op.reading.id);
    if (op.kind === "reading-del") out.add(op.reading_id);
    if (op.kind === "tp-session") out.add(op.session.id);
  }
  return [...out];
}

export async function planImport(backup: Backup, current: CurrentState): Promise<ImportPlan> {
  const d = backup.data;
  const cur = current.data;
  const existing = new Set<string>([
    ...cur.schools.map((r) => r.id),
    ...cur.classes.map((r) => r.id),
    ...cur.class_groups.map((r) => r.id),
    ...cur.students.map((r) => r.id),
    ...cur.readings.map((r) => r.id),
    ...cur.tp_sessions.map((r) => r.id),
  ]);

  // المعرّف الأصلي إن كان في الحساب، وإلا المشتق. وإن وُجد المشتق نفسه فذلك
  // استيراد سابق للملف نفسه: يُعدّ موجودًا.
  const idMap = new Map<string, string>();
  for (const id of allIds(backup)) {
    idMap.set(id, existing.has(id) ? id : await deriveId(current.teacherId, id));
  }
  const map = (id: string) => idMap.get(id) ?? id;
  const mapOpt = (id: string | null) => (id === null ? null : map(id));

  const insert: BackupData = { ...EMPTY_DATA };
  const kept: ImportPlan["kept"] = {
    schools: 0, classes: 0, class_groups: 0, students: 0, readings: 0,
    tp_sessions: 0, criteria: 0, components: 0, records: 0, tp_marks: 0,
  };

  function byId<T extends { id: string }>(
    table: "schools" | "classes" | "class_groups" | "students" | "readings" | "tp_sessions",
    rows: T[],
    remap: (row: T) => T,
  ): T[] {
    const out: T[] = [];
    for (const row of rows) {
      if (existing.has(map(row.id))) kept[table]++;
      else out.push(remap({ ...row, id: map(row.id) }));
    }
    return out;
  }

  insert.schools = byId("schools", d.schools, (r) => r);
  insert.classes = byId("classes", d.classes, (r) => ({ ...r, school_id: mapOpt(r.school_id) }));
  insert.class_groups = byId("class_groups", d.class_groups, (r) => ({ ...r, class_id: map(r.class_id) }));
  insert.students = byId("students", d.students, (r) => ({
    ...r,
    class_id: map(r.class_id),
    group_id: mapOpt(r.group_id),
  }));
  insert.readings = byId("readings", d.readings, (r) => ({ ...r, student_id: map(r.student_id) }));
  insert.tp_sessions = byId("tp_sessions", d.tp_sessions, (r) => ({
    ...r,
    class_id: map(r.class_id),
    group_id: mapOpt(r.group_id),
  }));

  const conflicts: ImportPlan["conflicts"] = { criteria: [], components: [], records: [], tp_marks: [] };

  const curCriteria = new Map(cur.criteria.map((c) => [c.code, c]));
  insert.criteria = [];
  for (const c of d.criteria) {
    const have = curCriteria.get(c.code);
    if (!have) insert.criteria.push(c);
    else if (sameCriterion(have, c)) kept.criteria++;
    else conflicts.criteria.push({ key: c.code, label: have.label, current: have, incoming: c, id: have.id });
  }
  const curComponents = new Map(cur.components.map((c) => [c.code, c]));
  insert.components = [];
  for (const c of d.components) {
    const have = curComponents.get(c.code);
    if (!have) insert.components.push(c);
    else if (sameComponent(have, c)) kept.components++;
    else conflicts.components.push({ key: c.code, label: have.label, current: have, incoming: c, id: have.id });
  }

  const nameOf = new Map(d.students.map((s) => [map(s.id), s.full_name]));
  const curRecords = new Map(cur.records.map((r) => [`${r.student_id}:${r.term}`, r]));
  insert.records = [];
  for (const r of d.records) {
    const row = { ...r, student_id: map(r.student_id) };
    const key = `${row.student_id}:${row.term}`;
    const have = curRecords.get(key);
    if (!have) insert.records.push(row);
    else if (sameRecord(have, row)) kept.records++;
    else
      conflicts.records.push({
        key,
        label: `${nameOf.get(row.student_id) ?? "تلميذ"} — الفصل ${row.term}`,
        current: have,
        incoming: row,
      });
  }
  const curMarks = new Map(cur.tp_marks.map((m) => [`${m.session_id}:${m.student_id}`, m]));
  insert.tp_marks = [];
  for (const m of d.tp_marks) {
    const row = { ...m, session_id: map(m.session_id), student_id: map(m.student_id) };
    const key = `${row.session_id}:${row.student_id}`;
    const have = curMarks.get(key);
    if (!have) insert.tp_marks.push(row);
    else if (sameTpMark(have, row)) kept.tp_marks++;
    else
      conflicts.tp_marks.push({
        key,
        label: `${nameOf.get(row.student_id) ?? "تلميذ"} — حصة أعمال تطبيقية`,
        current: have,
        incoming: row,
      });
  }

  const profileFill: ImportPlan["profileFill"] = {};
  if (!current.profile.full_name.trim() && backup.teacher.full_name.trim()) {
    profileFill.full_name = backup.teacher.full_name;
  }
  if (!current.profile.subject && backup.teacher.subject) profileFill.subject = backup.teacher.subject;
  if (!current.profile.school_name && backup.teacher.school_name) {
    profileFill.school_name = backup.teacher.school_name;
  }

  // العمليات المعلّقة: تُعاد إن عُرف كل ما تشير إليه (في الحساب أو في الملف)
  const known = new Set<string>([...existing, ...idMap.values()]);
  const remapped: Op[] = [];
  let orphans = 0;
  for (const op of backup.pending) {
    const next = remapOp(op, map);
    if (next && opRefs(next).every((id) => known.has(id))) remapped.push(next);
    else orphans++;
  }

  return {
    idMap,
    insert,
    kept,
    conflicts,
    profileFill,
    pending: remapped,
    pendingOrphans: orphans,
    foreign: backup.teacher.id !== current.teacherId,
  };
}

/** المعرّفات التي تشير إليها العملية (لا معرّفها هي). */
function opRefs(op: Op): string[] {
  switch (op.kind) {
    case "record":
    case "student":
      return [op.student_id];
    case "reading-add":
      return [op.reading.id, op.reading.student_id];
    case "reading-del":
      return [op.reading_id, op.student_id];
    case "tp-session":
      return [op.session.id, op.session.class_id, ...(op.session.group_id ? [op.session.group_id] : [])];
    case "tp-mark":
      return [op.session_id, op.student_id];
    default:
      return [];
  }
}

/** العملية بمعرّفات الحساب الحالي، نظيفةً من حالة المحاولات. */
export function remapOp(op: Op, map: (id: string) => string): Op | null {
  const fresh = { tries: 0, error: null, blocked: false, nextTry: 0 };
  switch (op.kind) {
    case "record":
      return { ...op, ...fresh, student_id: map(op.student_id) };
    case "student":
      return { ...op, ...fresh, student_id: map(op.student_id) };
    case "reading-add":
      return {
        ...op,
        ...fresh,
        reading: { ...op.reading, id: map(op.reading.id), student_id: map(op.reading.student_id) },
      };
    case "reading-del":
      return { ...op, ...fresh, reading_id: map(op.reading_id), student_id: map(op.student_id) };
    case "tp-session":
      return {
        ...op,
        ...fresh,
        session: {
          ...op.session,
          id: map(op.session.id),
          class_id: map(op.session.class_id),
          group_id: op.session.group_id === null ? null : map(op.session.group_id),
        },
      };
    case "tp-mark":
      return { ...op, ...fresh, session_id: map(op.session_id), student_id: map(op.student_id) };
    default:
      return null;
  }
}

/** عدد ما سيُكتب، لعرضه قبل الموافقة. */
export function planSize(plan: ImportPlan): number {
  const i = plan.insert;
  return (
    i.schools.length + i.classes.length + i.class_groups.length + i.students.length +
    i.criteria.length + i.components.length + i.records.length + i.readings.length +
    i.tp_sessions.length + i.tp_marks.length
  );
}

export function conflictCount(plan: ImportPlan): { settings: number; marks: number } {
  return {
    settings: plan.conflicts.criteria.length + plan.conflicts.components.length,
    marks: plan.conflicts.records.length + plan.conflicts.tp_marks.length,
  };
}

/* ---------- قراءة صفوف الحساب والكتابة فيه ---------- */

/** الجداول التي يمسّها الاستيراد، بترتيب الكتابة: الأب قبل الابن. */
export const WRITE_ORDER = [
  "schools", "classes", "class_groups", "students", "criteria",
  "components", "records", "readings", "tp_sessions", "tp_marks",
] as const;
export type Table = (typeof WRITE_ORDER)[number] | "teachers";

export const COLUMNS: Record<Table, string> = {
  schools: "id,name,position",
  classes: "id,name,position,school_id,tp_target,level,stream,school_year",
  class_groups: "id,class_id,name,position",
  students: "id,class_id,full_name,position,note,tags,group_id,is_active",
  criteria: "id,code,label,kind,base,ceiling,position",
  components: "id,code,label,weight,position,active",
  records: "student_id,term,criteria,tp,devoir,exam",
  readings: "id,student_id,term,score,read_on,note,criterion_code",
  tp_sessions: "id,class_id,group_id,term,held_on,title",
  tp_marks: "session_id,student_id,score,absent",
  teachers: "full_name,subject,school_name",
};

/**
 * ما يحتاجه الاستيراد من القاعدة. الصفوف تمرّ بحساب الأستاذ الحالي وحده
 * (RLS)، ومحوّل Supabase في backupDb.ts، ومحوّل في الذاكرة للاختبارات.
 * كل دالة ترمي خطأً عند الفشل.
 */
export type Db = {
  selectAll(table: Table): Promise<Loose[]>;
  insert(table: Table, rows: Loose[]): Promise<void>;
  upsert(table: Table, rows: Loose[], onConflict: string): Promise<void>;
  update(table: Table, match: Loose, patch: Loose): Promise<void>;
};

export async function readAccount(db: Db): Promise<{ data: BackupData; profile: CurrentState["profile"]; criteria: CurrentState["data"]["criteria"]; components: CurrentState["data"]["components"] }> {
  const raw: Partial<Record<keyof BackupData, Loose[]>> = {};
  for (const t of WRITE_ORDER) raw[t] = await db.selectAll(t);
  const me = (await db.selectAll("teachers"))[0] ?? {};
  const data = normalizeData(raw);
  const withId = <T>(rows: Loose[] | undefined, normalized: T[]) =>
    normalized.map((row, i) => ({ ...row, id: str(rows?.[i]?.id) }));
  return {
    data,
    profile: {
      full_name: str(me.full_name),
      subject: strOrNull(me.subject),
      school_name: strOrNull(me.school_name),
    },
    criteria: withId(raw.criteria, data.criteria),
    components: withId(raw.components, data.components),
  };
}

export async function currentState(db: Db, teacherId: string): Promise<CurrentState> {
  const a = await readAccount(db);
  return {
    teacherId,
    profile: a.profile,
    data: { ...a.data, criteria: a.criteria, components: a.components },
  };
}

export type ImportOptions = {
  /** استبدال إعدادات المعايير والمركّبات المختلفة بما في الملف. */
  replaceSettings: boolean;
  /** استبدال العلامات المختلفة بعلامات الملف. */
  replaceMarks: boolean;
};

export type ImportResult = { ok: true; written: number } | { ok: false; written: number; problem: string };

const CHUNK = 200;

/**
 * تنفيذ الخطة. بالترتيب، على دفعات. إن فشلت دفعةٌ توقّف ما بعدها وقيل كم
 * كُتب: إعادة الاستيراد بعدها آمنة، لأن ما كُتب يُعرف بمعرّفه فيُترك.
 */
export async function applyImport(
  db: Db,
  plan: ImportPlan,
  teacherId: string,
  options: ImportOptions,
): Promise<ImportResult> {
  let written = 0;
  const own = (rows: object[]) => rows.map((r) => ({ ...r, teacher_id: teacherId }));
  try {
    for (const table of WRITE_ORDER) {
      let rows = plan.insert[table] as object[];
      if (table === "classes") {
        // school_year إلزامي في القاعدة وله قيمة افتراضية؛ ملف الجهاز لا يحمله،
        // فيُترك للقاعدة بدل null يرفضها القيد.
        rows = (rows as BClass[]).map(({ school_year, ...rest }) =>
          school_year === null ? rest : { ...rest, school_year },
        );
      }
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = own(rows.slice(i, i + CHUNK));
        await db.insert(table, chunk);
        written += chunk.length;
      }
    }
    if (options.replaceSettings) {
      for (const c of plan.conflicts.criteria) {
        const { label, kind, base, ceiling } = c.incoming;
        await db.update("criteria", { id: c.id }, { label, kind, base, ceiling });
        written++;
      }
      for (const c of plan.conflicts.components) {
        const { label, weight, active } = c.incoming;
        await db.update("components", { id: c.id }, { label, weight, active });
        written++;
      }
    }
    if (options.replaceMarks) {
      const recs = own(plan.conflicts.records.map((c) => c.incoming));
      for (let i = 0; i < recs.length; i += CHUNK) {
        await db.upsert("records", recs.slice(i, i + CHUNK), "student_id,term");
      }
      written += recs.length;
      const marks = own(plan.conflicts.tp_marks.map((c) => c.incoming));
      for (let i = 0; i < marks.length; i += CHUNK) {
        await db.upsert("tp_marks", marks.slice(i, i + CHUNK), "session_id,student_id");
      }
      written += marks.length;
    }
    if (Object.keys(plan.profileFill).length) {
      await db.update("teachers", { id: teacherId }, plan.profileFill);
    }
    return { ok: true, written };
  } catch (problem) {
    return {
      ok: false,
      written,
      problem: problem instanceof Error ? problem.message : "تعذّرت الكتابة في الخادم",
    };
  }
}

/**
 * التحقّق بعد الاستيراد: يُقرأ الحساب من جديد، ويُطابَق كل ما كُتب بمحتواه
 * (لا بعدده). المعرّفات والعلاقات والعلامات بقيمها. وما لم يُطابَق يُذكر.
 */
export async function verifyImport(
  db: Db,
  plan: ImportPlan,
  options: ImportOptions,
): Promise<{ ok: boolean; checked: number; problems: string[] }> {
  const after = await readAccount(db);
  const d = after.data;
  const problems: string[] = [];
  let checked = 0;

  const index = <T>(rows: T[], key: (r: T) => string) => new Map(rows.map((r) => [key(r), r]));
  const eq = (a: unknown, b: unknown) => stable(a) === stable(b);

  const byId: Array<[keyof BackupData, string]> = [
    ["schools", "مؤسسة"], ["classes", "قسم"], ["class_groups", "فوج"],
    ["students", "تلميذ"], ["readings", "محاولة قراءة"], ["tp_sessions", "حصة"],
  ];
  for (const [table, what] of byId) {
    const have = index(d[table] as Array<{ id: string }>, (r) => r.id);
    for (const row of plan.insert[table] as Array<{ id: string }>) {
      checked++;
      const got = have.get(row.id);
      if (!got) problems.push(`${what} لم يُكتب (${row.id.slice(0, 8)})`);
      else if (!eq(pickComparable(table, got), pickComparable(table, row))) {
        problems.push(`${what} كُتب بقيم مختلفة (${row.id.slice(0, 8)})`);
      }
    }
  }

  const crit = index(d.criteria, (c) => c.code);
  const wantCriteria = [
    ...plan.insert.criteria,
    ...(options.replaceSettings ? plan.conflicts.criteria.map((c) => c.incoming) : []),
  ];
  for (const c of wantCriteria) {
    checked++;
    const got = crit.get(c.code);
    if (!got || !sameCriterion(got, c)) problems.push(`المعيار «${c.label}» لا يطابق الملف`);
  }
  const comp = index(d.components, (c) => c.code);
  const wantComponents = [
    ...plan.insert.components,
    ...(options.replaceSettings ? plan.conflicts.components.map((c) => c.incoming) : []),
  ];
  for (const c of wantComponents) {
    checked++;
    const got = comp.get(c.code);
    if (!got || !sameComponent(got, c)) problems.push(`المركّبة «${c.label}» لا تطابق الملف`);
  }

  const recs = index(d.records, (r) => `${r.student_id}:${r.term}`);
  const wantRecords = [
    ...plan.insert.records,
    ...(options.replaceMarks ? plan.conflicts.records.map((c) => c.incoming) : []),
  ];
  for (const r of wantRecords) {
    checked++;
    const got = recs.get(`${r.student_id}:${r.term}`);
    if (!got || !sameRecord(got, r)) problems.push(`علامات تلميذ في الفصل ${r.term} لا تطابق الملف`);
  }
  const marks = index(d.tp_marks, (m) => `${m.session_id}:${m.student_id}`);
  const wantMarks = [
    ...plan.insert.tp_marks,
    ...(options.replaceMarks ? plan.conflicts.tp_marks.map((c) => c.incoming) : []),
  ];
  for (const m of wantMarks) {
    checked++;
    const got = marks.get(`${m.session_id}:${m.student_id}`);
    if (!got || !sameTpMark(got, m)) problems.push("علامة حصة أعمال تطبيقية لا تطابق الملف");
  }

  return { ok: problems.length === 0, checked, problems };
}

/** حقول الصف التي تُطابَق بعد الكتابة (المعرّف والعلاقات والقيم). */
function pickComparable(table: keyof BackupData, row: object): unknown {
  const r = row as Loose;
  switch (table) {
    case "schools":
      return [r.id, r.name];
    case "classes":
      return [r.id, r.name, r.school_id, r.tp_target];
    case "class_groups":
      return [r.id, r.class_id, r.name];
    case "students":
      return [r.id, r.class_id, r.full_name, r.group_id, r.note, r.tags];
    case "readings":
      return [r.id, r.student_id, r.term, Number(r.score), r.read_on, r.criterion_code ?? DEFAULT_READING_CODE];
    case "tp_sessions":
      return [r.id, r.class_id, r.group_id, r.term, r.held_on, r.title];
    default:
      return r;
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Loose)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Loose)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/* ---------- معدّلات الملف: للمطابقة ولملف Excel ---------- */

/**
 * معدّل كل تلميذ في كل فصل، بالحساب نفسه الذي تعرضه الشاشة (معدّل الحصص
 * يحلّ محل خانته ثم المعيار فالمعدل). مفتاحه «معرّف التلميذ:الفصل».
 * يستعمله Excel، وتستعمله الاختبارات لتثبت أن الاستعادة لا تغيّر معدلًا.
 */
export function averagesOf(data: BackupData): Map<string, { cc: number | null; avg: number | null; values: Record<string, number | null> }> {
  const out = new Map<string, { cc: number | null; avg: number | null; values: Record<string, number | null> }>();
  const targetOf = new Map(data.classes.map((k) => [k.id, k.tp_target]));
  const criteria = data.criteria.map((c, i) => ({ ...c, id: `c${i}` }));
  const components = data.components.map((c, i) => ({ ...c, id: `k${i}` }));
  for (const t of [1, 2, 3]) {
    const tp = tpAverages(data.tp_marks, data.tp_sessions, t);
    const recordOf = new Map(data.records.filter((r) => r.term === t).map((r) => [r.student_id, r]));
    for (const s of data.students) {
      const reads = data.readings.filter((r) => r.term === t && r.student_id === s.id) as Reading[];
      const record = applyTpTarget(recordOf.get(s.id), s.id, t, tp.get(s.id) ?? null, targetOf.get(s.class_id) ?? null, criteria);
      const values = componentValues(criteria, record, reads);
      const touched = !!recordOf.get(s.id) || reads.length > 0 || tp.has(s.id);
      if (!touched) continue;
      out.set(`${s.id}:${t}`, { cc: values.cc, avg: termAverage(components, values), values });
    }
  }
  return out;
}

export type SheetRows = { name: string; rows: Array<Array<string | number>> };

const SHEET_BAD = /[\[\]:*?/\\]/g;

/**
 * محتوى ملف Excel المقروء: ورقة تعريف، وورقة لكل قسم فيها المركّبات والمعدل
 * لكل فصل فيه علامات. ليس للاستعادة (لذلك ملف JSON)، بل لقراءة العمل دون
 * التطبيق. الحالات الخاصة والملاحظات ليست فيه: هي للأستاذ وحده، وExcel أسهل
 * ما يُطبع ويُرسل.
 */
export function backupSheets(backup: Backup, groupName: (g: BGroup, index: number) => string): SheetRows[] {
  const d = backup.data;
  const averages = averagesOf(d);
  const round = (v: number | null | undefined) =>
    v === null || v === undefined || !Number.isFinite(v) ? "" : Math.round(v * 100) / 100;
  const used = new Set<string>();
  const sheetName = (raw: string) => {
    const base = (raw.replace(SHEET_BAD, " ").trim() || "قسم").slice(0, 28);
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base} ${n}`.slice(0, 31);
    used.add(name);
    return name;
  };

  const readme: SheetRows = {
    name: sheetName("اقرأني"),
    rows: [
      ["دفتر التقويم المستمر — نسختي"],
      ["تاريخ التصدير", backup.exported_at.slice(0, 16).replace("T", " ")],
      ["الأستاذ", backup.teacher.full_name || backup.teacher.email],
      ["المصدر", backup.source === "server" ? "الخادم" : "نسخة الجهاز (دون اتصال)"],
      ["الأقسام", d.classes.length],
      ["التلاميذ", d.students.length],
      [],
      ["هذا الملف للقراءة فقط. لاستعادة عملك استعمل ملف JSON المصاحب: الإعدادات ← حسابي ← نسختي ← استيراد."],
      ["الحالات الخاصة وملاحظات التلاميذ ليست في هذا الملف، وهي محفوظة في ملف JSON."],
    ],
  };
  if (backup.pending.length) {
    readme.rows.push([`فيه ${backup.pending.length} عملية لم تصل الخادم بعد: محفوظة في ملف JSON وحده.`]);
  }

  const components = [...d.components].sort((a, b) => a.position - b.position).filter((c) => c.active);
  const sheets: SheetRows[] = [readme];
  for (const klass of [...d.classes].sort((a, b) => a.position - b.position)) {
    const students = d.students
      .filter((s) => s.class_id === klass.id)
      .sort((a, b) => a.position - b.position);
    const groups = d.class_groups
      .filter((g) => g.class_id === klass.id)
      .sort((a, b) => a.position - b.position);
    const groupLabel = new Map(groups.map((g, i) => [g.id, groupName(g, i)]));
    const terms = [1, 2, 3].filter((t) => students.some((s) => averages.has(`${s.id}:${t}`)));

    const head: Array<string | number> = ["الرقم", "الاسم واللقب"];
    if (groups.length) head.push("الفوج");
    for (const t of terms) {
      for (const c of components) head.push(`${c.label} ف${t}`);
      head.push(`المعدل ف${t}`);
    }
    const rows: Array<Array<string | number>> = [head];
    students.forEach((s, i) => {
      const row: Array<string | number> = [i + 1, s.full_name];
      if (groups.length) row.push(s.group_id ? groupLabel.get(s.group_id) ?? "" : "");
      for (const t of terms) {
        const a = averages.get(`${s.id}:${t}`);
        for (const c of components) row.push(round(a?.values[c.code]));
        row.push(round(a?.avg));
      }
      rows.push(row);
    });
    sheets.push({ name: sheetName(klass.name), rows });
  }
  return sheets;
}
