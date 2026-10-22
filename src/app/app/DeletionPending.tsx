"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { purgeDateLabel } from "@/lib/account";
import { backupFileName } from "@/lib/backup";
import { exportFromServer } from "@/lib/backupDb";
import { backupJson, downloadBlob } from "./BackupSheet";

/**
 * الشاشة الوحيدة خلال مهلة الحذف. القاعدة تمنع الكتابة أصلًا (سياسات guard_*)،
 * وهذه الشاشة تقول ذلك بدل أن يُدخل الأستاذ علامات تُرفض. يبقى أمامه أمران:
 * إلغاء الحذف، أو تنزيل «نسختي» قبل أن يُحذف كل شيء.
 */
export default function DeletionPending({
  purgeAfter, email, teacherId,
}: {
  purgeAfter: string;
  email: string;
  teacherId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "cancel" | "backup">("");
  const [message, setMessage] = useState("");
  const [bad, setBad] = useState(false);

  async function cancel() {
    setBusy("cancel");
    setMessage("");
    const { error } = await createClient().rpc("cancel_account_deletion");
    if (error) {
      setBad(true);
      setMessage("تعذّر الإلغاء. تحقّق من الاتصال وأعد المحاولة.");
      setBusy("");
      return;
    }
    router.refresh();
  }

  async function backup() {
    setBusy("backup");
    setMessage("");
    try {
      const file = await exportFromServer(createClient(), { id: teacherId, email }, []);
      const ok = downloadBlob(backupFileName(new Date(), "json"), backupJson(file));
      setBad(!ok);
      setMessage(ok ? "نُزّلت «نسختي». احفظها في ملفّات هاتفك." : "تعذّر التنزيل في هذا المتصفّح.");
    } catch {
      setBad(true);
      setMessage("تعذّر تجهيز النسخة. تحقّق من الاتصال وأعد المحاولة.");
    }
    setBusy("");
  }

  return (
    <div className="auth gut">
      <div className="authbox">
        <h1>حسابك مجدول للحذف</h1>
        <p className="lead">
          يُحذف حسابك وكل ما فيه نهائيًا يوم {purgeDateLabel(purgeAfter) ?? purgeAfter}. حتى ذلك
          اليوم لا تُعدَّل العلامات. إن غيّرت رأيك فألغِ الحذف ويعود كل شيء كما كان.
        </p>
        {message && <div className={bad ? "note bad" : "note"}>{message}</div>}
        <button className="btn" onClick={cancel} disabled={busy !== ""}>
          {busy === "cancel" ? "لحظة…" : "ألغِ الحذف"}
        </button>
        <button className="btn ghost" onClick={backup} disabled={busy !== ""}>
          {busy === "backup" ? "لحظة…" : "نزّل «نسختي»"}
        </button>
      </div>
    </div>
  );
}
