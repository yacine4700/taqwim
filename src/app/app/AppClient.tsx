"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MIN_PASSWORD, changePasswordProblem, translateAuthError } from "@/lib/auth";
import { isDurable, kvDel, kvGet, kvSet } from "@/lib/localdb";
import { nameMatches } from "@/lib/names";
import { nextPositions, splitNewNames } from "@/lib/roster";
import { firstClassOf, groupBySchool, groupOf, resolveSessionClass } from "@/lib/schools";
import { assignment, cleanGroupName, shuffled, type Group } from "@/lib/groups";
import ExportSheet from "./ExportSheet";
import GroupsView from "./GroupsView";
import PrintView from "./PrintView";
import { useOutbox } from "@/lib/useOutbox";
import {
  applyReadings,
  applyRecords,
  applyStudents,
  applyTpMarks,
  applyTpSessions,
  countWord,
  newOp,
  opSessionId,
  opStudentId,
  pending,
  pendingLabel,
  uid,
  type Op,
} from "@/lib/outbox";
import {
  applyTpTarget,
  bump,
  checkTotal,
  classStats,
  componentValues,
  continuousMark,
  fmt,
  grade,
  optionsFor,
  pickForSession,
  readingAverage,
  shownValue,
  stepFor,
  targetCriterionCode,
  termAverage,
  tpAverages,
  TP_COMPONENT,
  type Component,
  type Criterion,
  type MarkField,
  type Reading,
  type RecordRow,
  type TpMark,
  type TpSession,
  type TpTarget,
} from "@/lib/scoring";

