"use client";

import { describeTarget, fmt, type classStats, type Component, type Criterion } from "@/lib/scoring";
import { useState } from "react";
import { Klass, School } from "./types";

/**
 * بطاقة القسم: ما يعرفه التطبيق عن القسم في مكان واحد، ومنها يُغيَّر الاسم
 * ويُحذف القسم. كانت «⋯ خيارات القسم» تفتح زرّ حذف وحده، فلا سبيل إلى تصحيح
 * اسم كُتب خطأ عند الاستيراد إلا بحذف القسم وإعادة استيراده.
 *
 * الاسم يُحفظ بزرّ صريح لا عند مغادرة الخانة: تغييره يظهر في رأس الكشف المطبوع.
 */
export function ClassCardSheet({
  klass, school, count, stats, termLabel, criteria, components, otherNames,
  onRename, onDelete, onClose,
}: {
  klass: Klass;
  school: School | null;
  count: number;
  stats: ReturnType<typeof classStats>;
  termLabel: string;
  criteria: Criterion[];
  components: Component[];
  /** أسماء بقية أقسامه، للتنبيه إلى تطابق الاسم. */
  otherNames: string[];
  onRename: (name: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(klass.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const trimmed = name.replace(/\s+/g, " ").trim();
  const changed = trimmed !== klass.name;
  const clash = changed && otherNames.some((n) => n.trim() === trimmed);
  const tp = describeTarget(klass.tp_target, criteria, components);

  async function save() {
    if (!trimmed) {
      setError("اكتب اسم القسم.");
      document.getElementById("class-card-name")?.focus();
      return;
    }
    setBusy(true);
    setError("");
    const result = await onRename(trimmed);
    setBusy(false);
    if (result.ok) {
      setSaved(true);
      setName(trimmed);
    } else {
      setError(result.error);
    }
  }

  const rows: Array<[string, string]> = [
    ["المؤسسة", school?.name ?? "غير منسوب"],
    ["التلاميذ", String(count)],
    [`منقَّطون في ${termLabel}`, `${stats.scored} من ${stats.total}`],
    ["المعدّل", stats.mean === null ? "—" : `${fmt(stats.mean)} / 20`],
    ["الوسيط", fmt(stats.median)],
    ["أدنى · أعلى", stats.min === null ? "—" : `${fmt(stats.min)} · ${fmt(stats.max)}`],
    ["نسبة ≥ 10", stats.passRate === null ? "—" : `${Math.round(stats.passRate * 100)}%`],
    ["بلا قراءة بعد", String(stats.unread)],
    ["معدّل الأعمال التطبيقية", tp.label],
  ];

  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>بطاقة القسم</h3>
          <button className="icbtn" onClick={onClose} disabled={busy} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="fld">
          <div className="flab">
            <b>اسم القسم</b>
            <small>يظهر في رأس الكشف المطبوع</small>
          </div>
          <div className="pickbar addrow">
            <input
              id="class-card-name"
              className="inp"
              value={name}
              disabled={busy}
              aria-invalid={!!error}
              onChange={(e) => { setName(e.target.value); setError(""); setSaved(false); }}
              onKeyDown={(e) => { if (e.key === "Enter" && changed) void save(); }}
            />
            <button className="btn soft" disabled={busy || !changed} onClick={() => void save()}>
              {busy ? "جارٍ الحفظ…" : "احفظ الاسم"}
            </button>
          </div>
          {error && <div className="ferr" role="alert" style={{ marginTop: 6 }}>{error}</div>}
          {clash && !error && (
            <div className="dwarn" style={{ marginTop: 6 }}>عندك قسم آخر بهذا الاسم. يمكنك حفظه، لكن يصعب التمييز بينهما.</div>
          )}
          {saved && !changed && !error && <div className="dok" style={{ marginTop: 6 }}>✓ حُفظ الاسم</div>}
        </div>

        <div className="fld">
          <dl className="kvlist">
            {rows.map(([label, value]) => (
              <div key={label} className="kv">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="pickbar" style={{ marginTop: 14 }}>
          <button className="btn warn" disabled={busy} onClick={onDelete}>حذف القسم</button>
          <button className="btn ghost" disabled={busy} onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </>
  );
}
