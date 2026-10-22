"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Teacher = {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  status: "active" | "disabled" | "deletion_pending";
  banned_until: string | null;
  purge_after: string | null;
  is_admin: boolean;
  classes: number;
  students: number;
  records: number;
  last_activity: string | null;
};

type LogRow = {
  at: string;
  actor_kind: "admin" | "teacher" | "system";
  action: string;
  target_email: string | null;
};

type Phase = "checking" | "enroll" | "verify" | "ready" | "forbidden";

const ACTION: Record<string, string> = {
  list: "عرض القائمة",
  disable: "إيقاف حساب",
  enable: "إعادة تفعيل",
  cancel_deletion: "إلغاء حذف",
  request_deletion: "طلب حذف",
  purge: "حذف نهائي",
};

const ACTOR: Record<LogRow["actor_kind"], string> = {
  admin: "المشرف",
  teacher: "الأستاذ",
  system: "التشغيل الليلي",
};

function day(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ar-DZ", { day: "numeric", month: "short", year: "numeric" });
}

function qrSrc(qr: string): string {
  return qr.startsWith("data:") ? qr : `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`;
}

export default function AdminClient({ email }: { email: string }) {
  const [supabase] = useState(() => createClient());
  const [phase, setPhase] = useState<Phase>("checking");
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [confirm, setConfirm] = useState<{ id: string; action: "disable" | "enable" | "cancel" } | null>(null);

  const load = useCallback(async () => {
    const list = await supabase.rpc("admin_list_teachers");
    if (list.error) {
      if (list.error.code === "42501") setPhase("forbidden");
      else setMessage("تعذّر تحميل القائمة. أعد فتح الصفحة.");
      return;
    }
    setTeachers((list.data ?? []) as Teacher[]);
    const recent = await supabase.rpc("admin_log_recent", { max_rows: 30 });
    setLog(recent.error ? [] : ((recent.data ?? []) as LogRow[]));
    setPhase("ready");
  }, [supabase]);

  // ما يلزم قبل أي طلب: جلسة aal2. بلا عامل مسجَّل ⇒ ربط تطبيق المصادقة؛
  // بعامل مسجَّل ⇒ طلب الرمز.
  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error || !data) {
        setMessage("تعذّر التحقّق من الجلسة. أعد فتح الصفحة.");
        return;
      }
      if (data.currentLevel === "aal2") return void load();
      if (data.nextLevel === "aal2") {
        const factors = await supabase.auth.mfa.listFactors();
        const verified = factors.data?.totp.find((f) => f.status === "verified");
        if (verified) {
          setFactorId(verified.id);
          setPhase("verify");
          return;
        }
      }
      setPhase("enroll");
    })();
  }, [supabase, load]);

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
    if (!/^\d{6}$/.test(code)) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setCode("");
    setBusy(false);
    if (error) {
      setMessage("الرمز غير صحيح أو انتهى وقته. أدخل الرمز الظاهر الآن في التطبيق.");
      return;
    }
    setQr("");
    setSecret("");
    await load();
  }

  async function act(id: string, action: "disable" | "enable" | "cancel") {
    setBusy(true);
    setMessage("");
    const { error } =
      action === "cancel"
        ? await supabase.rpc("admin_cancel_deletion", { target: id })
        : await supabase.rpc("admin_set_disabled", { target: id, disabled: action === "disable" });
    setBusy(false);
    setConfirm(null);
    if (error) {
      setMessage(error.code === "42501" ? "انتهت جلسة التحقّق الثنائي أو لا صلاحية. أعد فتح الصفحة." : "تعذّرت العملية.");
      return;
    }
    await load();
  }

  if (phase === "checking") {
    return (
      <div className="auth gut">
        <div className="authbox">
          <p className="lead">لحظة…</p>
          {message && <div className="note bad">{message}</div>}
        </div>
      </div>
    );
  }

  if (phase === "forbidden") {
    return (
      <div className="auth gut">
        <div className="authbox">
          <h1>لا صلاحية</h1>
          <p className="lead">هذا الحساب ليس حساب المشرف.</p>
          <a className="btn ghost" href="/app">
            رجوع إلى التطبيق
          </a>
        </div>
      </div>
    );
  }

  if (phase === "enroll" || phase === "verify") {
    return (
      <div className="auth gut">
        <form className="authbox" onSubmit={verify}>
          <h1>التحقّق الثنائي</h1>
          {phase === "enroll" && !qr && (
            <>
              <p className="lead">
                صفحة الإشراف تتطلّب رمزًا من تطبيق مصادقة (Google Authenticator أو غيره) في
                كل دخول إليها. هذه الخطوة لحساب المشرف فقط.
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
              <img src={qrSrc(qr)} alt="رمز QR لتطبيق المصادقة" width={200} height={200} style={{ background: "#fff", padding: 8, borderRadius: 8 }} />
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
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                aria-label="رمز التحقّق"
              />
              <button className="btn" type="submit" disabled={busy || code.length !== 6}>
                {busy ? "لحظة…" : "تحقّق"}
              </button>
            </>
          )}
          {message && <div className="note bad">{message}</div>}
          <small dir="ltr">{email}</small>
        </form>
      </div>
    );
  }

  return (
    <div className="gut" style={{ maxWidth: 760, margin: "0 auto", paddingBlock: 24 }}>
      <h1>الإشراف</h1>
      <p className="lead">
        الحسابات وحالتها وأعداد بياناتها. لا تظهر هنا أسماء التلاميذ ولا العلامات، وكل
        عملية تُسجَّل.
      </p>
      {message && <div className="note bad">{message}</div>}

      <div className="note" style={{ marginBlock: 12 }}>
        تغيير كلمة المرور يطلبه الأستاذ بنفسه من «نسيت كلمة السر» في صفحة الدخول على
        جهازه. رابط الاستعادة في هذا التطبيق يعمل في المتصفّح الذي طلبه فقط، فلا يُرسله
        المشرف.
      </div>

      <div className="plist">
        {teachers.map((t) => (
          <div key={t.id} className={t.status === "active" ? "prow" : "prow bad"}>
            <div className="k">
              <b>{t.full_name || "بلا اسم"}</b>
              <small>
                <bdi dir="ltr">{t.email}</bdi>
                {t.is_admin ? " · مشرف" : ""}
              </small>
              <small>
                {t.classes} أقسام · {t.students} تلاميذ · {t.records} سجلات · آخر نشاط {day(t.last_activity)} · آخر دخول{" "}
                {day(t.last_sign_in_at)}
              </small>
              {t.status === "disabled" && <small className="perr">موقوف</small>}
              {t.status === "deletion_pending" && <small className="perr">يُحذف يوم {day(t.purge_after)}</small>}
            </div>
            {!t.is_admin && (
              <div className="pacts">
                {confirm?.id === t.id ? (
                  <>
                    <button className="clearb danger" disabled={busy} onClick={() => act(t.id, confirm.action)}>
                      تأكيد
                    </button>
                    <button className="clearb" onClick={() => setConfirm(null)}>
                      تراجع
                    </button>
                  </>
                ) : t.status === "disabled" ? (
                  <button className="clearb" onClick={() => setConfirm({ id: t.id, action: "enable" })}>
                    أعد التفعيل
                  </button>
                ) : t.status === "deletion_pending" ? (
                  <button className="clearb" onClick={() => setConfirm({ id: t.id, action: "cancel" })}>
                    ألغِ الحذف
                  </button>
                ) : (
                  <button className="clearb danger" onClick={() => setConfirm({ id: t.id, action: "disable" })}>
                    أوقف
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 24 }}>آخر العمليات</h2>
      <div className="plist">
        {log.map((l, i) => (
          <div key={i} className="prow">
            <div className="k">
              <b>{ACTION[l.action] ?? l.action}</b>
              <small>
                {ACTOR[l.actor_kind]} · {day(l.at)}
                {l.target_email ? " · " : ""}
                {l.target_email && <bdi dir="ltr">{l.target_email}</bdi>}
              </small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
