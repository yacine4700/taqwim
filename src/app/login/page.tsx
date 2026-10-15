"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [bad, setBad] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setBad(false);
    const supabase = createClient();

    if (mode === "up") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });
      if (error) {
        setBad(true);
        setMessage(translate(error.message));
      } else if (data.session) {
        router.push("/app");
        router.refresh();
        return;
      } else {
        setMessage("أُنشئ الحساب. افتح بريدك وأكّد العنوان ثم سجّل الدخول.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setBad(true);
        setMessage(translate(error.message));
      } else {
        router.push("/app");
        router.refresh();
        return;
      }
    }
    setBusy(false);
  }

  return (
    <div className="auth gut">
      <form className="authbox" onSubmit={submit}>
        <div>
          <h1>
            دفتر <span style={{ color: "var(--primary)" }}>التقويم</span>
          </h1>
          <p className="lead">
            {mode === "in"
              ? "سجّل الدخول لتصل إلى أقسامك وعلاماتك."
              : "أنشئ حسابك، وتُجهَّز لك المعايير والمعاملات تلقائيًا."}
          </p>
        </div>

        {mode === "up" && (
          <label>
            الاسم الكامل
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </label>
        )}

        <label>
          البريد الإلكتروني
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            dir="ltr"
            required
          />
        </label>

        <label>
          كلمة السر
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            minLength={6}
            dir="ltr"
            required
          />
        </label>

        {message && <div className={bad ? "note bad" : "note"}>{message}</div>}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? "لحظة…" : mode === "in" ? "دخول" : "إنشاء الحساب"}
        </button>

        <button
          type="button"
          className="swap"
          onClick={() => {
            setMode(mode === "in" ? "up" : "in");
            setMessage("");
            setBad(false);
          }}
        >
          {mode === "in" ? "ليس لي حساب بعد" : "لي حساب، أريد الدخول"}
        </button>
      </form>
    </div>
  );
}

function translate(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "البريد أو كلمة السر غير صحيحة.";
  if (m.includes("already registered")) return "هذا البريد مسجّل. سجّل الدخول به.";
  if (m.includes("password")) return "كلمة السر قصيرة: ستة أحرف على الأقل.";
  if (m.includes("email")) return "راجع صيغة البريد الإلكتروني.";
  return message;
}
