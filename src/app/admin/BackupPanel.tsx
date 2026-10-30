"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { cleanReason } from "@/lib/admin";
import {
  OVERRIDE_MAX_DAYS,
  addDays,
  backupErrorMessage,
  examWindow,
  parseBackupStatus,
  scheduleLabel,
  validateBackup,
  validateExamsFrom,
  type BackupMode,
  type BackupStatus,
  type ExamRow,
} from "@/lib/adminBackup";

type Supabase = ReturnType<typeof createClient>;
type Problem = { code?: string | null; message?: string | null };

/**
 * تبويب «النسخ الاحتياطي»: الجدولة الحالية، وتجاوز يدوي مؤقت (يومي أو إيقاف)، وبداية الاختبارات
 * لكل فصل. القرار نفسه في القاعدة (private.backup_decision)؛ هنا عرض وتحكّم فقط.
 * أخطاء التحقّق الثنائي والجلسة تُعاد إلى اللوحة (onProblem) كبقية التبويبات.
 */
export default function BackupPanel({
  supabase, terms, today, onProblem, onSaved, onTermsChanged,
}: {
  supabase: Supabase;
  terms: ExamRow[];
  today: string;
  onProblem: (error: Problem) => void;
  onSaved: (text: string) => void;
  onTermsChanged: () => Promise<void>;
}) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<{ mode: Exclude<BackupMode, "auto">; until: string; reason: string } | null>(null);
  const [exams, setExams] = useState<{ key: string; value: string; reason: string } | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("admin_backup_status");
    if (!alive.current) return;
    if (err) {
      setLoadFailed(true);
      onProblem(err);
      return;
    }
    const parsed = parseBackupStatus(data);
    setLoadFailed(parsed === null);
    setStatus(parsed);
  }, [supabase, onProblem]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function fail(err: Problem) {
    const own = backupErrorMessage(err);
    if (own) setError(own);
    else {
      setError("");
      onProblem(err);
    }
  }

  async function saveOverride() {
    if (!form) return;
    const check = validateBackup(form.mode, form.until, form.reason, today);
    if (!check.ok) return setError(check.error);
    setBusy(true);
    setError("");
    const { error: err } = await supabase.rpc("admin_set_backup", {
      p_mode: form.mode,
      p_until: form.until,
      reason: cleanReason(form.reason),
    });
    if (!alive.current) return;
    setBusy(false);
    if (err) return fail(err);
    setForm(null);
    onSaved(form.mode === "paused" ? `أُوقف النسخ حتى ${form.until}.` : `النسخ يومي حتى ${form.until}.`);
    await refresh();
  }

  async function clearOverride() {
    setBusy(true);
    setError("");
    const { error: err } = await supabase.rpc("admin_set_backup", { p_mode: "auto" });
    if (!alive.current) return;
    setBusy(false);
    if (err) return fail(err);
    onSaved("عاد النسخ إلى الجدولة العادية.");
    await refresh();
  }

  async function saveExams(row: ExamRow) {
    if (!exams) return;
    const check = validateExamsFrom(row, exams.value);
    if (!check.ok) return setError(check.error);
    setBusy(true);
    setError("");
    const { error: err } = await supabase.rpc("admin_set_exams_from", {
      p_school_year: row.school_year,
      p_term: row.term,
      p_exams_from: exams.value.trim() === "" ? null : exams.value,
      reason: cleanReason(exams.reason),
    });
    if (!alive.current) return;
    setBusy(false);
    if (err) return fail(err);
    setExams(null);
    onSaved(`حُفظت بداية اختبارات الفصل ${row.term} من ${row.school_year}.`);
    await Promise.all([refresh(), onTermsChanged()]);
  }

  const label = status ? scheduleLabel(status) : null;
  const overridden = status !== null && (status.schedule === "paused" || status.schedule === "daily_override");

  return (
    <>
      <div className="note" style={{ marginBottom: 10 }}>
        النسخ أسبوعي (ليلة الخميس إلى الجمعة)، ويومي في فترات الاختبارات. يُقرَّر كل ليلة الساعة 02:23. التوقيف
        واليومي اليدوي مؤقتان دائمًا (حتى {OVERRIDE_MAX_DAYS} يومًا) ثم يعود النظام وحده. كل تعديل يُسجَّل.
      </div>

      {loadFailed && !status && (
        <div className="note bad" role="alert" style={{ marginBottom: 8 }}>
          تعذّرت قراءة حالة النسخ. إن لم يُطبَّق ترحيل الجدولة بعد فلن يعمل هذا التبويب.
        </div>
      )}
      {error && <div className="note bad" role="alert" style={{ marginBottom: 8 }}>{error}</div>}

      <div className="adm-bk">
      <div className="adm-bk-col">
      {status && label && (
        <div className="card adm-bk-card">
          <h3>الحالة الآن</h3>
          <div className={`note adm-bk-state ${label.tone === "warn" ? "warn" : ""}`}>
            <b>{label.title}</b>
            <br />
            <small>{label.detail}</small>
          </div>
          {status.override_expired && (
            <small className="adm-closes">انتهى تجاوز سابق، والنظام عاد إلى الجدولة العادية.</small>
          )}
          {overridden && !form && (
            <div className="adm-confirm-row">
              <button className="btn soft sm" disabled={busy} onClick={clearOverride}>
                {busy ? "لحظة…" : status.schedule === "paused" ? "فعّل الآن" : "أعد الجدولة العادية"}
              </button>
            </div>
          )}
        </div>
      )}

      {form ? (
        <div className="card adm-bk-card">
          <h3>{form.mode === "paused" ? "أوقف النسخ مؤقتًا" : "نسخ يومي مؤقت"}</h3>
          <div className="adm-confirm" style={{ padding: "6px 0 10px" }}>
            <div className="adm-dates">
              <label>
                حتى تاريخ
                <input
                  type="date"
                  dir="ltr"
                  min={addDays(today, 1)}
                  max={addDays(today, OVERRIDE_MAX_DAYS)}
                  value={form.until}
                  onChange={(e) => setForm({ ...form, until: e.target.value })}
                />
              </label>
            </div>
            <label>
              السبب (إلزامي)
              <input
                type="text"
                maxLength={300}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </label>
            {form.mode === "paused" && (
              <small className="adm-closes">
                أثناء التوقيف لا نسخة جديدة. إن مرّت 9 أيام بلا نسخة ناجحة يصلك بريد تنبيه يوميًّا.
              </small>
            )}
          </div>
          <div className="adm-confirm-row">
            <button className="btn sm" disabled={busy} onClick={saveOverride}>
              {busy ? "لحظة…" : "احفظ"}
            </button>
            <button className="btn ghost sm" disabled={busy} onClick={() => { setForm(null); setError(""); }}>
              تراجع
            </button>
          </div>
        </div>
      ) : (
        !overridden && (
          <div className="adm-confirm-row">
            <button
              className="btn soft sm"
              onClick={() => { setError(""); setForm({ mode: "daily", until: "", reason: "" }); }}
            >
              نسخ يومي مؤقت
            </button>
            <button
              className="btn soft sm"
              onClick={() => { setError(""); setForm({ mode: "paused", until: "", reason: "" }); }}
            >
              أوقف مؤقتًا
            </button>
          </div>
        )
      )}

      </div>
      <div className="adm-bk-col">
      <h3 className="adm-bk-title">فترات الاختبارات (نسخ يومي)</h3>
      <small className="adm-closes">
        من بداية الاختبارات إلى نهاية الفصل + المهلة. الافتراضي 14 يومًا قبل نهاية الفصل.
      </small>
      {terms.length === 0 && <div className="note">لا فصول في الرزنامة.</div>}
      {terms.map((t) => {
        const key = `${t.school_year}/${t.term}`;
        const w = examWindow(t);
        const editing = exams?.key === key;
        return (
          <div key={key} className="card adm-bk-card">
            <b>
              {t.school_year} · الفصل {t.term}
            </b>
            <small className="adm-closes">
              من <bdi dir="ltr">{w.from}</bdi> إلى <bdi dir="ltr">{w.to}</bdi>
              {w.isDefault ? " (افتراضي)" : ""}
            </small>
            {t.term === 3 && w.isDefault && (
              <small className="adm-closes">نهاية الفصل الثالث افتراض، فاكتب بداية اختباراته الفعلية.</small>
            )}
            {editing && exams ? (
              <div className="adm-confirm" style={{ padding: "6px 0 10px" }}>
                <label>
                  بداية الاختبارات (فارغ = الافتراضي)
                  <input
                    type="date"
                    dir="ltr"
                    min={t.starts_on}
                    max={t.ends_on}
                    value={exams.value}
                    onChange={(e) => setExams({ ...exams, value: e.target.value })}
                  />
                </label>
                <label>
                  السبب (اختياري)
                  <input type="text" maxLength={300} value={exams.reason} onChange={(e) => setExams({ ...exams, reason: e.target.value })} />
                </label>
                <div className="adm-confirm-row">
                  <button className="btn sm" disabled={busy} onClick={() => saveExams(t)}>
                    {busy ? "لحظة…" : "احفظ"}
                  </button>
                  <button className="btn ghost sm" disabled={busy} onClick={() => { setExams(null); setError(""); }}>
                    تراجع
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="clearb"
                style={{ alignSelf: "flex-start" }}
                onClick={() => { setError(""); setExams({ key, value: t.exams_from ?? "", reason: "" }); }}
              >
                عدّل البداية
              </button>
            )}
          </div>
        );
      })}
      </div>
      </div>
    </>
  );
}
