"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensurePersistence, kvDel, kvGet, kvSet, type Persistence } from "@/lib/localdb";
import { backupFileName, buildBackup, normalizeData, type Backup } from "@/lib/backup";
import { exportFromServer } from "@/lib/backupDb";
import { useBackLayers } from "@/lib/useBackLayers";
import {
  algiersToday,
  termName,
  termNotice,
  termView,
  type TermRow,
} from "@/lib/terms";
import { nextPositions } from "@/lib/roster";
import { groupBySchool } from "@/lib/schools";
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
  canSignOut,
  newOp,
  opFingerprint,
  opSessionId,
  opStudentId,
  pending,
  pendingLabel,
  uid,
  type Op,
} from "@/lib/outbox";
import {
  applyTpTarget,
  checkTotal,
  classStats,
  componentValues,
  termAverage,
  tpAverages,
  type Component,
  type Criterion,
  type Reading,
  type RecordRow,
  type TpMark,
  type TpSession,
  type TpTarget,
  termStatsFor,
} from "@/lib/scoring";
import { Klass, NO_PROFILE, Profile, School, Snapshot, Student, Tab } from "./types";
import { today } from "./util";
import {
  emptyDraft,
  migrateWhere,
  openClassAfterTab,
  READING_COLUMN,
  type ReadingDraft,
} from "@/lib/readingDraft";
import { ClassesView } from "./ClassesView";
import { ClassView } from "./ClassView";
import { StatsView } from "./StatsView";
import { DocsView } from "./DocsView";
import { SettingsView } from "./SettingsView";
import { AddStudentsSheet, NewSchoolSheet, SchoolFixSheet } from "./RosterSheets";
import { ConfirmCriterionChangeSheet, ConfirmCriterionSheet, ConfirmSheet, ConfirmSignOutSheet, ConfirmStudentSheet } from "./ConfirmSheets";
import { PendingSheet, SyncBadge, since } from "./sync";
import { StudentSheet } from "./StudentSheet";
import { ImportSheet } from "./ImportSheet";
import { BackupSheet, backupJson, downloadBlob } from "./BackupSheet";
import { Tabs } from "./parts";

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
  /* روزنامة الفصول من الخادم (أو نسخة الجهاز). فارغة = لا شيء يُقفل، كما في القاعدة. */
  const [calendar, setCalendar] = useState<TermRow[]>([]);
  /** وصلت الروزنامة من نسخة الجهاز أو الخادم، فيُفتح الفصل الجاري مرة واحدة. */
  const [calendarKnown, setCalendarKnown] = useState(false);
  /** اليوم بتوقيت الجزائر؛ يتجدد إذا بقي التطبيق مفتوحًا عبر منتصف الليل. */
  const [todayIso, setTodayIso] = useState(() => algiersToday());
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
  /* عدد القرّاء في الحصة يُحفظ مع بقية المكان: الأستاذ يقرأ لعدد ثابت غالبًا */
  const [readCount, setReadCount] = useState(5);
  /**
   * العمود المفتوح وقائمة القراءة غير المحفوظة، لكل قسم، هنا لا في ClassView:
   * الأستاذ يتنقّل في الحصة بين القراءة وأعمدة التقويم المستمر وبين التبويبات،
   * وClassView يُفكّ عند مغادرته فكان يُضيّع عموده وقائمته. في الذاكرة فقط:
   * إعادة فتح التطبيق تبدأ حصة جديدة (والعمود المفتوح يُحفظ مع المكان).
   */
  const [columnOf, setColumnOf] = useState<Record<string, string | null>>({});
  const [drafts, setDrafts] = useState<Record<string, ReadingDraft<Student>>>({});
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
  const [backupOpen, setBackupOpen] = useState(false);
  /** بصمات العمليات المعلّقة التي ضمّها آخر ملف «نسختي» نُزِّل: بوّابة الخروج. */
  const [exportedOps, setExportedOps] = useState<ReadonlySet<string>>(() => new Set());
  const [persistence, setPersistence] = useState<Persistence | null>(null);
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

  /* الحفظ الدائم: يُطلب مرة عند الفتح، ورفضه لا يوقف شيئًا (انظر localdb) */
  useEffect(() => {
    void ensurePersistence().then(setPersistence);
  }, []);

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
    /* الروزنامة كالأفواج: غيابها (جدول لم يُرحَّل بعد، أو انقطاع) لا يحجب العلامات ولا يُقفل شيئًا. */
    const cal = await supabase
      .from("term_calendar")
      .select("school_year,term,starts_on,ends_on,grace_days")
      .order("starts_on");
    const calendarRows: TermRow[] | null = cal.error
      ? null
      : ((cal.data ?? []) as TermRow[]).map((r) => ({
          ...r,
          term: Number(r.term),
          grace_days: Number(r.grace_days),
        }));
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
      calendar: calendarRows ?? undefined,
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
    // قراءة فاشلة تُبقي الروزنامة المحفوظة على الجهاز بدل أن تمحوها.
    if (calendarRows) {
      setCalendar(calendarRows);
      setCalendarKnown(true);
    }
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
      if (saved.calendar) {
        setCalendar(saved.calendar);
        setCalendarKnown(true);
      }
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
        columnOf?: Record<string, string | null>;
        hideStart?: boolean;
        openSchool?: string | null;
      }>(whereKey);
      if (!saved) return;
      /* الفصل لا يُستعاد: يُفتح التطبيق دائمًا على الفصل الجاري بالتاريخ (انظر landedRef). */
      /* تبويب «الحصة» حُذف: من تركه هناك يُفتح له قسمها على القراءة */
      const where = migrateWhere(saved, (id) => classes.some((c) => c.id === id));
      if (where.tab) setTab(where.tab as Tab);
      const columns = { ...(saved.columnOf ?? {}) };
      if (where.readingIn) columns[where.readingIn] = READING_COLUMN;
      setColumnOf(columns);
      if (saved.sessionCount && saved.sessionCount >= 3) setReadCount(saved.sessionCount);
      if (saved.hideStart) setHideStart(true);
      if (saved.openSchool) setOpenSchool(saved.openSchool);
      // القسم قد يكون حُذف من جهاز آخر، فلا يُفتح إلا إن كان ما يزال موجودًا.
      if (where.openClass) setOpenClass(where.openClass);
    })();
  }, [classes, whereKey]);

  useEffect(() => {
    if (!restoredRef.current) return;
    void kvSet(whereKey, {
      tab, term, openClass, openSchool, sessionCount: readCount, columnOf, hideStart,
    });
  }, [tab, term, openClass, openSchool, readCount, columnOf, hideStart, whereKey]);

  /* المحاولات تُسجَّل في الفصل المعروض لحظة الحفظ: قائمة اختيرت في ف1 لا تُحفظ في ف2 */
  useEffect(() => {
    setDrafts({});
  }, [term]);

  /* ---------- الفصول: أيّها مفتوح للتنقيط ---------- */

  /* اليوم يتجدد إن بقي التطبيق مفتوحًا عبر منتصف الليل أو عاد من الخلفية. */
  useEffect(() => {
    const refresh = () => setTodayIso(algiersToday());
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const view = useMemo(() => termView(calendar, todayIso), [calendar, todayIso]);
  /** الفصل المعروض مقفل: يُعرض ويُطبع ويُصدَّر، ولا يُنقَّط. القاعدة تحرس هذا أيضًا. */
  const locked = !view.terms[term as 1 | 2 | 3]?.open;
  const lockedSay = useCallback(
    () => say(`${termName(term)} مغلق: للاطلاع فقط.`),
    [say, term],
  );

  /* يُفتح التطبيق عند الدخول على الفصل الجاري بالتاريخ، مرة واحدة لا كلما تغيّر شيء. */
  const landedRef = useRef(false);
  useEffect(() => {
    if (landedRef.current || !calendarKnown) return;
    landedRef.current = true;
    setTerm(view.landing);
  }, [calendarKnown, view.landing]);

  /* عودة الشبكة: أعد القراءة من الخادم مرة واحدة، لا عند كل تبدّل حالة */
  const onlineRef = useRef(true);
  useEffect(() => {
    if (outbox.online && !onlineRef.current) void load();
    onlineRef.current = outbox.online;
  }, [outbox.online, load]);

  /* المظهر المحفوظ يُطبَّق عند فتح التطبيق، فالزرّ صار في الإعدادات ولا يُرسم قبل فتحها */
  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved) document.documentElement.setAttribute("data-theme", saved);
    } catch {
      /* نافذة خاصة */
    }
  }, []);

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
  /** إحصاء قسم في فصل آخر غير المعروض، لمقارنة الفصل بالسابق في شاشة الإحصاء. */
  const statsInTerm = useCallback(
    (classId: string, atTerm: number) =>
      termStatsFor({
        term: atTerm,
        students: studentsOf(classId),
        target: targetOfClass(classId),
        records,
        readings,
        tpMarks,
        sessions,
        criteria,
        components,
      }),
    [studentsOf, targetOfClass, records, readings, tpMarks, sessions, criteria, components],
  );

  /* ---------- writes ---------- */

  /**
   * كل علامة تدخل الطابور أولًا فتظهر في الشاشة في اللحظة نفسها، ثم تُرسل في
   * الخلفية. لا انتظار للخادم عند الضغطة، ولا إعادة تحميل تمحو ما أُدخل.
   */
  function saveRecord(studentId: string, patch: Partial<RecordRow>) {
    if (locked) return lockedSay();
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
    if (locked) {
      lockedSay();
      return false;
    }
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
    if (locked) return lockedSay();
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
    // الواجهة لا تعرض «حصة جديدة» في فصل مقفل؛ هذا حارس أخير. القاعدة ترفض أيضًا.
    if (locked) {
      lockedSay();
      return "";
    }
    const session: TpSession = { id: uid(), term, ...input };
    outbox.push(newOp("tp-session", { session }));
    return session.id;
  }

  function editTpSession(id: string, patch: { held_on?: string; title?: string | null }) {
    const current = sessions.find((s) => s.id === id);
    if (!current) return;
    if (!view.terms[current.term as 1 | 2 | 3]?.open) return lockedSay();
    outbox.push(newOp("tp-session", { session: { ...current, ...patch } }));
  }

  /** حذف حصة وعلاماتها: يحتاج الخادم، وما لم يُرسل منها يُسقَط من الطابور أولًا. */
  async function deleteTpSession(session: TpSession) {
    if (!view.terms[session.term as 1 | 2 | 3]?.open) return lockedSay();
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
    const sessionTerm = sessions.find((s) => s.id === sessionId)?.term ?? term;
    if (!view.terms[sessionTerm as 1 | 2 | 3]?.open) return lockedSay();
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
        return;
      }
    }
    say("حُفظ المعيار");
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
      return;
    }
    say("حُفظت بياناتك");
  }

  async function saveComponent(id: string, patch: Partial<Component>) {
    if (!needsNetwork()) return;
    setComponents((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const { error } = await supabase.from("components").update(patch).eq("id", id);
    if (error) {
      say("تعذّر حفظ المركّبة");
      void load();
      return;
    }
    say("حُفظت المركّبة");
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
      return;
    }
    say("حُفظ الاسم");
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
  /* ---------- «نسختي» ---------- */

  /**
   * نسخة الآن: من الخادم كاملةً إن أمكن، وإلا من نسخة الجهاز (دون اتصال، أو
   * جلسة منتهية) — فالخروج والتصدير لا يتوقّفان على الشبكة. والطابور معها
   * منفصلًا. null إن لم تُحمَّل البيانات بعد: ملفٌّ فارغ يُظنّ نسخةً أسوأ من لا ملف.
   */
  const makeBackup = useCallback(async (): Promise<Backup | null> => {
    if (outbox.online) {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.user.id === teacherId) {
          return await exportFromServer(supabase, { id: teacherId, email }, outbox.queue);
        }
      } catch {
        // الشبكة سقطت في منتصف القراءة: نسخة الجهاز أدناه
      }
    }
    if (loading) return null;
    return buildBackup({
      source: "device",
      teacher: {
        id: teacherId,
        email,
        full_name: profile.full_name,
        subject: profile.subject,
        school_name: null,
      },
      data: normalizeData({
        schools,
        classes,
        class_groups: groups,
        students: baseStudents,
        criteria,
        components,
        records: baseRecords,
        readings: baseReadings,
        tp_sessions: baseSessions,
        tp_marks: baseTpMarks,
      }),
      pending: outbox.queue,
    });
  }, [
    outbox.online, outbox.queue, supabase, teacherId, email, loading, profile, schools, classes,
    groups, baseStudents, criteria, components, baseRecords, baseReadings, baseSessions, baseTpMarks,
  ]);

  const recordExported = useCallback((backup: Backup) => {
    setExportedOps(new Set(backup.pending.map(opFingerprint)));
  }, []);

  /** للخروج: ملف «نسختي» بما لم يُرسل. true إن بدأ التنزيل. */
  async function saveBeforeSignOut(): Promise<boolean> {
    const backup = await makeBackup();
    if (!backup) return false;
    const ok = downloadBlob(backupFileName(new Date(), "json"), backupJson(backup));
    if (ok) recordExported(backup);
    return ok;
  }

  async function signOut() {
    // الخروج يمسح الطابور: لا يتمّ وفيه ما لم يُحفظ في الخادم ولا في ملف
    if (!canSignOut(outbox.queue, exportedOps)) {
      setConfirmSignOut(true);
      return;
    }
    setConfirmSignOut(false);
    await kvDel(`snapshot:${teacherId}`);
    await kvDel(`queue:${teacherId}`);
    outbox.reset();
    navigator.serviceWorker?.controller?.postMessage({ type: "clear-cache" });
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  /* ---------- زرّ الرجوع ---------- */
  /**
   * الطبقات المفتوحة من الأعلى إلى الأسفل: النوافذ ثم بطاقة التلميذ ثم الشاشات.
   * القائمة واحدة للعدّ والإغلاق، فلا يُعدّ ما لا يُغلق ولا يُغلق ما لم يُعدّ.
   * التبويب فوق القسم المفتوح: من خرج من قسم إلى الإعدادات يعود بالرجوع إلى
   * القسم لا إلى القائمة.
   */
  const manySchools = groupBySchool(classes, schools).length > 1;
  const layerStack: Array<[boolean, () => void]> = [
    [confirmSignOut, () => setConfirmSignOut(false)],
    [backupOpen, () => setBackupOpen(false)],
    [showPending, () => setShowPending(false)],
    [
      criterionChange !== null,
      () => {
        setCriterionChange(null);
        setSettingsTick((n) => n + 1);
      },
    ],
    [confirmCriterion !== null, () => setConfirmCriterion(null)],
    [confirmStudent !== null, () => setConfirmStudent(null)],
    [confirmDelete !== null, () => setConfirmDelete(null)],
    [exporting, () => setExporting(false)],
    [!!printing && classes.some((c) => c.id === printing), () => setPrinting(null)],
    [importing, () => setImporting(false)],
    [!!addingTo && classes.some((c) => c.id === addingTo), () => setAddingTo(null)],
    [newSchool, () => setNewSchool(false)],
    [openStudent !== null, () => setOpenStudentId(null)],
    [tab !== "classes", () => setTab("classes")],
    /* الرجوع من العمود المفتوح إلى جدول القسم قبل الخروج منه */
    [openClass !== null && !!columnOf[openClass], () => setColumnOf((c) => ({ ...c, [openClass!]: null }))],
    [classSection === "groups" && openClass !== null, () => setClassSection("students")],
    [openClass !== null, () => setOpenClass(null)],
    [openSchool !== null && manySchools, () => setOpenSchool(null)],
  ];
  useBackLayers(layerStack.filter(([isOpen]) => isOpen).length, () => {
    layerStack.find(([isOpen]) => isOpen)?.[1]();
  });

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
            needsLogin={outbox.needsLogin}
            frozen={outbox.frozen}
            label={pendingLabel(queue)}
            onClick={() => setShowPending(true)}
          />
          <div className="terms" role="group" aria-label="الفصل">
            {[1, 2, 3].map((t) => {
              const status = view.terms[t as 1 | 2 | 3];
              return (
                <button
                  key={t}
                  aria-pressed={term === t}
                  data-phase={view.enforced ? status.phase : undefined}
                  title={
                    !view.enforced
                      ? undefined
                      : status.phase === "grace"
                        ? `${termName(t)}: في مهلة التنقيط`
                        : status.open
                          ? undefined
                          : `${termName(t)}: للاطلاع فقط`
                  }
                  onClick={() => setTerm(t)}
                >
                  ف{t}
                </button>
              );
            })}
          </div>
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

          {/* التنبيه حيث تُكتب العلامات: مهلة الفصل المنتهي، أو فصل مقفل للاطلاع فقط.
              ويقترح الفصل الجاري. القاعدة هي الحَكَم، وهذا تنبيه قبل أن يُرفض شيء. */}
          {tab === "classes" && openClass && (() => {
            const notice = termNotice(term, view);
            if (!notice) return null;
            return (
              <div
                className={`note ${notice.tone === "info" ? "" : notice.tone === "warn" ? "bad" : "warn"} termnote`}
                role="status"
              >
                <span>{notice.text}</span>
                {term !== view.landing && (
                  <button className="clearb" onClick={() => setTerm(view.landing)}>
                    انتقل إلى {termName(view.landing)}
                  </button>
                )}
              </div>
            );
          })()}

          {tab === "classes" &&
            (openClass && classSection === "groups" && tpReady ? (
              <GroupsView
                klass={classes.find((c) => c.id === openClass)!}
                students={studentsOf(openClass)}
                groups={groupsOf(openClass)}
                sessions={sessions.filter((x) => x.class_id === openClass)}
                tpMarks={tpMarks}
                term={term}
                readOnly={locked}
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
                readOnly={locked}
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
                column={columnOf[openClass] ?? null}
                onColumn={(column) => setColumnOf((c) => ({ ...c, [openClass]: column }))}
                reading={criteria.find((c) => c.kind === "auto")}
                readCount={readCount}
                onReadCount={setReadCount}
                draft={drafts[openClass] ?? emptyDraft<Student>()}
                onDraft={(next) => setDrafts((d) => ({ ...d, [openClass]: next }))}
                onSaveReadings={addReadings}
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

          {tab === "stats" && (
            <StatsView
              classes={classes}
              schools={schools}
              statsOf={statsOf}
              statsInTerm={statsInTerm}
              term={term}
            />
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
              onBackup={() => setBackupOpen(true)}
              persistence={persistence}
              onPersist={() => void ensurePersistence().then(setPersistence)}
            />
          )}
        </div>
      </main>

      <Tabs
        tab={tab}
        onChange={(t) => {
          /* من تبويب آخر إلى «الأقسام»: القسم يبقى مفتوحًا بعموده وقائمته؛
             والنقر على «الأقسام» وهو فيها يُغلقه إلى القائمة */
          setOpenClass((open) => openClassAfterTab(tab, t, open));
          setTab(t);
        }}
      />

      {openStudent && (
        <StudentSheet
          student={openStudent}
          term={term}
          readOnly={locked}
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
          needsLogin={outbox.needsLogin}
            frozen={outbox.frozen}
          nameOf={(id) => students.find((s) => s.id === id)?.full_name ?? "تلميذ محذوف"}
          onClose={() => setShowPending(false)}
          onFlush={outbox.flush}
          onRetry={outbox.retry}
          onDiscard={outbox.discard}
        />
      )}

      {backupOpen && (
        <BackupSheet
          supabase={supabase}
          teacherId={teacherId}
          online={outbox.online}
          queue={queue}
          makeBackup={makeBackup}
          onExported={recordExported}
          onImported={() => void load()}
          onReplay={(ops) => ops.forEach((op) => outbox.push(op))}
          onClose={() => setBackupOpen(false)}
        />
      )}

      {confirmSignOut && (
        <ConfirmSignOutSheet
          label={pendingLabel(queue)}
          saved={canSignOut(queue, exportedOps)}
          onSave={saveBeforeSignOut}
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

