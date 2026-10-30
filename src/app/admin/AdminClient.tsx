"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { algiersToday } from "@/lib/terms";
import {
  GRACE_DEFAULT,
  calendarIssues,
  closesOn,
  editEffect,
  graceWord,
  groupByYear,
  nextYearLabel,
  suggestYear,
  termErrorMessage,
  termLogSummary,
  validateTerm,
  type AdminTermRow,
  type EditEffect,
  type TermDraft,
} from "@/lib/adminTerms";
import {
  ACTION_LABEL,
  ACTOR_LABEL,
  REASON_MAX,
  STATUS_LABEL,
  adminProblemMessage,
  attentionItems,
  classifyAdminError,
  cleanCode,
  cleanReason,
  codeReady,
  countWord,
  daysLeft,
  dueWord,
  filterTeachers,
  leftLabel,
  msLeft,
  parseAdminState,
  summarize,
  type AdminLogRow,
  type AdminTeacher,
  type StatusFilter,
} from "@/lib/admin";

type Tab = "accounts" | "deletions" | "calendar" | "log";
/** loading: أول تحميل · ready: اللوحة · reverify: التحقّق الثنائي منتهٍ · forbidden: ليس مشرفًا · error: تعذّر التحميل */
type Phase = "loading" | "ready" | "reverify" | "forbidden" | "error";
type Pending = { id: string; action: "disable" | "enable" | "cancel"; reason: string };

function day(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("ar-DZ", { day: "numeric", month: "short", year: "numeric" });
}

function dayTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("ar-DZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const CONFIRM_TEXT: Record<Pending["action"], string> = {
  disable: "يُمنع الأستاذ من الدخول وتُحذف جلساته. بياناته لا تُمسّ ويمكن إعادة التفعيل.",
  enable: "يعود الأستاذ إلى الدخول، وتبقى بياناته كما كانت.",
  cancel: "يُلغى طلب الحذف ويعود الحساب نشطًا.",
};
const CONFIRM_BUTTON: Record<Pending["action"], string> = {
  disable: "أوقف الحساب",
  enable: "أعد التفعيل",
  cancel: "ألغِ الحذف",
};

