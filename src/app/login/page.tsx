"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  consentProblem,
  signupMetadata,
  translateAuthError as translate,
} from "@/lib/auth";
import { BANNED_MESSAGE, isBannedError } from "@/lib/account";

/** بريد التواصل لصاحب الحساب الموقوف (متغيّر بيئة، كما في صفحة الخصوصية). */
const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [bad, setBad] = useState(false);

  /* ما يصل من الصفحات الأخرى: رابط استعادة فاسد، أو طلب رابط جديد */
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("forgot")) setMode("forgot");
    if (query.get("deleted")) setMessage("حُذف حسابك وكل بياناتك.");
    if (query.get("error") === "link") {
      setBad(true);
      setMessage("تعذّر فتح الرابط: انتهت صلاحيته أو فُتح في جهاز آخر. اطلب رابطًا جديدًا.");
      setMode("forgot");
    }
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setBad(false);
    const supabase = createClient();

    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset`,
      });
      if (error) {
        setBad(true);
        setMessage(translate(error.message));
      } else {
        // جواب واحد سواء أكان البريد مسجّلًا أم لا، فلا يُستعمل النموذج للتخمين
        setMessage("إن كان هذا البريد مسجّلًا فقد أرسلنا إليه رابط الاستعادة. افتحه من الجهاز نفسه.");
      }
      setBusy(false);
      return;
    }

    if (mode === "up") {
      const refused = consentProblem(accepted);
      if (refused) {
        setBad(true);
        setMessage(refused);
        setBusy(false);
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: signupMetadata(name, new Date()) },
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
        // الحظر يُعرف برمزه (user_banned) لا بنصّه وحده: النص إنجليزي وقد يتغيّر
        setMessage(isBannedError(error) ? BANNED_MESSAGE : translate(error.message));
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
              : mode === "up"
                ? "أنشئ حسابك، وتُجهَّز لك المعايير والمعاملات تلقائيًا."
                : "اكتب بريدك لنرسل إليه رابطًا تعيّن به كلمة سر جديدة. علاماتك محفوظة ولا تتأثر."}
          </p>
          {/* من وصله الرابط من زميل لا يعرف ما هذا: سطر يقول لمن التطبيق وماذا يفعل */}
          {mode !== "forgot" && (
            <p className="about">
              دفتر لأستاذ الثانوي: تنقّط فيه التقويم المستمر ومحاولات القراءة
              في الحصة. يعمل دون شبكة ويُرسل ما أدخلتَه حين تعود، ويملأ وثيقة
              حجز النقاط للإدارة.
            </p>
          )}
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

        {mode !== "forgot" && (
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
        )}

        {mode === "up" && (
          <label className="consent">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              required
            />
            <span>
              قرأتُ{" "}
              <a href="/privacy" target="_blank" rel="noopener">
                سياسة الخصوصية
              </a>{" "}
              وأوافق عليها: أنا مسؤول عن أسماء التلاميذ التي أُدخلها.
            </span>
          </label>
        )}

        {message && (
          <div className={bad ? "note bad" : "note"}>
            {message}
            {message === BANNED_MESSAGE && CONTACT && (
              <>
                {" "}
                <a href={`mailto:${CONTACT}`} dir="ltr">
                  {CONTACT}
                </a>
              </>
            )}
          </div>
        )}

        <button className="btn" type="submit" disabled={busy}>
          {busy
            ? "لحظة…"
            : mode === "in"
              ? "دخول"
              : mode === "up"
                ? "إنشاء الحساب"
                : "أرسل رابط الاستعادة"}
        </button>

        {mode === "in" && (
          <button
            type="button"
            className="swap"
            onClick={() => {
              setMode("forgot");
              setMessage("");
              setBad(false);
            }}
          >
            نسيت كلمة السر؟
          </button>
        )}

        <button
          type="button"
          className="swap"
          onClick={() => {
            setMode(mode === "in" ? "up" : "in");
            setMessage("");
            setBad(false);
          }}
        >
          {mode === "in" ? "ليس لي حساب بعد" : mode === "up" ? "لي حساب، أريد الدخول" : "رجوع إلى الدخول"}
        </button>

        <a className="swap" href="/privacy" style={{ fontWeight: 400 }}>
          الخصوصية: أين تُحفظ البيانات ومن يراها
        </a>
      </form>
    </div>
  );
}
