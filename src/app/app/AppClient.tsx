"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  checkTotal,
  clamp,
  classStats,
  componentValues,
  continuousMark,
  fmt,
  grade,
  optionsFor,
  pickForSession,
  readingAverage,
  stepFor,
  termAverage,
  type Component,
  type Criterion,
  type MarkField,
  type Reading,
  type RecordRow,
} from "@/lib/scoring";

type Klass = { id: string; name: string; position: number };
type Student = {
  id: string;
  class_id: string;
  full_name: string;
  position: number;
  /** حالات جاهزة تُختار بنقرة. لا تدخل أي حساب. */
  tags: string[];
  /** ملاحظة حرة لما لا تغطّيه الحالات الجاهزة. لا تدخل أي حساب. */
  note: string | null;
};

/**
 * الحالات الجاهزة: صيغت بما يفيد الأستاذ في الحصة (ما يفعله)، لا بتوصيف
 * التلميذ. فـ«يحتاج مقدّمة القسم» إجراء عملي يغطّي أسبابًا كثيرة دون أن
 * يُسجّل عن التلميذ ما ليس من شأن دفتر التنقيط.
 */
const STATE_TAGS = [
  "غياب متكرر",
  "يحتاج مقدّمة القسم",
  "لا يملك الكتاب",
  "متابعة من الولي",
  "قليل المشاركة",
  "يحتاج تشجيعًا",
];
type Tab = "classes" | "session" | "stats" | "settings";

