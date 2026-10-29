"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { adminProblemMessage, classifyAdminError, cleanCode, codeReady, parseAdminState } from "@/lib/admin";
import { BANNED_MESSAGE, isBannedError } from "@/lib/account";

type Phase = "checking" | "credentials" | "enroll" | "verify";

/**
 * دخول المشرف: صفحة منفصلة عن دخول الأساتذة، بلا تسجيل حساب ولا «نسيت كلمة السر».
 * الخطوات: البريد وكلمة السر ← (ربط تطبيق المصادقة أول مرة) ← الرمز ذو الستة أرقام.
 * من ليس في private.admins يُخرَج فورًا برسالة عامة لا تكشف إن كان البريد لمشرف.
 */
function AdminLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const reauth = params.get("reauth") === "1";
  const [supabase] = useState(() => createClient());
  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // حساب لم يُدرج في private.admins بعد: يُسمح له بربط تطبيق المصادقة وحده، ولا يدخل اللوحة.
  const [unlisted, setUnlisted] = useState(false);

  /** بعد جلسة قائمة: إلى اللوحة إن كان التحقّق ساريًا، وإلا إلى خطوة الرمز. */
  async function proceed(): Promise<void> {
    const me = await supabase.rpc("am_i_admin");
    if (me.error) {
      const problem = classifyAdminError(me.error);
      if (problem === "session") {
        setPhase("credentials");
        return;
      }
      setMessage(adminProblemMessage(problem));
      setPhase("credentials");
      return;
    }
    const state = parseAdminState(me.data);
    if (!state.listed) {
      // الترتيب الآمن لحساب جديد: يُربط تطبيق المصادقة أولًا من هنا، ثم يُدرج الحساب في
      // private.admins بعد ذلك. فلا تمرّ لحظة يكون فيها الحساب مشرفًا وبلا عامل مربوط
      // بهاتف صاحبه. الحساب الذي له عامل مؤكَّد مسبقًا (أستاذ عادي مثلًا) يُخرَج برسالة عامة.
      const existing = await supabase.auth.mfa.listFactors();
      if (existing.data?.totp.some((f) => f.status === "verified")) {
        await supabase.auth.signOut();
        setMessage("لا صلاحية لهذا الحساب هنا.");
        setPhase("credentials");
        return;
      }
      setUnlisted(true);
      setPhase("enroll");
      return;
    }
    setUnlisted(false);
    if (state.ready) {
      router.replace("/admin");
      router.refresh();
      return;
    }
    const factors = await supabase.auth.mfa.listFactors();
    const verified = factors.data?.totp.find((f) => f.status === "verified");
    if (verified) {
      setFactorId(verified.id);
      setPhase("verify");
    } else {
      setPhase("enroll");
    }
  }

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setPhase("credentials");
        return;
      }
      setEmail(data.user.email ?? "");
      if (reauth) setMessage("انتهت صلاحية التحقّق الثنائي. أدخل الرمز من جديد.");
      await proceed();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setPassword("");
    if (error) {
      setBusy(false);
      setMessage(
        isBannedError(error)
          ? BANNED_MESSAGE
          : /rate limit|too many/i.test(error.message)
            ? "محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة."
            : "البريد أو كلمة السر غير صحيحة.",
      );
      return;
    }
    await proceed();
    setBusy(false);
  }

  async function startEnroll() {
    setBusy(true);
    setMessage("");
    // محاولة ربط سابقة لم تكتمل تترك عاملًا غير مؤكَّد: يُزال قبل البدء من جديد.
    const factors = await supabase.auth.mfa.listFactors();
    for (const f of factors.data?.all ?? []) {
      if (f.factor_type === "totp" && f.status !== "verified") {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "مشرف دفتر التقويم",
    });
    setBusy(false);
    if (error || !data) {
      setMessage("تعذّر بدء الربط. قد يكون التحقّق الثنائي غير مفعّل في إعدادات Supabase.");
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!codeReady(code)) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setCode("");
    if (error) {
      setBusy(false);
      setMessage("الرمز غير صحيح أو انتهى وقته. أدخل الرمز الظاهر الآن في التطبيق.");
      return;
    }
    setQr("");
    setSecret("");
    if (unlisted) {
      // رُبط التطبيق. لا لوحة بعد: يُدرج صاحب الخادم الحساب ثم يعود المشرف فيدخل بالرمز.
      await supabase.auth.signOut();
      setBusy(false);
      setUnlisted(false);
      setPhase("credentials");
      setMessage("رُبط تطبيق المصادقة بهذا الحساب. بعد أن يُدرج صاحب الخادم الحساب في المشرفين ادخل من جديد بالرمز.");
      return;
    }
    // القاعدة هي التي تقول إن التحقّق صار ساريًا، لا مجرّد نجاح الطلب.
    const me = await supabase.rpc("am_i_admin");
    setBusy(false);
    if (me.error || !parseAdminState(me.data).ready) {
      setMessage("تمّ الرمز لكن الخادم لم يقبل الجلسة بعد. أعد المحاولة.");
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  async function other() {
    await supabase.auth.signOut();
    setEmail("");
    setCode("");
    setQr("");
    setMessage("");
    setPhase("credentials");
  }

  if (phase === "checking") {
    return (
      <div className="auth gut">
        <div className="authbox">
          <p className="lead">لحظة…</p>
        </div>
      </div>
    );
  }

  if (phase === "credentials") {
    return (
      <div className="auth gut">
        <form className="authbox" onSubmit={signIn}>
          <div>
            <h1>دخول المشرف</h1>
            <p className="lead">هذه الصفحة لحساب الإشراف وحده. حساب الأستاذ يدخل من الصفحة العادية.</p>
          </div>
          <label>
            البريد الإلكتروني
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
              autoComplete="username"
              autoCapitalize="none"
              required
            />
          </label>
          <label>
            كلمة السر
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              dir="ltr"
              autoComplete="current-password"
              required
            />
          </label>
          {message && <div className="note bad">{message}</div>}
          <button className="btn" type="submit" disabled={busy || !email.trim() || !password}>
            {busy ? "لحظة…" : "متابعة"}
          </button>
          <a className="swap" href="/login">
            دخول الأساتذة
          </a>
        </form>
      </div>
    );
  }

  return (
    <div className="auth gut">
      <form className="authbox" onSubmit={verify}>
        <h1>التحقّق الثنائي</h1>
        {phase === "enroll" && !qr && (
          <>
            <p className="lead">
              {unlisted
                ? "هذا الحساب غير مُدرج في الإشراف بعد، ويمكنك الآن تجهيز تطبيق المصادقة ليكون جاهزًا حين يُدرج. لا دخول إلى اللوحة قبل الإدراج."
                : "لم يُربط تطبيق مصادقة بهذا الحساب بعد. اربط Google Authenticator أو ما يماثله، فالرمز يُطلب في كل دخول وبعد كل 12 ساعة."}
            </p>
            <button className="btn" type="button" onClick={startEnroll} disabled={busy}>
              {busy ? "لحظة…" : "اربط تطبيق المصادقة"}
            </button>
          </>
        )}
        {phase === "enroll" && qr && (
          <>
            <p className="lead">امسح الرمز بتطبيق المصادقة، ثم اكتب الأرقام الستّة التي تظهر فيه.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qr.startsWith("data:") ? qr : `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`}
              alt="رمز QR لتطبيق المصادقة"
              width={200}
              height={200}
              style={{ background: "#fff", padding: 8, borderRadius: 8, alignSelf: "center" }}
            />
            <small>
              أو أدخل هذا المفتاح يدويًّا: <bdi dir="ltr" style={{ userSelect: "all" }}>{secret}</bdi>
            </small>
          </>
        )}
        {phase === "verify" && <p className="lead">اكتب الأرقام الستّة الظاهرة الآن في تطبيق المصادقة.</p>}
        {(phase === "verify" || qr) && (
          <>
            <input
              value={code}
              onChange={(e) => setCode(cleanCode(e.target.value))}
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              aria-label="رمز التحقّق"
              autoFocus
              style={{ letterSpacing: 4, textAlign: "center", fontSize: 20 }}
            />
            <button className="btn" type="submit" disabled={busy || !codeReady(code)}>
              {busy ? "لحظة…" : "تحقّق"}
            </button>
          </>
        )}
        {message && <div className="note bad">{message}</div>}
        <small dir="ltr">{email}</small>
        <button className="swap" type="button" onClick={other}>
          الدخول بحساب آخر
        </button>
      </form>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLogin />
    </Suspense>
  );
}
