"use client";

import { useEffect, useState } from "react";
import { readPendingOps } from "@/lib/pendingOnDevice";
import { savedNotice } from "@/lib/outbox";

/**
 * شبكة الأمان: أيّ خطأ في عرض صفحة كان يعطي شاشة بيضاء بلا رسالة ولا مخرج.
 * الآن يرى الأستاذ ما حدث، ويُطمأَن على علاماته المعلّقة (هي في IndexedDB
 * وليست في الصفحة التي سقطت)، وله زرّان: إعادة المحاولة وإعادة التحميل.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [notice, setNotice] = useState("");

  useEffect(() => {
    console.error(error);
    let alive = true;
    void readPendingOps().then((ops) => {
      if (alive) setNotice(savedNotice(ops));
    });
    return () => {
      alive = false;
    };
  }, [error]);

  return (
    <div className="auth gut">
      <div className="authbox" role="alert">
        <h1>حدث خطأ غير متوقّع</h1>
        <p className="lead">تعذّر عرض هذه الصفحة. أعد المحاولة، وإن تكرّر فأعد تحميل الصفحة.</p>

        {notice && <div className="note">{notice}</div>}

        <button className="btn" type="button" onClick={() => reset()}>
          أعد المحاولة
        </button>
        <button
          className="btn ghost"
          type="button"
          onClick={() => window.location.reload()}
        >
          أعد تحميل الصفحة
        </button>

        {error.digest && (
          <p className="lead" dir="ltr" style={{ fontSize: 11, textAlign: "center" }}>
            {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
