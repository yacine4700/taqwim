"use client";

import { useEffect, useState } from "react";
import "./globals.css";
import { readPendingOps } from "@/lib/pendingOnDevice";
import { savedNotice } from "@/lib/outbox";

/**
 * حين يسقط التخطيط الجذري نفسه لا يعمل error.tsx. هذه الصفحة تحلّ محلّه
 * كاملةً، فتحمل html وbody بنفسها. تقرأ الطابور من الجهاز قراءةً فقط
 * (لا تعتمد على شيء ممّا سقط) لتطمئن الأستاذ على علاماته المعلّقة.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    void readPendingOps().then((ops) => {
      if (alive) setNotice(savedNotice(ops));
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <html lang="ar" dir="rtl">
      <body>
        <div className="auth gut">
          <div className="authbox" role="alert">
            <h1>حدث خطأ غير متوقّع</h1>
            <p className="lead">تعذّر تشغيل التطبيق. أعد المحاولة أو أعد فتحه.</p>
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
          </div>
        </div>
      </body>
    </html>
  );
}