type Klass = {
  id: string;
  name: string;
  position: number;
  /** المؤسسة التي يُدرَّس فيها القسم، أو null لقسم لم يُنسب بعد. */
  school_id: string | null;
  /** أين يذهب معدّل حصص الأعمال التطبيقية: null لا ربط، أو 'component'، أو 'criterion:<code>'. */
  tp_target: TpTarget;
};
type School = { id: string; name: string; position: number };
type Student = {
  id: string;
  class_id: string;
  full_name: string;
  position: number;
  /** حالات جاهزة تُختار بنقرة. لا تدخل أي حساب. */
  tags: string[];
  /** ملاحظة حرة لما لا تغطّيه الحالات الجاهزة. لا تدخل أي حساب. */
  note: string | null;
  /** فوجه في القسم، أو null إن لم يُوزَّع. لا يدخل أي حساب. */
  group_id: string | null;
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
type Tab = "classes" | "session" | "stats" | "docs" | "settings";

/**
 * بيانات الأستاذ كما تُطبع في رأس الكشف.
 * المؤسسة ليست منها: هي صفة القسم، فالأستاذ الواحد يدرّس في ثانويتين.
 */
type Profile = { full_name: string; subject: string | null };

const NO_PROFILE: Profile = { full_name: "", subject: null };

/** نسخة الخادم كما حُفظت في الجهاز، لتفتح الشاشة بلا شبكة. */
type Snapshot = {
  classes: Klass[];
  schools: School[];
  profile: Profile;
  students: Student[];
  criteria: Criterion[];
  components: Component[];
  records: RecordRow[];
  readings: Reading[];
  /** الأفواج وحصص الأعمال التطبيقية: غائبة من نسخة أقدم من هذا الإصدار. */
  groups?: Group[];
  sessions?: TpSession[];
  tpMarks?: TpMark[];
  tpReady?: boolean;
  savedAt: number;
};

/** تاريخ اليوم بتوقيت الجهاز. ISO يعطي توقيت غرينتش، فيقدّم المحاولة يومًا قبل الفجر. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function AppClient({
  email,
  teacherId,
}: {
  email: string;
  teacherId: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [tab, setTab] = useState<Tab>("classes");
  const [term, setTerm] = useState(1);
  const [classes, setClasses] = useState<Klass[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [profile, setProfile] = useState<Profile>(NO_PROFILE);
  /* نسخة الخادم وحدها. ما يراه الأستاذ = هذه + الطابور، ويُحسب أدناه. */
  const [baseStudents, setBaseStudents] = useState<Student[]>([]);
  const [baseRecords, setBaseRecords] = useState<RecordRow[]>([]);
  const [baseReadings, setBaseReadings] = useState<Reading[]>([]);
  /* الأفواج تُدار والشبكة قائمة. الحصص وعلاماتها تمرّ بالطابور فتعمل دونها. */
  const [groups, setGroups] = useState<Group[]>([]);
  const [baseSessions, setBaseSessions] = useState<TpSession[]>([]);
  const [baseTpMarks, setBaseTpMarks] = useState<TpMark[]>([]);
  /** جداول الأفواج موجودة في القاعدة وقُرئت. إن لم تكن فالأفواج مخفيّة ولا يتأثّر غيرها. */
  const [tpReady, setTpReady] = useState(false);
  /** داخل القسم المفتوح: التلاميذ (الأصل) أو الأفواج. */
  const [classSection, setClassSection] = useState<"students" | "groups">("students");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /** وقت حفظ النسخة المعروضة إن كانت من الجهاز لا من الخادم. */
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [openClass, setOpenClass] = useState<string | null>(null);
  const [openSchool, setOpenSchool] = useState<string | null>(null);
  const [openStudentId, setOpenStudentId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  /** القسم الذي تُضاف إليه أسماء، أو null. */
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [newSchool, setNewSchool] = useState(false);
  const [printing, setPrinting] = useState<string | null>(null);
  /* اختيار تبويب الحصة يُحفظ مع بقية المكان: الأستاذ يقرأ لقسم واحد في الحصة */
  const [sessionClass, setSessionClass] = useState("");
  const [sessionCount, setSessionCount] = useState(5);
  /**
   * أسماء الحصة ونقاطها غير المحفوظة هنا لا في SessionView: التبويب يُفكّ
   * عند مغادرته، ومن غادره ليتحقّق من شيء فقد القائمة التي اختارها.
   * في الذاكرة فقط: إعادة فتح التطبيق تبدأ حصة جديدة.
   */
  const [sessionPicked, setSessionPicked] = useState<Student[]>([]);
  const [sessionScores, setSessionScores] = useState<Record<string, number | "skip">>({});
  const [hideStart, setHideStart] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Klass | null>(null);
  const [confirmCriterion, setConfirmCriterion] = useState<Criterion | null>(null);
  /** تغيير نوع معيار أو سقفه ينتظر موافقة، وعدّاد يُعيد خانات الإعدادات إلى قيمها إن رُفض. */
  const [criterionChange, setCriterionChange] = useState<
    { criterion: Criterion; patch: Partial<Criterion>; marked: number } | null
  >(null);
  const [settingsTick, setSettingsTick] = useState(0);
  const [confirmStudent, setConfirmStudent] = useState<Student | null>(null);
  const [showPending, setShowPending] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [toast, setToast] = useState("");

  const say = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

  /* ---------- الطابور: ما أُدخل ولم يصل الخادم ---------- */

  /**
   * العملية التي قبلها الخادم تنتقل إلى نسخة الخادم في اللحظة نفسها التي
   * تخرج فيها من الطابور، فلا يرتجف الرقم على الشاشة بينهما.
   */
  const onApplied = useCallback((op: Op) => {
    if (op.kind === "record") setBaseRecords((rows) => applyRecords(rows, [op]));
    else if (op.kind === "student") setBaseStudents((rows) => applyStudents(rows, [op]));
    else if (op.kind === "tp-session") setBaseSessions((rows) => applyTpSessions(rows, [op]));
    else if (op.kind === "tp-mark") setBaseTpMarks((rows) => applyTpMarks(rows, [op]));
    else setBaseReadings((rows) => applyReadings(rows, [op]));
  }, []);

  const outbox = useOutbox(supabase, teacherId, onApplied);

  /* فتح قسم يبدأ من تلاميذه دائمًا، لا من آخر شاشة تُرك عندها قسم آخر */
  useEffect(() => {
    setClassSection("students");
  }, [openClass]);
  const queue = outbox.queue;
  const waiting = useMemo(() => pending(queue), [queue]);

  const students = useMemo(() => applyStudents(baseStudents, queue), [baseStudents, queue]);
  const records = useMemo(() => applyRecords(baseRecords, queue), [baseRecords, queue]);
  const readings = useMemo(() => applyReadings(baseReadings, queue), [baseReadings, queue]);
  const sessions = useMemo(() => applyTpSessions(baseSessions, queue), [baseSessions, queue]);
  const tpMarks = useMemo(() => applyTpMarks(baseTpMarks, queue), [baseTpMarks, queue]);

  /** أقسام بلا مؤسسة: حالة لا يُفترض أن تبقى، فتُصلَح بإلزام. */
  const orphans = useMemo(
    () => classes.filter((c) => !c.school_id || !schools.some((s) => s.id === c.school_id)),
    [classes, schools],
  );

  const openStudent = useMemo(
    () => students.find((s) => s.id === openStudentId) ?? null,
    [students, openStudentId],
  );

  /** جيران التلميذ المفتوح في قسمه: للانتقال دون إغلاق البطاقة وفتح أخرى. */
  const neighbours = useMemo(() => {
    if (!openStudent) return { list: [] as Student[], index: -1 };
    const list = students.filter((s) => s.class_id === openStudent.class_id);
    return { list, index: list.findIndex((s) => s.id === openStudent.id) };
  }, [students, openStudent]);

  /**
   * خطوات البداية: ما لا يعرف الأستاذ الجديد أنه ناقص.
   * الاستيراد ظاهر في الشاشة الفارغة، لكن مجموع المعايير قد يخرج عن 20
   * وبياناته قد تغيب عن رأس الكشف وهو لا يدري إلا عند الطبع.
   */
  const startSteps = useMemo(() => {
    if (hideStart) return [];
    const steps: Array<{ key: string; label: string; hint: string; action: string; onDo: () => void }> = [];
    if (classes.length === 0) {
      steps.push({
        key: "classes",
        label: "استورد أقسامك",
        hint: "من ملف الإشراف التربوي، أو بلصق الأسماء",
        action: "استيراد",
        onDo: () => setImporting(true),
      });
    }
    if (criteria.length && !checkTotal(criteria).exact) {
      steps.push({
        key: "criteria",
        label: "راجع معاييرك",
        hint: `مجموع السقوف ${Number(checkTotal(criteria).total.toFixed(2))} لا 20`,
        action: "الإعدادات",
        onDo: () => setTab("settings"),
      });
    }
    if (!profile.full_name) {
      steps.push({
        key: "profile",
        label: "اكتب اسمك والمادة",
        hint: "يظهران في رأس الكشف المطبوع",
        action: "حسابي",
        onDo: () => setTab("settings"),
      });
    }
    return steps;
  }, [hideStart, classes, criteria, profile]);

  /** عملٌ يحتاج الخادم: إنشاء، حذف، تغيير إعدادات. التنقيط وحده يعمل دون شبكة. */
  const needsNetwork = useCallback(() => {
    if (outbox.online) return true;
    say("هذا يحتاج اتصالًا. التنقيط وحده يعمل دون شبكة.");
    return false;
  }, [outbox.online, say]);

  /* ---------- تحميل البيانات ---------- */

  const snapKey = `snapshot:${teacherId}`;
  /** وصلت نسخة من الخادم، فلا تكتب فوقها نسخة الجهاز القديمة. */
  const servedRef = useRef(false);

  const load = useCallback(async () => {
    const [c, sc, s, cr, cp, r, rd, me] = await Promise.all([
      supabase.from("classes").select("id,name,position,school_id").order("position"),
      supabase.from("schools").select("id,name,position").order("position"),
      supabase.from("students").select("id,class_id,full_name,position,note,tags").order("position"),
      supabase.from("criteria").select("id,code,label,kind,base,ceiling,position").order("position"),
      supabase.from("components").select("id,code,label,weight,position,active").order("position"),
      supabase.from("records").select("student_id,term,criteria,tp,devoir,exam"),
      supabase.from("readings").select("id,student_id,term,score,read_on").order("read_on"),
      supabase.from("teachers").select("full_name,subject").eq("id", teacherId).maybeSingle(),
    ]);
    const failure =
      c.error ?? sc.error ?? s.error ?? cr.error ?? cp.error ?? r.error ?? rd.error ?? null;
    if (failure) {
      setError(failure.message);
      setLoading(false);
      return;
    }
    servedRef.current = true;
    setError("");

    /*
     * الأفواج وحصصها تُقرأ على حدة ولا يُفشل غيابُها الباقي: إن لم تُهيَّأ
     * جداولها في القاعدة بعدُ (أو انقطع الاتصال في منتصف القراءة) يعمل
     * التطبيق كما كان، وتُخفى الأفواج بدل أن تُحجب علاماته.
     */
    const [gr, ss, tm, cg, sg] = await Promise.all([
      supabase.from("class_groups").select("id,class_id,name,position").order("position"),
      supabase.from("tp_sessions").select("id,class_id,group_id,term,held_on,title").order("held_on"),
      supabase.from("tp_marks").select("session_id,student_id,score,absent"),
      supabase.from("classes").select("id,tp_target"),
      supabase.from("students").select("id,group_id"),
    ]);
    const ready = !gr.error && !ss.error && !tm.error && !cg.error && !sg.error;
    const targetOfClass = new Map<string, TpTarget>(
      (ready ? (cg.data ?? []) : []).map((row) => [row.id as string, (row.tp_target as TpTarget) ?? null]),
    );
    const groupOfStudent = new Map<string, string | null>(
      (ready ? (sg.data ?? []) : []).map((row) => [row.id as string, (row.group_id as string | null) ?? null]),
    );

    const snapshot: Snapshot = {
      classes: ((c.data ?? []) as Array<Omit<Klass, "tp_target">>).map((k) => ({
        ...k,
        tp_target: targetOfClass.get(k.id) ?? null,
      })),
      schools: (sc.data ?? []) as School[],
      students: ((s.data ?? []) as Array<Omit<Student, "group_id">>).map((st) => ({
        ...st,
        group_id: groupOfStudent.get(st.id) ?? null,
      })),
      groups: ready ? ((gr.data ?? []) as Group[]) : [],
      sessions: ready
        ? ((ss.data ?? []) as TpSession[]).map((x) => ({ ...x, term: Number(x.term) }))
        : [],
      tpMarks: ready
        ? ((tm.data ?? []) as TpMark[]).map((x) => ({
            ...x,
            score: x.score === null ? null : Number(x.score),
          }))
        : [],
      tpReady: ready,
      criteria: (cr.data ?? []) as Criterion[],
      components: (cp.data ?? []) as Component[],
      records: (r.data ?? []) as RecordRow[],
      readings: (rd.data ?? []) as Reading[],
      profile: (me.data as Profile | null) ?? NO_PROFILE,
      savedAt: Date.now(),
    };
    setClasses(snapshot.classes);
    setSchools(snapshot.schools);
    setProfile(snapshot.profile);
    setBaseStudents(snapshot.students);
    setCriteria(snapshot.criteria);
    setComponents(snapshot.components);
    setBaseRecords(snapshot.records);
    setBaseReadings(snapshot.readings);
    setGroups(snapshot.groups ?? []);
    setBaseSessions(snapshot.sessions ?? []);
    setBaseTpMarks(snapshot.tpMarks ?? []);
    setTpReady(snapshot.tpReady ?? false);
    setCachedAt(null);
    setLoading(false);
    void kvSet(snapKey, snapshot);
  }, [supabase, snapKey, teacherId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const saved = await kvGet<Snapshot>(snapKey);
      // إن سبق الخادمُ القراءةَ من الجهاز فالأحدث هو الباقي.
      if (!alive || !saved || servedRef.current) return;
      setClasses((saved.classes ?? []).map((k) => ({ ...k, tp_target: k.tp_target ?? null })));
      setSchools(saved.schools ?? []);
      setBaseStudents((saved.students ?? []).map((st) => ({ ...st, group_id: st.group_id ?? null })));
      setCriteria(saved.criteria ?? []);
      setComponents(saved.components ?? []);
      setBaseRecords(saved.records ?? []);
      setBaseReadings(saved.readings ?? []);
      setGroups(saved.groups ?? []);
      setBaseSessions(saved.sessions ?? []);
      setBaseTpMarks(saved.tpMarks ?? []);
      setTpReady(saved.tpReady ?? false);
      setProfile(saved.profile ?? NO_PROFILE);
      setCachedAt(saved.savedAt ?? 0);
      setLoading(false);
    })();
    void load();
    return () => {
      alive = false;
    };
  }, [snapKey, load]);

  /*
   * يفتح التطبيق حيث تركه الأستاذ: التبويب والفصل والقسم المفتوح.
   * الحصة تُستأنف بعد انقطاع — رنّة، سؤال تلميذ، قفل الشاشة — والبدء من
   * قائمة الأقسام في كل مرة يعني ثلاث لمسات قبل أول علامة.
   */
  const whereKey = `where:${teacherId}`;
  const restoredRef = useRef(false);

  useEffect(() => {
    if (restoredRef.current || !classes.length) return;
    restoredRef.current = true;
    void (async () => {
      const saved = await kvGet<{
        tab: Tab;
        term: number;
        openClass: string | null;
        sessionClass?: string;
        sessionCount?: number;
        hideStart?: boolean;
        openSchool?: string | null;
      }>(whereKey);
      if (!saved) return;
      if (saved.term >= 1 && saved.term <= 3) setTerm(saved.term);
      if (saved.tab) setTab(saved.tab);
      if (saved.sessionClass && classes.some((c) => c.id === saved.sessionClass)) {
        setSessionClass(saved.sessionClass);
      }
      if (saved.sessionCount && saved.sessionCount >= 3) setSessionCount(saved.sessionCount);
      if (saved.hideStart) setHideStart(true);
      if (saved.openSchool) setOpenSchool(saved.openSchool);
      // القسم قد يكون حُذف من جهاز آخر، فلا يُفتح إلا إن كان ما يزال موجودًا.
      if (saved.openClass && classes.some((c) => c.id === saved.openClass)) {
        setOpenClass(saved.openClass);
      }
    })();
  }, [classes, whereKey]);

  useEffect(() => {
    if (!restoredRef.current) return;
    void kvSet(whereKey, {
      tab, term, openClass, openSchool, sessionClass, sessionCount, hideStart,
    });
  }, [tab, term, openClass, openSchool, sessionClass, sessionCount, hideStart, whereKey]);

  /* المحاولات تُسجَّل في الفصل المعروض لحظة الحفظ: قائمة اختيرت في ف1 لا تُحفظ في ف2 */
  useEffect(() => {
    setSessionPicked([]);
    setSessionScores({});
  }, [term]);

  /* عودة الشبكة: أعد القراءة من الخادم مرة واحدة، لا عند كل تبدّل حالة */
  const onlineRef = useRef(true);
  useEffect(() => {
    if (outbox.online && !onlineRef.current) void load();
    onlineRef.current = outbox.online;
  }, [outbox.online, load]);

  /* تسجيل عامل الخدمة: به تفتح الشاشة والتطبيق مثبَّت ولا شبكة */
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        /* متصفّح يمنع العمّال، أو سياق غير آمن: التطبيق يعمل دونه */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

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
  /** معدّل حصص كل تلميذ في الفصل المعروض. يُحسب ولا يُخزَّن. */
  const tpAverageById = useMemo(
    () => tpAverages(tpMarks, sessions, term),
    [tpMarks, sessions, term],
  );
  const classOfStudent = useMemo(
    () => new Map(students.map((s) => [s.id, s.class_id])),
    [students],
  );
  const targetOfClass = useCallback(
    (classId: string): TpTarget => classes.find((c) => c.id === classId)?.tp_target ?? null,
    [classes],
  );
  /**
   * السجل **للعرض والحساب فقط**: معدّل الحصص يحلّ محل الخانة التي اختارها
   * الأستاذ لقسمه. لا يُمرَّر إلى الكتابة أبدًا (saveRecord وsetCriterion يقرآن
   * recordOf الخام)، وإلا ثبّت معدّل اليوم في الخانة وانفصلت عن الحصص.
   */
  const effectiveRecordOf = useCallback(
    (studentId: string) => {
      const classId = classOfStudent.get(studentId);
      return applyTpTarget(
        recordOf(studentId),
        studentId,
        term,
        tpAverageById.get(studentId) ?? null,
        classId ? targetOfClass(classId) : null,
        criteria,
      );
    },
    [recordOf, classOfStudent, term, tpAverageById, targetOfClass, criteria],
  );
  const averageOf = useCallback(
    (studentId: string) =>
      termAverage(
        components,
        componentValues(criteria, effectiveRecordOf(studentId), readingsOf(studentId)),
      ),
    [components, criteria, effectiveRecordOf, readingsOf],
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

  /**
   * كل علامة تدخل الطابور أولًا فتظهر في الشاشة في اللحظة نفسها، ثم تُرسل في
   * الخلفية. لا انتظار للخادم عند الضغطة، ولا إعادة تحميل تمحو ما أُدخل.
   */
  function saveRecord(studentId: string, patch: Partial<RecordRow>) {
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
    outbox.push(
      newOp("record", {
        student_id: studentId,
        term,
        criteria: next.criteria,
        tp: next.tp,
        devoir: next.devoir,
        exam: next.exam,
      }),
    );
  }

  function setCriterion(studentId: string, code: string, value: number | null) {
    const current = recordOf(studentId);
    const map = { ...(current?.criteria ?? {}) };
    // الحذف لا التصفير: «مسح» يعيد المعيار إلى «لم يُقيَّم».
    if (value === null) delete map[code];
    else map[code] = value;
    saveRecord(studentId, { criteria: map });
  }

  async function addReadings(entries: Array<{ studentId: string; score: number }>) {
    const day = today();
    for (const entry of entries) {
      // المعرّف يُولَّد هنا: تظهر المحاولة فورًا، وإعادة الإرسال لا تكرّرها.
      const reading: Reading = {
        id: uid(),
        student_id: entry.studentId,
        term,
        score: entry.score,
        read_on: day,
      };
      outbox.push(newOp("reading-add", { reading }));
    }
    say(
      outbox.online
        ? `سُجّلت ${entries.length} محاولة`
        : `سُجّلت ${entries.length} محاولة — ستُرسل عند عودة الشبكة`,
    );
    return true;
  }

  function removeReading(id: string) {
    const row = readings.find((r) => r.id === id);
    outbox.push(
      newOp("reading-del", { reading_id: id, student_id: row?.student_id ?? "" }),
    );
    say(row ? `حُذفت محاولة القراءة ${row.score}` : "حُذفت محاولة القراءة");
  }

  /* ---------- الأفواج وحصص الأعمال التطبيقية ---------- */

  /**
   * أين يذهب معدّل حصص القسم. إعداد لا تنقيط، فيحتاج الخادم. تغييره لا يمسّ
   * علامة كُتبت: القيمة اليدوية في الخانة القديمة تبقى كما هي.
   */
  async function setTpTarget(classId: string, target: TpTarget) {
    if (!needsNetwork()) return;
    const before = classes.find((c) => c.id === classId)?.tp_target ?? null;
    setClasses((cs) => cs.map((c) => (c.id === classId ? { ...c, tp_target: target } : c)));
    const { error } = await supabase.from("classes").update({ tp_target: target }).eq("id", classId);
    if (error) {
      setClasses((cs) => cs.map((c) => (c.id === classId ? { ...c, tp_target: before } : c)));
      say("تعذّر حفظ الربط");
      return;
    }
    say(target ? "رُبطت نقطة الأعمال التطبيقية" : "فُكّ الربط");
    void load();
  }

  /** ترتيب الأفواج الحالية في قسم، كما يراها الأستاذ. */
  const groupsOf = useCallback(
    (classId: string) =>
      groups
        .filter((g) => g.class_id === classId)
        .sort((a, b) => a.position - b.position),
    [groups],
  );

  /** يكتب فوج كل تلميذ: تحديث واحد لكل فوج، لا تحديث لكل تلميذ. */
  async function writeAssignment(plan: Array<{ student_id: string; group_id: string }>) {
    const byGroup = new Map<string, string[]>();
    for (const item of plan) {
      const list = byGroup.get(item.group_id) ?? [];
      list.push(item.student_id);
      byGroup.set(item.group_id, list);
    }
    for (const [groupId, ids] of byGroup) {
      const { error } = await supabase.from("students").update({ group_id: groupId }).in("id", ids);
      if (error) return false;
    }
    return true;
  }

  /** قسم بلا أفواج يُقسَّم إلى `count` فوجًا ويُوزَّع تلاميذه كتلًا متقاربة. */
  async function createGroups(classId: string, count: number, mode: "list" | "random") {
    if (!needsNetwork()) return false;
    if (groupsOf(classId).length > 0) return false;
    const list = studentsOf(classId);
    const rows = Array.from({ length: count }, (_, i) => ({
      teacher_id: teacherId,
      class_id: classId,
      position: i + 1,
    }));
    const { data, error } = await supabase
      .from("class_groups")
      .insert(rows)
      .select("id,class_id,name,position")
      .order("position");
    if (error || !data) {
      say("تعذّر إنشاء الأفواج");
      return false;
    }
    const created = data as Group[];
    const ordered = mode === "random" ? shuffled(list) : list;
    const ok = await writeAssignment(
      assignment(ordered.map((s) => s.id), created.map((g) => g.id)),
    );
    say(ok ? `قُسّم القسم إلى ${count} أفواج` : "أُنشئت الأفواج لكن تعذّر توزيع بعض التلاميذ");
    await load();
    return ok;
  }

  /** إعادة توزيع كل التلاميذ على الأفواج القائمة. تمحو ما نُقل يدويًا، فتُؤكَّد قبلها. */
  async function redistribute(classId: string, mode: "list" | "random") {
    if (!needsNetwork()) return false;
    const list = studentsOf(classId);
    const current = groupsOf(classId);
    if (current.length < 2) return false;
    const ordered = mode === "random" ? shuffled(list) : list;
    const ok = await writeAssignment(
      assignment(ordered.map((s) => s.id), current.map((g) => g.id)),
    );
    say(ok ? "أُعيد التوزيع" : "تعذّر إعادة التوزيع");
    await load();
    return ok;
  }

  async function addGroup(classId: string) {
    if (!needsNetwork()) return;
    const position = groupsOf(classId).reduce((max, g) => Math.max(max, g.position), 0) + 1;
    const { data, error } = await supabase
      .from("class_groups")
      .insert({ teacher_id: teacherId, class_id: classId, position })
      .select("id,class_id,name,position")
      .single();
    if (error || !data) {
      say("تعذّرت إضافة الفوج");
      return;
    }
    setGroups((gs) => [...gs, data as Group]);
    void load();
  }

  async function renameGroup(id: string, raw: string) {
    if (!needsNetwork()) return;
    const name = cleanGroupName(raw);
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, name } : g)));
    const { error } = await supabase.from("class_groups").update({ name }).eq("id", id);
    if (error) {
      say("تعذّر حفظ الاسم");
      void load();
    }
  }

  /** حذف فوج لا يحذف تلاميذه ولا حصصه ولا علاماتها: يخرجون منه فقط. */
  async function deleteGroup(group: Group) {
    if (!needsNetwork()) return;
    const { error } = await supabase.from("class_groups").delete().eq("id", group.id);
    if (error) {
      say("تعذّر حذف الفوج");
      return;
    }
    setGroups((gs) => gs.filter((g) => g.id !== group.id));
    setBaseStudents((ss) => ss.map((s) => (s.group_id === group.id ? { ...s, group_id: null } : s)));
    setBaseSessions((ss) => ss.map((s) => (s.group_id === group.id ? { ...s, group_id: null } : s)));
    say("حُذف الفوج — تلاميذه وحصصه باقية");
    void load();
  }

  async function moveStudent(studentId: string, groupId: string | null) {
    if (!needsNetwork()) return;
    const before = baseStudents.find((s) => s.id === studentId)?.group_id ?? null;
    setBaseStudents((ss) => ss.map((s) => (s.id === studentId ? { ...s, group_id: groupId } : s)));
    const { error } = await supabase.from("students").update({ group_id: groupId }).eq("id", studentId);
    if (error) {
      setBaseStudents((ss) => ss.map((s) => (s.id === studentId ? { ...s, group_id: before } : s)));
      say("تعذّر نقل التلميذ");
    }
  }

  /**
   * حصة جديدة تدخل الطابور: تُنشأ وتُنقَّط في قاعة بلا تغطية، ومعرّفها يُولَّد
   * هنا فلا يكرّرها الإرسال. وتسبق علاماتِها في الطابور دائمًا.
   */
  function createTpSession(input: {
    class_id: string;
    group_id: string | null;
    held_on: string;
    title: string | null;
  }): string {
    const session: TpSession = { id: uid(), term, ...input };
    outbox.push(newOp("tp-session", { session }));
    return session.id;
  }

  function editTpSession(id: string, patch: { held_on?: string; title?: string | null }) {
    const current = sessions.find((s) => s.id === id);
    if (!current) return;
    outbox.push(newOp("tp-session", { session: { ...current, ...patch } }));
  }

  /** حذف حصة وعلاماتها: يحتاج الخادم، وما لم يُرسل منها يُسقَط من الطابور أولًا. */
  async function deleteTpSession(session: TpSession) {
    if (!needsNetwork()) return;
    for (const op of queue) {
      if (opSessionId(op) === session.id) outbox.discard(op.id);
    }
    const { error } = await supabase.from("tp_sessions").delete().eq("id", session.id);
    if (error) {
      say("تعذّر حذف الحصة");
      void load();
      return;
    }
    setBaseSessions((ss) => ss.filter((s) => s.id !== session.id));
    setBaseTpMarks((ms) => ms.filter((m) => m.session_id !== session.id));
    say("حُذفت الحصة");
  }

  /** علامة تلميذ في حصة. بلا علامة ولا غياب = مسح: يعود «لم يُقيَّم» لا صفرًا. */
  function setTpMark(sessionId: string, studentId: string, score: number | null, absent: boolean) {
    outbox.push(
      newOp("tp-mark", { session_id: sessionId, student_id: studentId, score, absent }),
    );
  }

  /**
   * تعديل معيار. القيمة الابتدائية تُشتق من النوع ولا تُطلب من الأستاذ:
   * معيار الخصم يبدأ من العلامة الكاملة (base = ceiling) فيُحسب دائمًا ولو لم
   * يُخصم منه شيء، ومعيار الإضافة يبدأ من صفر فيخرج من الحساب حتى يُنقَّط.
   */
  async function updateCriterion(id: string, patch: Partial<Criterion>) {
    const before = criteria.find((c) => c.id === id);
    if (!before) return;
    if (!needsNetwork()) return;
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

  /**
   * النوع والسقف يغيّران معنى أرقام مسجَّلة في كل أقسام الأستاذ وفصوله، فإن
   * كانت هناك علامات مسجَّلة في المعيار سُئل أولًا. التسمية لا تمسّ حسابًا،
   * فتمرّ دون سؤال.
   */
  function requestCriterionChange(id: string, patch: Partial<Criterion>) {
    const before = criteria.find((c) => c.id === id);
    if (!before) return;
    const changesMeaning =
      (patch.kind !== undefined && patch.kind !== before.kind) ||
      (patch.ceiling !== undefined && Number(patch.ceiling) !== Number(before.ceiling));
    const marked = records.filter((r) => typeof r.criteria?.[before.code] === "number").length;
    if (changesMeaning && marked > 0) {
      setCriterionChange({ criterion: before, patch, marked });
      return;
    }
    void updateCriterion(id, patch);
  }

  async function addCriterion() {
    if (!needsNetwork()) return;
    // كود داخلي ثابت لا يراه الأستاذ: علامات التلاميذ محفوظة به، فلو ربطناه
    // بالتسمية لضاعت العلامات عند أول تغيير للاسم.
    const code = `c${Math.random().toString(36).slice(2, 10)}`;
    const row = {
      teacher_id: teacherId,
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
    if (!needsNetwork()) return;
    setCriteria((cs) => cs.filter((x) => x.id !== c.id));
    setConfirmCriterion(null);
    const { error } = await supabase.from("criteria").delete().eq("id", c.id);
    if (error) {
      say("تعذّر الحذف");
      void load();
      return;
    }
    // قسمٌ كان هدفُه هذا المعيار يعود بلا ربط، فيُسأل الأستاذ من جديد
    // بدل أن يبقى كود يشير إلى لا شيء.
    const dangling = classes.filter((k) => k.tp_target === `criterion:${c.code}`);
    if (dangling.length && tpReady) {
      setClasses((cs) =>
        cs.map((k) => (k.tp_target === `criterion:${c.code}` ? { ...k, tp_target: null } : k)),
      );
      await supabase
        .from("classes")
        .update({ tp_target: null })
        .eq("tp_target", `criterion:${c.code}`);
      say(`حُذف معيار ${c.label} — فُكّ ربط الأعمال التطبيقية به في ${dangling.length} قسم`);
      return;
    }
    say(`حُذف معيار ${c.label}`);
  }

  async function saveProfile(patch: Partial<Profile>) {
    if (!needsNetwork()) return;
    setProfile((p) => ({ ...p, ...patch }));
    const { error } = await supabase.from("teachers").update(patch).eq("id", teacherId);
    if (error) {
      say("تعذّر حفظ بياناتك");
      void load();
    }
  }

  async function saveComponent(id: string, patch: Partial<Component>) {
    if (!needsNetwork()) return;
    setComponents((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const { error } = await supabase.from("components").update(patch).eq("id", id);
    if (error) {
      say("تعذّر حفظ المركّبة");
      void load();
    }
  }

  /** الاسم والحالة الخاصة يُكتبان في الحصة، فيمرّان بالطابور مثل العلامة. */
  function updateStudent(id: string, patch: Partial<Student>) {
    outbox.push(newOp("student", { student_id: id, patch }));
  }

  async function deleteStudent(student: Student) {
    if (!needsNetwork()) return;
    setConfirmStudent(null);
    setOpenStudentId(null);
    const { error } = await supabase.from("students").delete().eq("id", student.id);
    if (error) {
      say("تعذّر الحذف");
      return;
    }
    // ما بقي له في الطابور لم يعد له مكان يصل إليه: صفّه بدل أن يتعثّر.
    for (const op of queue) {
      if (opStudentId(op) === student.id) outbox.discard(op.id);
    }
    setBaseStudents((ss) => ss.filter((s) => s.id !== student.id));
    setBaseRecords((rs) => rs.filter((r) => r.student_id !== student.id));
    setBaseReadings((rs) => rs.filter((r) => r.student_id !== student.id));
    setBaseTpMarks((ms) => ms.filter((m) => m.student_id !== student.id));
    say(`حُذف ${student.full_name}`);
  }

  /* ---------- المؤسسات ---------- */

  async function addSchool(name: string) {
    if (!needsNetwork()) return null;
    const { data, error } = await supabase
      .from("schools")
      .insert({ teacher_id: teacherId, name, position: schools.length + 1 })
      .select("id,name,position")
      .single();
    if (error || !data) {
      say("تعذّرت إضافة المؤسسة");
      return null;
    }
    setSchools((ss) => [...ss, data as School]);
    return data as School;
  }

  async function renameSchool(id: string, name: string) {
    if (!needsNetwork()) return;
    setSchools((ss) => ss.map((s) => (s.id === id ? { ...s, name } : s)));
    const { error } = await supabase.from("schools").update({ name }).eq("id", id);
    if (error) {
      say("تعذّر حفظ الاسم");
      void load();
    }
  }

  /** حذف المؤسسة لا يحذف أقسامها: تبقى بلا مؤسسة وتُنسب من جديد. */
  async function deleteSchool(school: School) {
    if (!needsNetwork()) return;
    setSchools((ss) => ss.filter((s) => s.id !== school.id));
    setClasses((cs) =>
      cs.map((c) => (c.school_id === school.id ? { ...c, school_id: null } : c)),
    );
    const { error } = await supabase.from("schools").delete().eq("id", school.id);
    if (error) {
      say("تعذّر الحذف");
      void load();
      return;
    }
    say(`حُذفت ${school.name} — أقسامها باقية بلا مؤسسة`);
  }

  /** نسبة قسم إلى مؤسسة. لا تُستعمل إلا في إصلاح قسم وُجد بلا واحدة. */
  async function assignSchool(classId: string, schoolId: string) {
    if (!needsNetwork()) return false;
    const { error } = await supabase
      .from("classes")
      .update({ school_id: schoolId })
      .eq("id", classId);
    if (error) {
      say("تعذّر حفظ المؤسسة");
      return false;
    }
    setClasses((cs) =>
      cs.map((c) => (c.id === classId ? { ...c, school_id: schoolId } : c)),
    );
    return true;
  }

  async function createClassWithStudents(
    name: string,
    names: string[],
    schoolId: string,
  ) {
    if (!needsNetwork()) return;
    const { data: created, error } = await supabase
      .from("classes")
      .insert({
        teacher_id: teacherId,
        name,
        position: classes.length + 1,
        school_id: schoolId,
      })
      .select("id,name,position,school_id")
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

  /**
   * تلميذ وافد أو منسيّ في الاستيراد. يحتاج الشبكة كإنشاء القسم وحذف التلميذ:
   * التلميذ الجديد بلا معرّف من الخادم لا تُكتب له علامة في الطابور.
   */
  async function addStudents(classId: string, names: string[]): Promise<boolean> {
    if (!needsNetwork()) return false;
    const positions = nextPositions(studentsOf(classId).map((s) => s.position), names.length);
    const rows = names.map((full_name, i) => ({
      teacher_id: teacherId,
      class_id: classId,
      full_name,
      position: positions[i],
    }));
    const { data, error } = await supabase
      .from("students")
      .insert(rows)
      .select("id,class_id,full_name,position,note,tags");
    if (error || !data) {
      say("تعذّرت إضافة التلاميذ");
      return false;
    }
    setBaseStudents((ss) => [
      ...ss,
      ...data.map((s) => ({ ...s, tags: s.tags ?? [] }) as Student),
    ]);
    say(names.length === 1 ? `أُضيف ${names[0]}` : `أُضيف ${names.length} تلاميذ`);
    // نسخة الجهاز تُكتب عند التحميل: بلا هذا يغيب الوافد إن فُتح التطبيق دون شبكة.
    void load();
    return true;
  }

  async function deleteClass(klass: Klass) {
    if (!needsNetwork()) return;
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

  /**
   * الخروج يمسح نسخة الجهاز وطابوره: الجهاز قد يكون مشتركًا بين أستاذين،
   * فلا تبقى أقسام أحدهما وعلاماته بعد خروجه. وإن بقي شيء لم يُرسل، يُسأل
   * أولًا — فالخروج يضيّعه.
   */
  async function signOut() {
    setConfirmSignOut(false);
    await kvDel(`snapshot:${teacherId}`);
    await kvDel(`queue:${teacherId}`);
    outbox.reset();
    navigator.serviceWorker?.controller?.postMessage({ type: "clear-cache" });
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  /* ---------- render ---------- */
  return (
    <div className="shell">
      <header className="gut">
        <div className="hwrap wrap">
          {/* اسم التطبيق طريق الرجوع: من أيّ تبويب أو بطاقة قسم إلى الأقسام */}
          <button
            className="brand"
            aria-label="العودة إلى الأقسام"
            onClick={() => {
              setTab("classes");
              setOpenClass(null);
              setOpenStudentId(null);
              setOpenSchool(null);
            }}
          >
            دفتر <span>التقويم</span>
          </button>
          <div className="hspace" />
          <SyncBadge
            waiting={waiting}
            online={outbox.online}
            sending={outbox.sending}
            label={pendingLabel(queue)}
            onClick={() => setShowPending(true)}
          />
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
          {error && classes.length === 0 && (
            <div className="note bad" style={{ marginBottom: 14 }}>
              تعذّر الوصول إلى البيانات: {error}
            </div>
          )}

          {cachedAt !== null && classes.length > 0 && (
            <div className="note warn" style={{ marginBottom: 14 }}>
              تعمل من نسخة هذا الجهاز ({since(cachedAt)}). التنقيط يُحفظ ويُرسل
              عند عودة الشبكة.
            </div>
          )}

          {tab === "classes" &&
            (openClass && classSection === "groups" && tpReady ? (
              <GroupsView
                klass={classes.find((c) => c.id === openClass)!}
                students={studentsOf(openClass)}
                groups={groupsOf(openClass)}
                sessions={sessions.filter((x) => x.class_id === openClass)}
                tpMarks={tpMarks}
                term={term}
                criteria={criteria}
                components={components}
                tpAverageById={tpAverageById}
                online={outbox.online}
                onBack={() => setClassSection("students")}
                onTarget={(target) => void setTpTarget(openClass, target)}
                onCreateGroups={(count, mode) => createGroups(openClass, count, mode)}
                onRedistribute={(mode) => redistribute(openClass, mode)}
                onAddGroup={() => addGroup(openClass)}
                onRenameGroup={renameGroup}
                onDeleteGroup={deleteGroup}
                onMoveStudent={moveStudent}
                onCreateSession={createTpSession}
                onEditSession={editTpSession}
                onDeleteSession={deleteTpSession}
                onMark={setTpMark}
                say={say}
              />
            ) : openClass ? (
              <ClassView
                klass={classes.find((c) => c.id === openClass)!}
                students={studentsOf(openClass)}
                term={term}
                criteria={criteria}
                components={components}
                recordOf={effectiveRecordOf}
                averageOf={averageOf}
                readingCount={(id) => readingsOf(id).length}
                stats={statsOf(openClass)}
                tp={{
                  target: classes.find((c) => c.id === openClass)?.tp_target ?? null,
                  averageOf: (id) => tpAverageById.get(id) ?? null,
                }}
                onGroups={tpReady ? () => setClassSection("groups") : undefined}
                onBack={() => setOpenClass(null)}
                onPick={(s) => setOpenStudentId(s.id)}
                onDelete={() => setConfirmDelete(classes.find((c) => c.id === openClass)!)}
                onAddStudents={() => setAddingTo(openClass)}
                onCriterion={setCriterion}
                onMark={(studentId, field, value) =>
                  saveRecord(studentId, { [field]: value } as Partial<RecordRow>)
                }
              />
            ) : (
              <ClassesView
                loading={loading}
                classes={classes}
                schools={schools}
                studentCount={students.length}
                statsOf={statsOf}
                onOpen={(id) => {
                  setClassSection("students");
                  setOpenClass(id);
                }}
                onImport={() => setImporting(true)}
                onNewSchool={() => setNewSchool(true)}
                openSchool={openSchool}
                onOpenSchool={setOpenSchool}
                start={startSteps}
                onDismissStart={() => setHideStart(true)}
              />
            ))}

          {tab === "session" && (
            <SessionView
              classes={classes}
              schools={schools}
              studentsOf={studentsOf}
              attemptsOf={(id) => readingsOf(id).length}
              term={term}
              reading={criteria.find((c) => c.kind === "auto")}
              classId={sessionClass}
              onClassId={setSessionClass}
              count={sessionCount}
              onCount={setSessionCount}
              picked={sessionPicked}
              setPicked={setSessionPicked}
              scores={sessionScores}
              setScores={setSessionScores}
              onSave={addReadings}
            />
          )}

          {tab === "stats" && (
            <StatsView classes={classes} statsOf={statsOf} term={term} />
          )}

          {tab === "docs" && (
            <DocsView
              classes={classes}
              schools={schools}
              profile={profile}
              onImport={() => setImporting(true)}
              onExport={() => setExporting(true)}
              onPrint={setPrinting}
            />
          )}

          {tab === "settings" && (
            <SettingsView
              criteria={criteria}
              components={components}
              email={email}
              onCriterion={requestCriterionChange}
              resetTick={settingsTick}
              onAddCriterion={addCriterion}
              onDeleteCriterion={setConfirmCriterion}
              onComponent={saveComponent}
              onProfile={saveProfile}
              profile={profile}
              schools={schools}
              classes={classes}
              onAddSchool={addSchool}
              onRenameSchool={renameSchool}
              onDeleteSchool={deleteSchool}
              onSignOut={() => (waiting.total ? setConfirmSignOut(true) : void signOut())}
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
          record={effectiveRecordOf(openStudent.id)}
          readings={readingsOf(openStudent.id)}
          components={components}
          tp={{
            target: classes.find((c) => c.id === openStudent.class_id)?.tp_target ?? null,
            average: tpAverageById.get(openStudent.id) ?? null,
          }}
          onClose={() => setOpenStudentId(null)}
          onCriterion={(code, value) => setCriterion(openStudent.id, code, value)}
          onMark={(field, value) => saveRecord(openStudent.id, { [field]: value } as Partial<RecordRow>)}
          onRemoveReading={removeReading}
          onEdit={(patch) => updateStudent(openStudent.id, patch)}
          onDelete={() => setConfirmStudent(openStudent)}
          position={neighbours.index + 1}
          count={neighbours.list.length}
          onStep={(step) => {
            const next = neighbours.list[neighbours.index + step];
            if (next) setOpenStudentId(next.id);
          }}
        />
      )}

      {/* قسم بلا مؤسسة لا يُترك: رأس كشفه يُطبع ناقصًا والأقسام لا تُجمع
          به. فيُسأل عنه أول ما يُفتح التطبيق — وحين تكون الشبكة قائمة، فلا
          يُحبس الأستاذ عن التنقيط في قاعة لا تغطية فيها. */}
      {!loading && outbox.online && orphans.length > 0 && !importing && (
        <SchoolFixSheet
          orphans={orphans}
          schools={schools}
          onAddSchool={addSchool}
          onAssign={assignSchool}
        />
      )}

      {newSchool && (
        <NewSchoolSheet onClose={() => setNewSchool(false)} onAdd={addSchool} />
      )}

      {addingTo && classes.some((c) => c.id === addingTo) && (
        <AddStudentsSheet
          klass={classes.find((c) => c.id === addingTo)!}
          existing={studentsOf(addingTo).map((s) => s.full_name)}
          onClose={() => setAddingTo(null)}
          onAdd={async (names) => {
            const ok = await addStudents(addingTo, names);
            if (ok) setAddingTo(null);
          }}
        />
      )}

      {importing && (
        <ImportSheet
          onClose={() => setImporting(false)}
          schools={schools}
          defaultSchool={classes[classes.length - 1]?.school_id ?? null}
          onAddSchool={addSchool}
          onCreate={async (name, names, schoolId) => {
            setImporting(false);
            await createClassWithStudents(name, names, schoolId);
          }}
        />
      )}

      {printing && classes.some((c) => c.id === printing) && (
        <PrintView
          klass={classes.find((c) => c.id === printing)!}
          students={studentsOf(printing)}
          criteria={criteria}
          components={components}
          profile={profile}
          schools={schools}
          term={term}
          recordOf={effectiveRecordOf}
          readingsOf={readingsOf}
          onClose={() => setPrinting(null)}
        />
      )}

      {exporting && (
        <ExportSheet
          classes={classes}
          studentsOf={studentsOf}
          criteria={criteria}
          components={components}
          recordOf={effectiveRecordOf}
          readingsOf={readingsOf}
          term={term}
          say={say}
          onClose={() => setExporting(false)}
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

      {criterionChange && (
        <ConfirmCriterionChangeSheet
          criterion={criterionChange.criterion}
          patch={criterionChange.patch}
          marked={criterionChange.marked}
          onCancel={() => {
            setCriterionChange(null);
            setSettingsTick((n) => n + 1);
          }}
          onConfirm={() => {
            const { criterion, patch } = criterionChange;
            setCriterionChange(null);
            void updateCriterion(criterion.id, patch);
          }}
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

      {showPending && (
        <PendingSheet
          queue={queue}
          waiting={waiting}
          online={outbox.online}
          sending={outbox.sending}
          lastSyncedAt={outbox.lastSyncedAt}
          nameOf={(id) => students.find((s) => s.id === id)?.full_name ?? "تلميذ محذوف"}
          onClose={() => setShowPending(false)}
          onFlush={outbox.flush}
          onRetry={outbox.retry}
          onDiscard={outbox.discard}
        />
      )}

      {confirmSignOut && (
        <ConfirmSignOutSheet
          label={pendingLabel(queue)}
          onCancel={() => setConfirmSignOut(false)}
          onShow={() => {
            setConfirmSignOut(false);
            setShowPending(true);
          }}
          onConfirm={() => void signOut()}
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

/**
 * ما يبقى على الأستاذ في أول أسبوع.
 *
 * الخطوات التي تمّت تختفي وحدها، والبطاقة كلها تختفي حين تتمّ كلها — فلا
 * تبقى في الشاشة سنةً كاملة. ولا تُعرض خطوة لا يعرف الأستاذ أنها ناقصة:
 * المعايير أُنشئت له افتراضًا، لكن مجموعها قد يخرج عن 20 وهو لا يدري.
 */
function StartCard({
  steps, onDismiss,
}: {
  steps: Array<{ key: string; label: string; hint: string; action: string; onDo: () => void }>;
  onDismiss: () => void;
}) {
  if (!steps.length) return null;
  return (
    <div className="card startcard">
      <div className="srow2">
        <b>لتبدأ</b>
        <div className="hspace" />
        <button className="clearb" onClick={onDismiss}>أخفِ</button>
      </div>
      {steps.map((step) => (
        <div key={step.key} className="srow2">
          <div className="k">
            {step.label}
            <small>{step.hint}</small>
          </div>
          <button className="btn soft" onClick={step.onDo}>{step.action}</button>
        </div>
      ))}
    </div>
  );
}

function ClassesView({
  loading, classes, schools, studentCount, statsOf, onOpen, onImport, onNewSchool,
  openSchool, onOpenSchool, start, onDismissStart,
}: {
  loading: boolean;
  classes: Klass[];
  schools: School[];
  studentCount: number;
  statsOf: (id: string) => ReturnType<typeof classStats>;
  onOpen: (id: string) => void;
  onImport: () => void;
  onNewSchool: () => void;
  /** المؤسسة المفتوحة، أو null فتُعرض بطاقاتها. */
  openSchool: string | null;
  onOpenSchool: (key: string | null) => void;
  start: Array<{ key: string; label: string; hint: string; action: string; onDo: () => void }>;
  onDismissStart: () => void;
}) {
  const groups = groupBySchool(classes, schools);
  /** مؤسسة واحدة: لا معنى لشاشة بطاقة واحدة، فتُعرض أقسامها رأسًا. */
  const single = groups.length === 1 ? groups[0] : null;
  const current = single ?? groups.find((g) => g.key === openSchool) ?? null;

  return (
    <section className="view">
      <div className="vhead">
        {current && !single && (
          <button className="icbtn" onClick={() => onOpenSchool(null)} aria-label="رجوع إلى المؤسسات">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        )}
        <div>
          <h2>{current && !single ? current.name : "أقسامي"}</h2>
          {classes.length > 0 && (
            <p>
              {current
                ? `${countWord(current.classes.length, "قسم واحد", "قسمان", "أقسام", "قسمًا")} · ${current.classes.reduce((sum, k) => sum + statsOf(k.id).total, 0)} تلميذًا`
                : `${studentCount} تلميذًا في ${countWord(classes.length, "قسم واحد", "قسمان", "أقسام", "قسمًا")}`}
            </p>
          )}
        </div>
        <div className="hspace" />
        {/* الاستيراد من شاشة المؤسسات لا من داخل واحدة: القسم الجديد قد
            يكون لأيّهما، ومؤسسته تُختار في ورقة الاستيراد نفسها. */}
        {!current ? (
          <button className="btn soft" onClick={onNewSchool}>+ مؤسسة</button>
        ) : null}
        {!current || single ? (
          <button className="btn soft" onClick={onImport}>+ قسم</button>
        ) : null}
      </div>

      {!loading && <StartCard steps={start} onDismiss={onDismissStart} />}

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
      ) : !current ? (
        /* شاشة المؤسسات: بطاقاتها وحدها، تُفتح الواحدة فتُعرض أقسامها.
           لا تُعرض الأقسام هنا، فصاحب ثانويتين يرى ثانويتيه لا سبعة أقسام. */
        <div className="schooltiles">
          {groups.map((group) => {
            const stats = group.classes.map((k) => statsOf(k.id));
            const students = stats.reduce((sum, st) => sum + st.total, 0);
            const scored = stats.reduce((sum, st) => sum + st.scored, 0);
            return (
              <button
                key={group.key}
                className="tile"
                onClick={() => onOpenSchool(group.key)}
              >
                <b>{group.name}</b>
                <span className="hspace" />
                <i className="num">{scored}/{students}</i>
                <small>منقَّطون</small>
                <div className="bar">
                  <i style={{ width: `${students ? Math.round((scored / students) * 100) : 0}%` }} />
                </div>
                <small>
                  {countWord(group.classes.length, "قسم واحد", "قسمان", "أقسام", "قسمًا")}
                </small>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid">
          {current.classes.map((klass) => {
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
  klass, students, term, criteria, components, recordOf,
  averageOf, readingCount, stats, tp, onGroups,
  onBack, onPick, onDelete, onAddStudents, onCriterion, onMark,
}: {
  klass: Klass;
  students: Student[];
  term: number;
  criteria: Criterion[];
  components: Component[];
  recordOf: (id: string) => RecordRow | undefined;
  averageOf: (id: string) => number | null;
  readingCount: (id: string) => number;
  stats: ReturnType<typeof classStats>;
  /** وجهة معدّل حصص الأعمال التطبيقية ومعدّل كل تلميذ، لقفل الخانة التي تُحسب منها. */
  tp: { target: TpTarget; averageOf: (id: string) => number | null };
  /** غائب إن لم تُهيَّأ جداول الأفواج بعد. */
  onGroups?: () => void;
  onBack: () => void;
  onPick: (s: Student) => void;
  onDelete: () => void;
  onAddStudents: () => void;
  onCriterion: (studentId: string, code: string, value: number | null) => void;
  onMark: (studentId: string, field: MarkField, value: number | null) => void;
}) {
  /** العمود المفتوح: `c:` معيار و`m:` مركّبة. فارغ = جدول المعدلات المعتاد. */
  const [column, setColumn] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "todo" | "low">("all");

  const ranked = students
    .map((s) => ({ student: s, average: averageOf(s.id) }))
    .filter((r) => r.average !== null)
    .sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
  const rank = new Map(ranked.map((r, i) => [r.student.id, i + 1]));

  // معيار القراءة لا يُنقَّط بيد: نقطته من محاولات الحصة.
  const columns = [
    ...criteria.filter((c) => c.kind !== "auto").map((c) => ({ key: `c:${c.code}`, label: c.label })),
    ...components
      .filter((c) => c.code !== "cc" && c.active)
      .map((c) => ({ key: `m:${c.code}`, label: c.label })),
  ];
  const open = columns.find((c) => c.key === column) ?? null;
  const openCriterion = open?.key.startsWith("c:")
    ? criteria.find((c) => `c:${c.code}` === open.key) ?? null
    : null;
  const openMark = open?.key.startsWith("m:")
    ? (open.key.slice(2) as MarkField)
    : null;
  /** العمود الذي تُحسب نقطته من حصص الأعمال التطبيقية: من نُقِّط فيها لا تُدخَل له علامة بيد. */
  const columnLocked =
    (openCriterion !== null && targetCriterionCode(tp.target) === openCriterion.code) ||
    (openMark === "tp" && tp.target === TP_COMPONENT);

  /**
   * «أين وقفت؟» هو سؤال كل حصة. والجواب يختلف بالسياق: في وضع العمود هو من
   * لم يُدخَل له شيء في هذا العمود، وفي الجدول العادي من لا علامة له أصلًا.
   */
  const waiting = (student: Student) => {
    const record = recordOf(student.id);
    if (openCriterion) return typeof record?.criteria?.[openCriterion.code] !== "number";
    if (openMark) return record?.[openMark] === null || record?.[openMark] === undefined;
    return averageOf(student.id) === null;
  };

  const todo = students.filter(waiting).length;
  const filled = students.length - todo;
  const low = students.filter((s) => {
    const average = averageOf(s.id);
    return average !== null && average < 10;
  }).length;

  // الترتيب والرتبة يُحسبان على القسم كله، فالتصفية تُخفي سطورًا ولا تغيّر رتبة.
  const rows = students
    .filter((s) => nameMatches(s.full_name, query))
    .filter((s) => (filter === "todo" ? waiting(s) : true))
    .filter((s) => {
      if (filter !== "low") return true;
      const average = averageOf(s.id);
      return average !== null && average < 10;
    })
    .map((s) => ({ student: s, average: averageOf(s.id) }));

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
          <p>
            {open
              ? `تنقّط عمود ${open.label}`
              : `الفصل ${term} · معدل القسم ${fmt(stats.mean)}`}
          </p>
        </div>
        {onGroups && (
          <>
            <div className="hspace" />
            <button className="btn soft" onClick={onGroups}>
              الأفواج والأعمال التطبيقية
            </button>
          </>
        )}
      </div>

      {open && columnLocked && (
        <div className="note">
          هذا العمود يُحسب من حصص الأعمال التطبيقية لمن نُقِّط فيها. ومن لم يُنقَّط
          فيها تُدخل له علامته هنا.
        </div>
      )}

      {/* الواجب يُصحَّح للقسم كله مرة واحدة، لا تلميذًا تلميذًا: يُختار العمود
          مرة ثم يُنزَل على الأسماء بعدّاد لكل سطر. */}
      {students.length > 0 && columns.length > 0 && (
        <div className="colbar">
          <span className="collab">عرض:</span>
          <div className="chips">
            {/* العودة إلى الحالة العامة بزرّ ظاهر: إعادة النقر على العمود المختار
                تُلغيه، لكن أحدًا لا يخمّن ذلك. */}
            <button
              aria-pressed={column === null}
              onClick={() => {
                setColumn(null);
                setFilter("all");
              }}
            >
              الكل
            </button>
            {columns.map((c) => (
              <button
                key={c.key}
                aria-pressed={column === c.key}
                onClick={() => {
                  setColumn(column === c.key ? null : c.key);
                  setFilter("all");
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* عدّاد التقدّم وتصفيته في زرّ واحد: الرقم يقول أين وقفت، والضغط
          يُظهر الباقين وحدهم فلا يُبحث عنهم بالنظر في ستّة وثلاثين سطرًا. */}
      {students.length > 0 && (
        <div className="filterbar">
          <div className="chips">
            <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              الكل
            </button>
            <button
              aria-pressed={filter === "todo"}
              onClick={() => setFilter(filter === "todo" ? "all" : "todo")}
              disabled={todo === 0}
            >
              {open ? "بلا إدخال" : "بلا علامة"} {todo}
            </button>
            {!open && (
              <button
                aria-pressed={filter === "low"}
                onClick={() => setFilter(filter === "low" ? "all" : "low")}
                disabled={low === 0}
              >
                تحت 10 · {low}
              </button>
            )}
          </div>
          <div className="hspace" />
          <span
            className={todo === 0 ? "pill ok" : "pill"}
            title={open ? `أدخلتَ لـ ${filled} من ${students.length}` : `نُقِّط ${filled} من ${students.length}`}
          >
            {filled}/{students.length}
          </span>
        </div>
      )}

      {students.length > 8 && (
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            id="class-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن تلميذ"
            aria-label="ابحث عن تلميذ"
          />
          {query && (
            <button className="clearb" onClick={() => setQuery("")} aria-label="امسح البحث">
              ×
            </button>
          )}
        </div>
      )}

      {students.length === 0 ? (
        <div className="card empty">
          <h3>القسم بلا تلاميذ</h3>
          <p>أضف الأسماء، اسمًا في كل سطر.</p>
          <button className="btn soft" onClick={onAddStudents}>+ تلاميذ</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="card empty">
          <h3>
            {query
              ? `لا اسم يطابق «${query}»`
              : filter === "todo"
                ? "لم يبقَ أحد — القسم كله منقَّط"
                : "لا أحد تحت 10"}
          </h3>
          <button
            className="btn soft"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            أظهر القسم كله
          </button>
        </div>
      ) : (
        <div className="slist">
          {rows.map(({ student, average }, index) =>
            open ? (
              <div key={student.id} className="srow colmode">
                <span className="rank num">{index + 1}</span>
                <button className="sname asname" onClick={() => onPick(student)}>
                  {student.full_name}
                  {state(student) && (
                    <small className="nbadge" title={state(student)}>{state(student)}</small>
                  )}
                </button>
                {columnLocked && tp.averageOf(student.id) !== null ? (
                  <span className="rowlock num" title="محسوبة من حصص الأعمال التطبيقية">
                    {fmt(tp.averageOf(student.id))} / 20 · حصص
                  </span>
                ) : openCriterion ? (
                  <RowCounter
                    criterion={openCriterion}
                    record={recordOf(student.id)}
                    onChange={(value) => onCriterion(student.id, openCriterion.code, value)}
                  />
                ) : openMark ? (
                  <RowMark
                    field={openMark}
                    record={recordOf(student.id)}
                    onChange={(value) => onMark(student.id, openMark, value)}
                  />
                ) : null}
              </div>
            ) : (
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
            ),
          )}
        </div>
      )}

      <div className="pickbar">
        {open ? (
          <button className="btn ghost" onClick={() => setColumn(null)}>
            أنهِ العمود
          </button>
        ) : (
          <>
            <button className="btn soft" onClick={onAddStudents}>+ تلميذ</button>
            <button className="btn warn" onClick={onDelete}>حذف القسم</button>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * عدّاد سطر واحد في وضع العمود: ناقص ورقم وزائد، مضغوطة لتسع الاسم معها.
 * نفس حساب بطاقة التلميذ (bump/shownValue)، فلا يختلف ما يُخزَّن باختلاف
 * المكان الذي نُقِّط منه.
 */
function RowCounter({
  criterion, record, onChange,
}: {
  criterion: Criterion;
  record: RecordRow | undefined;
  onChange: (value: number | null) => void;
}) {
  const ceiling = Number(criterion.ceiling);
  const step = stepFor(criterion);
  const stored = record?.criteria?.[criterion.code];
  const value = typeof stored === "number" ? stored : null;
  const assessed = value !== null;
  const shown = shownValue(criterion, value);
  const isDeduct = criterion.kind === "deduct";

  const atFloor = isDeduct ? shown === 0 : !assessed || shown === 0;
  const atRoof = (shown ?? 0) >= ceiling && (isDeduct || assessed);

  return (
    <div className="rowc">
      <button
        className="rcbtn"
        onClick={() => onChange(bump(criterion, value, -step))}
        disabled={atFloor}
        aria-label={`${criterion.label}: أنقص ${step}`}
      >
        −
      </button>
      <button
        className={assessed || isDeduct ? "rcval num" : "rcval num none"}
        onClick={() => assessed && onChange(null)}
        disabled={!assessed}
        aria-label={assessed ? "امسح فيعود غير مقيَّم" : "لم يُقيَّم"}
        title={assessed ? "انقر لتمسح فيعود غير مقيَّم" : "لم يُقيَّم"}
      >
        {shown === null ? "—" : fmt(shown, shown % 1 ? 1 : 0)}
      </button>
      <button
        className="rcbtn"
        onClick={() => onChange(bump(criterion, value, step))}
        disabled={atRoof}
        aria-label={`${criterion.label}: أضف ${step}`}
      >
        +
      </button>
    </div>
  );
}

/** مركّبة من 20 في وضع العمود: خانة رقم، والفراغ يعني «لم يُنقَّط». */
function RowMark({
  field, record, onChange,
}: {
  field: MarkField;
  record: RecordRow | undefined;
  onChange: (value: number | null) => void;
}) {
  const current = record?.[field] ?? null;
  const [refused, setRefused] = useState(false);
  return (
    <div className="rowm">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={20}
        step={0.25}
        defaultValue={current ?? ""}
        key={`${field}-${current ?? ""}`}
        aria-label="العلامة من 20"
        aria-invalid={refused}
        title={refused ? MARK_HINT : undefined}
        onChange={() => setRefused(false)}
        onBlur={(e) => {
          const read = readMark(e.target);
          if (read.kind === "bad") {
            e.target.value = String(current ?? "");
            setRefused(true);
            return;
          }
          setRefused(false);
          if (read.kind === "empty") {
            if (current !== null) onChange(null);
            return;
          }
          if (read.value !== current) onChange(read.value);
        }}
        onKeyDown={(e) => {
          // Enter ينتقل إلى التلميذ التالي: اليد لا تترك لوحة المفاتيح.
          if (e.key !== "Enter") return;
          e.preventDefault();
          const field = e.currentTarget;
          const inputs = Array.from(
            field.closest(".slist")?.querySelectorAll(".rowm input") ?? [],
          ) as HTMLInputElement[];
          const next = inputs[inputs.indexOf(field) + 1];
          if (next) next.focus();
          else e.currentTarget.blur();
        }}
      />
      <i className="num">/ 20</i>
      {refused && <small className="ferr" role="alert">{MARK_HINT}</small>}
    </div>
  );
}

function SessionView({
  classes, schools, studentsOf, attemptsOf, term, reading,
  classId, onClassId, count, onCount, picked, setPicked, scores, setScores, onSave,
}: {
  classes: Klass[];
  schools: School[];
  studentsOf: (id: string) => Student[];
  attemptsOf: (id: string) => number;
  term: number;
  /** معيار القراءة المحسوب تلقائيًا، إن أبقاه الأستاذ في معاييره. */
  reading: Criterion | undefined;
  /** القسم والعدد محفوظان في الجهاز، فلا يُعادان في كل حصة. */
  classId: string;
  onClassId: (id: string) => void;
  count: number;
  onCount: (n: number) => void;
  /** القائمة المختارة ونقاطها، تعيشان في AppClient فتنجوان من تبديل التبويب. */
  picked: Student[];
  setPicked: Dispatch<SetStateAction<Student[]>>;
  scores: Record<string, number | "skip">;
  setScores: Dispatch<SetStateAction<Record<string, number | "skip">>>;
  onSave: (entries: Array<{ studentId: string; score: number }>) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);

  /* القسم المحفوظ قد يُحذف من جهاز آخر: لا تبقى الحصة على قسم لا وجود له */
  useEffect(() => {
    const wanted = resolveSessionClass(groupBySchool(classes, schools), classId);
    if (wanted !== classId) onClassId(wanted);
  }, [classes, schools, classId, onClassId]);

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

  /* المؤسسة قبل القسم، كما في شاشة الأقسام: أسماء الأقسام تتشابه بين ثانويتين،
     ومن يقف أمام تلاميذ مؤسسة لا يريد أن يقرأ في قائمة سبعة أقسام معًا.
     مؤسسة واحدة: لا معنى لقائمة بخيار واحد، فلا تظهر. */
  const groups = groupBySchool(classes, schools);
  const group = groupOf(groups, classId) ?? groups[0];
  const list = studentsOf(classId);
  const unread = list.filter((s) => attemptsOf(s.id) === 0).length;
  const chosen = picked.filter((s) => typeof scores[s.id] === "number").length;

  /** يستبدل تلميذًا بالتالي في العدل: الأقل محاولات ممن ليسوا في القائمة. */
  function swap(student: Student) {
    const already = new Set(picked.map((p) => p.id));
    const [next] = pickForSession(
      list.filter((s) => !already.has(s.id)),
      attemptsOf,
      1,
    );
    if (!next) return;
    setPicked((ps) => ps.map((p) => (p.id === student.id ? next : p)));
    setScores((s) => {
      const rest = { ...s };
      delete rest[student.id];
      return rest;
    });
  }
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
        {groups.length > 1 && (
          <select
            id="session-school"
            aria-label="المؤسسة"
            style={{ flex: "1 1 100%" }}
            value={group.key}
            onChange={(e) => {
              onClassId(firstClassOf(groups, e.target.value));
              setPicked([]);
              setScores({});
            }}
          >
            {groups.map((g) => (
              <option key={g.key} value={g.key}>{g.name}</option>
            ))}
          </select>
        )}
        <select
          id="session-class"
          aria-label="القسم"
          value={classId}
          onChange={(e) => {
            onClassId(e.target.value);
            setPicked([]);
            setScores({});
          }}
        >
          {group.classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select id="session-count" value={count} onChange={(e) => onCount(Number(e.target.value))}>
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
                {/* الاسم يخرج والقائمة لا تُعاد: الغائب لا يُنقص الحصة واحدًا */}
                <button className="clearb" onClick={() => swap(student)}>بدّله</button>
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

/**
 * الوثائق: كل ما له ملف في مكان واحد.
 *
 * كانت وثيقة حجز النقاط في الإعدادات والكشف مخبّأً في أسفل جدول القسم، وهذا
 * خلط بين ما يُضبط مرة في السنة وما يُستعمل كل فصل. والأستاذ يبحث عن «وثيقة»
 * لا عن «إعداد».
 *
 * والفرق بين الاثنتين مكتوب هنا لا في الذاكرة: الإكسل يُرسل إلى الإدارة
 * بأربع خانات، والكشف يبقى عند الأستاذ بكل التفصيل.
 */
function DocsView({
  classes, schools, profile, onImport, onExport, onPrint,
}: {
  classes: Klass[];
  schools: School[];
  profile: Profile;
  onImport: () => void;
  onExport: () => void;
  onPrint: (classId: string) => void;
}) {
  const [forPrint, setForPrint] = useState("");
  const chosen = forPrint || classes[0]?.id || "";
  // اسم الأستاذ وحده هو الناقص هنا: مؤسسة الكشف صارت من القسم.
  const missingSchool = classes.some((c) => !c.school_id);
  const groups = groupBySchool(classes, schools);

  return (
    <section className="view">
      <div className="vhead">
        <div>
          <h2>الوثائق</h2>
          <p>ما يدخل التطبيق من ملفات وما يخرج منه.</p>
        </div>
      </div>

      <div className="card doccard">
        <div className="dochead">
          <b>وثيقة حجز النقاط</b>
          <span className="pill">إلى الإدارة</span>
        </div>
        <p>
          ارفع الوثيقة التي نزّلتها، فتُملأ خانات أقسامك كلها دفعة واحدة —
          التقويم المستمر والأعمال التطبيقية ومعدل الفروض والاختبار — وتعود
          برؤوسها وتنسيقها كما كانت.
        </p>
        <button className="btn full" onClick={onExport} disabled={!classes.length}>
          ارفع الوثيقة واملأها
        </button>
      </div>

      <div className="card doccard">
        <div className="dochead">
          <b>كشف القسم</b>
          <span className="pill">يبقى عندك</span>
        </div>
        <p>
          ورقة A4 فيها القسم كله: كل معيار في عموده، والمعدل والرتبة والتقدير،
          وإحصاء القسم وسطر الإمضاءين. تطبعها أو تحفظها PDF — للمداولات، أو
          لتبيّن من أين جاءت النقطة.
        </p>
        {!classes.length ? (
          <div className="note">استورد قسمًا أولًا.</div>
        ) : (
          <>
            {!profile.full_name && (
              <div className="note warn">
                اكتب اسمك في الإعدادات ← حسابي ليظهر في رأس الكشف.
              </div>
            )}
            {missingSchool && (
              <div className="note warn">
                بعض أقسامك بلا مؤسسة، فيُطبع رأس كشفها بلا اسم ثانوية.
              </div>
            )}
            <div className="pickbar">
              <select
                value={chosen}
                aria-label="القسم"
                onChange={(e) => setForPrint(e.target.value)}
                style={{ flex: 1 }}
              >
                {/* الأقسام مجموعة بمؤسساتها: اسم القسم وحده يتشابه بين ثانويتين */}
                {groups.map((group) =>
                  groups.length > 1 ? (
                    <optgroup key={group.key} label={group.name}>
                      {group.classes.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </optgroup>
                  ) : (
                    group.classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))
                  ),
                )}
              </select>
              <button className="btn" onClick={() => onPrint(chosen)}>
                افتح الكشف
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card doccard">
        <div className="dochead">
          <b>استيراد قسم</b>
          <span className="pill">إلى التطبيق</span>
        </div>
        <p>
          من ملف الإشراف التربوي (xlsx) يُقرأ اسم القسم وأسماء تلاميذه، أو
          الصق الأسماء سطرًا لكل تلميذ.
        </p>
        <button className="btn soft full" onClick={onImport}>استيراد قائمة</button>
      </div>
    </section>
  );
}

const TP_PRESETS = ["الأعمال التطبيقية", "التعبير الشفوي"];

/**
 * الإعدادات ثلاثة أبواب لا صفحة واحدة طويلة.
 *
 * كانت المعايير والمركّبات والبيانات الشخصية والحساب في سياق واحد يُمرَّر
 * مئات البكسلات، وهي أشياء لا يجمعها شيء: الأولى تُضبط مرة في السنة وتمسّ
 * كل علامة، والثانية تُكتب مرة ولا تمسّ حسابًا.
 */
function SettingsView({
  criteria, components, email, profile, schools, classes,
  onCriterion, resetTick, onAddCriterion, onDeleteCriterion, onComponent, onProfile,
  onAddSchool, onRenameSchool, onDeleteSchool, onSignOut,
}: {
  criteria: Criterion[];
  components: Component[];
  email: string;
  profile: Profile;
  schools: School[];
  classes: Klass[];
  onCriterion: (id: string, patch: Partial<Criterion>) => void;
  /** يزيد حين يُرفض تغيير معلَّق، فتعود خانة السقف إلى قيمتها المحفوظة. */
  resetTick: number;
  onAddCriterion: () => void;
  onDeleteCriterion: (c: Criterion) => void;
  onComponent: (id: string, patch: Partial<Component>) => void;
  onProfile: (patch: Partial<Profile>) => void;
  onAddSchool: (name: string) => Promise<School | null>;
  onRenameSchool: (id: string, name: string) => void;
  onDeleteSchool: (school: School) => void;
  onSignOut: () => void;
}) {
  const [part, setPart] = useState<"scoring" | "schools" | "me">("scoring");
  const [pwdOpen, setPwdOpen] = useState(false);
  const check = checkTotal(criteria);

  return (
    <section className="view">
      <div className="vhead">
        <div>
          <h2>الإعدادات</h2>
        </div>
      </div>

      <div className="segmented" role="group" aria-label="أبواب الإعدادات">
        <button aria-pressed={part === "scoring"} onClick={() => setPart("scoring")}>
          التقويم
        </button>
        <button aria-pressed={part === "schools"} onClick={() => setPart("schools")}>
          المؤسسات
        </button>
        <button aria-pressed={part === "me"} onClick={() => setPart("me")}>
          حسابي
        </button>
      </div>

      {part === "scoring" && (
      <>
      <div className="note">
        المعايير والمركّبات تسري على كل الأقسام والفصول الثلاثة.
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
                  key={`${c.id}-${c.ceiling}-${resetTick}`}
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
      </>
      )}

      {part === "schools" && (
        <SchoolsSettings
          schools={schools}
          classes={classes}
          onAdd={onAddSchool}
          onRename={onRenameSchool}
          onDelete={onDeleteSchool}
        />
      )}

      {part === "me" && (
      <>
      {/* تُطبع في رأس كشف القسم، ولا تدخل أي حساب. والمؤسسة ليست منها:
          هي صفة القسم، فبابها «المؤسسات». */}
      <div className="card">
        <div className="srow2">
          <b>بياناتي</b>
          <div className="hspace" />
          <span className="pill">تظهر في الكشف المطبوع</span>
        </div>
        {([
          ["full_name", "الاسم واللقب", ""],
          ["subject", "المادة", "مثال: علوم الطبيعة والحياة"],
        ] as const).map(([field, label, hint]) => (
          <div key={field} className="srow2">
            <div className="k">
              {label}
              {hint && <small>{hint}</small>}
            </div>
            <input
              id={`profile-${field}`}
              style={{ width: 170 }}
              aria-label={label}
              defaultValue={profile[field] ?? ""}
              onBlur={(e) => {
                const text = e.target.value.trim();
                const next = field === "full_name" ? text : text === "" ? null : text;
                if (next !== (profile[field] ?? (field === "full_name" ? "" : null))) {
                  onProfile({ [field]: next } as Partial<Profile>);
                }
              }}
            />
          </div>
        ))}
      </div>

      <div className="card">
        <div className="srow2">
          <div className="k">
            الحساب
            <small dir="ltr" style={{ textAlign: "start" }}>{email}</small>
          </div>
          <button className="btn ghost" onClick={onSignOut}>خروج</button>
        </div>
        <div className="srow2">
          <div className="k">
            كلمة السر
            <small>غيّرها وأنت داخل حسابك</small>
          </div>
          <button className="btn ghost" onClick={() => setPwdOpen(true)}>تغيير</button>
        </div>
        <div className="srow2">
          <div className="k">
            الخصوصية
            <small>أين تُحفظ بيانات تلاميذك ومن يراها</small>
          </div>
          <a className="btn ghost" href="/privacy">اقرأ</a>
        </div>
        <div className="srow2">
          <div className="k">
            حذف الحساب
            <small>يمحو كل أقسامك وعلاماتك نهائيًا</small>
          </div>
          <a className="btn warn" href="/account">حذف…</a>
        </div>
      </div>
      </>
      )}
      {pwdOpen && <ChangePasswordSheet email={email} onClose={() => setPwdOpen(false)} />}
    </section>
  );
}

/**
 * تغيير كلمة السر في نافذة منبثقة، دون مغادرة الإعدادات. تُطلب الحالية ويُتحقَّق
 * منها أولًا: هاتف مفتوح تركه صاحبه على الطاولة لا يكفي لأخذ حساب فيه علامات
 * فصل كامل. (ومن نسي كلمته فطريقه شاشة الدخول ← «نسيت كلمة السر؟».)
 */
function ChangePasswordSheet({ email, onClose }: { email: string; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    const problem = changePasswordProblem(current, next, again);
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy(true);
    setMessage("");
    const client = createClient();

    const check = await client.auth.signInWithPassword({ email, password: current });
    if (check.error) {
      const wrong = check.error.message.toLowerCase().includes("invalid login");
      setMessage(wrong ? "كلمة السر الحالية غير صحيحة." : translateAuthError(check.error.message));
      setBusy(false);
      return;
    }

    const { error } = await client.auth.updateUser({ password: next });
    setBusy(false);
    if (error) {
      setMessage(translateAuthError(error.message));
      return;
    }
    setDone(true);
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="تغيير كلمة السر">
        <div className="shead">
          <h3>{done ? "تغيّرت كلمة السر" : "تغيير كلمة السر"}</h3>
          <button className="icbtn" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {done ? (
          <>
            <p className="lead">استعملها في دخولك القادم. علاماتك كما هي.</p>
            <button className="btn full" onClick={onClose}>تمّ</button>
          </>
        ) : (
          <>
            {(
              [
                ["الحالية", current, setCurrent, "current-password"],
                ["الجديدة", next, setNext, "new-password"],
                ["أعد كتابة الجديدة", again, setAgain, "new-password"],
              ] as const
            ).map(([label, value, set, auto]) => (
              <div key={label} className="fld">
                <div className="flab">
                  <b>{label === "أعد كتابة الجديدة" ? label : `كلمة السر ${label}`}</b>
                </div>
                <input
                  className="inp"
                  type="password"
                  style={{ width: "100%" }}
                  dir="ltr"
                  value={value}
                  autoComplete={auto}
                  minLength={label === "الحالية" ? undefined : MIN_PASSWORD}
                  onChange={(e) => set(e.target.value)}
                />
              </div>
            ))}

            {message && <div className="note bad">{message}</div>}

            <button
              className="btn"
              style={{ marginTop: 14 }}
              disabled={busy || !current || !next || !again}
              onClick={() => void submit()}
            >
              {busy ? "لحظة…" : "حفظ كلمة السر"}
            </button>
          </>
        )}
      </div>
    </>
  );
}

/** إضافة مؤسسة من شاشة المؤسسات نفسها، دون المرور بالإعدادات. */
/**
 * إضافة تلميذ أو أكثر إلى قسم قائم: وافد في منتصف السنة، أو اسم سقط من
 * الاستيراد. سطر لكل تلميذ، فيُلصق عدّة أسماء مرّة واحدة كما في الاستيراد.
 * ما يشبه اسمًا في القسم يُعرض قبل الإضافة: قد يكون خطأ تكرار، وقد يكون
 * تلميذين بالاسم نفسه حقًّا، والأستاذ وحده يعرف.
 */
function AddStudentsSheet({
  klass, existing, onClose, onAdd,
}: {
  klass: Klass;
  existing: string[];
  onClose: () => void;
  onAdd: (names: string[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [keepRepeated, setKeepRepeated] = useState(false);
  const [busy, setBusy] = useState(false);
  const { fresh, repeated } = splitNewNames(text, existing);
  const names = keepRepeated ? [...fresh, ...repeated] : fresh;

  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>إضافة إلى {klass.name}</h3>
          <button className="icbtn" onClick={onClose} disabled={busy} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="fld">
          <div className="flab">
            <b>اللقب والاسم</b>
            <small>تلميذ في كل سطر</small>
          </div>
          <textarea
            id="add-students"
            className="inp"
            style={{ width: "100%" }}
            rows={3}
            autoFocus
            value={text}
            placeholder={"اللقب الاسم"}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        {repeated.length > 0 && (
          <div className="note">
            موجود في القسم أو مكرّر: {repeated.join("، ")}
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
              <input
                type="checkbox"
                checked={keepRepeated}
                onChange={(e) => setKeepRepeated(e.target.checked)}
              />
              تلميذ آخر بالاسم نفسه، أضفه أيضًا
            </label>
          </div>
        )}

        <button
          className="btn"
          style={{ marginTop: 14 }}
          disabled={busy || names.length === 0}
          onClick={async () => {
            setBusy(true);
            await onAdd(names);
            setBusy(false);
          }}
        >
          {busy
            ? "جارٍ الإضافة…"
            : names.length > 1
              ? `أضف ${names.length} تلاميذ`
              : "أضف التلميذ"}
        </button>
      </div>
    </>
  );
}

function NewSchoolSheet({
  onClose, onAdd,
}: {
  onClose: () => void;
  onAdd: (name: string) => Promise<School | null>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>مؤسسة جديدة</h3>
          <button className="icbtn" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="fld">
          <div className="flab">
            <b>اسم الثانوية</b>
            <small>يُطبع في رأس كشف أقسامها</small>
          </div>
          <input
            id="new-school"
            className="inp"
            style={{ width: "100%" }}
            value={name}
            autoFocus
            placeholder="مثال: ثانوية رمضان حمود"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button
          className="btn"
          style={{ marginTop: 14 }}
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            const created = await onAdd(name.trim());
            setBusy(false);
            if (created) onClose();
          }}
        >
          {busy ? "جارٍ الإضافة…" : "أضفها"}
        </button>
      </div>
    </>
  );
}

/**
 * إصلاح قسم بلا مؤسسة.
 *
 * ورقة لا تُغلق بنقرة خارجها ولا بزرّ إغلاق: المؤسسة صارت إلزامية، وقسمٌ
 * بلا واحدة يُطبع رأس كشفه ناقصًا ولا يظهر تحت أيّ بطاقة. والحالة تنشأ من
 * حسابات أُنشئت قبل المؤسسات، أو من مؤسسة حُذفت بأقسامها.
 *
 * ومن لا مؤسسة له أصلًا يكتبها هنا، فلا يُحال إلى شاشة أخرى وهو محبوس.
 */
function SchoolFixSheet({
  orphans, schools, onAddSchool, onAssign,
}: {
  orphans: Klass[];
  schools: School[];
  onAddSchool: (name: string) => Promise<School | null>;
  onAssign: (classId: string, schoolId: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const klass = orphans[0];
  const [picked, setPicked] = useState("");
  const chosen = picked || schools[0]?.id || "";

  return (
    <>
      <div className="scrim" />
      <div className="sheet">
        <div className="shead">
          <h3>مؤسسة {klass.name}</h3>
        </div>
        <p className="lead">
          كل قسم ينتمي إلى مؤسسة: اسمها يُطبع في رأس كشفه، وبها تُجمع
          الأقسام. وهذا القسم بلا واحدة.
          {orphans.length > 1 &&
            ` وبعده ${countWord(orphans.length - 1, "قسم واحد", "قسمان", "أقسام", "قسمًا")}.`}
        </p>

        {schools.length > 0 && (
          <div className="fld">
            <div className="flab">
              <b>اخترها من مؤسساتك</b>
            </div>
            <div className="pickbar">
              <select
                id="fix-school"
                style={{ flex: 1 }}
                value={chosen}
                aria-label="المؤسسة"
                onChange={(e) => setPicked(e.target.value)}
              >
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button
                className="btn"
                disabled={busy || !chosen}
                onClick={async () => {
                  setBusy(true);
                  await onAssign(klass.id, chosen);
                  setBusy(false);
                }}
              >
                {busy ? "جارٍ الحفظ…" : "احفظ"}
              </button>
            </div>
          </div>
        )}

        <div className="fld">
          <div className="flab">
            <b>{schools.length ? "أو أضف مؤسسة جديدة" : "اكتب اسم مؤسستك"}</b>
          </div>
          <div className="pickbar addrow">
            <input
              id="fix-newschool"
              className="inp"
              value={name}
              placeholder="مثال: ثانوية رمضان حمود"
              aria-label="مؤسسة جديدة"
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className={schools.length ? "btn soft" : "btn"}
              disabled={busy || !name.trim()}
              onClick={async () => {
                setBusy(true);
                const created = await onAddSchool(name.trim());
                if (created) {
                  await onAssign(klass.id, created.id);
                  setName("");
                }
                setBusy(false);
              }}
            >
              أضفها
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * المؤسسات وأقسامها.
 *
 * حذف المؤسسة لا يحذف أقسامها — تبقى بلا مؤسسة وتُنسب من جديد — فالتأكيد
 * سطرٌ في مكانه لا ورقة منبثقة: لا علامة تضيع.
 */
function SchoolsSettings({
  schools, classes, onAdd, onRename, onDelete,
}: {
  schools: School[];
  /** للعدّ وحده: مؤسسة القسم تُختار مرة عند استيراده. */
  classes: Klass[];
  onAdd: (name: string) => Promise<School | null>;
  onRename: (id: string, name: string) => void;
  onDelete: (school: School) => void;
}) {
  const [adding, setAdding] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);

  return (
    <>
      <div className="note">
        المؤسسة صفة القسم: رأس كشفه يأخذ اسمها، والأقسام تُجمع بها في
        قائمة الأقسام.
      </div>

      <div className="card">
        <div className="srow2">
          <b>مؤسساتي</b>
          <div className="hspace" />
          <span className="pill">{schools.length}</span>
        </div>

        {schools.length === 0 && (
          <div className="srow2">
            <div className="k">
              لا مؤسسة بعد
              <small>أضف ثانويتك ليظهر اسمها في الكشف المطبوع</small>
            </div>
          </div>
        )}

        {schools.map((school) => {
          const count = classes.filter((c) => c.school_id === school.id).length;
          return (
            <div key={school.id} className="crit">
              <div className="critop">
                <input
                  className="cname"
                  id={`school-${school.id}`}
                  aria-label="اسم المؤسسة"
                  defaultValue={school.name}
                  onBlur={(e) => {
                    const text = e.target.value.trim();
                    if (text && text !== school.name) onRename(school.id, text);
                    else e.target.value = school.name;
                  }}
                />
                <span className="pill">
                  {countWord(count, "قسم واحد", "قسمان", "أقسام", "قسمًا")}
                </span>
                <button
                  className="icbtn danger"
                  aria-label={`حذف ${school.name}`}
                  onClick={() => setConfirm(confirm === school.id ? null : school.id)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                  </svg>
                </button>
              </div>
              {confirm === school.id && (
                <div className="srow2">
                  <div className="k">
                    {count
                      ? `لا تضيع علامة، لكن ${countWord(count, "قسمًا واحدًا سيُسأل", "قسمين سيُسألان", "أقسام ستُسأل", "قسمًا سيُسأل")} عن مؤسسة جديدة.`
                      : "لا أقسام فيها."}
                  </div>
                  <button className="btn ghost" onClick={() => setConfirm(null)}>تراجع</button>
                  <button
                    className="btn warn"
                    onClick={() => {
                      setConfirm(null);
                      onDelete(school);
                    }}
                  >
                    احذفها
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <div className="srow2 addrow">
          <input
            id="school-new"
            value={adding}
            aria-label="مؤسسة جديدة"
            placeholder="أضف مؤسسة: ثانوية…"
            onChange={(e) => setAdding(e.target.value)}
          />
          <button
            className="btn soft"
            disabled={!adding.trim()}
            onClick={async () => {
              const created = await onAdd(adding.trim());
              if (created) setAdding("");
            }}
          >
            أضف
          </button>
        </div>
      </div>

    </>
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
  const step = stepFor(criterion);
  const isDeduct = criterion.kind === "deduct";

  const stored = record?.criteria?.[criterion.code];
  const value = typeof stored === "number" ? stored : null;
  const assessed = value !== null;
  const shown = shownValue(criterion, value);

  // عند الصفر لا ينزل أكثر: «مسح» هو طريق الرجوع إلى «لم يُقيَّم».
  const atFloor = isDeduct ? shown === 0 : !assessed || shown === 0;
  const atRoof = (shown ?? 0) >= ceiling && (isDeduct || assessed);

  return (
    // التسمية والعدّاد في سطر واحد: خمسة معايير في ملء الشاشة بدل ثلاثة
    <div className="fld line">
      <div className="flab">
        <b>{criterion.label}</b>
        {!isDeduct && !assessed && <small>لم يُقيَّم</small>}
      </div>
      <div className="counter">
        <button
          className="cbtn"
          onClick={() => onChange(bump(criterion, value, -step))}
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
          onClick={() => onChange(bump(criterion, value, step))}
          disabled={atRoof}
          aria-label={`أضف ${step}`}
        >
          +
        </button>
        {/* خانة «مسح» محجوزة دائمًا: ظهورها واختفاؤها كان يزحزح الأزرار تحت الإصبع */}
        <span className="clearslot">
          {assessed && (
            <button className="clearb" onClick={() => onChange(null)} aria-label={`امسح ${criterion.label}`}>
              مسح
            </button>
          )}
        </span>
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

const KIND_LABEL: Record<Criterion["kind"], string> = {
  deduct: "يبدأ كاملًا ويُخصم منه",
  add: "يبدأ من 0 ويُضاف إليه",
  auto: "من محاولات القراءة",
};

/**
 * تغيير نوع المعيار أو سقفه بعد أن سُجّلت علامات فيه. الأرقام المخزَّنة لا
 * تُمسّ، لكن معناها يتغيّر: 3 في معيار إضافة هي «ثلاث نقاط»، وفي معيار خصم
 * هي «خُصمت ثلاث». فيُقال هذا قبل التطبيق لا بعده.
 */
function ConfirmCriterionChangeSheet({
  criterion, patch, marked, onCancel, onConfirm,
}: {
  criterion: Criterion;
  patch: Partial<Criterion>;
  marked: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const kindChanged = patch.kind !== undefined && patch.kind !== criterion.kind;
  const ceilingChanged =
    patch.ceiling !== undefined && Number(patch.ceiling) !== Number(criterion.ceiling);
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="sheet">
        <div className="shead">
          <h3>تغيير معيار {criterion.label}</h3>
        </div>
        <p className="lead">
          {kindChanged && patch.kind
            ? `النوع: «${KIND_LABEL[criterion.kind]}» ← «${KIND_LABEL[patch.kind]}». `
            : ""}
          {ceilingChanged ? `السقف: ${Number(criterion.ceiling)} ← ${Number(patch.ceiling)}. ` : ""}
          في هذا المعيار {marked} علامة مسجَّلة في كل الأقسام والفصول. تبقى
          أرقامها كما هي، لكن معناها يتغيّر فيتغيّر التقويم المستمر لأصحابها.
        </p>
        <div className="srow2">
          <button className="btn ghost" onClick={onCancel}>تراجع</button>
          <div className="hspace" />
          <button className="btn danger" onClick={onConfirm}>غيّر المعيار</button>
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

/* ================= الإرسال: المؤشّر وقائمة المعلّقات ================= */

/** «منذ ثلاث دقائق» — الأستاذ يحتاج أن يعرف كم عمر ما يراه. */
function since(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return "قبل لحظات";
  if (minutes < 60) return `منذ ${countWord(minutes, "دقيقة", "دقيقتين", "دقائق", "دقيقة")}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `منذ ${countWord(hours, "ساعة", "ساعتين", "ساعات", "ساعة")}`;
  return `منذ ${countWord(Math.round(hours / 24), "يوم", "يومين", "أيام", "يومًا")}`;
}

/**
 * مؤشّر الإرسال في رأس الشاشة.
 *
 * لا يُعرض رقمٌ إلا إن كان هناك ما ينتظر فعلًا: الأستاذ في الحصة يحتاج أن
 * يعرف بنظرة أن علاماته وصلت، لا أن يقرأ شريط حالة دائمًا.
 */
function SyncBadge({
  waiting, online, sending, label, onClick,
}: {
  waiting: ReturnType<typeof pending>;
  online: boolean;
  sending: boolean;
  label: string;
  onClick: () => void;
}) {
  const tone = waiting.blocked ? "bad" : !online ? "off" : waiting.total ? "busy" : "ok";
  const title = waiting.blocked
    ? `${label} — منها ${waiting.blocked} متعثّرة`
    : waiting.total
      ? online
        ? `${label} — جارٍ الإرسال`
        : `${label} — ستُرسل عند عودة الشبكة`
      : online
        ? "كل ما أدخلته محفوظ في الخادم"
        : "دون اتصال، ولا شيء ينتظر الإرسال";

  return (
    <button
      className={`sync ${tone}${sending ? " busy-now" : ""}`}
      onClick={onClick}
      aria-label={title}
      title={title}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {tone === "ok" ? (
          <path d="M20 6L9 17l-5-5" />
        ) : tone === "off" ? (
          <path d="M4 4l16 16M7 18h9a4 4 0 00.9-7.9A6 6 0 008 8.6" />
        ) : tone === "bad" ? (
          <path d="M12 8v5M12 16.5v.01M12 3l9 17H3z" />
        ) : (
          <path d="M12 16V8m0 0l-3 3m3-3l3 3M7 18h9a4 4 0 100-8 6 6 0 00-11.3 1.5A3.5 3.5 0 006 18h1" />
        )}
      </svg>
      {waiting.total > 0 && <span className="num">{waiting.total}</span>}
    </button>
  );
}

function opWho(op: Op): string {
  return opStudentId(op) ?? "";
}

function opWhat(op: Op): string {
  switch (op.kind) {
    case "record":
      return `علامات الفصل ${op.term}`;
    case "reading-add":
      return `محاولة قراءة ${op.reading.score}`;
    case "reading-del":
      return "حذف محاولة قراءة";
    case "student":
      return "بيانات التلميذ";
    case "tp-session":
      return `حصة أعمال تطبيقية ${op.session.held_on.slice(5)}`;
    case "tp-mark":
      return op.absent ? "غياب في حصة أعمال تطبيقية" : op.score === null ? "مسح علامة أعمال تطبيقية" : `علامة أعمال تطبيقية ${op.score}`;
  }
}

/**
 * قائمة ما لم يصل الخادم بعد: باسم التلميذ ووقت إدخاله.
 *
 * وجودها هو ما يجعل الطابور أمانًا لا صندوقًا أسود: الأستاذ يرى بعينه أن
 * العشرين علامة لم تضع، ويقرّر في المتعثّر منها.
 */
function PendingSheet({
  queue, waiting, online, sending, lastSyncedAt, nameOf,
  onClose, onFlush, onRetry, onDiscard,
}: {
  queue: Op[];
  waiting: ReturnType<typeof pending>;
  online: boolean;
  sending: boolean;
  lastSyncedAt: number | null;
  nameOf: (studentId: string) => string;
  onClose: () => void;
  onFlush: () => void;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>{waiting.total ? pendingLabel(queue) : "كل شيء محفوظ"}</h3>
          <button className="icbtn" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <p className="lead">
          {!online
            ? "لا اتصال الآن. ما أدخلته محفوظ في الجهاز ويُرسل وحده عند عودة الشبكة — ولو أُغلق التطبيق."
            : sending
              ? "جارٍ الإرسال…"
              : waiting.total
                ? "في الطريق إلى الخادم."
                : lastSyncedAt
                  ? `آخر إرسال ${since(lastSyncedAt)}.`
                  : "لا شيء ينتظر الإرسال."}
        </p>

        {waiting.total > 0 && isDurable() === false && (
          <div className="note warn">
            هذا المتصفّح لا يسمح بالحفظ في الجهاز (نافذة خاصة غالبًا)، فما ينتظر
            الإرسال يضيع بإغلاق التطبيق. أبقِه مفتوحًا حتى تعود الشبكة.
          </div>
        )}

        {waiting.blocked > 0 && (
          <div className="note bad">
            {waiting.blocked} منها رفضها الخادم ولن تنجح بإعادة المحاولة وحدها —
            غالبًا لأن التلميذ حُذف. راجعها أدناه.
          </div>
        )}

        {queue.length > 0 && (
          <div className="plist">
            {queue.map((op) => (
              <div key={op.id} className={op.blocked ? "prow bad" : "prow"}>
                <div className="k">
                  <b>{op.kind === "tp-session" ? "حصة جديدة" : nameOf(opWho(op))}</b>
                  <small>
                    {opWhat(op)} · {since(op.at)}
                  </small>
                  {op.blocked && op.error && <small className="perr">{op.error}</small>}
                </div>
                {op.blocked ? (
                  <div className="pacts">
                    <button className="clearb" onClick={() => onRetry(op.id)}>أعد</button>
                    <button className="clearb danger" onClick={() => onDiscard(op.id)}>تجاهل</button>
                  </div>
                ) : (
                  <span className="pill">{op.tries > 0 ? `محاولة ${op.tries}` : "ينتظر"}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {waiting.total > 0 && online && (
          <button className="btn" style={{ marginTop: 14 }} onClick={onFlush} disabled={sending}>
            {sending ? "جارٍ الإرسال…" : "أرسل الآن"}
          </button>
        )}
      </div>
    </>
  );
}

function ConfirmSignOutSheet({
  label, onCancel, onShow, onConfirm,
}: {
  label: string;
  onCancel: () => void;
  onShow: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="sheet">
        <div className="shead">
          <h3>الخروج قبل الإرسال</h3>
        </div>
        <p className="lead">
          {label} بعد. الخروج يمسح بيانات هذا الجهاز، فتضيع. انتظر عودة الشبكة
          ثم اخرج.
        </p>
        <div className="srow2">
          <button className="btn ghost" onClick={onCancel}>تراجع</button>
          <div className="hspace" />
          <button className="btn soft" onClick={onShow}>أرني</button>
          <button className="btn danger" onClick={onConfirm}>اخرج وامسح</button>
        </div>
      </div>
    </>
  );
}

/* ================= sheets ================= */

const MARK_HINT = "العلامة بين 0 و20";

/**
 * ما كُتب في خانة علامة من 20. ثلاث حالات لا اثنتان: الفراغ الحقيقي يمسح،
 * أما نصّ لم يفهمه المتصفّح («14,» مثلًا) فيصل فراغًا في value مع badInput،
 * ومعاملته مسحًا تمحو علامة محفوظة بخطأ في الإصبع.
 */
function readMark(
  input: HTMLInputElement,
): { kind: "empty" } | { kind: "bad" } | { kind: "ok"; value: number } {
  const text = input.value.trim();
  if (text === "") return input.validity.badInput ? { kind: "bad" } : { kind: "empty" };
  const value = Number(text);
  if (Number.isNaN(value) || value < 0 || value > 20) return { kind: "bad" };
  return { kind: "ok", value };
}

function StudentSheet({
  student, criteria, record, readings, components, tp,
  onClose, onCriterion, onMark, onRemoveReading, onEdit, onDelete,
  position, count, onStep,
}: {
  student: Student;
  criteria: Criterion[];
  /** السجل للعرض: معدّل الحصص فيه محلّ الخانة المربوطة. لا يُكتب منه شيء. */
  record: RecordRow | undefined;
  readings: Reading[];
  components: Component[];
  /** وجهة معدّل الحصص ومعدّل هذا التلميذ، فتُقفل الخانة التي يُحسب فيها. */
  tp: { target: TpTarget; average: number | null };
  onClose: () => void;
  onCriterion: (code: string, value: number | null) => void;
  onMark: (field: MarkField, value: number | null) => void;
  onRemoveReading: (id: string) => void;
  onEdit: (patch: Partial<Student>) => void;
  onDelete: () => void;
  /** موضعه في القسم وعدد تلاميذه، للتنقّل دون إغلاق البطاقة. */
  position: number;
  count: number;
  onStep: (step: number) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [showState, setShowState] = useState(false);
  /** محاولة القراءة المهيَّأة للحذف: النقرة الأولى تهيّئ، والثانية تحذف. */
  const [armed, setArmed] = useState<string | null>(null);
  /** الخانة التي رُفضت قيمتها، ولأيّ تلميذ: لا تنتقل رسالتها إلى التالي. */
  const [markError, setMarkError] = useState<{ id: string; field: MarkField } | null>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
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
          {/* تنقّل داخل القسم: تنقيط عشرة تلاميذ كان عشر فتحات وإغلاقات */}
          {count > 1 && (
            <div className="stepper" role="group" aria-label="تلميذ آخر">
              <button
                onClick={() => onStep(-1)}
                disabled={position <= 1}
                aria-label="التلميذ السابق"
              >
                ›
              </button>
              <span className="num">{position}/{count}</span>
              <button
                onClick={() => onStep(1)}
                disabled={position >= count}
                aria-label="التلميذ التالي"
              >
                ‹
              </button>
            </div>
          )}
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

        {/* النقطة أولًا: هي ما فُتحت البطاقة لأجله، فلا تُطلب بتمرير الشاشة */}
        <div className="totals top">
          <Stat value={fmt(cc)} label={ccLabel} />
          <Stat value={fmt(average)} label="معدل المادة" />
          <Stat value={grade(average) || "—"} label="التقدير" />
        </div>

        {edit ? (
          <div className="fld">
            <label className="elab" htmlFor={`name-${student.id}`}>الاسم واللقب</label>
            <input
              key={`${student.id}-${student.full_name}`}
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
                      <button
                        key={r.id}
                        className={armed === r.id ? "danger" : undefined}
                        title="انقر مرتين للحذف"
                        onClick={() => {
                          if (armed !== r.id) {
                            setArmed(r.id);
                            return;
                          }
                          setArmed(null);
                          onRemoveReading(r.id);
                        }}
                      >
                        {armed === r.id ? "احذف؟ ✕" : `${r.score} · ${r.read_on.slice(5)}`}
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          }
          if (tp.average !== null && targetCriterionCode(tp.target) === c.code) {
            return (
              <div key={c.id} className="fld line">
                <div className="flab">
                  <b>{c.label}</b>
                  <small>من حصص الأعمال التطبيقية</small>
                </div>
                <span className="rowlock num">
                  {fmt(record?.criteria?.[c.code] ?? null)} / {c.ceiling}
                </span>
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
          if (field === "tp" && tp.average !== null && tp.target === TP_COMPONENT) {
            return (
              <div key={component.id} className="fld line">
                <div className="flab">
                  <b>{component.label}</b>
                  <small>معدّل حصصه · معامل {Number(component.weight)}</small>
                </div>
                <span className="rowlock num">{fmt(tp.average)} / 20</span>
              </div>
            );
          }
          const current = record?.[field] ?? null;
          const refused = markError?.id === student.id && markError.field === field;
          return (
            <div key={component.id} className="fld line">
              <div className="flab">
                <b>{component.label}</b>
                <small>معامل {Number(component.weight)}</small>
                {refused && <small className="ferr">{MARK_HINT}</small>}
              </div>
              <div className="mk">
                {/* المفتاح يضمّ التلميذ والقيمة: الخانة غير متحكَّم بها، فبلا هذا
                    تبقى علامة التلميذ السابق ظاهرة بعد «التالي» وتُكتب للتالي
                    إن لُمست الخانة. */}
                <input
                  key={`${student.id}-${field}-${current ?? ""}`}
                  id={`mark-${field}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={20}
                  step={0.25}
                  defaultValue={current ?? ""}
                  aria-invalid={refused}
                  onChange={() => setMarkError(null)}
                  onBlur={(e) => {
                    const read = readMark(e.target);
                    if (read.kind === "bad") {
                      e.target.value = String(current ?? "");
                      setMarkError({ id: student.id, field });
                      return;
                    }
                    setMarkError(null);
                    if (read.kind === "empty") {
                      if (current !== null) onMark(field, null);
                      return;
                    }
                    if (read.value !== current) onMark(field, read.value);
                  }}
                />
              </div>
            </div>
          );
        })}

        {/* الحالة الخاصة في الأسفل مطويّة: تُكتب مرة في الفصل، والعلامة كل حصة.
            وكانت تأكل رُبع الشاشة في رأس البطاقة قبل أن يُرى أول معيار. */}
        <button
          className={showState ? "staterow on" : "staterow"}
          aria-expanded={showState}
          onClick={() => setShowState(!showState)}
        >
          <b>حالة خاصة</b>
          <small>{state(student) || "لا شيء"}</small>
          <i aria-hidden>{showState ? "⌃" : "⌄"}</i>
        </button>

        {showState && (
          <div className="fld">
            <label className="elab" htmlFor={`note-${student.id}`}>
              لك وحدك، لتتذكّرها. لا تدخل أي حساب ولا تظهر في المعدلات ولا في الكشف.
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
              key={`${student.id}-${student.note ?? ""}`}
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
        )}
      </div>
    </>
  );
}

/** الملف كما هو، حين يعجز المتصفّح عن فكّ ترميز الصورة (HEIC من آيفون مثلًا). */
function fileAsBase64(file: File): Promise<{ data: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      resolve({ data: url.slice(url.indexOf(",") + 1), mime: file.type || "image/jpeg" });
    };
    reader.readAsDataURL(file);
  });
}

/** يصغّر الصورة قبل إرسالها: صورة الهاتف 4 ميغا تُبطئ الرفع ولا تزيد دقّة. */
async function shrinkImage(file: File): Promise<{ data: string; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const long = Math.max(bitmap.width, bitmap.height);
  const scale = long > 1600 ? 1600 / long : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { data: url.slice(url.indexOf(",") + 1), mime: "image/jpeg" };
}

type Source = "photo" | "file" | "paste";

/** ورقة القسم صفحتان على الأكثر، وهو ما يقبله الخادم أيضًا. */
const MAX_SHOTS = 2;

/**
 * استيراد قسم من ثلاثة أبواب: صورة الورقة، أو ملف الإشراف التربوي، أو لصق
 * الأسماء. وكانت الثلاثة مكدّسة في ورقة واحدة طويلة، والأستاذ يستعمل بابًا
 * واحدًا في المرة — فصارت تُختار أولًا ولا يظهر إلا بابها.
 *
 * والأسماء في النهاية نصّ واحد مهما كان مصدرها: ما يُقرأ من صورة أو ملف
 * يبقى قابلًا للتصحيح باليد قبل الإنشاء، فلا تُحفظ قراءة خاطئة.
 */
function ImportSheet({
  onClose, onCreate, schools, defaultSchool, onAddSchool,
}: {
  onClose: () => void;
  onCreate: (name: string, names: string[], schoolId: string) => void;
  schools: School[];
  /** مؤسسة آخر قسم استُورد: الأستاذ يستورد أقسام ثانوية في جلسة واحدة. */
  defaultSchool: string | null;
  onAddSchool: (name: string) => Promise<School | null>;
}) {
  const [source, setSource] = useState<Source>("photo");
  const [name, setName] = useState("");
  const [schoolId, setSchoolId] = useState<string>(defaultSchool ?? schools[0]?.id ?? "");
  const [newSchool, setNewSchool] = useState("");
  /** حقل المؤسسة الجديدة مفتوح، ولو كان للأستاذ مؤسسات. */
  const [adding, setAdding] = useState(schools.length === 0);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  /** صور الورقة: صفحة أو صفحتان، تُقرآن معًا. */
  const [shots, setShots] = useState<Array<{ url: string; data: string; mime: string }>>([]);

  async function readFile(file: File) {
    setReading(true);
    setStatus("جارٍ قراءة الملف…");
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
    } finally {
      setReading(false);
    }
  }

  /** تُضاف الصور إلى ما اختير، حتى صفحتين: ورقة القسم قد تكون صفحتين. */
  async function addShots(files: File[]) {
    const room = MAX_SHOTS - shots.length;
    if (room <= 0) {
      setStatus(`صفحتان على الأكثر. احذف واحدة لتضيف غيرها.`);
      return;
    }
    const taken = files.slice(0, room);
    const ready = await Promise.all(
      taken.map(async (file) => {
        const { data, mime } = await shrinkImage(file).catch(() => fileAsBase64(file));
        return { url: `data:${mime};base64,${data}`, data, mime };
      }),
    );
    setShots((before) => [...before, ...ready]);
    setStatus(
      files.length > room
        ? "صفحتان على الأكثر: أخذتُ الأولى."
        : "",
    );
  }

  /** الصفحتان تُقرآن في طلب واحد: النموذج يرى القائمة كاملة فلا يكرّر ولا يقطع. */
  async function readShots() {
    if (!shots.length) return;
    setReading(true);
    setStatus("جارٍ قراءة الصور…");
    try {
      const response = await fetch("/api/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: shots.map((shot) => ({ data: shot.data, mime: shot.mime })),
        }),
      });
      const payload = (await response.json()) as {
        cls?: string;
        names?: string[];
        error?: string;
      };
      if (!response.ok) {
        setStatus(payload.error ?? "تعذّرت قراءة الصور.");
        return;
      }
      const found = payload.names ?? [];
      if (!found.length) {
        setStatus("لم أجد أسماء. صوّر الورقة كاملة وواضحة.");
        return;
      }
      if (payload.cls && !name) setName(payload.cls);
      setText(found.join("\n"));
      setStatus(`قرأتُ ${found.length} اسمًا — راجعها قبل الإنشاء.`);
    } catch {
      setStatus("تعذّرت قراءة الصور. أعد المحاولة أو الصق الأسماء.");
    } finally {
      setReading(false);
    }
  }

  const names = text.split("\n").map((t) => t.trim()).filter((t) => t.length > 1);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>قسم جديد</h3>
          <button className="icbtn" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="segmented" role="group" aria-label="مصدر الأسماء">
          <button aria-pressed={source === "photo"} onClick={() => setSource("photo")}>
            صورة
          </button>
          <button aria-pressed={source === "file"} onClick={() => setSource("file")}>
            ملف الإشراف
          </button>
          <button aria-pressed={source === "paste"} onClick={() => setSource("paste")}>
            لصق
          </button>
        </div>

        {source === "photo" && (
          <div className="fld">
            <div className="flab">
              <b>ورقة القسم</b>
              <small>مطبوعة أو بخطّ اليد · صفحتان على الأكثر</small>
            </div>

            {shots.length > 0 && (
              <div className="shotrow">
                {shots.map((shot, index) => (
                  <div key={shot.url} className="thumb">
                    {/* صورة محلّية لم تُرفع بعد: next/image لا يعالج data: */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot.url} alt={`صفحة ${index + 1}`} />
                    <button
                      className="icbtn danger"
                      aria-label={`احذف صفحة ${index + 1}`}
                      onClick={() => setShots((before) => before.filter((_, i) => i !== index))}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* بلا capture: الهاتف يعرض الكاميرا والمعرض معًا فيختار الأستاذ */}
            {shots.length < MAX_SHOTS && (
              <label className={shots.length ? "shot small" : "shot"}>
                <input
                  id="import-photo"
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={reading}
                  onChange={(e) => {
                    const files: File[] = e.target.files ? Array.from(e.target.files) : [];
                    e.target.value = "";
                    if (files.length) void addShots(files);
                  }}
                />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8h3.5L8 6h8l1.5 2H21v11H3z" />
                  <circle cx="12" cy="13.5" r="3.5" />
                </svg>
                <b>{shots.length ? "أضف الصفحة الثانية" : "صوّر الورقة أو اخترها من المعرض"}</b>
                {!shots.length && <small>من الكاميرا أو من صورك</small>}
              </label>
            )}

            {shots.length > 0 && (
              <button
                className="btn full"
                style={{ marginTop: 10 }}
                disabled={reading}
                onClick={() => void readShots()}
              >
                {reading
                  ? "جارٍ القراءة…"
                  : `اقرأ الأسماء من ${countWord(shots.length, "الصورة", "الصورتين", "الصور", "الصور")}`}
              </button>
            )}
          </div>
        )}

        {source === "file" && (
          <div className="fld">
            <div className="flab">
              <b>ملف الإشراف التربوي</b>
              <small>xlsx — يُقرأ اسم القسم والأسماء تلقائيًا</small>
            </div>
            <input
              id="import-file"
              className="inp"
              style={{ width: "100%" }}
              type="file"
              accept=".xlsx,.xls"
              disabled={reading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
          </div>
        )}

        {status && <div className="note">{status}</div>}

        <div className="fld">
          <div className="flab">
            <b>{source === "paste" ? "الصق الأسماء" : "الأسماء"}</b>
            <small>سطر لكل تلميذ · {names.length}</small>
          </div>
          <textarea
            id="import-names"
            className="inp"
            style={{ minHeight: source === "paste" ? 150 : 110 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"اللقب الاسم\nاللقب الاسم\n…"}
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

        {/* المؤسسة تُسأل هنا لا بعد الاستيراد: رأس الكشف يأخذها، ونقل قسم
            بعد تنقيطه أصعب من اختياره مرة. */}
        <div className="fld">
          <div className="flab">
            <b>المؤسسة</b>
            <small>لازمة — تظهر في رأس كشف هذا القسم</small>
          </div>
          {schools.length > 0 && !adding && (
            <div className="pickbar">
              <select
                id="import-school"
                style={{ flex: 1, minWidth: 0 }}
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
              >
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {/* مؤسسة جديدة دون مغادرة الورقة: الأستاذ يستورد قسم ثانوية
                  لم يُدخلها بعد، فلا يُطرد إلى الإعدادات ثم يعود. */}
              <button
                className="btn soft"
                onClick={() => setAdding(true)}
                aria-label="أضف مؤسسة"
              >
                + مؤسسة
              </button>
            </div>
          )}
          {(schools.length === 0 || adding) && (
            <div className="pickbar addrow">
              <input
                id="import-newschool"
                className="inp"
                value={newSchool}
                onChange={(e) => setNewSchool(e.target.value)}
                placeholder="اسم الثانوية"
              />
              <button
                className="btn soft"
                disabled={!newSchool.trim()}
                onClick={async () => {
                  const created = await onAddSchool(newSchool.trim());
                  if (created) {
                    setSchoolId(created.id);
                    setNewSchool("");
                    setAdding(false);
                  }
                }}
              >
                أضفها
              </button>
              {schools.length > 0 && (
                <button className="clearb" onClick={() => setAdding(false)}>تراجع</button>
              )}
            </div>
          )}
        </div>

        <button
          className="btn"
          style={{ marginTop: 14 }}
          disabled={busy || reading}
          onClick={() => {
            if (!name.trim()) return setStatus("اكتب اسم القسم.");
            if (!names.length) return setStatus("لا أسماء بعد: صوّر الورقة أو ارفع الملف أو الصقها.");
            // المؤسسة إلزامية: قسمٌ بلا واحدة يُطبع رأس كشفه ناقصًا.
            if (!schoolId) return setStatus("اختر مؤسسة القسم أو أضفها.");
            setBusy(true);
            onCreate(name.trim(), names, schoolId);
          }}
        >
          {busy ? "جارٍ الإنشاء…" : `أنشئ القسم (${names.length} تلميذًا)`}
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
  { key: "docs", label: "الوثائق", path: "M7 3h7l4 4v14H7zM14 3v4h4M10 13h6M10 17h6" },
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
