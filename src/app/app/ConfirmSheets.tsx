"use client";

import { useState } from "react";
import { type Criterion } from "@/lib/scoring";
import { Klass, Student } from "./types";

export function ConfirmStudentSheet({
  student, marks, reads, onCancel, onConfirm,
}: {
  student: Student;
  marks: number;
  reads: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const has = marks > 0 || reads > 0;
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="sheet">
        <div className="shead">
          <h3>حذف {student.full_name}</h3>
        </div>
        <p className="lead">
          {has
            ? `معه ${marks} سجل علامات و${reads} محاولة قراءة، وتُحذف معه في الفصول الثلاثة. لا رجعة في هذا.`
            : "ليست معه علامات مسجَّلة. يُحذف من القسم في الفصول الثلاثة."}
        </p>
        <div className="srow2">
          <button className="btn ghost" onClick={onCancel}>تراجع</button>
          <div className="hspace" />
          <button className="btn danger" onClick={onConfirm}>احذف التلميذ</button>
        </div>
      </div>
    </>
  );
}

const KIND_LABEL: Record<Criterion["kind"], string> = {
  deduct: "يبدأ كاملًا ويُخصم منه",
  add: "يبدأ من 0 ويُضاف إليه",
  auto: "من محاولات القراءة",
};

/**
 * تغيير نوع المعيار أو سقفه بعد أن سُجّلت علامات فيه. الأرقام المخزَّنة لا
 * تُمسّ، لكن معناها يتغيّر: 3 في معيار إضافة هي «ثلاث نقاط»، وفي معيار خصم
 * هي «خُصمت ثلاث». فيُقال هذا قبل التطبيق لا بعده.
 */
export function ConfirmCriterionChangeSheet({
  criterion, patch, marked, onCancel, onConfirm,
}: {
  criterion: Criterion;
  patch: Partial<Criterion>;
  marked: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const kindChanged = patch.kind !== undefined && patch.kind !== criterion.kind;
  const ceilingChanged =
    patch.ceiling !== undefined && Number(patch.ceiling) !== Number(criterion.ceiling);
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="sheet">
        <div className="shead">
          <h3>تغيير معيار {criterion.label}</h3>
        </div>
        <p className="lead">
          {kindChanged && patch.kind
            ? `النوع: «${KIND_LABEL[criterion.kind]}» ← «${KIND_LABEL[patch.kind]}». `
            : ""}
          {ceilingChanged ? `السقف: ${Number(criterion.ceiling)} ← ${Number(patch.ceiling)}. ` : ""}
          في هذا المعيار {marked} علامة مسجَّلة في كل الأقسام والفصول. تبقى
          أرقامها كما هي، لكن معناها يتغيّر فيتغيّر التقويم المستمر لأصحابها.
        </p>
        <div className="srow2">
          <button className="btn ghost" onClick={onCancel}>تراجع</button>
          <div className="hspace" />
          <button className="btn danger" onClick={onConfirm}>غيّر المعيار</button>
        </div>
      </div>
    </>
  );
}

export function ConfirmCriterionSheet({
  criterion, onCancel, onConfirm,
}: {
  criterion: Criterion;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="sheet">
        <div className="shead">
          <h3>حذف معيار {criterion.label}</h3>
        </div>
        <p className="lead">
          سيخرج من التقويم المستمر في كل الأقسام والفصول، وتُستبعد العلامات
          المسجَّلة فيه من الحساب. بقية المعايير تبقى كما هي.
        </p>
        <div className="srow2">
          <button className="btn ghost" onClick={onCancel}>تراجع</button>
          <div className="hspace" />
          <button className="btn danger" onClick={onConfirm}>احذف المعيار</button>
        </div>
      </div>
    </>
  );
}


export function ConfirmSignOutSheet({
  label, onCancel, onShow, onConfirm,
}: {
  label: string;
  onCancel: () => void;
  onShow: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="sheet">
        <div className="shead">
          <h3>الخروج قبل الإرسال</h3>
        </div>
        <p className="lead">
          {label} بعد. الخروج يمسح بيانات هذا الجهاز، فتضيع. انتظر عودة الشبكة
          ثم اخرج.
        </p>
        <div className="srow2">
          <button className="btn ghost" onClick={onCancel}>تراجع</button>
          <div className="hspace" />
          <button className="btn soft" onClick={onShow}>أرني</button>
          <button className="btn danger" onClick={onConfirm}>اخرج وامسح</button>
        </div>
      </div>
    </>
  );
}


export function ConfirmSheet({
  klass, count, onCancel, onConfirm,
}: {
  klass: Klass;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="sheet">
        <div className="shead">
          <h3>حذف {klass.name}</h3>
        </div>
        <div className="note warn" style={{ marginBlock: 14 }}>
          سيُحذف القسم و{count} تلميذًا وكل علاماتهم ومحاولاتهم في الفصول الثلاثة. لا رجوع عن هذا.
        </div>
        <div className="pickbar">
          <button className="btn ghost" onClick={onCancel}>إلغاء</button>
          <button
            className="btn warn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onConfirm();
            }}
          >
            {busy ? "جارٍ الحذف…" : "نعم، احذف"}
          </button>
        </div>
      </div>
    </>
  );
}

