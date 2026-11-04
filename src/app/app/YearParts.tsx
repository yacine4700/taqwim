"use client";

import { useState } from "react";
import { type YearBanner } from "@/lib/terms";
import { CreateResult, Klass } from "./types";

/**
 * لافتة الحذف السنوي في شاشة الأقسام. الإجراءان اللذان يحفظان للأستاذ عمله:
 * «نسختي» (كل بياناته في ملف)، ونقل أسماء التلاميذ إلى قسم جديد (الأسماء وحدها).
 */
export function YearBannerCard({
  banner, onBackup, onMove,
}: {
  banner: YearBanner;
  onBackup: () => void;
  onMove: () => void;
}) {
  return (
    <div
      className={`note ${banner.tone === "info" ? "" : banner.tone === "warn" ? "warn" : "bad"} termnote yearnote`}
      role="status"
    >
      <span>{banner.text}</span>
      <span className="yearacts">
        <button className="clearb" onClick={onBackup}>نسختي</button>
        <button className="clearb" onClick={onMove}>نقل الأسماء إلى قسم جديد</button>
      </span>
    </div>
  );
}

/**
 * نقل أسماء قسم مقفل إلى قسم جديد. تُنقل الأسماء وترتيبها فقط: لا علامات ولا
 * محاولات قراءة ولا حصص ولا حالات ولا ملاحظات ولا أفواج. وأصل القسم يبقى كما هو
 * إلى موعد حذفه، فلا يضيع شيء بنقل خاطئ.
 */
export function MoveRosterSheet({
  closed, initialId, count, onCancel, onMove,
}: {
  closed: Klass[];
  initialId: string;
  /** عدد تلاميذ القسم، لتُقال الحصيلة قبل التنفيذ. */
  count: (classId: string) => number;
  onCancel: () => void;
  onMove: (classId: string, name: string) => Promise<CreateResult>;
}) {
  const [classId, setClassId] = useState(initialId);
  const [name, setName] = useState(closed.find((k) => k.id === initialId)?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const n = count(classId);
  const clean = name.trim();

  async function go() {
    if (busy || !clean || n === 0) return;
    setBusy(true);
    setError("");
    const result = await onMove(classId, clean);
    setBusy(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onCancel} />
      <div className="sheet" role="dialog" aria-labelledby="move-title">
        <div className="shead">
          <h3 id="move-title">نقل الأسماء إلى قسم جديد</h3>
        </div>
        <p className="lead">
          تُنقل أسماء التلاميذ وترتيبها فقط. لا تُنقل العلامات ولا القراءات ولا الحصص ولا
          الحالات ولا الملاحظات ولا الأفواج. ويبقى القسم القديم كما هو حتى موعد حذفه.
        </p>
        {closed.length > 1 && (
          <div className="fld">
            <div className="flab"><b>القسم القديم</b></div>
            <select
              style={{ width: "100%" }}
              value={classId}
              disabled={busy}
              onChange={(e) => {
                setClassId(e.target.value);
                setName(closed.find((k) => k.id === e.target.value)?.name ?? "");
                setError("");
              }}
            >
              {closed.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="fld">
          <div className="flab">
            <b>اسم القسم الجديد</b>
            <small>{n === 0 ? "لا تلاميذ في هذا القسم" : `${n} تلميذًا`}</small>
          </div>
          <input
            className="inp"
            style={{ width: "100%" }}
            value={name}
            disabled={busy}
            onChange={(e) => { setName(e.target.value); setError(""); }}
          />
        </div>
        {error && (
          <div className="note bad" role="alert" style={{ marginTop: 10 }}>{error}</div>
        )}
        <div className="srow2">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>تراجع</button>
          <div className="hspace" />
          <button className="btn" onClick={() => void go()} disabled={busy || !clean || n === 0}>
            {busy ? "جارٍ النقل…" : "انقل الأسماء"}
          </button>
        </div>
      </div>
    </>
  );
}
