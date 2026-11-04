"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { consentMetadata, consentProblem } from "@/lib/auth";
import ConsentField from "../ConsentField";

/**
 * يُحفظ أثر الموافقة بالطريقة نفسها التي يُحفظ بها عند التسجيل: بيانات المستخدم في Auth
 * (privacy_version وprivacy_accepted_at)، عبر updateUser. لا جدول جديد ولا تغيير في الدخول.
 * «الخروج» لا يمسّ ما على الجهاز من علامات لم تُرسل بعد: تعود الجلسة إلى /login وحسب.
 */
export default function ConsentClient({ email }: { email: string }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    const refused = consentProblem(accepted);
    if (refused) {
      setMessage(refused);
      return;
    }
    setBusy(true);
    setMessage("");
    const { error } = await createClient().auth.updateUser({ data: consentMetadata(new Date()) });
    if (error) {
      setMessage("تعذّر حفظ موافقتك. تحقّق من الاتصال وأعد المحاولة.");
      setBusy(false);
      return;
    }
    router.push("/app");
    router.refresh();
  }

  async function leave() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) await supabase.auth.signOut({ scope: "local" });
    window.location.replace("/login");
  }

  return (
    <div className="auth gut">
      <form className="authbox" onSubmit={accept}>
        <div>
          <h1>
            دفتر <span style={{ color: "var(--primary)" }}>التقويم</span>
          </h1>
          <p className="lead">
            حدّثنا سياسة الخصوصية، وأضفنا شروط استخدام التطبيق. نطلب موافقتك عليهما مرة واحدة قبل
            أن تتابع إلى أقسامك. علاماتك محفوظة ولم يتغيّر فيها شيء.
          </p>
          {email && (
            <p className="about" dir="ltr" style={{ textAlign: "start" }}>
              {email}
            </p>
          )}
        </div>

        <ConsentField checked={accepted} onChange={setAccepted} />

        {message && <div className="note bad">{message}</div>}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? "لحظة…" : "أوافق وأتابع"}
        </button>
        <button type="button" className="swap" disabled={busy} onClick={() => void leave()}>
          لا أوافق: اخرج من الحساب
        </button>
        <a className="swap" href="/delete-account" style={{ fontWeight: 400 }}>
          أريد حذف حسابي
        </a>
      </form>
    </div>
  );
}
