"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { confirmMatches } from "@/lib/auth";
import { DELETION_GRACE_DAYS, deletionErrorMessage, purgeDateLabel } from "@/lib/account";
import { pendingLabel } from "@/lib/outbox";
import { readPendingOps } from "@/lib/pendingOnDevice";

/**
 * طلب حذف الحساب. لا يُحذف شيء الآن: يبدأ مهلة 7 أيام يستطيع الأستاذ خلالها
 * الإلغاء، ثم يحذفه التشغيل الليلي بعد أخذ نسخة. يُكتب البريد وكلمة المرور:
 * الدخول بكلمة المرور يسجّل في الخادم وقت إدخالها لهذه الجلسة، والدالة
 * request_account_deletion ترفض إن مضى عليه أكثر من 10 دقائق، فلا يكفي هاتف مفتوح.
 */
export default function AccountPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [unsent, setUnsent] = useState("");
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [due, setDue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  /* خطوة أخيرة بعد ملء النموذج: ورقة تؤكّد الطلب قبل أن يُرسل، لا زرّ يُنفّذ بنقرة */
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await createClient().auth.getUser();
      if (!alive) return;
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setEmail(data.user.email ?? "");
      const ops = await readPendingOps();
      if (alive) setUnsent(pendingLabel(ops));
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!email || unsent || !confirmMatches(typed, email) || !password) return;
    setMessage("");
    setConfirming(true);
  }

  async function remove() {
    if (!email || unsent || !confirmMatches(typed, email) || !password) return;
    setBusy(true);
    setMessage("");
    const supabase = createClient();
    // دخول جديد بكلمة المرور: يثبت للخادم أنها أُدخلت الآن في هذه الجلسة.
    const signIn = await supabase.auth.signInWithPassword({ email, password });
    setPassword("");
    if (signIn.error) {
      setMessage(deletionErrorMessage(signIn.error));
      setConfirming(false);
      setBusy(false);
      return;
    }
    const { data, error } = await supabase.rpc("request_account_deletion");
    if (error) {
      setMessage(deletionErrorMessage(error));
      setConfirming(false);
      setBusy(false);
      return;
    }
    setConfirming(false);
    setDue(typeof data === "string" ? data : null);
    setBusy(false);
  }

  if (due) {
    return (
      <div className="auth gut">
        <div className="authbox">
          <h1>طُلب حذف حسابك</h1>
          <p className="lead">
            يُحذف حسابك وكل ما فيه نهائيًا يوم {purgeDateLabel(due) ?? "بعد 7 أيام"}. إلى ذلك
            اليوم تستطيع الدخول وتنزيل «نسختي» أو إلغاء الحذف، ولا تُعدَّل العلامات.
          </p>
          <a className="btn" href="/app">
            رجوع إلى التطبيق
          </a>
        </div>
      </div>
    );
  }

  if (email === null) {
    return (
      <div className="auth gut">
        <div className="authbox">
          <p className="lead">لحظة…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth gut">
      <form className="authbox" onSubmit={ask}>
        <div>
          <a className="swap" href="/app" style={{ display: "inline-block", marginBottom: 10 }}>
            ← رجوع إلى التطبيق
          </a>
          <h1>حذف الحساب</h1>
          <p className="lead">
            يُحذف حسابك وكل أقسامك وتلاميذك وعلاماتك نهائيًا بعد {DELETION_GRACE_DAYS} أيام.
            خلال هذه الأيام تستطيع إلغاء الطلب، ولا تُعدَّل العلامات. بعدها لا يمكن
            استرجاع شيء من التطبيق.
          </p>
        </div>

        {unsent && (
          <div className="note warn">
            {unsent} بعد. ارجع إلى التطبيق وانتظر حتى تصل، ثم اطلب الحذف: بعد الطلب
            لا تُقبل العلامات، فتبقى في هذا الجهاز حتى تُلغي الطلب.
          </div>
        )}

        <label>
          للتأكيد اكتب بريدك:
          <small dir="ltr" style={{ textAlign: "start", fontWeight: 400 }}>
            {email}
          </small>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            dir="ltr"
            autoComplete="off"
            autoCapitalize="none"
          />
        </label>

        <label>
          كلمة المرور:
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            dir="ltr"
            autoComplete="current-password"
          />
        </label>

        {message && <div className="note bad">{message}</div>}

        <button
          className="btn danger"
          type="submit"
          disabled={busy || !!unsent || !confirmMatches(typed, email) || !password}
        >
          {`احذف حسابي بعد ${DELETION_GRACE_DAYS} أيام`}
        </button>

        {confirming && (
          <>
            <div className="scrim" onClick={busy ? undefined : () => setConfirming(false)} />
            <div className="sheet" role="dialog" aria-modal="true">
              <div className="shead">
                <h3>هل أنت متأكد من حذف حسابك؟</h3>
              </div>
              <p className="lead">
                ستطلب حذف الحساب <span dir="ltr">{email}</span> وكل أقسامك وتلاميذك وعلاماتك.
                يبدأ الآن عدّ {DELETION_GRACE_DAYS} أيام، لا تُقبل خلالها علامات جديدة، وتستطيع
                خلالها إلغاء الطلب. وبعدها يُحذف كل شيء نهائيًا ولا يمكن استرجاعه.
              </p>
              <div className="srow2">
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirming(false)}>
                  تراجع
                </button>
                <div className="hspace" />
                <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>
                  {busy ? "لحظة…" : "نعم، احذف حسابي"}
                </button>
              </div>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
