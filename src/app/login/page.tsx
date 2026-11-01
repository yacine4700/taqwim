"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  consentProblem,
  isEmailNotConfirmed,
  signupMetadata,
  translateAuthError as translate,
} from "@/lib/auth";
import { BANNED_MESSAGE, isBannedError } from "@/lib/account";

/** بريد التواصل لصاحب الحساب الموقوف (متغيّر بيئة، كما في صفحة الخصوصية). */
const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

/** الانتظار بين رسالتين إلى البريد نفسه: الخادم يرفض ما دون الدقيقة، فنمنعه قبل أن يُرفض. */
const RESEND_AFTER = 60;

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
  /* الدخول رُدّ لأن البريد لم يؤكَّد: يظهر معه زرّ إعادة إرسال رسالة التأكيد */
  const [unconfirmed, setUnconfirmed] = useState(false);
  /* بعد إرسال رسالة (تأكيد الحساب، أو رابط الاستعادة) تُعرض شاشة كاملة لا تنبيه صغير */
  const [sent, setSent] = useState<{ kind: "signup" | "recovery"; email: string } | null>(null);
  /* ثوانٍ تبقت قبل أن يُسمح بإعادة الإرسال (الخادم نفسه يمنع أقل من دقيقة) */
  const [wait, setWait] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendNote, setResendNote] = useState<{ text: string; bad: boolean } | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  function showSent(kind: "signup" | "recovery", to: string) {
    setSent({ kind, email: to });
    setWait(RESEND_AFTER);
    setResendNote(null);
  }

  async function resend() {
    if (!sent || wait > 0 || resending) return;
    setResending(true);
    setResendNote(null);
    const supabase = createClient();
    const { error } =
      sent.kind === "signup"
        ? await supabase.auth.resend({ type: "signup", email: sent.email })
        : await supabase.auth.resetPasswordForEmail(sent.email, {
            redirectTo: `${window.location.origin}/auth/callback?next=/reset`,
          });
    setResendNote(
      error
        ? { text: translate(error.message), bad: true }
        : { text: "أعدنا إرسال الرسالة. راجع بريدك.", bad: false },
    );
    setWait(RESEND_AFTER);
    setResending(false);
  }

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
    // رابط الاستعادة وصل لحساب موقوف: طلب رابط جديد لا ينفعه، فتُشرح الحال ويبقى نموذج الدخول
    if (query.get("error") === "banned") {
      setBad(true);
      setMessage(BANNED_MESSAGE);
    }
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setBad(false);
    setUnconfirmed(false);
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
        showSent("recovery", email);
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
        // لا جلسة: التأكيد مفعّل. الشاشة نفسها تُعرض سواء أكان البريد جديدًا أم مسجّلًا من قبل
        // (الخادم يُجيب الجوابين بلا فرق)، فلا يُستعمل النموذج لتخمين من له حساب.
        setPassword("");
        showSent("signup", email);
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setBad(true);
        // الحظر يُعرف برمزه (user_banned) لا بنصّه وحده: النص إنجليزي وقد يتغيّر
        setMessage(isBannedError(error) ? BANNED_MESSAGE : translate(error.message));
        if (isEmailNotConfirmed(error)) {
          setMessage(translate("Email not confirmed"));
          setUnconfirmed(true);
        }
      } else {
        router.push("/app");
        router.refresh();
        return;
      }
    }
    setBusy(false);
  }

  /** من رُدّ دخوله لعدم التأكيد: رسالة جديدة، ثم شاشة «تحقّق من بريدك» بمهلتها. */
  async function resendConfirmation() {
    setBusy(true);
    setMessage("");
    setBad(false);
    const { error } = await createClient().auth.resend({ type: "signup", email });
    setBusy(false);
    if (error) {
      setBad(true);
      setMessage(translate(error.message));
      return;
    }
    setUnconfirmed(false);
    setPassword("");
    showSent("signup", email);
  }

  if (sent) {
    const isSignup = sent.kind === "signup";
    // يعود إلى شاشة الدخول والبريد في خانته، وكلمة السر فارغة
    const backToSignIn = () => {
      setSent(null);
      setMode("in");
      setMessage("");
      setBad(false);
    };
    return (
      <div className="auth gut">
        <div className="authbox" role="status">
          <svg
            width="56"
            height="56"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
          </svg>
          <div>
            <h1>
              تحقّق من <span style={{ color: "var(--primary)" }}>بريدك الإلكتروني</span>
            </h1>
            <p className="lead">
              {isSignup
                ? "أنشأنا حسابك، وأرسلنا رسالة تأكيد إلى:"
                : "إن كان هذا البريد مسجّلًا فقد أرسلنا إليه رابط استعادة كلمة السر:"}
            </p>
          </div>
          <div
            className="note"
            dir="ltr"
            style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)", textAlign: "center", wordBreak: "break-all" }}
          >
            {sent.email}
          </div>
          <p className="lead">
            {isSignup
              ? "افتح الرسالة واضغط على رابط التأكيد لتفعيل حسابك، ثم سجّل الدخول."
              : "افتح الرسالة واضغط على الرابط لتعيين كلمة سر جديدة. افتحه من المتصفح والجهاز نفسهما اللذين طلبتَه منهما. علاماتك محفوظة ولا تتأثر."}
          </p>
          <p className="about">
            لم تصلك الرسالة؟ راجع مجلد الرسائل غير المرغوب فيها (Spam)، فقد تتأخر بضع دقائق.
          </p>
          {resendNote && <div className={resendNote.bad ? "note bad" : "note"}>{resendNote.text}</div>}
          <button className="btn" type="button" onClick={backToSignIn}>
            {isSignup ? "تسجيل الدخول" : "العودة إلى تسجيل الدخول"}
          </button>
          <button
            type="button"
            className="swap"
            onClick={() => void resend()}
            disabled={wait > 0 || resending}
          >
            {resending
              ? "لحظة…"
              : wait > 0
                ? `أعد إرسال الرسالة بعد ${wait} ثانية`
                : "أعد إرسال الرسالة"}
          </button>
          <button
            type="button"
            className="swap"
            onClick={() => {
              setSent(null);
              setMessage("");
              setBad(false);
            }}
          >
            {isSignup ? "بريد خاطئ؟ العودة إلى إنشاء الحساب" : "بريد خاطئ؟ اكتبه من جديد"}
          </button>
        </div>
      </div>
    );
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

        {unconfirmed && mode === "in" && (
          <button className="btn soft" type="button" disabled={busy} onClick={() => void resendConfirmation()}>
            {busy ? "لحظة…" : "أعد إرسال رسالة التأكيد"}
          </button>
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
              setUnconfirmed(false);
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
            setUnconfirmed(false);
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
