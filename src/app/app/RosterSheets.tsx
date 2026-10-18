"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MIN_PASSWORD, changePasswordProblem, translateAuthError } from "@/lib/auth";
import { splitNewNames } from "@/lib/roster";
import { countWord } from "@/lib/outbox";
import { Klass, School } from "./types";

/**
 * تغيير كلمة السر في نافذة منبثقة، دون مغادرة الإعدادات. تُطلب الحالية ويُتحقَّق
 * منها أولًا: هاتف مفتوح تركه صاحبه على الطاولة لا يكفي لأخذ حساب فيه علامات
 * فصل كامل. (ومن نسي كلمته فطريقه شاشة الدخول ← «نسيت كلمة السر؟».)
 */
export function ChangePasswordSheet({ email, onClose }: { email: string; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    const problem = changePasswordProblem(current, next, again);
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy(true);
    setMessage("");
    const client = createClient();

    const check = await client.auth.signInWithPassword({ email, password: current });
    if (check.error) {
      const wrong = check.error.message.toLowerCase().includes("invalid login");
      setMessage(wrong ? "كلمة السر الحالية غير صحيحة." : translateAuthError(check.error.message));
      setBusy(false);
      return;
    }

    const { error } = await client.auth.updateUser({ password: next });
    setBusy(false);
    if (error) {
      setMessage(translateAuthError(error.message));
      return;
    }
    setDone(true);
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="تغيير كلمة السر">
        <div className="shead">
          <h3>{done ? "تغيّرت كلمة السر" : "تغيير كلمة السر"}</h3>
          <button className="icbtn" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {done ? (
          <>
            <p className="lead">استعملها في دخولك القادم. علاماتك كما هي.</p>
            <button className="btn full" onClick={onClose}>تمّ</button>
          </>
        ) : (
          <>
            {(
              [
                ["الحالية", current, setCurrent, "current-password"],
                ["الجديدة", next, setNext, "new-password"],
                ["أعد كتابة الجديدة", again, setAgain, "new-password"],
              ] as const
            ).map(([label, value, set, auto]) => (
              <div key={label} className="fld">
                <div className="flab">
                  <b>{label === "أعد كتابة الجديدة" ? label : `كلمة السر ${label}`}</b>
                </div>
                <input
                  className="inp"
                  type="password"
                  style={{ width: "100%" }}
                  dir="ltr"
                  value={value}
                  autoComplete={auto}
                  minLength={label === "الحالية" ? undefined : MIN_PASSWORD}
                  onChange={(e) => set(e.target.value)}
                />
              </div>
            ))}

            {message && <div className="note bad">{message}</div>}

            <button
              className="btn"
              style={{ marginTop: 14 }}
              disabled={busy || !current || !next || !again}
              onClick={() => void submit()}
            >
              {busy ? "لحظة…" : "حفظ كلمة السر"}
            </button>
          </>
        )}
      </div>
    </>
  );
}

/** إضافة مؤسسة من شاشة المؤسسات نفسها، دون المرور بالإعدادات. */
/**
 * إضافة تلميذ أو أكثر إلى قسم قائم: وافد في منتصف السنة، أو اسم سقط من
 * الاستيراد. سطر لكل تلميذ، فيُلصق عدّة أسماء مرّة واحدة كما في الاستيراد.
 * ما يشبه اسمًا في القسم يُعرض قبل الإضافة: قد يكون خطأ تكرار، وقد يكون
 * تلميذين بالاسم نفسه حقًّا، والأستاذ وحده يعرف.
 */
