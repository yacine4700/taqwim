"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { passwordProblem, translateAuthError, MIN_PASSWORD } from "@/lib/auth";

/**
 * تعيين كلمة سر جديدة. تُفتح بعد /auth/callback وقد صارت الجلسة قائمة؛
 * وإن فُتحت بلا جلسة (رابط قديم، أو مفتوح في جهاز آخر) تُعرض رسالة وزرّ
 * لطلب رابط جديد، لا نموذج لا يعمل.
 */
export default function ResetPage() {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | "expired">("checking");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (alive) setState(data.user ? "ready" : "expired");
      });
    return () => {
      alive = false;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = passwordProblem(password, again);
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy(true);
    setMessage("");
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setMessage(translateAuthError(error.message));
      setBusy(false);
      return;
    }
    router.push("/app");
    router.refresh();
  }

  if (state === "checking") {
    return (
      <div className="auth gut">
        <div className="authbox">
          <p className="lead">لحظة…</p>
        </div>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className="auth gut">
        <div className="authbox">
          <h1>انتهت صلاحية الرابط</h1>
          <p className="lead">
            رابط الاستعادة يعمل مرّة واحدة وفي المتصفح الذي طلبته منه. اطلب رابطًا
            جديدًا من شاشة الدخول.
          </p>
          <a className="btn" href="/login?forgot=1">
            اطلب رابطًا جديدًا
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="auth gut">
      <form className="authbox" onSubmit={submit}>
        <div>
          <h1>كلمة سر جديدة</h1>
          <p className="lead">اكتب كلمة السر التي ستدخل بها من الآن.</p>
        </div>

        <label>
          كلمة السر الجديدة
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            dir="ltr"
            required
          />
        </label>

        <label>
          أعد كتابتها
          <input
            type="password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            dir="ltr"
            required
          />
        </label>

        {message && <div className="note bad">{message}</div>}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? "لحظة…" : "حفظ والدخول"}
        </button>
      </form>
    </div>
  );
}
