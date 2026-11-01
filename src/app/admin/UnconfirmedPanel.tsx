"use client";

import { useEffect, useState } from "react";
import {
  UNCONFIRMED_MIN_DAYS,
  unconfirmedAge,
  unconfirmedCounts,
  unconfirmedWhyKept,
  type AdminUnconfirmed,
} from "@/lib/admin";

/**
 * حسابات سجّلت ولم تؤكّد بريدها. لا يُحذف شيء تلقائيًا: يرى المشرف القائمة، وإن وُجد قابل للحذف
 * ظهر زرّ يُبدَّل في مكانه بتأكيد («نعم، احذف N» و«تراجع») يبقى حتى يختار المشرف (لا مهلة تُسقطه
 * وهو يقرأ). والعدد يُمرَّر إلى القاعدة فترفض الحذف إن تغيّرت القائمة بعد أن رآها.
 */
export default function UnconfirmedPanel({
  rows,
  busy,
  onPurge,
}: {
  rows: AdminUnconfirmed[];
  busy: boolean;
  onPurge: (expected: number) => void;
}) {
  const { total, deletable } = unconfirmedCounts(rows);
  const [armed, setArmed] = useState(false);

  // تغيّر العدد (تحديث أو حذف) يُسقط التأكيد المعلَّق: لا يبقى مسلَّحًا على عدد لم يعد صحيحًا.
  useEffect(() => {
    setArmed(false);
  }, [deletable]);

  if (total === 0) return null;
  const phrase = deletable === 1 ? "حساب واحد" : deletable === 2 ? "حسابين" : `${deletable} ${deletable <= 10 ? "حسابات" : "حسابًا"}`;

  return (
    <section className="card adm-unconf" aria-label="حسابات لم تؤكّد بريدها" style={{ padding: 14, marginBottom: 12 }}>
      <b>
        لم تؤكّد بريدها <span className="adm-count">{total}</span>
      </b>
      <p className="lead" style={{ margin: "6px 0 10px" }}>
        سجّلوا ولم يضغطوا رابط التأكيد، فلا يدخلون. {deletable > 0
          ? deletable === 1
            ? `واحد منهم مرّت ${UNCONFIRMED_MIN_DAYS} أيام ولا بيانات له، ويمكن حذفه.`
            : `${deletable} منهم مرّت ${UNCONFIRMED_MIN_DAYS} أيام ولا بيانات لهم، ويمكن حذفهم.`
          : `لا أحد منهم قابل للحذف بعد (يُحذف من مرّت ${UNCONFIRMED_MIN_DAYS} أيام ولا بيانات له).`}{" "}
        لا يُحذف شيء إلا بتأكيدك.
      </p>

      <details>
        <summary>عرض القائمة ({total})</summary>
        <div style={{ marginTop: 8 }}>
          {rows.map((r) => (
            <div key={r.id} className="srow2" style={{ flexWrap: "wrap" }}>
              <div className="k">
                <bdi dir="ltr">{r.email ?? "—"}</bdi>
                <small>
                  {[r.full_name, unconfirmedAge(r.days_old), unconfirmedWhyKept(r)].filter(Boolean).join(" · ")}
                </small>
              </div>
              <span className={r.deletable ? "pill warn" : "pill"}>{r.deletable ? "قابل للحذف" : "يبقى"}</span>
            </div>
          ))}
        </div>
      </details>

      {deletable > 0 &&
        (armed ? (
          <div className="adm-confirm" role="alertdialog" aria-label="تأكيد حذف غير المؤكَّدين">
            <p>
              <b>حذف {phrase} نهائيًا؟</b>{" "}
              تُمحى الحسابات ومعاييرها الافتراضية. لا بيانات فيها، ولا رجعة. تُسجَّل العملية باسمك.
            </p>
            <div className="adm-confirm-row">
              <button className="btn danger sm" disabled={busy} onClick={() => onPurge(deletable)}>
                {busy ? "لحظة…" : `نعم، احذف ${deletable}`}
              </button>
              <button className="btn ghost sm" disabled={busy} onClick={() => setArmed(false)}>
                تراجع
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10 }}>
            <button className="clearb danger" disabled={busy} onClick={() => setArmed(true)}>
              احذف القابلة للحذف ({deletable})…
            </button>
          </div>
        ))}
    </section>
  );
}