export function AddStudentsSheet({
  klass, existing, onClose, onAdd,
}: {
  klass: Klass;
  existing: string[];
  onClose: () => void;
  onAdd: (names: string[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [keepRepeated, setKeepRepeated] = useState(false);
  const [busy, setBusy] = useState(false);
  const { fresh, repeated } = splitNewNames(text, existing);
  const names = keepRepeated ? [...fresh, ...repeated] : fresh;

  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>إضافة إلى {klass.name}</h3>
          <button className="icbtn" onClick={onClose} disabled={busy} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="fld">
          <div className="flab">
            <b>اللقب والاسم</b>
            <small>تلميذ في كل سطر</small>
          </div>
          <textarea
            id="add-students"
            className="inp"
            style={{ width: "100%" }}
            rows={3}
            autoFocus
            value={text}
            placeholder={"اللقب الاسم"}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        {repeated.length > 0 && (
          <div className="note">
            موجود في القسم أو مكرّر: {repeated.join("، ")}
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
              <input
                type="checkbox"
                checked={keepRepeated}
                onChange={(e) => setKeepRepeated(e.target.checked)}
              />
              تلميذ آخر بالاسم نفسه، أضفه أيضًا
            </label>
          </div>
        )}

        <button
          className="btn"
          style={{ marginTop: 14 }}
          disabled={busy || names.length === 0}
          onClick={async () => {
            setBusy(true);
            await onAdd(names);
            setBusy(false);
          }}
        >
          {busy
            ? "جارٍ الإضافة…"
            : names.length > 1
              ? `أضف ${names.length} تلاميذ`
              : "أضف التلميذ"}
        </button>
      </div>
    </>
  );
}

export function NewSchoolSheet({
  onClose, onAdd,
}: {
  onClose: () => void;
  onAdd: (name: string) => Promise<School | null>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>مؤسسة جديدة</h3>
          <button className="icbtn" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="fld">
          <div className="flab">
            <b>اسم الثانوية</b>
            <small>يُطبع في رأس كشف أقسامها</small>
          </div>
          <input
            id="new-school"
            className="inp"
            style={{ width: "100%" }}
            value={name}
            autoFocus
            placeholder="مثال: ثانوية رمضان حمود"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button
          className="btn"
          style={{ marginTop: 14 }}
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            const created = await onAdd(name.trim());
            setBusy(false);
            if (created) onClose();
          }}
        >
          {busy ? "جارٍ الإضافة…" : "أضفها"}
        </button>
      </div>
    </>
  );
}

/**
 * إصلاح قسم بلا مؤسسة.
 *
 * ورقة لا تُغلق بنقرة خارجها ولا بزرّ إغلاق: المؤسسة صارت إلزامية، وقسمٌ
 * بلا واحدة يُطبع رأس كشفه ناقصًا ولا يظهر تحت أيّ بطاقة. والحالة تنشأ من
 * حسابات أُنشئت قبل المؤسسات، أو من مؤسسة حُذفت بأقسامها.
 *
 * ومن لا مؤسسة له أصلًا يكتبها هنا، فلا يُحال إلى شاشة أخرى وهو محبوس.
 */
export function SchoolFixSheet({
  orphans, schools, onAddSchool, onAssign,
}: {
  orphans: Klass[];
  schools: School[];
  onAddSchool: (name: string) => Promise<School | null>;
  onAssign: (classId: string, schoolId: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const klass = orphans[0];
  const [picked, setPicked] = useState("");
  const chosen = picked || schools[0]?.id || "";

  return (
    <>
      <div className="scrim" />
      <div className="sheet">
        <div className="shead">
          <h3>مؤسسة {klass.name}</h3>
        </div>
        <p className="lead">
          كل قسم ينتمي إلى مؤسسة: اسمها يُطبع في رأس كشفه، وبها تُجمع
          الأقسام. وهذا القسم بلا واحدة.
          {orphans.length > 1 &&
            ` وبعده ${countWord(orphans.length - 1, "قسم واحد", "قسمان", "أقسام", "قسمًا")}.`}
        </p>

        {schools.length > 0 && (
          <div className="fld">
            <div className="flab">
              <b>اخترها من مؤسساتك</b>
            </div>
            <div className="pickbar">
              <select
                id="fix-school"
                style={{ flex: 1 }}
                value={chosen}
                aria-label="المؤسسة"
                onChange={(e) => setPicked(e.target.value)}
              >
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button
                className="btn"
                disabled={busy || !chosen}
                onClick={async () => {
                  setBusy(true);
                  await onAssign(klass.id, chosen);
                  setBusy(false);
                }}
              >
                {busy ? "جارٍ الحفظ…" : "احفظ"}
              </button>
            </div>
          </div>
        )}

        <div className="fld">
          <div className="flab">
            <b>{schools.length ? "أو أضف مؤسسة جديدة" : "اكتب اسم مؤسستك"}</b>
          </div>
          <div className="pickbar addrow">
            <input
              id="fix-newschool"
              className="inp"
              value={name}
              placeholder="مثال: ثانوية رمضان حمود"
              aria-label="مؤسسة جديدة"
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className={schools.length ? "btn soft" : "btn"}
              disabled={busy || !name.trim()}
              onClick={async () => {
                setBusy(true);
                const created = await onAddSchool(name.trim());
                if (created) {
                  await onAssign(klass.id, created.id);
                  setName("");
                }
                setBusy(false);
              }}
            >
              أضفها
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
