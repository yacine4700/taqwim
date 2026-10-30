"use client";

import { useEffect, useState } from "react";
import {
  bump,
  componentValues,
  continuousMark,
  fmt,
  grade,
  readingAverage,
  shownValue,
  stepFor,
  targetCriterionCode,
  termAverage,
  TP_COMPONENT,
  type Component,
  type Criterion,
  type MarkField,
  type Reading,
  readingsFor,
  type RecordRow,
  type TpTarget,
} from "@/lib/scoring";
import { STATE_TAGS, Student } from "./types";
import { Stat, state } from "./parts";

/**
 * عدّاد معيار واحد: ناقص وزائد ورقم بينهما يقول أين وصلت علامة التلميذ.
 *
 * الفرق بين «صفر» و«لم يُقيَّم» محفوظ لأن الحساب كله يقوم عليه:
 * - معيار الخصم يبدأ من العلامة الكاملة ويُحسب دائمًا، فالعدّاد يبدأ ممتلئًا.
 * - معيار الإضافة يبدأ غير مقيَّم فيظهر «—» ويخرج من القسمة؛ أول ضغطة على
 *   زائد تجعله مقيَّمًا. و«مسح» يعيده إلى غير مقيَّم، لا إلى صفر.
 */
function CriterionCounter({
  criterion, record, onChange,
}: {
  criterion: Criterion;
  record: RecordRow | undefined;
  onChange: (value: number | null) => void;
}) {
  const ceiling = Number(criterion.ceiling);
  const step = stepFor(criterion);
  const isDeduct = criterion.kind === "deduct";

  const stored = record?.criteria?.[criterion.code];
  const value = typeof stored === "number" ? stored : null;
  const assessed = value !== null;
  const shown = shownValue(criterion, value);

  // عند الصفر لا ينزل أكثر: «مسح» هو طريق الرجوع إلى «لم يُقيَّم».
  const atFloor = isDeduct ? shown === 0 : !assessed || shown === 0;
  const atRoof = (shown ?? 0) >= ceiling && (isDeduct || assessed);

  return (
    // التسمية والعدّاد في سطر واحد: خمسة معايير في ملء الشاشة بدل ثلاثة
    <div className="fld line">
      <div className="flab">
        <b>{criterion.label}</b>
        {!isDeduct && !assessed && <small>لم يُقيَّم</small>}
      </div>
      <div className="counter">
        <button
          className="cbtn"
          onClick={() => onChange(bump(criterion, value, -step))}
          disabled={atFloor}
          aria-label={`أنقص ${step}`}
        >
          −
        </button>
        <span className="cval">
          <b className="num">{shown === null ? "—" : fmt(shown, shown % 1 ? 1 : 0)}</b>
          <i className="num">/ {ceiling}</i>
        </span>
        <button
          className="cbtn"
          onClick={() => onChange(bump(criterion, value, step))}
          disabled={atRoof}
          aria-label={`أضف ${step}`}
        >
          +
        </button>
        {/* خانة «مسح» محجوزة دائمًا: ظهورها واختفاؤها كان يزحزح الأزرار تحت الإصبع */}
        <span className="clearslot">
          {assessed && (
            <button className="clearb" onClick={() => onChange(null)} aria-label={`امسح ${criterion.label}`}>
              مسح
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

export const MARK_HINT = "العلامة بين 0 و20";

/**
 * ما كُتب في خانة علامة من 20. ثلاث حالات لا اثنتان: الفراغ الحقيقي يمسح،
 * أما نصّ لم يفهمه المتصفّح («14,» مثلًا) فيصل فراغًا في value مع badInput،
 * ومعاملته مسحًا تمحو علامة محفوظة بخطأ في الإصبع.
 */
export function readMark(
  input: HTMLInputElement,
): { kind: "empty" } | { kind: "bad" } | { kind: "ok"; value: number } {
  const text = input.value.trim();
  if (text === "") return input.validity.badInput ? { kind: "bad" } : { kind: "empty" };
  const value = Number(text);
  if (Number.isNaN(value) || value < 0 || value > 20) return { kind: "bad" };
  return { kind: "ok", value };
}

export function StudentSheet({
  student, term, readOnly, criteria, record, readings: allReadings, components, tp,
  onClose, onCriterion, onMark, onRemoveReading, onEdit, onDelete,
  position, count, onStep,
}: {
  student: Student;
  /** الفصل الذي تُكتب فيه العلامات، ظاهر في رأس البطاقة فلا يُنقَّط في فصل خطأً. */
  term: number;
  /** الفصل مقفل: العلامات تُعرض ولا تُعدَّل. الاسم والحالة الخاصة ليسا من الفصل فيبقيان. */
  readOnly: boolean;
  criteria: Criterion[];
  /** السجل للعرض: معدّل الحصص فيه محلّ الخانة المربوطة. لا يُكتب منه شيء. */
  record: RecordRow | undefined;
  readings: Reading[];
  components: Component[];
  /** وجهة معدّل الحصص ومعدّل هذا التلميذ، فتُقفل الخانة التي يُحسب فيها. */
  tp: { target: TpTarget; average: number | null };
  onClose: () => void;
  onCriterion: (code: string, value: number | null) => void;
  onMark: (field: MarkField, value: number | null) => void;
  onRemoveReading: (id: string) => void;
  onEdit: (patch: Partial<Student>) => void;
  onDelete: () => void;
  /** موضعه في القسم وعدد تلاميذه، للتنقّل دون إغلاق البطاقة. */
  position: number;
  count: number;
  onStep: (step: number) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [showState, setShowState] = useState(false);
  /** محاولة القراءة المهيَّأة للحذف: النقرة الأولى تهيّئ، والثانية تحذف. */
  const [armed, setArmed] = useState<string | null>(null);
  /** الخانة التي رُفضت قيمتها، ولأيّ تلميذ: لا تنتقل رسالتها إلى التالي. */
  const [markError, setMarkError] = useState<{ id: string; field: MarkField } | null>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  const tags = student.tags ?? [];
  const cc = continuousMark(criteria, record, allReadings);
  const average = termAverage(components, componentValues(criteria, record, allReadings));
  const ccLabel = components.find((c) => c.code === "cc")?.label ?? "التقويم المستمر";
  // لا تُعرض إلا المركّبات المفعّلة: المطفأة خارجة من المعدل، فعرض خانة لها
  // يعني أن يُنقّط الأستاذ نقطة لا تُحسب.
  const marks = components.filter((c) => c.code !== "cc" && c.active);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>
            {student.full_name}
            <small className="termtag">الفصل {term}</small>
          </h3>
          {/* تنقّل داخل القسم: تنقيط عشرة تلاميذ كان عشر فتحات وإغلاقات */}
          {count > 1 && (
            <div className="stepper" role="group" aria-label="تلميذ آخر">
              <button
                onClick={() => onStep(-1)}
                disabled={position <= 1}
                aria-label="التلميذ السابق"
              >
                ›
              </button>
              <span className="num">{position}/{count}</span>
              <button
                onClick={() => onStep(1)}
                disabled={position >= count}
                aria-label="التلميذ التالي"
              >
                ‹
              </button>
            </div>
          )}
          <button
            className={edit ? "icbtn on" : "icbtn"}
            aria-pressed={edit}
            onClick={() => setEdit(!edit)}
            aria-label="تعديل بيانات التلميذ"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4" />
            </svg>
          </button>
          <button className="icbtn" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* النقطة أولًا: هي ما فُتحت البطاقة لأجله، فلا تُطلب بتمرير الشاشة */}
        <div className="totals top">
          <Stat value={fmt(cc)} label={ccLabel} />
          <Stat value={fmt(average)} label="معدل المادة" />
          <Stat value={grade(average) || "—"} label="التقدير" />
        </div>

        {edit ? (
          <div className="fld">
            <label className="elab" htmlFor={`name-${student.id}`}>الاسم واللقب</label>
            <input
              key={`${student.id}-${student.full_name}`}
              className="cname"
              id={`name-${student.id}`}
              defaultValue={student.full_name}
              onBlur={(e) => {
                const text = e.target.value.trim();
                if (text && text !== student.full_name) onEdit({ full_name: text });
                else e.target.value = student.full_name;
              }}
            />
            <button className="btn warn full" onClick={onDelete}>حذف التلميذ من القسم</button>
          </div>
        ) : null}

        {/* fieldset معطَّل يعطّل كل عدّاد وخانة وحذف محاولة داخله دفعة واحدة */}
        <fieldset className="rofield" disabled={readOnly}>
        {criteria.map((c) => {
          if (c.kind === "auto") {
            // محاولات هذا المعيار وحده: لكل معيار من نوعه سجلّه ومتوسطه.
            const readings = readingsFor(allReadings, c.code);
            const avg = readingAverage(readings);
            return (
              <div key={c.id} className="fld">
                <div className="flab">
                  <b>{c.label}</b>
                  <small>{readings.length} محاولة</small>
                  <i>{avg === null ? "—" : `${fmt(avg)} / ${c.ceiling}`}</i>
                </div>
                <div className="readlog">
                  {readings.length === 0 ? (
                    <span style={{ fontSize: 11, color: "var(--faint)" }}>لا محاولات بعد</span>
                  ) : (
                    readings.map((r) => (
                      <button
                        key={r.id}
                        className={armed === r.id ? "danger" : undefined}
                        title="انقر مرتين للحذف"
                        onClick={() => {
                          if (armed !== r.id) {
                            setArmed(r.id);
                            return;
                          }
                          setArmed(null);
                          onRemoveReading(r.id);
                        }}
                      >
                        {armed === r.id ? "احذف؟ ✕" : `${r.score} · ${r.read_on.slice(5)}`}
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          }
          if (tp.average !== null && targetCriterionCode(tp.target) === c.code) {
            return (
              <div key={c.id} className="fld line">
                <div className="flab">
                  <b>{c.label}</b>
                  <small>من حصص الأعمال التطبيقية</small>
                </div>
                <span className="rowlock num">
                  {fmt(record?.criteria?.[c.code] ?? null)} / {c.ceiling}
                </span>
              </div>
            );
          }
          return (
            <CriterionCounter
              key={c.id}
              criterion={c}
              record={record}
              onChange={(value) => onCriterion(c.code, value)}
            />
          );
        })}

        {marks.map((component) => {
          const field = component.code as MarkField;
          if (field === "tp" && tp.average !== null && tp.target === TP_COMPONENT) {
            return (
              <div key={component.id} className="fld line">
                <div className="flab">
                  <b>{component.label}</b>
                  <small>معدّل حصصه · معامل {Number(component.weight)}</small>
                </div>
                <span className="rowlock num">{fmt(tp.average)} / 20</span>
              </div>
            );
          }
          const current = record?.[field] ?? null;
          const refused = markError?.id === student.id && markError.field === field;
          return (
            <div key={component.id} className="fld line">
              <div className="flab">
                <b>{component.label}</b>
                <small>معامل {Number(component.weight)}</small>
                {refused && <small className="ferr">{MARK_HINT}</small>}
              </div>
              <div className="mk">
                {/* المفتاح يضمّ التلميذ والقيمة: الخانة غير متحكَّم بها، فبلا هذا
                    تبقى علامة التلميذ السابق ظاهرة بعد «التالي» وتُكتب للتالي
                    إن لُمست الخانة. */}
                <input
                  key={`${student.id}-${field}-${current ?? ""}`}
                  id={`mark-${field}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={20}
                  step={0.25}
                  defaultValue={current ?? ""}
                  aria-invalid={refused}
                  onChange={() => setMarkError(null)}
                  onBlur={(e) => {
                    const read = readMark(e.target);
                    if (read.kind === "bad") {
                      e.target.value = String(current ?? "");
                      setMarkError({ id: student.id, field });
                      return;
                    }
                    setMarkError(null);
                    if (read.kind === "empty") {
                      if (current !== null) onMark(field, null);
                      return;
                    }
                    if (read.value !== current) onMark(field, read.value);
                  }}
                />
              </div>
            </div>
          );
        })}
        </fieldset>

        {/* الحالة الخاصة في الأسفل مطويّة: تُكتب مرة في الفصل، والعلامة كل حصة.
            وكانت تأكل رُبع الشاشة في رأس البطاقة قبل أن يُرى أول معيار. */}
        <button
          className={showState ? "staterow on" : "staterow"}
          aria-expanded={showState}
          onClick={() => setShowState(!showState)}
        >
          <b>حالة خاصة</b>
          <small>{state(student) || "لا شيء"}</small>
          <i aria-hidden>{showState ? "⌃" : "⌄"}</i>
        </button>

        {showState && (
          <div className="fld">
            <label className="elab" htmlFor={`note-${student.id}`}>
              لك وحدك، لتتذكّرها. لا تدخل أي حساب ولا تظهر في المعدلات ولا في الكشف.
            </label>
            <div className="chips tagrow">
              {STATE_TAGS.map((tag) => {
                const on = tags.includes(tag);
                return (
                  <button
                    key={tag}
                    aria-pressed={on}
                    onClick={() =>
                      onEdit({
                        tags: on ? tags.filter((t) => t !== tag) : [...tags, tag],
                      })
                    }
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <textarea
              key={`${student.id}-${student.note ?? ""}`}
              className="inp note-in"
              id={`note-${student.id}`}
              rows={2}
              placeholder="أو اكتب ما لا تغطّيه الحالات أعلاه"
              defaultValue={student.note ?? ""}
              onBlur={(e) => {
                const text = e.target.value.trim();
                const next = text === "" ? null : text;
                if (next !== (student.note ?? null)) onEdit({ note: next });
              }}
            />
          </div>
        )}
      </div>
    </>
  );
}