export default function AppClient({ email }: { email: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [tab, setTab] = useState<Tab>("classes");
  const [term, setTerm] = useState(1);
  const [classes, setClasses] = useState<Klass[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openClass, setOpenClass] = useState<string | null>(null);
  const [openStudent, setOpenStudent] = useState<Student | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Klass | null>(null);
  const [confirmCriterion, setConfirmCriterion] = useState<Criterion | null>(null);
  const [confirmStudent, setConfirmStudent] = useState<Student | null>(null);
  const [toast, setToast] = useState("");

  const say = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

  const load = useCallback(async () => {
    const [c, s, cr, cp, r, rd] = await Promise.all([
      supabase.from("classes").select("id,name,position").order("position"),
      supabase.from("students").select("id,class_id,full_name,position,note,tags").order("position"),
      supabase.from("criteria").select("id,code,label,kind,base,ceiling,position").order("position"),
      supabase.from("components").select("id,code,label,weight,position,active").order("position"),
      supabase.from("records").select("student_id,term,criteria,tp,devoir,exam"),
      supabase.from("readings").select("id,student_id,term,score,read_on").order("read_on"),
    ]);
    const failure =
      c.error ?? s.error ?? cr.error ?? cp.error ?? r.error ?? rd.error ?? null;
    if (failure) {
      setError(failure.message);
    } else {
      setError("");
      setClasses((c.data ?? []) as Klass[]);
      setStudents((s.data ?? []) as Student[]);
      setCriteria((cr.data ?? []) as Criterion[]);
      setComponents((cp.data ?? []) as Component[]);
      setRecords((r.data ?? []) as RecordRow[]);
      setReadings((rd.data ?? []) as Reading[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------- derived ---------- */
  const studentsOf = useCallback(
    (classId: string) => students.filter((s) => s.class_id === classId),
    [students],
  );
  const recordOf = useCallback(
    (studentId: string) => records.find((r) => r.student_id === studentId && r.term === term),
    [records, term],
  );
  const readingsOf = useCallback(
    (studentId: string) => readings.filter((r) => r.student_id === studentId && r.term === term),
    [readings, term],
  );
  const averageOf = useCallback(
    (studentId: string) =>
      termAverage(
        components,
        componentValues(criteria, recordOf(studentId), readingsOf(studentId)),
      ),
    [components, criteria, recordOf, readingsOf],
  );
  const statsOf = useCallback(
    (classId: string) => {
      const list = studentsOf(classId);
      const unread = list.filter((s) => readingsOf(s.id).length === 0).length;
      return classStats(list.map((s) => averageOf(s.id)), unread);
    },
    [studentsOf, readingsOf, averageOf],
  );

  /* ---------- writes ---------- */
  async function saveRecord(studentId: string, patch: Partial<RecordRow>) {
    const current = recordOf(studentId);
    const next: RecordRow = {
      student_id: studentId,
      term,
      criteria: { ...(current?.criteria ?? {}) },
      tp: current?.tp ?? null,
      devoir: current?.devoir ?? null,
      exam: current?.exam ?? null,
      ...patch,
    };
    setRecords((rows) => {
      const rest = rows.filter((r) => !(r.student_id === studentId && r.term === term));
      return [...rest, next];
    });
    const { data: me } = await supabase.auth.getUser();
    const { error } = await supabase.from("records").upsert(
      {
        teacher_id: me.user?.id,
        student_id: studentId,
        term,
        criteria: next.criteria,
        tp: next.tp,
        devoir: next.devoir,
        exam: next.exam,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id,term" },
    );
    if (error) {
      say("تعذّر الحفظ، أعد المحاولة");
      void load();
    }
  }

  async function setCriterion(studentId: string, code: string, value: number | null) {
    const current = recordOf(studentId);
    const map = { ...(current?.criteria ?? {}) };
    if (value === null) delete map[code];
    else map[code] = value;
    await saveRecord(studentId, { criteria: map });
  }

  async function addReadings(entries: Array<{ studentId: string; score: number }>) {
    const { data: me } = await supabase.auth.getUser();
    const today = new Date().toISOString().slice(0, 10);
    const rows = entries.map((e) => ({
      teacher_id: me.user?.id,
      student_id: e.studentId,
      term,
      score: e.score,
      read_on: today,
    }));
    const { data, error } = await supabase.from("readings").insert(rows).select("id,student_id,term,score,read_on");
    if (error) {
      say("تعذّر حفظ المحاولات");
      return false;
    }
    setReadings((rs) => [...rs, ...((data ?? []) as Reading[])]);
    say(`سُجّلت ${entries.length} محاولة`);
    return true;
  }

  async function removeReading(id: string) {
    setReadings((rs) => rs.filter((r) => r.id !== id));
    const { error } = await supabase.from("readings").delete().eq("id", id);
    if (error) {
      say("تعذّر الحذف");
      void load();
    }
  }

  /**
   * تعديل معيار. القيمة الابتدائية تُشتق من النوع ولا تُطلب من الأستاذ:
   * معيار الخصم يبدأ من العلامة الكاملة (base = ceiling) فيُحسب دائمًا ولو لم
   * يُخصم منه شيء، ومعيار الإضافة يبدأ من صفر فيخرج من الحساب حتى يُنقَّط.
   */
  async function updateCriterion(id: string, patch: Partial<Criterion>) {
    const before = criteria.find((c) => c.id === id);
    if (!before) return;
    const next: Criterion = { ...before, ...patch };
    if (next.kind === "deduct") next.base = Number(next.ceiling);
    else if (next.kind === "add" || next.kind === "auto") next.base = 0;

    // معيار قراءة واحد فقط: لو عُيّن معيار آخر للقراءة صار متوسط المحاولات
    // محسوبًا مرتين في النقطة نفسها.
    const demoted =
      next.kind === "auto"
        ? criteria.filter((c) => c.id !== id && c.kind === "auto")
        : [];

    setCriteria((cs) =>
      cs.map((c) =>
        c.id === id
          ? next
          : demoted.some((d) => d.id === c.id)
            ? { ...c, kind: "add" as const, base: 0 }
            : c,
      ),
    );

    const { error } = await supabase
      .from("criteria")
      .update({
        label: next.label,
        kind: next.kind,
        base: next.base,
        ceiling: next.ceiling,
        position: next.position,
      })
      .eq("id", id);

    for (const d of demoted) {
      await supabase.from("criteria").update({ kind: "add", base: 0 }).eq("id", d.id);
    }

    if (error) {
      say("تعذّر حفظ المعيار");
      void load();
      return;
    }
    if (demoted.length) {
      say(`${demoted[0].label}: صار معيارًا يدويًا`);
      return;
    }
    // تغيير النوع يغيّر معنى العلامات المسجَّلة: ما كان إضافةً صار خصمًا.
    if (patch.kind && patch.kind !== before.kind) {
      const marked = records.filter(
        (r) => typeof r.criteria?.[before.code] === "number",
      ).length;
      if (marked) {
        say(`تنبيه: ${marked} علامة مسجَّلة في هذا المعيار صار معناها مختلفًا`);
      }
    }
  }

  async function addCriterion() {
    const { data: me } = await supabase.auth.getUser();
    // كود داخلي ثابت لا يراه الأستاذ: علامات التلاميذ محفوظة به، فلو ربطناه
    // بالتسمية لضاعت العلامات عند أول تغيير للاسم.
    const code = `c${Math.random().toString(36).slice(2, 10)}`;
    const row = {
      teacher_id: me.user?.id,
      code,
      label: "معيار جديد",
      kind: "add" as const,
      base: 0,
      ceiling: 4,
      position: criteria.length + 1,
    };
    const { data, error } = await supabase
      .from("criteria")
      .insert(row)
      .select("id,code,label,kind,base,ceiling,position")
      .single();
    if (error || !data) {
      say("تعذّر إضافة المعيار");
      return;
    }
    setCriteria((cs) => [...cs, data as Criterion]);
    say("أُضيف معيار — سمِّه واضبط سقفه");
  }

  async function deleteCriterion(c: Criterion) {
    setCriteria((cs) => cs.filter((x) => x.id !== c.id));
    setConfirmCriterion(null);
    const { error } = await supabase.from("criteria").delete().eq("id", c.id);
    if (error) {
      say("تعذّر الحذف");
      void load();
      return;
    }
    say(`حُذف معيار ${c.label}`);
  }

  async function saveComponent(id: string, patch: Partial<Component>) {
    setComponents((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const { error } = await supabase.from("components").update(patch).eq("id", id);
    if (error) {
      say("تعذّر حفظ المركّبة");
      void load();
    }
  }

  async function updateStudent(id: string, patch: Partial<Student>) {
    setStudents((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setOpenStudent((s) => (s && s.id === id ? { ...s, ...patch } : s));
    const { error } = await supabase.from("students").update(patch).eq("id", id);
    if (error) {
      say("تعذّر الحفظ");
      void load();
    }
  }

  async function deleteStudent(student: Student) {
    // العلامات والمحاولات تُحذف معه بـ on delete cascade، فالتأكيد ضروري.
    setStudents((ss) => ss.filter((s) => s.id !== student.id));
    setConfirmStudent(null);
    setOpenStudent(null);
    const { error } = await supabase.from("students").delete().eq("id", student.id);
    if (error) {
      say("تعذّر الحذف");
      void load();
      return;
    }
    setRecords((rs) => rs.filter((r) => r.student_id !== student.id));
    setReadings((rs) => rs.filter((r) => r.student_id !== student.id));
    say(`حُذف ${student.full_name}`);
  }

  async function createClassWithStudents(name: string, names: string[]) {
    const { data: me } = await supabase.auth.getUser();
    const teacherId = me.user?.id;
    const { data: created, error } = await supabase
      .from("classes")
      .insert({ teacher_id: teacherId, name, position: classes.length + 1 })
      .select("id,name,position")
      .single();
    if (error || !created) {
      say("تعذّر إنشاء القسم");
      return;
    }
    const rows = names.map((full_name, i) => ({
      teacher_id: teacherId,
      class_id: created.id,
      full_name,
      position: i + 1,
    }));
    const { error: se } = await supabase.from("students").insert(rows);
    if (se) {
      say("أُنشئ القسم لكن تعذّر إدراج الأسماء");
    } else {
      say(`أُضيف القسم: ${names.length} تلميذًا`);
    }
    await load();
    setOpenClass(created.id);
    setTab("classes");
  }

  async function deleteClass(klass: Klass) {
    const { error } = await supabase.from("classes").delete().eq("id", klass.id);
    if (error) {
      say("تعذّر الحذف");
      return;
    }
    setConfirmDelete(null);
    setOpenClass(null);
    say("حُذف القسم");
    await load();
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  /* ---------- render ---------- */
  return (
    <div className="shell">
      <header className="gut">
        <div className="hwrap wrap">
          <div className="brand">
            دفتر <span>التقويم</span>
          </div>
          <div className="hspace" />
          <div className="terms" role="group" aria-label="الفصل">
            {[1, 2, 3].map((t) => (
              <button key={t} aria-pressed={term === t} onClick={() => setTerm(t)}>
                ف{t}
              </button>
            ))}
          </div>
          <ThemeButton />
        </div>
      </header>

      <main className="gut">
        <div className="wrap">
          {error && (
            <div className="note bad" style={{ marginBottom: 14 }}>
              تعذّر الوصول إلى البيانات: {error}
            </div>
          )}

          {tab === "classes" &&
            (openClass ? (
              <ClassView
                klass={classes.find((c) => c.id === openClass)!}
                students={studentsOf(openClass)}
                term={term}
                averageOf={averageOf}
                readingCount={(id) => readingsOf(id).length}
                stats={statsOf(openClass)}
                onBack={() => setOpenClass(null)}
                onPick={setOpenStudent}
                onDelete={() => setConfirmDelete(classes.find((c) => c.id === openClass)!)}
              />
            ) : (
              <ClassesView
                loading={loading}
                classes={classes}
                studentCount={students.length}
                statsOf={statsOf}
                onOpen={setOpenClass}
                onImport={() => setImporting(true)}
              />
            ))}

          {tab === "session" && (
            <SessionView
              classes={classes}
              studentsOf={studentsOf}
              attemptsOf={(id) => readingsOf(id).length}
              term={term}
              reading={criteria.find((c) => c.kind === "auto")}
              onSave={addReadings}
            />
          )}

          {tab === "stats" && (
            <StatsView classes={classes} statsOf={statsOf} term={term} />
          )}

          {tab === "settings" && (
            <SettingsView
              criteria={criteria}
              components={components}
              email={email}
              onCriterion={updateCriterion}
              onAddCriterion={addCriterion}
              onDeleteCriterion={setConfirmCriterion}
              onComponent={saveComponent}
              onImport={() => setImporting(true)}
              onSignOut={signOut}
            />
          )}
        </div>
      </main>

      <Tabs
        tab={tab}
        onChange={(t) => {
          setTab(t);
          if (t === "classes") setOpenClass(null);
        }}
      />

      {openStudent && (
        <StudentSheet
          student={openStudent}
          criteria={criteria}
          record={recordOf(openStudent.id)}
          readings={readingsOf(openStudent.id)}
          components={components}
          onClose={() => setOpenStudent(null)}
          onCriterion={(code, value) => setCriterion(openStudent.id, code, value)}
          onMark={(field, value) => saveRecord(openStudent.id, { [field]: value } as Partial<RecordRow>)}
          onRemoveReading={removeReading}
          onEdit={(patch) => updateStudent(openStudent.id, patch)}
          onDelete={() => setConfirmStudent(openStudent)}
        />
      )}

      {importing && (
        <ImportSheet
          onClose={() => setImporting(false)}
          onCreate={async (name, names) => {
            setImporting(false);
            await createClassWithStudents(name, names);
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmSheet
          klass={confirmDelete}
          count={studentsOf(confirmDelete.id).length}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deleteClass(confirmDelete)}
        />
      )}

      {confirmCriterion && (
        <ConfirmCriterionSheet
          criterion={confirmCriterion}
          onCancel={() => setConfirmCriterion(null)}
          onConfirm={() => deleteCriterion(confirmCriterion)}
        />
      )}

      {confirmStudent && (
        <ConfirmStudentSheet
          student={confirmStudent}
          marks={records.filter((r) => r.student_id === confirmStudent.id).length}
          reads={readings.filter((r) => r.student_id === confirmStudent.id).length}
          onCancel={() => setConfirmStudent(null)}
          onConfirm={() => deleteStudent(confirmStudent)}
        />
      )}

      {toast && (
        <div className="toast">
          <div>{toast}</div>
        </div>
      )}
    </div>
  );
}

/* ================= views ================= */

function ClassesView({
  loading, classes, studentCount, statsOf, onOpen, onImport,
}: {
  loading: boolean;
  classes: Klass[];
  studentCount: number;
  statsOf: (id: string) => ReturnType<typeof classStats>;
  onOpen: (id: string) => void;
  onImport: () => void;
}) {
  return (
    <section className="view">
      <div className="vhead">
        <div>
          <h2>أقسامي</h2>
          {classes.length > 0 && (
            <p>{studentCount} تلميذًا في {classes.length} أقسام</p>
          )}
        </div>
        <div className="hspace" />
        <button className="btn soft" onClick={onImport}>+ قسم</button>
      </div>

      {loading ? (
        <div className="card empty">
          <h3>جارٍ تحميل أقسامك…</h3>
        </div>
      ) : classes.length === 0 ? (
        <div className="card empty">
          <h3>لا أقسام بعد</h3>
          <p>ارفع ملف الإشراف التربوي (xlsx) فيُنشأ القسم بأسماء تلاميذه، أو الصق الأسماء سطرًا لكل تلميذ.</p>
          <button className="btn" onClick={onImport}>استيراد قائمة</button>
        </div>
      ) : (
        <div className="grid">
          {classes.map((klass) => {
            const st = statsOf(klass.id);
            const covered = st.total - st.unread;
            return (
              <button key={klass.id} className="card clscard" onClick={() => onOpen(klass.id)}>
                <div className="top">
                  <h3>{klass.name}</h3>
                  <span className="pill">{st.total} تلميذًا</span>
                </div>
                <div className="statrow">
                  <Stat value={fmt(st.mean)} label="معدل القسم" />
                  <Stat value={`${st.scored}/${st.total}`} label="منقَّطون" />
                  <Stat value={`${covered}/${st.total}`} label="قُرئ لهم" />
                </div>
                <div className="bar">
                  <i style={{ width: `${st.total ? Math.round((covered / st.total) * 100) : 0}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** سطر الحالة الخاصة كما يظهر تحت الاسم: الحالات الجاهزة ثم الملاحظة الحرة. */
function state(student: Student): string {
  return [...(student.tags ?? []), student.note ?? ""]
    .filter((part) => part.trim() !== "")
    .join(" · ");
}

function ClassView({
  klass, students, term, averageOf, readingCount, stats, onBack, onPick, onDelete,
}: {
  klass: Klass;
  students: Student[];
  term: number;
  averageOf: (id: string) => number | null;
  readingCount: (id: string) => number;
  stats: ReturnType<typeof classStats>;
  onBack: () => void;
  onPick: (s: Student) => void;
  onDelete: () => void;
}) {
  const rows = students.map((s) => ({ student: s, average: averageOf(s.id) }));
  const ranked = [...rows]
    .filter((r) => r.average !== null)
    .sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
  const rank = new Map(ranked.map((r, i) => [r.student.id, i + 1]));

  return (
    <section className="view">
      <div className="vhead">
        <button className="icbtn" onClick={onBack} aria-label="رجوع">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <div>
          <h2>{klass.name}</h2>
          <p>الفصل {term} · معدل القسم {fmt(stats.mean)}</p>
        </div>
      </div>

      {students.length === 0 ? (
        <div className="card empty">
          <h3>القسم بلا تلاميذ</h3>
          <p>استورد قائمة الأسماء من تبويب الأقسام.</p>
        </div>
      ) : (
        <div className="slist">
          {rows.map(({ student, average }) => (
            <button key={student.id} className="srow" onClick={() => onPick(student)}>
              <span className="rank num">{average === null ? "–" : rank.get(student.id)}</span>
              <span className="sname">
                {student.full_name}
                {state(student) && (
                  <small className="nbadge" title={state(student)}>{state(student)}</small>
                )}
              </span>
              <span className="sreads">{readingCount(student.id) ? `${readingCount(student.id)}×` : ""}</span>
              <span className={`savg num${average === null ? " none" : average < 10 ? " low" : ""}`}>
                {fmt(average)}
              </span>
              <span className="gradecell">{grade(average)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="pickbar">
        <button className="btn warn" onClick={onDelete}>حذف القسم</button>
      </div>
    </section>
  );
}

function SessionView({
  classes, studentsOf, attemptsOf, term, reading, onSave,
}: {
  classes: Klass[];
  studentsOf: (id: string) => Student[];
  attemptsOf: (id: string) => number;
  term: number;
  /** معيار القراءة المحسوب تلقائيًا، إن أبقاه الأستاذ في معاييره. */
  reading: Criterion | undefined;
  onSave: (entries: Array<{ studentId: string; score: number }>) => Promise<boolean>;
}) {
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [count, setCount] = useState(5);
  const [picked, setPicked] = useState<Student[]>([]);
  const [scores, setScores] = useState<Record<string, number | "skip">>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!classId && classes.length) setClassId(classes[0].id);
  }, [classes, classId]);

  if (!classes.length) {
    return (
      <section className="view">
        <div className="vhead">
          <div>
            <h2>محاولات الحصة</h2>
          </div>
        </div>
        <div className="card empty">
          <h3>لا أقسام بعد</h3>
          <p>استورد قسمًا أولًا من تبويب الأقسام.</p>
        </div>
      </section>
    );
  }

  const list = studentsOf(classId);
  const unread = list.filter((s) => attemptsOf(s.id) === 0).length;
  const chosen = picked.filter((s) => typeof scores[s.id] === "number").length;
  // سلّم التنقيط من سقف معيار القراءة نفسه، فلو رفعه الأستاذ إلى 6 ظهرت 6.
  const scale = reading ? optionsFor({ ...reading, kind: "add" }) : [0, 1, 2, 3, 4];

  return (
    <section className="view">
      <div className="vhead">
        <div>
          <h2>محاولات الحصة</h2>
          <p>الأقل محاولات أولًا، والاختيار عشوائي بين المتساوين.</p>
        </div>
      </div>

      <div className="pickbar">
        <select
          id="session-class"
          value={classId}
          onChange={(e) => {
            setClassId(e.target.value);
            setPicked([]);
            setScores({});
          }}
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select id="session-count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
          {[3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <button
          className="btn"
          onClick={() => {
            setPicked(pickForSession(list, attemptsOf, count));
            setScores({});
          }}
        >
          اختر {count}
        </button>
      </div>

      <div className="note">
        لم تُقرأ لهم بعد: {unread} من {list.length} · الفصل {term}
      </div>

      {!reading && (
        <div className="note warn">
          لا معيار قراءة في إعداداتك، فالمحاولات تُسجَّل ولا تدخل التقويم
          المستمر. أضف معيارًا من الإعدادات إن أردت أن تُحسب.
        </div>
      )}

      {picked.length === 0 ? (
        <div className="card empty">
          <h3>جاهز للحصة</h3>
          <p>اضغط «اختر» فتظهر أسماء هذه الحصة، ثم انقر نقطة كل تلميذ واحفظ.</p>
        </div>
      ) : (
        <>
          {picked.map((student) => (
            <div key={student.id} className="card pcard">
              <div className="pn">
                <b>{student.full_name}</b>
                <span className="pill">
                  {attemptsOf(student.id) ? `${attemptsOf(student.id)} محاولات` : "أول محاولة"}
                </span>
              </div>
              <div className="scorerow">
                {scale.map((n) => (
                  <button
                    key={n}
                    aria-pressed={scores[student.id] === n}
                    onClick={() => setScores((s) => ({ ...s, [student.id]: n }))}
                  >
                    {n}
                  </button>
                ))}
                <button
                  className="skip"
                  aria-pressed={scores[student.id] === "skip"}
                  onClick={() => setScores((s) => ({ ...s, [student.id]: "skip" }))}
                >
                  غائب
                </button>
              </div>
            </div>
          ))}
          <button
            className="btn"
            disabled={!chosen || saving}
            onClick={async () => {
              setSaving(true);
              const entries = picked
                .filter((s) => typeof scores[s.id] === "number")
                .map((s) => ({ studentId: s.id, score: scores[s.id] as number }));
              const ok = await onSave(entries);
              setSaving(false);
              if (ok) {
                setPicked([]);
                setScores({});
              }
            }}
          >
            {saving ? "جارٍ الحفظ…" : `حفظ ${chosen} محاولة`}
          </button>
        </>
      )}
    </section>
  );
}

const BINS: Array<[number, number, string]> = [
  [0, 5, "أقل من 5"], [5, 8, "5 – 8"], [8, 10, "8 – 10"], [10, 12, "10 – 12"],
  [12, 14, "12 – 14"], [14, 16, "14 – 16"], [16, 20.01, "16 – 20"],
];

function StatsView({
  classes, statsOf, term,
}: {
  classes: Klass[];
  statsOf: (id: string) => ReturnType<typeof classStats>;
  term: number;
}) {
  return (
    <section className="view">
      <div className="vhead">
        <div>
          <h2>الإحصاء</h2>
          <p>الفصل {term}</p>
        </div>
      </div>
      {classes.length === 0 ? (
        <div className="card empty">
          <h3>لا بيانات</h3>
          <p>استورد قسمًا أولًا.</p>
        </div>
      ) : (
        classes.map((klass) => {
          const st = statsOf(klass.id);
          const counts = BINS.map(([lo, hi]) => st.values.filter((v) => v >= lo && v < hi).length);
          const peak = Math.max(1, ...counts);
          return (
            <div key={klass.id} className="card">
              <div className="srow2">
                <div className="k">
                  <b>{klass.name}</b>
                  <small>{st.scored} منقَّطًا من {st.total}</small>
                </div>
                <span className="pill">{st.mean === null ? "—" : `${fmt(st.mean)} / 20`}</span>
              </div>
              {st.scored > 0 && (
                <>
                  <div className="kpis">
                    <Kpi value={fmt(st.median)} label="الوسيط" />
                    <Kpi value={fmt(st.sd)} label="الانحراف" />
                    <Kpi value={fmt(st.max)} label="أعلى" />
                    <Kpi value={fmt(st.min)} label="أدنى" />
                    <Kpi value={st.passRate === null ? "—" : `${Math.round(st.passRate * 100)}%`} label="فاق 10" />
                  </div>
                  <div className="dist">
                    {BINS.map(([, , label], i) => (
                      <div key={label} className="drow">
                        <span className="dl">{label}</span>
                        <span className="db">
                          <i style={{ width: `${Math.round((counts[i] / peak) * 100)}%` }} />
                        </span>
                        <span className="dn num">{counts[i]}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

const TP_PRESETS = ["الأعمال التطبيقية", "التعبير الشفوي"];

function SettingsView({
  criteria, components, email,
  onCriterion, onAddCriterion, onDeleteCriterion, onComponent, onImport, onSignOut,
}: {
  criteria: Criterion[];
  components: Component[];
  email: string;
  onCriterion: (id: string, patch: Partial<Criterion>) => void;
  onAddCriterion: () => void;
  onDeleteCriterion: (c: Criterion) => void;
  onComponent: (id: string, patch: Partial<Component>) => void;
  onImport: () => void;
  onSignOut: () => void;
}) {
  const check = checkTotal(criteria);

  return (
    <section className="view">
      <div className="vhead">
        <div>
          <h2>الإعدادات</h2>
          <p>تسري على كل الأقسام والفصول الثلاثة.</p>
        </div>
      </div>

      <div className="card">
        <div className="srow2">
          <b>معايير التقويم المستمر</b>
          <div className="hspace" />
          <span className={check.exact ? "pill ok" : "pill warn"}>
            المجموع {Number(check.total.toFixed(2))} / 20
          </span>
        </div>

        {check.warning && <div className="note warn">{check.warning}</div>}

        {criteria.map((c) => (
          <div key={c.id} className="crit">
            <div className="critop">
              <input
                className="cname"
                id={`label-${c.code}`}
                defaultValue={c.label}
                aria-label="تسمية المعيار"
                onBlur={(e) => {
                  const text = e.target.value.trim();
                  if (text && text !== c.label) onCriterion(c.id, { label: text });
                  else e.target.value = c.label;
                }}
              />
              <label className="cceil">
                <span>السقف</span>
                <input
                  id={`ceiling-${c.code}`}
                  type="number"
                  min={0.5}
                  max={20}
                  step={0.5}
                  defaultValue={Number(c.ceiling)}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (value > 0 && value <= 20) onCriterion(c.id, { ceiling: value });
                    else e.target.value = String(Number(c.ceiling));
                  }}
                />
              </label>
              <button
                className="icbtn danger"
                aria-label={`حذف ${c.label}`}
                onClick={() => onDeleteCriterion(c)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                </svg>
              </button>
            </div>

            <div className="kinds" role="group" aria-label="نقطة الانطلاق">
              <button
                aria-pressed={c.kind === "deduct"}
                onClick={() => onCriterion(c.id, { kind: "deduct" })}
              >
                يبدأ كاملًا ({Number(c.ceiling)}) ويُخصم منه
              </button>
              <button
                aria-pressed={c.kind === "add"}
                onClick={() => onCriterion(c.id, { kind: "add" })}
              >
                يبدأ من 0 ويُضاف إليه
              </button>
              <button
                aria-pressed={c.kind === "auto"}
                onClick={() => onCriterion(c.id, { kind: "auto" })}
              >
                من محاولات القراءة
              </button>
            </div>
            <small className="chint">
              {c.kind === "deduct"
                ? "يُحسب لكل تلميذ دائمًا: الخانة الفارغة تعني العلامة الكاملة."
                : c.kind === "auto"
                  ? "نقطة محسوبة من متوسط محاولات القراءة، لا تُدخلها بيدك."
                  : "لا يُحسب حتى تُنقّطه: الخانة الفارغة تخرج من القسمة ولا تُحسب صفرًا."}
            </small>
          </div>
        ))}

        <button className="btn soft full" onClick={onAddCriterion}>+ معيار</button>
      </div>

      <div className="card">
        <div className="srow2">
          <b>مركّبات معدل المادة</b>
        </div>
        <div className="note">
          المركّبة المطفأة تخرج من القسمة تمامًا، وكذلك غير المنقَّطة.
        </div>

        {components.map((c) => {
          const fixed = c.code === "cc";
          return (
            <div key={c.id} className={c.active || fixed ? "crit" : "crit off"}>
              <div className="critop">
                {fixed ? (
                  <div className="k" style={{ flex: 1 }}>
                    {c.label}
                    <small>محصّلة المعايير أعلاه</small>
                  </div>
                ) : (
                  <input
                    className="cname"
                    id={`clabel-${c.code}`}
                    defaultValue={c.label}
                    aria-label="تسمية المركّبة"
                    onBlur={(e) => {
                      const text = e.target.value.trim();
                      if (text && text !== c.label) onComponent(c.id, { label: text });
                      else e.target.value = c.label;
                    }}
                  />
                )}
                <label className="cceil">
                  <span>المعامل</span>
                  <input
                    id={`weight-${c.code}`}
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    defaultValue={Number(c.weight)}
                    disabled={!c.active && !fixed}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (value >= 0 && value <= 10) onComponent(c.id, { weight: value });
                      else e.target.value = String(Number(c.weight));
                    }}
                  />
                </label>
                {!fixed && (
                  <button
                    className={c.active ? "sw on" : "sw"}
                    role="switch"
                    aria-checked={c.active}
                    aria-label={`${c.label}: ${c.active ? "مفعّلة" : "مطفأة"}`}
                    onClick={() => onComponent(c.id, { active: !c.active })}
                  >
                    <i />
                  </button>
                )}
              </div>
              {c.code === "tp" && c.active && (
                <div className="kinds" role="group" aria-label="تسمية سريعة">
                  {TP_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      aria-pressed={c.label === preset}
                      onClick={() => onComponent(c.id, { label: preset })}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              )}
              {!fixed && !c.active && (
                <small className="chint">مطفأة: لا تظهر للتلاميذ ولا تدخل المعدل.</small>
              )}
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="srow2">
          <div className="k">
            استيراد قسم
            <small>ملف الإشراف التربوي أو لصق الأسماء</small>
          </div>
          <button className="btn soft" onClick={onImport}>استيراد</button>
        </div>
        <div className="srow2">
          <div className="k">
            الحساب
            <small dir="ltr" style={{ textAlign: "start" }}>{email}</small>
          </div>
          <button className="btn ghost" onClick={onSignOut}>خروج</button>
        </div>
      </div>
    </section>
  );
}

/**
 * عدّاد معيار واحد: ناقص وزائد ورقم بينهما يقول أين وصلت علامة التلميذ.
 *
 * الفرق بين «صفر» و«لم يُقيَّم» محفوظ لأن الحساب كله يقوم عليه:
 * - معيار الخصم يبدأ من العلامة الكاملة ويُحسب دائمًا، فالعدّاد يبدأ ممتلئًا.
 * - معيار الإضافة يبدأ غير مقيَّم فيظهر «—» ويخرج من القسمة؛ أول ضغطة على
 *   زائد تجعله مقيَّمًا. و«مسح» يعيده إلى غير مقيَّم، لا إلى صفر.
 */
function CriterionCounter({
  criterion, record, onChange,
}: {
  criterion: Criterion;
  record: RecordRow | undefined;
  onChange: (value: number | null) => void;
}) {
  const ceiling = Number(criterion.ceiling);
  const base = Number(criterion.base);
  const step = stepFor(criterion);
  const isDeduct = criterion.kind === "deduct";

  const stored = record?.criteria?.[criterion.code];
  const value = typeof stored === "number" ? stored : null;
  const assessed = value !== null;

  const shown = isDeduct
    ? clamp(base + (value ?? 0), 0, ceiling)
    : assessed
      ? clamp(value, 0, ceiling)
      : null;

  function bump(delta: number) {
    if (isDeduct) {
      const next = clamp((shown ?? ceiling) + delta, 0, ceiling);
      onChange(Number((next - base).toFixed(2)));
      return;
    }
    if (!assessed && delta < 0) return;
    const next = clamp((shown ?? 0) + delta, 0, ceiling);
    onChange(Number(next.toFixed(2)));
  }

  // عند الصفر لا ينزل أكثر: «مسح» هو طريق الرجوع إلى «لم يُقيَّم».
  const atFloor = isDeduct ? shown === 0 : !assessed || shown === 0;
  const atRoof = (shown ?? 0) >= ceiling && (isDeduct || assessed);

  return (
    <div className="fld">
      <div className="flab">
        <b>{criterion.label}</b>
        <small>
          {isDeduct
            ? "يبدأ كاملًا ويُخصم منه"
            : assessed
              ? "مقيَّم"
              : "لم يُقيَّم — خارج الحساب"}
        </small>
      </div>
      <div className="counter">
        <button
          className="cbtn"
          onClick={() => bump(-step)}
          disabled={atFloor}
          aria-label={`أنقص ${step}`}
        >
          −
        </button>
        <span className="cval">
          <b className="num">{shown === null ? "—" : fmt(shown, shown % 1 ? 1 : 0)}</b>
          <i className="num">/ {ceiling}</i>
        </span>
        <button
          className="cbtn"
          onClick={() => bump(step)}
          disabled={atRoof}
          aria-label={`أضف ${step}`}
        >
          +
        </button>
        <div className="hspace" />
        {assessed && (
          <button className="clearb" onClick={() => onChange(null)}>مسح</button>
        )}
      </div>
    </div>
  );
}

function ConfirmStudentSheet({
  student, marks, reads, onCancel, onConfirm,
}: {
  student: Student;
  marks: number;
  reads: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const has = marks > 0 || reads > 0;
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="sheet">
        <div className="shead">
          <h3>حذف {student.full_name}</h3>
        </div>
        <p className="lead">
          {has
            ? `معه ${marks} سجل علامات و${reads} محاولة قراءة، وتُحذف معه في الفصول الثلاثة. لا رجعة في هذا.`
            : "ليست معه علامات مسجَّلة. يُحذف من القسم في الفصول الثلاثة."}
        </p>
        <div className="srow2">
          <button className="btn ghost" onClick={onCancel}>تراجع</button>
          <div className="hspace" />
          <button className="btn danger" onClick={onConfirm}>احذف التلميذ</button>
        </div>
      </div>
    </>
  );
}

function ConfirmCriterionSheet({
  criterion, onCancel, onConfirm,
}: {
  criterion: Criterion;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="sheet">
        <div className="shead">
          <h3>حذف معيار {criterion.label}</h3>
        </div>
        <p className="lead">
          سيخرج من التقويم المستمر في كل الأقسام والفصول، وتُستبعد العلامات
          المسجَّلة فيه من الحساب. بقية المعايير تبقى كما هي.
        </p>
        <div className="srow2">
          <button className="btn ghost" onClick={onCancel}>تراجع</button>
          <div className="hspace" />
          <button className="btn danger" onClick={onConfirm}>احذف المعيار</button>
        </div>
      </div>
    </>
  );
}

/* ================= sheets ================= */

function StudentSheet({
  student, criteria, record, readings, components,
  onClose, onCriterion, onMark, onRemoveReading, onEdit, onDelete,
}: {
  student: Student;
  criteria: Criterion[];
  record: RecordRow | undefined;
  readings: Reading[];
  components: Component[];
  onClose: () => void;
  onCriterion: (code: string, value: number | null) => void;
  onMark: (field: MarkField, value: number | null) => void;
  onRemoveReading: (id: string) => void;
  onEdit: (patch: Partial<Student>) => void;
  onDelete: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const tags = student.tags ?? [];
  const cc = continuousMark(criteria, record, readings);
  const average = termAverage(components, componentValues(criteria, record, readings));
  const ccLabel = components.find((c) => c.code === "cc")?.label ?? "التقويم المستمر";
  // لا تُعرض إلا المركّبات المفعّلة: المطفأة خارجة من المعدل، فعرض خانة لها
  // يعني أن يُنقّط الأستاذ نقطة لا تُحسب.
  const marks = components.filter((c) => c.code !== "cc" && c.active);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>{student.full_name}</h3>
          <button
            className={edit ? "icbtn on" : "icbtn"}
            aria-pressed={edit}
            onClick={() => setEdit(!edit)}
            aria-label="تعديل بيانات التلميذ"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4" />
            </svg>
          </button>
          <button className="icbtn" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {edit ? (
          <div className="fld">
            <label className="elab" htmlFor={`name-${student.id}`}>الاسم واللقب</label>
            <input
              className="cname"
              id={`name-${student.id}`}
              defaultValue={student.full_name}
              onBlur={(e) => {
                const text = e.target.value.trim();
                if (text && text !== student.full_name) onEdit({ full_name: text });
                else e.target.value = student.full_name;
              }}
            />
            <button className="btn warn full" onClick={onDelete}>حذف التلميذ من القسم</button>
          </div>
        ) : null}

        <div className="fld">
          <label className="elab" htmlFor={`note-${student.id}`}>
            حالة خاصة
            <small>لك وحدك، لتتذكّرها. لا تدخل أي حساب ولا تظهر في المعدلات.</small>
          </label>
          <div className="chips tagrow">
            {STATE_TAGS.map((tag) => {
              const on = tags.includes(tag);
              return (
                <button
                  key={tag}
                  aria-pressed={on}
                  onClick={() =>
                    onEdit({
                      tags: on ? tags.filter((t) => t !== tag) : [...tags, tag],
                    })
                  }
                >
                  {tag}
                </button>
              );
            })}
          </div>
          <textarea
            className="inp note-in"
            id={`note-${student.id}`}
            rows={2}
            placeholder="أو اكتب ما لا تغطّيه الحالات أعلاه"
            defaultValue={student.note ?? ""}
            onBlur={(e) => {
              const text = e.target.value.trim();
              const next = text === "" ? null : text;
              if (next !== (student.note ?? null)) onEdit({ note: next });
            }}
          />
        </div>

        {criteria.map((c) => {
          if (c.kind === "auto") {
            const avg = readingAverage(readings);
            return (
              <div key={c.id} className="fld">
                <div className="flab">
                  <b>{c.label}</b>
                  <small>{readings.length} محاولة</small>
                  <i>{avg === null ? "—" : `${fmt(avg)} / ${c.ceiling}`}</i>
                </div>
                <div className="readlog">
                  {readings.length === 0 ? (
                    <span style={{ fontSize: 11, color: "var(--faint)" }}>لا محاولات بعد</span>
                  ) : (
                    readings.map((r) => (
                      <button key={r.id} title="انقر للحذف" onClick={() => onRemoveReading(r.id)}>
                        {r.score} · {r.read_on.slice(5)}
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          }
          return (
            <CriterionCounter
              key={c.id}
              criterion={c}
              record={record}
              onChange={(value) => onCriterion(c.code, value)}
            />
          );
        })}

        {marks.map((component) => {
          const field = component.code as MarkField;
          return (
            <div key={component.id} className="fld">
              <div className="flab">
                <b>{component.label}</b>
                <small>من 0 إلى 20 · معامل {Number(component.weight)}</small>
              </div>
              <div className="mk">
                <input
                  id={`mark-${field}`}
                  type="number"
                  min={0}
                  max={20}
                  step={0.25}
                  defaultValue={record?.[field] ?? ""}
                  onBlur={(e) => {
                    const text = e.target.value.trim();
                    if (text === "") return onMark(field, null);
                    const value = Number(text);
                    if (Number.isNaN(value) || value < 0 || value > 20) {
                      e.target.value = String(record?.[field] ?? "");
                      return;
                    }
                    onMark(field, value);
                  }}
                />
              </div>
            </div>
          );
        })}

        <div className="totals">
          <Stat value={fmt(cc)} label={ccLabel} />
          <Stat value={fmt(average)} label="معدل المادة" />
          <Stat value={grade(average) || "—"} label="التقدير" />
        </div>
      </div>
    </>
  );
}

function ImportSheet({
  onClose, onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, names: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState("لم يُختر ملف بعد.");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function readFile(file: File) {
    setStatus("جارٍ القراءة…");
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer, { type: "array" });
      let best: { cls: string; names: string[] } | null = null;
      for (const sheetName of book.SheetNames) {
        const found = parseSupervision(XLSX, book.Sheets[sheetName]);
        if (found && (!best || found.names.length > best.names.length)) best = found;
      }
      if (!best) {
        setStatus("لم أجد قائمة أسماء في الملف.");
        return;
      }
      if (best.cls && !name) setName(best.cls);
      setText(best.names.join("\n"));
      setStatus(`وجدت ${best.names.length} اسمًا${best.cls ? ` للقسم: ${best.cls}` : ""}`);
    } catch {
      setStatus("الملف غير مقروء. جرّب لصق الأسماء.");
    }
  }

  const names = text.split("\n").map((t) => t.trim()).filter((t) => t.length > 1);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>استيراد قسم</h3>
          <button className="icbtn" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="fld">
          <div className="flab">
            <b>ملف الإشراف التربوي</b>
            <small>xlsx — يُقرأ اسم القسم والأسماء تلقائيًا</small>
          </div>
          <input
            id="import-file"
            ref={fileRef}
            className="inp"
            style={{ width: "100%" }}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </div>

        <div className="fld">
          <div className="flab">
            <b>أو الصق الأسماء</b>
            <small>سطر لكل تلميذ</small>
          </div>
          <textarea
            id="import-names"
            className="inp"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"بن عمر أمين\nالحاج موسى ابراهيم\n…"}
          />
        </div>

        <div className="fld">
          <div className="flab">
            <b>اسم القسم</b>
          </div>
          <input
            id="import-class"
            className="inp"
            style={{ width: "100%" }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: ثانية ثانوي علوم تجريبية -3-"
          />
        </div>

        <div className="note">{status}</div>

        <button
          className="btn"
          style={{ marginTop: 14 }}
          disabled={busy}
          onClick={() => {
            if (!name.trim()) return setStatus("اكتب اسم القسم.");
            if (!names.length) return setStatus("لا أسماء. ارفع ملفًا أو الصق الأسماء.");
            setBusy(true);
            onCreate(name.trim(), names);
          }}
        >
          {busy ? "جارٍ الإنشاء…" : `إنشاء القسم (${names.length} تلميذًا)`}
        </button>
      </div>
    </>
  );
}

/* ملفات الإشراف التربوي تضع القسم في I2 والأسماء في العمود C ابتداءً من السطر 7 */
function parseSupervision(
  XLSX: typeof import("xlsx"),
  sheet: import("xlsx").WorkSheet,
): { cls: string; names: string[] } | null {
  const grid = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
    header: 1,
    raw: false,
    defval: null,
  });

  let cls = "";
  for (const row of grid.slice(0, 6)) {
    for (const cell of row ?? []) {
      const text = cell == null ? "" : String(cell);
      if (text.includes("القسم") && text.includes(":")) {
        cls = text.split(":").slice(1).join(":").trim();
      }
    }
  }

  let header = -1;
  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    const row = grid[i] ?? [];
    if (row.some((cell) => cell != null && String(cell).trim() === "الرقم")) {
      header = i;
      break;
    }
  }
  if (header < 0) return null;

  const headerRow = grid[header] ?? [];
  let nameColumn = headerRow.findIndex(
    (cell) => cell != null && (String(cell).includes("الاسم") || String(cell).includes("اللقب")),
  );
  if (nameColumn < 0) nameColumn = 2;

  const names: string[] = [];
  for (let i = header + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const name = row[nameColumn] == null ? "" : String(row[nameColumn]).trim();
    const number = row[0];
    if (name && number != null && String(number).trim() !== "" && !Number.isNaN(Number(number))) {
      names.push(name);
    }
  }
  return names.length ? { cls, names } : null;
}

function ConfirmSheet({
  klass, count, onCancel, onConfirm,
}: {
  klass: Klass;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="sheet">
        <div className="shead">
          <h3>حذف {klass.name}</h3>
        </div>
        <div className="note warn" style={{ marginBlock: 14 }}>
          سيُحذف القسم و{count} تلميذًا وكل علاماتهم ومحاولاتهم في الفصول الثلاثة. لا رجوع عن هذا.
        </div>
        <div className="pickbar">
          <button className="btn ghost" onClick={onCancel}>إلغاء</button>
          <button
            className="btn warn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onConfirm();
            }}
          >
            {busy ? "جارٍ الحذف…" : "نعم، احذف"}
          </button>
        </div>
      </div>
    </>
  );
}

/* ================= bits ================= */

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="kpi">
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

const TAB_ITEMS: Array<{ key: Tab; label: string; path: string }> = [
  { key: "classes", label: "الأقسام", path: "M4 6h16M4 12h16M4 18h10" },
  { key: "session", label: "الحصة", path: "M12 4v16M4 12h16" },
  { key: "stats", label: "الإحصاء", path: "M5 19V10M12 19V5M19 19v-6" },
  { key: "settings", label: "الإعدادات", path: "M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2M18 12h2M12 4v2M12 18v2" },
];

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="tabs" role="tablist">
      <div className="inner">
        {TAB_ITEMS.map((item) => (
          <button key={item.key} aria-pressed={tab === item.key} onClick={() => onChange(item.key)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d={item.path} />
            </svg>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function ThemeButton() {
  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved) document.documentElement.setAttribute("data-theme", saved);
    } catch {
      /* private window */
    }
  }, []);

  return (
    <button
      className="icbtn"
      aria-label="تغيير المظهر"
      onClick={() => {
        const current = document.documentElement.getAttribute("data-theme");
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const next = current ? (current === "dark" ? "light" : "dark") : prefersDark ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try {
          localStorage.setItem("theme", next);
        } catch {
          /* private window */
        }
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
      </svg>
    </button>
  );
}
