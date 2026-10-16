"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { confirmMatches, translateAuthError } from "@/lib/auth";
import { kvDel } from "@/lib/localdb";
import { pendingLabel } from "@/lib/outbox";
import { readPendingOps } from "@/lib/pendingOnDevice";

/**
 * حذف الحساب. لا رجعة فيه، فلا تكفيه نقرة: يُكتب البريد للتأكيد، ويُقال
 * صراحةً ما سيُمحى وما لم يُرسل بعد. الحذف نفسه دالة في القاعدة
 * (delete_my_account) تحذف حساب المتصل وحده، والباقي يتبعه بالحذف التسلسلي.
 */
export default function AccountPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [unsent, setUnsent] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
      setUserId(data.user.id);
      const ops = await readPendingOps();
      if (alive) setUnsent(pendingLabel(ops));
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    if (!email || !confirmMatches(typed, email)) return;
    setBusy(true);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      // الدالة لم تُطبَّق بعد في القاعدة: لا شيء حُذف، والرسالة تقول ذلك بدل نصّ خام
      const missing =
        error.code === "PGRST202" || error.message.toLowerCase().includes("could not find");
      setMessage(
        missing
          ? "الحذف غير مُفعَّل على الخادم بعد، ولم يُحذف شيء. أبلغ صاحب التطبيق."
          : translateAuthError(error.message),
      );
      setBusy(false);
      return;
    }
    // الحساب انمحى: تُمسح نسخة الجهاز وطابوره أيضًا ثم تنتهي الجلسة
    await kvDel(`snapshot:${userId}`);
    await kvDel(`queue:${userId}`);
    navigator.serviceWorker?.controller?.postMessage({ type: "clear-cache" });
    await supabase.auth.signOut({ scope: "local" });
    router.push("/login?deleted=1");
    router.refresh();
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
      <form className="authbox" onSubmit={remove}>
        <div>
          <a className="swap" href="/app" style={{ display: "inline-block", marginBottom: 10 }}>
            ← رجوع إلى التطبيق
          </a>
          <h1>حذف الحساب</h1>
          <p className="lead">
            سيُمحى حسابك وكل أقسامك وتلاميذك وعلاماتك نهائيًا، ولا يمكن استرجاعها.
          </p>
        </div>

        {unsent && (
          <div className="note warn">
            {unsent} بعد، وستضيع مع الحذف. ارجع إلى التطبيق وانتظر إرسالها أوّلًا.
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

        {message && <div className="note bad">{message}</div>}

        <button
          className="btn danger"
          type="submit"
          disabled={busy || !confirmMatches(typed, email)}
        >
          {busy ? "لحظة…" : "احذف حسابي نهائيًا"}
        </button>
      </form>
    </div>
  );
}
