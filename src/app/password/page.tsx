"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  MIN_PASSWORD,
  changePasswordProblem,
  translateAuthError,
} from "@/lib/auth";

/**
 * تغيير كلمة السر من داخل الحساب. تُطلب الكلمة الحالية ويُتحقَّق منها أولًا:
 * هاتف مفتوح تركه صاحبه على الطاولة لا يكفي لأخذ حسابه وفيه علامات فصل كامل.
 * (أمّا من نسي كلمته فطريقه /login ← «نسيت كلمة السر؟».)
 */
export default function PasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!alive) return;
        if (!data.user) router.replace("/login");
        else setEmail(data.user.email ?? "");
      });
    return () => {
      alive = false;
    };
  }, [router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email) return;
    const problem = changePasswordProblem(current, next, again);
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy(true);
    setMessage("");
    const supabase = createClient();

    const check = await supabase.auth.signInWithPassword({ email, password: current });
    if (check.error) {
      const wrong = check.error.message.toLowerCase().includes("invalid login");
      setMessage(wrong ? "كلمة السر الحالية غير صحيحة." : translateAuthError(check.error.message));
      setBusy(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) {
      setMessage(translateAuthError(error.message));
      setBusy(false);
      return;
    }
    setDone(true);
    setBusy(false);
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

  if (done) {
    return (
      <div className="auth gut">
        <div className="authbox">
          <h1>تغيّرت كلمة السر</h1>
          <p className="lead">استعملها في دخولك القادم. علاماتك كما هي.</p>
          <a className="btn" href="/app">
            رجوع إلى التطبيق
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="auth gut">
      <form className="authbox" onSubmit={submit}>
        <div>
          <a className="swap" href="/app" style={{ display: "inline-block", marginBottom: 10 }}>
            ← رجوع إلى التطبيق
          </a>
          <h1>تغيير كلمة السر</h1>
        </div>

        <label>
          كلمة السر الحالية
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            dir="ltr"
            required
          />
        </label>

        <label>
          كلمة السر الجديدة
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            dir="ltr"
            required
          />
        </label>

        <label>
          أعد كتابة الجديدة
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
          {busy ? "لحظة…" : "حفظ كلمة السر"}
        </button>
      </form>
    </div>
  );
}
