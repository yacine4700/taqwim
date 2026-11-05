"use client";

import { useRef, useState } from "react";
import { createSingleFlight } from "@/lib/moveRoster";
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
 * تعذّرت قراءة حالة السنة الدراسية. لا يُقال إن قسمًا مفتوح أو مقفل لأن هذا بالذات
 * هو المجهول: الواجهة لا تعرف. العلامات المُدخَلة تُحفظ في جهازك ويقرّر الخادم عند
 * الإرسال، وما رفضه يظهر لك في قائمة المعلّق ولا يضيع.
 */
export function YearUnconfirmedNote({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="note warn termnote" role="status">
      <span>
        تعذّر التأكد من حالة السنة الدراسية لأقسامك، فلا نعرف الآن هل قسم منها مفتوح للتنقيط
        أم مغلق. ما تُدخله يُحفظ في جهازك، ويقرّر الخادم عند الإرسال، وما يرفضه يظهر لك ولا يضيع.
      </span>
      <button className="clearb" onClick={onRetry}>أعد التحقق</button>
    </div>
  );
}

/**
 * نقل أسماء قسم مقفل إلى قسم جديد. تُنقل الأسماء وترتيبها فقط: لا علامات ولا
 * محاولات قراءة ولا حصص ولا حالات ولا ملاحظات ولا أفواج. وأصل القسم يبقى كما هو
 * إلى موعد حذفه، فلا يضيع شيء بنقل خاطئ. وإعادة المحاولة آمنة من التكرار (lib/moveRoster).
 *
 * `initialId` فارغ = القسم الأقرب حذفًا بين المحمَّلة. وإن لم يُحمَّل قسم مقفل بعد
 * (تحميل جارٍ أو قراءة تأخّرت) تُقال الحال ويُعرض زرّ إعادة التحميل بدل زرّ لا يفعل شيئًا.
 */
export function MoveRosterSheet({
  closed, initialId, loading, count, onCancel, onReload, onMove,
}: {
  /** الأقسام المقفلة المحمَّلة، الأقرب حذفًا أولًا. */
  closed: Klass[];
  initialId: string;
  loading: boolean;
  /** عدد تلاميذ القسم، لتُقال الحصيلة قبل التنفيذ. */
  count: (classId: string) => number;
  onCancel: () => void;
  onReload: () => void;
  onMove: (classId: string, name: string) => Promise<CreateResult>;
}) {
  const [picked, setPicked] = useState(initialId);
  /** الاسم كما كتبه الأستاذ؛ null = اسم القسم المختار. */
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** useRef لا حالة: ضغطتان قبل إعادة الرسم لا تُنشئان نقلين. */
  const guard = useRef(createSingleFlight());

  const klass = closed.find((k) => k.id === picked) ?? closed[0] ?? null;
  const name = typed ?? klass?.name ?? "";
  const n = klass ? count(klass.id) : 0;
  const clean = name.trim();

  async function go() {
    if (!klass || !clean || n === 0) return;
    await guard.current(async () => {
      setBusy(true);
      setError("");
      const result = await onMove(klass.id, clean);
      setBusy(false);
      if (!result.ok) setError(result.error);
    });
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
        {!klass ? (
          <>
            <div className="note warn" role="status">
              {loading
                ? "جارٍ تحميل أقسامك…"
                : "لم يظهر بعدُ قسم مقفل في قائمة أقسامك. أعد التحميل ثم حاول."}
            </div>
            <div className="srow2">
              <button className="btn ghost" onClick={onCancel}>إغلاق</button>
              <div className="hspace" />
              <button className="btn" onClick={onReload} disabled={loading}>أعد التحميل</button>
            </div>
          </>
        ) : (
          <>
            {closed.length > 1 && (
              <div className="fld">
                <div className="flab"><b>القسم القديم</b></div>
                <select
                  style={{ width: "100%" }}
                  value={klass.id}
                  disabled={busy}
                  onChange={(e) => { setPicked(e.target.value); setTyped(null); setError(""); }}
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
                onChange={(e) => { setTyped(e.target.value); setError(""); }}
              />
            </div>
            {error && (
              <div className="note bad" role="alert" style={{ marginTop: 10 }}>{error}</div>
            )}
            <div className="srow2">
              <button className="btn ghost" onClick={onCancel} disabled={busy}>تراجع</button>
              <div className="hspace" />
              <button className="btn" onClick={() => void go()} disabled={busy || !clean || n === 0}>
                {busy ? "جارٍ النقل…" : error ? "أعد المحاولة" : "انقل الأسماء"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