export default function AdminClient({
  email,
  initialExpiresAt,
}: {
  email: string;
  initialExpiresAt: string | null;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [phase, setPhase] = useState<Phase>("loading");
  const [teachers, setTeachers] = useState<AdminTeacher[]>([]);
  const [log, setLog] = useState<AdminLogRow[]>([]);
  const [expiresAt, setExpiresAt] = useState<string | null>(initialExpiresAt);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("accounts");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState("");
  const [code, setCode] = useState("");
  /* الرزنامة: الصفوف، وما يُحرَّر الآن (فصل واحد أو سنة جديدة كاملة) */
  const [terms, setTerms] = useState<AdminTermRow[]>([]);
  const [editing, setEditing] = useState<{ school_year: string; term: number; draft: TermDraft } | null>(null);
  const [newYear, setNewYear] = useState<{ label: string; drafts: TermDraft[] } | null>(null);
  const [termError, setTermError] = useState("");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const toLogin = useCallback(() => {
    router.replace("/admin/login");
    router.refresh();
  }, [router]);

  /** يفسّر خطأ القاعدة ويوجّه الواجهة: إعادة الرمز، أو الخروج، أو الرفض، أو رسالة. */
  const handleProblem = useCallback(
    (error: Parameters<typeof classifyAdminError>[0]): void => {
      const problem = classifyAdminError(error);
      if (problem === "mfa_required") {
        setMessage("");
        setPhase("reverify");
      } else if (problem === "forbidden") setPhase("forbidden");
      else if (problem === "session") toLogin();
      else setMessage(adminProblemMessage(problem));
    },
    [toLogin],
  );

  const load = useCallback(async () => {
    const me = await supabase.rpc("am_i_admin");
    if (!alive.current) return;
    if (me.error) {
      setPhase("error");
      handleProblem(me.error);
      return;
    }
    const state = parseAdminState(me.data);
    if (!state.listed) return setPhase("forbidden");
    setExpiresAt(state.mfaExpiresAt);
    if (!state.ready) return setPhase("reverify");

    const [list, recent, cal] = await Promise.all([
      supabase.rpc("admin_list_teachers"),
      supabase.rpc("admin_log_recent", { max_rows: 60 }),
      supabase
        .from("term_calendar")
        .select("school_year,term,starts_on,ends_on,grace_days")
        .order("starts_on"),
    ]);
    if (!alive.current) return;
    if (list.error) {
      setPhase("error");
      handleProblem(list.error);
      return;
    }
    setTeachers((list.data ?? []) as AdminTeacher[]);
    // السجلّ ثانوي: فشله لا يُسقط القائمة، لكن يُقال.
    setLog(recent.error ? [] : ((recent.data ?? []) as AdminLogRow[]));
    // الرزنامة ثانوية كالسجلّ: فشلها لا يُسقط القائمة (الجدول قد لا يكون رُحِّل بعد).
    if (!cal.error) {
      setTerms(
        ((cal.data ?? []) as AdminTermRow[]).map((r) => ({
          ...r,
          term: Number(r.term),
          grace_days: Number(r.grace_days),
        })),
      );
    }
    setMessage(recent.error ? "تعذّر تحميل سجلّ العمليات." : "");
    setPhase("ready");
  }, [supabase, handleProblem]);

  useEffect(() => {
    void load();
  }, [load]);

  // عدّاد صلاحية التحقّق الثنائي: عند انقضائها تُطلب إعادة الرمز دون انتظار خطأ من الخادم.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);
  const left = msLeft(expiresAt, now);
  useEffect(() => {
    if (phase === "ready" && expiresAt && left <= 0) setPhase("reverify");
  }, [phase, expiresAt, left]);

  async function act() {
    if (!pending) return;
    setBusy(true);
    setMessage("");
    setDone("");
    const reason = cleanReason(pending.reason);
    const { error } =
      pending.action === "cancel"
        ? await supabase.rpc("admin_cancel_deletion", { target: pending.id, reason })
        : await supabase.rpc("admin_set_disabled", {
            target: pending.id,
            disabled: pending.action === "disable",
            reason,
          });
    setBusy(false);
    if (error) {
      // لم يُنفَّذ شيء. إن كان السبب انتهاء الرمز فبعد إعادته يختار المشرف من جديد.
      setPending(null);
      handleProblem(error);
      return;
    }
    setPending(null);
    setDone(
      pending.action === "disable" ? "أُوقف الحساب." : pending.action === "enable" ? "أُعيد تفعيل الحساب." : "أُلغي طلب الحذف.",
    );
    await load();
  }

  /**
   * يحفظ فصلًا واحدًا. يفحص أولًا بالقواعد نفسها، ثم تحكم القاعدة. يعيد true إن نجح.
   * إن انتهى رمز التحقق الثنائي تنتقل اللوحة إلى طلب الرمز ولا يُنفَّذ شيء.
   */
  async function saveTerm(school_year: string, term: number, draft: TermDraft): Promise<boolean> {
    const check = validateTerm(school_year, term, draft);
    if (!check.ok) {
      setTermError(check.error);
      return false;
    }
    const { error } = await supabase.rpc("admin_set_term", {
      p_school_year: school_year,
      p_term: term,
      p_starts_on: draft.starts_on,
      p_ends_on: draft.ends_on,
      p_grace_days: check.grace,
      reason: cleanReason(draft.reason),
    });
    if (error) {
      const own = termErrorMessage(error);
      if (own) setTermError(own);
      else {
        setTermError("");
        handleProblem(error);
      }
      return false;
    }
    return true;
  }

  async function submitEditing() {
    if (!editing) return;
    setBusy(true);
    setTermError("");
    setDone("");
    const saved = await saveTerm(editing.school_year, editing.term, editing.draft);
    setBusy(false);
    if (!saved) return;
    setEditing(null);
    setDone(`حُفظ الفصل ${editing.term} من ${editing.school_year}.`);
    await load();
  }

  async function submitNewYear() {
    if (!newYear) return;
    setBusy(true);
    setTermError("");
    setDone("");
    // بالترتيب: إن فشل فصل يتوقف الباقي، وما حُفظ قبله يبقى ويظهر بعد إعادة التحميل.
    let saved = 0;
    for (let i = 0; i < 3; i++) {
      if (!(await saveTerm(newYear.label, i + 1, newYear.drafts[i]))) break;
      saved += 1;
    }
    setBusy(false);
    if (saved === 3) {
      setNewYear(null);
      setDone(`أُضيفت رزنامة ${newYear.label}.`);
    } else if (saved > 0) {
      setTermError((e) => `حُفظ ${saved} من 3 فصول فقط. ${e}`);
    }
    await load();
  }

  async function reverify(event: React.FormEvent) {
    event.preventDefault();
    if (!codeReady(code)) return;
    setBusy(true);
    setMessage("");
    const factors = await supabase.auth.mfa.listFactors();
    const factor = factors.data?.totp.find((f) => f.status === "verified");
    if (!factor) {
      setBusy(false);
      toLogin();
      return;
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    setCode("");
    if (error) {
      setBusy(false);
      setMessage(
        classifyAdminError(error) === "session"
          ? adminProblemMessage("session")
          : "الرمز غير صحيح أو انتهى وقته. أدخل الرمز الظاهر الآن في التطبيق.",
      );
      if (classifyAdminError(error) === "session") toLogin();
      return;
    }
    setBusy(false);
    setPhase("loading");
    await load();
  }

  async function signOut() {
    await supabase.auth.signOut();
    toLogin();
  }

  const stats = useMemo(() => summarize(teachers, now), [teachers, now]);
  const shown = useMemo(() => filterTeachers(teachers, query, status), [teachers, query, status]);
  const deletions = useMemo(
    () => teachers.filter((t) => t.status === "deletion_pending").sort((a, b) => (a.purge_after ?? "").localeCompare(b.purge_after ?? "")),
    [teachers],
  );

  const today = algiersToday();
  const calendarMessages = useMemo(() => calendarIssues(terms, today), [terms, today]);
  const attention = useMemo(
    () => attentionItems(teachers, calendarMessages, now),
    [teachers, calendarMessages, now],
  );

  if (phase === "loading") {
    return (
      <div className="auth gut">
        <div className="authbox">
          <p className="lead">جارٍ تحميل الحسابات…</p>
        </div>
      </div>
    );
  }

  if (phase === "forbidden") {
    return (
      <div className="auth gut">
        <div className="authbox">
          <h1>لا صلاحية</h1>
          <p className="lead">هذا الحساب ليس حساب المشرف.</p>
          <button className="btn ghost" onClick={signOut}>
            خروج
          </button>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="auth gut">
        <div className="authbox">
          <h1>تعذّر التحميل</h1>
          <div className="note bad">{message || adminProblemMessage("other")}</div>
          <button
            className="btn"
            onClick={() => {
              setPhase("loading");
              void load();
            }}
          >
            أعد المحاولة
          </button>
          <button className="swap" onClick={signOut}>
            خروج
          </button>
        </div>
      </div>
    );
  }

  if (phase === "reverify") {
    return (
      <div className="auth gut">
        <form className="authbox" onSubmit={reverify}>
          <h1>أعد رمز التحقّق</h1>
          <p className="lead">
            انتهت صلاحية التحقّق الثنائي (12 ساعة). لم يُنفَّذ أي تغيير بعد انتهائها. اكتب الرمز
            الظاهر الآن في تطبيق المصادقة.
          </p>
          <input
            value={code}
            onChange={(e) => setCode(cleanCode(e.target.value))}
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            aria-label="رمز التحقّق"
            autoFocus
            style={{ letterSpacing: 4, textAlign: "center", fontSize: 20 }}
          />
          {message && <div className="note bad">{message}</div>}
          <button className="btn" type="submit" disabled={busy || !codeReady(code)}>
            {busy ? "لحظة…" : "تحقّق"}
          </button>
          <button className="swap" type="button" onClick={signOut}>
            خروج
          </button>
        </form>
      </div>
    );
  }

  const rowActions = (t: AdminTeacher) => {
    if (t.is_admin) return null;
    if (pending?.id === t.id) return null;
    if (t.status === "disabled")
      return (
        <button className="clearb" onClick={() => setPending({ id: t.id, action: "enable", reason: "" })}>
          أعد التفعيل
        </button>
      );
    if (t.status === "deletion_pending")
      return (
        <button className="clearb" onClick={() => setPending({ id: t.id, action: "cancel", reason: "" })}>
          ألغِ الحذف
        </button>
      );
    return (
      <button className="clearb danger" onClick={() => setPending({ id: t.id, action: "disable", reason: "" })}>
        أوقف
      </button>
    );
  };

  const confirmPanel = (t: AdminTeacher) =>
    pending?.id === t.id ? (
      <div className="adm-confirm">
        <p>
          {CONFIRM_TEXT[pending.action]} <bdi dir="ltr">{t.email}</bdi>
        </p>
        <label>
          السبب (اختياري، يُحفظ في السجلّ)
          <input
            value={pending.reason}
            onChange={(e) => setPending({ ...pending, reason: e.target.value.slice(0, REASON_MAX) })}
            maxLength={REASON_MAX}
            placeholder="مثال: طلب الأستاذ، أو شكوى"
          />
        </label>
        <div className="adm-confirm-row">
          <button className={pending.action === "disable" ? "btn danger sm" : "btn sm"} disabled={busy} onClick={act}>
            {busy ? "لحظة…" : CONFIRM_BUTTON[pending.action]}
          </button>
          <button className="btn ghost sm" disabled={busy} onClick={() => setPending(null)}>
            تراجع
          </button>
        </div>
      </div>
    ) : null;

  const row = (t: AdminTeacher) => (
    <div key={t.id} className={t.status === "active" ? "adm-item" : "adm-item bad"}>
      <div className="prow">
        <div className="k">
          <b>{t.full_name || "بلا اسم"}</b>
          <small>
            <bdi dir="ltr">{t.email}</bdi>
            {t.is_admin ? " · مشرف" : ""}
          </small>
          <small>
            {countWord(t.classes, "class")} · {countWord(t.students, "student")} · {countWord(t.records, "record")}
          </small>
          <small>
            آخر نشاط {day(t.last_activity)} · آخر دخول {day(t.last_sign_in_at)}
          </small>
          {t.status !== "active" && (
            <small className="perr">
              {t.status === "disabled"
                ? "موقوف"
                : `يُحذف يوم ${day(t.purge_after)} (${dueWord(daysLeft(t.purge_after, now))})`}
            </small>
          )}
        </div>
        <div className="pacts">{rowActions(t)}</div>
      </div>
      {confirmPanel(t)}
    </div>
  );

  return (
    <div className="gut adm">
      <div className="adm-head">
        <div>
          <h1>الإشراف</h1>
          <small dir="ltr">{email}</small>
        </div>
        <div className="adm-head-side">
          <small className={left < 30 * 60_000 ? "adm-warn" : ""}>تحقّق الرمز: {leftLabel(left)}</small>
          <button className="clearb" onClick={signOut}>
            خروج
          </button>
        </div>
      </div>

      <p className="lead">
        الحسابات وحالتها وأعداد بياناتها. لا تظهر هنا أسماء التلاميذ ولا العلامات، وكل عملية تغيّر
        شيئًا تُسجَّل.
      </p>

      <section className="adm-stats" aria-label="إحصاءات">
        <div className="card stat"><b>{stats.accounts}</b><small>أساتذة</small></div>
        <div className="card stat"><b>{stats.activeWeek}</b><small>نشطون هذا الأسبوع</small></div>
        <div className="card stat"><b>{stats.activeMonth}</b><small>نشطون هذا الشهر</small></div>
        <div className="card stat"><b>{stats.idle}</b><small>لم ينقّطوا قط</small></div>
        <div className="card stat"><b>{stats.classes}</b><small>أقسام</small></div>
        <div className="card stat"><b>{stats.students}</b><small>تلاميذ (عدد فقط)</small></div>
        <div className="card stat"><b>{stats.disabled}</b><small>موقوفون</small></div>
        <div className="card stat"><b>{stats.pending}</b><small>حذف مجدول</small></div>
      </section>

      {message && <div className="note bad" role="alert">{message}</div>}
      {done && <div className="note" role="status">{done}</div>}

      {/* ما يحتاج انتباهًا: يُخفى منه ما يظهر أصلًا في التبويب المفتوح */}
      {attention.some((a) => a.tab !== tab) && (
        <section className="adm-attn" aria-label="يحتاج انتباهك">
          <b>يحتاج انتباهك</b>
          {attention
            .filter((a) => a.tab !== tab)
            .map((a) => (
              <button
                key={a.key}
                type="button"
                className={`note ${a.level === "bad" ? "bad" : "warn"} adm-attn-item`}
                onClick={() => setTab(a.tab)}
              >
                <span>{a.text}</span>
                <small>افتح</small>
              </button>
            ))}
        </section>
      )}

      <div className="segmented" role="tablist" style={{ marginBlock: 12 }}>
        <button role="tab" aria-pressed={tab === "accounts"} onClick={() => setTab("accounts")}>
          الحسابات ({teachers.length})
        </button>
        <button role="tab" aria-pressed={tab === "deletions"} onClick={() => setTab("deletions")}>
          طلبات الحذف ({deletions.length})
        </button>
        <button role="tab" aria-pressed={tab === "calendar"} onClick={() => setTab("calendar")}>
          الرزنامة
        </button>
        <button role="tab" aria-pressed={tab === "log"} onClick={() => setTab("log")}>
          السجلّ
        </button>
      </div>

      {tab === "accounts" && (
        <>
          <input
            className="adm-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالاسم أو البريد"
            aria-label="بحث"
          />
          <div className="chips" style={{ marginBlock: 10 }}>
            {(["all", "active", "disabled", "deletion_pending"] as const).map((s) => (
              <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
                {s === "all" ? "الكل" : STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <div className="note">لا حسابات تطابق البحث.</div>
          ) : (
            <div className="plist">{shown.map(row)}</div>
          )}
          <div className="note" style={{ marginTop: 14 }}>
            تغيير كلمة المرور يطلبه الأستاذ بنفسه من «نسيت كلمة السر» في صفحة الدخول على جهازه.
            رابط الاستعادة يعمل في المتصفّح الذي طلبه فقط، فلا يُرسله المشرف.
          </div>
        </>
      )}

      {tab === "deletions" && (
        <>
          <div className="note" style={{ marginBottom: 10 }}>
            يُحذف الحساب نهائيًا في التشغيل الليلي بعد انقضاء 7 أيام من الطلب، وبعد نجاح النسخة
            الاحتياطية. إلغاء الطلب قبل الموعد يُعيد الحساب كما كان.
          </div>
          {deletions.length === 0 ? (
            <div className="note">لا طلبات حذف معلّقة.</div>
          ) : (
            <div className="plist">{deletions.map(row)}</div>
          )}
        </>
      )}

      {tab === "calendar" && (
        <>
          <div className="note" style={{ marginBottom: 10 }}>
            الفصل مفتوح للتنقيط من بدايته حتى نهايته + المهلة، فيُنقَّط الفصلان معًا في أيام المهلة. بعدها
            يصير الفصل للاطلاع فقط في تطبيق كل الأساتذة. كل تعديل يُسجَّل بقيمه السابقة.
          </div>
          {calendarMessages.map((m) => (
            <div key={m} className="note warn" style={{ marginBottom: 8 }}>{m}</div>
          ))}

          {termError && <div className="note bad" role="alert" style={{ marginBottom: 8 }}>{termError}</div>}

          {newYear ? (
            <div className="card adm-year">
              <h3>سنة جديدة {newYear.label}</h3>
              <p className="lead">التواريخ مقترحة من السنة السابقة بإزاحة سنة. عدّلها كما في رزنامة الوزارة.</p>
              {newYear.drafts.map((d, i) => (
                <TermFields
                  key={i}
                  title={`الفصل ${i + 1}`}
                  draft={d}
                  onChange={(next) =>
                    setNewYear({ ...newYear, drafts: newYear.drafts.map((x, j) => (j === i ? next : x)) })
                  }
                  withReason={false}
                  effect={editEffect(null, d, today)}
                />
              ))}
              <div className="adm-confirm-row">
                <button className="btn sm" disabled={busy} onClick={submitNewYear}>
                  {busy ? "لحظة…" : "احفظ السنة"}
                </button>
                <button className="btn ghost sm" disabled={busy} onClick={() => { setNewYear(null); setTermError(""); }}>
                  تراجع
                </button>
              </div>
            </div>
          ) : (
            !editing && (
              <button
                className="btn soft sm"
                style={{ marginBottom: 10 }}
                onClick={() => {
                  const label = nextYearLabel(terms, today);
                  setTermError("");
                  setNewYear({ label, drafts: suggestYear(terms, label) });
                }}
              >
                + أضف السنة {nextYearLabel(terms, today)}
              </button>
            )
          )}

          {terms.length === 0 && !newYear && (
            <div className="note">لا فصول في الرزنامة، أو لم يُرحَّل الجدول بعد.</div>
          )}

          {groupByYear(terms).map((y) => (
            <div key={y.school_year} className="card adm-year">
              <h3>{y.school_year}</h3>
              {y.terms.map((t, i) => {
                const term = i + 1;
                const isEditing = editing?.school_year === y.school_year && editing.term === term;
                if (isEditing && editing) {
                  return (
                    <div key={term} className="adm-term editing">
                      <TermFields
                        title={`الفصل ${term}`}
                        draft={editing.draft}
                        onChange={(draft) => setEditing({ ...editing, draft })}
                        withReason
                        effect={editEffect(t, editing.draft, today)}
                      />
                      <div className="adm-confirm-row">
                        <button className="btn sm" disabled={busy} onClick={submitEditing}>
                          {busy ? "لحظة…" : "احفظ"}
                        </button>
                        <button className="btn ghost sm" disabled={busy} onClick={() => { setEditing(null); setTermError(""); }}>
                          تراجع
                        </button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={term} className="adm-term">
                    <div className="k">
                      <b>الفصل {term}</b>
                      {t ? (
                        <>
                          <small><bdi dir="ltr">{t.starts_on} → {t.ends_on}</bdi></small>
                          <small>{graceWord(t.grace_days)} · آخر يوم للتنقيط <bdi dir="ltr">{closesOn(t)}</bdi></small>
                        </>
                      ) : (
                        <small className="perr">غير مُدخَل</small>
                      )}
                    </div>
                    {!newYear && !editing && (
                      <button
                        className="clearb"
                        onClick={() => {
                          setTermError("");
                          setEditing({
                            school_year: y.school_year,
                            term,
                            draft: t
                              ? { starts_on: t.starts_on, ends_on: t.ends_on, grace_days: String(t.grace_days), reason: "" }
                              : { starts_on: "", ends_on: "", grace_days: String(GRACE_DEFAULT), reason: "" },
                          });
                        }}
                      >
                        {t ? "عدّل" : "أضف"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}

      {tab === "log" && (
        <>
          {log.length === 0 ? (
            <div className="note">لا عمليات مسجّلة بعد.</div>
          ) : (
            <div className="plist">
              {log.map((l, i) => (
                <div key={i} className="prow">
                  <div className="k">
                    <b>{ACTION_LABEL[l.action] ?? l.action}</b>
                    <small>
                      {ACTOR_LABEL[l.actor_kind]} · {dayTime(l.at)}
                      {l.target_email ? " · " : ""}
                      {l.target_email && <bdi dir="ltr">{l.target_email}</bdi>}
                    </small>
                    {l.action === "set_term" && <small>{termLogSummary(l.detail)}</small>}
                    {l.detail?.reason && <small>السبب: {l.detail.reason}</small>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** حقول فصل واحد: بداية ونهاية ومهلة، والسبب اختياري عند التعديل. */
function TermFields({
  title, draft, onChange, withReason, effect,
}: {
  title: string;
  draft: TermDraft;
  onChange: (next: TermDraft) => void;
  withReason: boolean;
  /** ما يعنيه التعديل للأساتذة اليوم، يُحسب قبل الحفظ. */
  effect?: EditEffect;
}) {
  return (
    <div className="adm-confirm" style={{ padding: "6px 0 10px" }}>
      <b>{title}</b>
      <div className="adm-dates">
        <label>
          البداية
          <input type="date" dir="ltr" value={draft.starts_on} onChange={(e) => onChange({ ...draft, starts_on: e.target.value })} />
        </label>
        <label>
          النهاية
          <input type="date" dir="ltr" value={draft.ends_on} onChange={(e) => onChange({ ...draft, ends_on: e.target.value })} />
        </label>
        <label>
          المهلة (أيام)
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={30}
            dir="ltr"
            value={draft.grace_days}
            onChange={(e) => onChange({ ...draft, grace_days: e.target.value })}
          />
        </label>
      </div>
      {effect?.closes && (
        <small className="adm-closes">
          آخر يوم للتنقيط: <bdi dir="ltr">{effect.closes}</bdi>
        </small>
      )}
      {effect?.notes.map((n) => (
        <div key={n.text} className={n.level === "warn" ? "note warn" : "note"} role={n.level === "warn" ? "alert" : "status"}>
          {n.text}
        </div>
      ))}
      {withReason && (
        <label>
          السبب (اختياري، يُحفظ في السجلّ)
          <input
            value={draft.reason}
            maxLength={REASON_MAX}
            placeholder="مثال: تأخّر الاختبارات بقرار الوزارة"
            onChange={(e) => onChange({ ...draft, reason: e.target.value.slice(0, REASON_MAX) })}
          />
        </label>
      )}
    </div>
  );
}
