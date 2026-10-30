"use client";

import { useState } from "react";
import { optionsFor, type Criterion } from "@/lib/scoring";
import {
  draftEntries,
  pickDraft,
  setDraftScore,
  swapInDraft,
  type ReadingDraft,
} from "@/lib/readingDraft";
import { Student } from "./types";

/**
 * رأس وضع القراءة داخل القسم: العدد و«اختر»، ثم بطاقات المختارين بسلّم
 * النقاط، ثم «حفظ». كان هذا تبويب «الحصة» بقسمه الخاص؛ صار القسم المفتوح هو
 * قسم الحصة، فلا اختيار مؤسسة ولا قسم.
 */
export function ReadingPanel({
  students, attemptsOf, reading, count, onCount, draft, onDraft, onSave,
}: {
  students: Student[];
  attemptsOf: (id: string) => number;
  /** معيار السحب الذي تُسجَّل له المحاولات، إن بقي في معايير الأستاذ. */
  reading: Criterion | undefined;
  count: number;
  onCount: (n: number) => void;
  /** المسودّة تعيش في AppClient لكل قسم، فتنجو من تبديل العمود والخروج من القسم. */
  draft: ReadingDraft<Student>;
  onDraft: (next: ReadingDraft<Student>) => void;
  onSave: (entries: Array<{ studentId: string; score: number }>) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  const chosen = draftEntries(draft).length;
  // سلّم التنقيط من سقف معيار القراءة نفسه، فلو رفعه الأستاذ إلى 6 ظهرت 6.
  const scale = reading ? optionsFor({ ...reading, kind: "add" }) : [0, 1, 2, 3, 4];

  return (
    <>
      {!reading && (
        <div className="note warn">
          لا معيار «بالسحب في الحصة» في إعداداتك، فالمحاولات تُسجَّل ولا تدخل
          التقويم المستمر. أضف معيارًا من الإعدادات واختر له «بالسحب في الحصة».
        </div>
      )}

      <div className="pickbar readbar">
        <select
          id="reading-count"
          aria-label="عدد القرّاء"
          value={count}
          onChange={(e) => onCount(Number(e.target.value))}
        >
          {[3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        {/* إعادة الاختيار تمحو القائمة: لا تُعرض وفيها نقطة لم تُحفظ، فلا
            تضيع قراءة استُمع إليها بلمسة. «بدّله» يبقى لكل اسم. */}
        <button
          className={draft.picked.length ? "btn soft" : "btn"}
          disabled={chosen > 0}
          title={chosen > 0 ? "احفظ النقاط أولًا" : undefined}
          onClick={() => onDraft(pickDraft(students, attemptsOf, count))}
        >
          {draft.picked.length ? `أعِد اختيار ${count}` : `اختر ${count}`}
        </button>
        <small className="chint">الأقل محاولات أولًا، والعشوائية بين المتساوين. والمتطوّع بـ«+» أمام اسمه.</small>
      </div>

      {draft.picked.map((student) => (
        <div key={student.id} className="card pcard">
          <div className="pn">
            <b>{student.full_name}</b>
            <span className="pill">
              {attemptsOf(student.id) ? `${attemptsOf(student.id)} محاولات` : "أول محاولة"}
            </span>
            {/* الاسم يخرج والقائمة لا تُعاد: الغائب لا يُنقص الحصة واحدًا */}
            <button
              className="clearb"
              onClick={() => onDraft(swapInDraft(draft, student.id, students, attemptsOf))}
            >
              بدّله
            </button>
          </div>
          <div className="scorerow">
            {scale.map((n) => (
              <button
                key={n}
                aria-pressed={draft.scores[student.id] === n}
                onClick={() => onDraft(setDraftScore(draft, student.id, n))}
              >
                {n}
              </button>
            ))}
            <button
              className="skip"
              aria-pressed={draft.scores[student.id] === "skip"}
              onClick={() => onDraft(setDraftScore(draft, student.id, "skip"))}
            >
              غائب
            </button>
          </div>
        </div>
      ))}

      {draft.picked.length > 0 && (
        <button
          className="btn"
          disabled={!chosen || saving}
          onClick={async () => {
            setSaving(true);
            const ok = await onSave(draftEntries(draft));
            setSaving(false);
            if (ok) onDraft({ picked: [], scores: {} });
          }}
        >
          {saving ? "جارٍ الحفظ…" : `حفظ ${chosen} محاولة`}
        </button>
      )}
    </>
  );
}
