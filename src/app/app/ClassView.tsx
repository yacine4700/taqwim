"use client";

import { useRef, useState } from "react";
import { liveDraft, READING_COLUMN, toggleVolunteer, type ReadingDraft } from "@/lib/readingDraft";
import { nameMatches } from "@/lib/names";
import {
  bump,
  classStats,
  fmt,
  grade,
  shownValue,
  stepFor,
  targetCriterionCode,
  TP_COMPONENT,
  type Component,
  type Criterion,
  type MarkField,
  type RecordRow,
  type TpTarget,
} from "@/lib/scoring";
import { Klass, Student } from "./types";
import { state } from "./parts";
import { MARK_HINT, readMark } from "./StudentSheet";
import { ReadingPanel } from "./ReadingPanel";

export function ClassView({
  klass, students, term, criteria, components, recordOf,
  averageOf, readingCount, stats, tp, onGroups,
  onBack, onPick, onDelete, onAddStudents, onCriterion, onMark,
  column, onColumn, reading, readCount, onReadCount, draft, onDraft, onSaveReadings,
}: {
  klass: Klass;
  students: Student[];
  term: number;
  criteria: Criterion[];
  components: Component[];
  recordOf: (id: string) => RecordRow | undefined;
  averageOf: (id: string) => number | null;
  readingCount: (id: string) => number;
  stats: ReturnType<typeof classStats>;
  /** وجهة معدّل حصص الأعمال التطبيقية ومعدّل كل تلميذ، لقفل الخانة التي تُحسب منها. */
  tp: { target: TpTarget; averageOf: (id: string) => number | null };
  /** غائب إن لم تُهيَّأ جداول الأفواج بعد. */
  onGroups?: () => void;
  onBack: () => void;
  onPick: (s: Student) => void;
  onDelete: () => void;
  onAddStudents: () => void;
  onCriterion: (studentId: string, code: string, value: number | null) => void;
  onMark: (studentId: string, field: MarkField, value: number | null) => void;
  /**
   * العمود المفتوح: `r:` القراءة، `c:` معيار، `m:` مركّبة. فارغ = جدول المعدلات.
   * يعيش في AppClient لكل قسم: من خرج إلى تبويب آخر ورجع يجد عموده.
   */
  column: string | null;
  onColumn: (column: string | null) => void;
  /** معيار القراءة المحسوب تلقائيًا، إن أبقاه الأستاذ في معاييره. */
  reading: Criterion | undefined;
  readCount: number;
  onReadCount: (n: number) => void;
  /** قائمة القراءة غير المحفوظة لهذا القسم. */
  draft: ReadingDraft<Student>;
  onDraft: (next: ReadingDraft<Student>) => void;
  onSaveReadings: (entries: Array<{ studentId: string; score: number }>) => Promise<boolean>;
}) {
  const setColumn = onColumn;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "todo" | "low">("all");
  /** «حذف القسم» مطويّ: كان بجوار «+ تلميذ» بالحجم نفسه في أسفل كل قسم. */
  const [more, setMore] = useState(false);

  const ranked = students
    .map((s) => ({ student: s, average: averageOf(s.id) }))
    .filter((r) => r.average !== null)
    .sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
  const rank = new Map(ranked.map((r, i) => [r.student.id, i + 1]));

  /*
   * القراءة أول الرقاقات: هي ما يُستعمل أمام القسم أكثر من غيره، والأستاذ
   * يتنقّل في الحصة بينها وبين أعمدة التقويم المستمر. ومعيار القراءة نفسه لا
   * يُنقَّط بيد: نقطته من المحاولات، فلا عمود له بين المعايير.
   */
  const columns = [
    { key: READING_COLUMN, label: "قراءة" },
    ...criteria.filter((c) => c.kind !== "auto").map((c) => ({ key: `c:${c.code}`, label: c.label })),
    ...components
      .filter((c) => c.code !== "cc" && c.active)
      .map((c) => ({ key: `m:${c.code}`, label: c.label })),
  ];
  const open = columns.find((c) => c.key === column) ?? null;
  const isReading = open?.key === READING_COLUMN;
  const live = liveDraft(draft, students);
  const inDraft = new Set(live.picked.map((p) => p.id));
  const openCriterion = open?.key.startsWith("c:")
    ? criteria.find((c) => `c:${c.code}` === open.key) ?? null
    : null;
  const openMark = open?.key.startsWith("m:")
    ? (open.key.slice(2) as MarkField)
    : null;
  /** العمود الذي تُحسب نقطته من حصص الأعمال التطبيقية: من نُقِّط فيها لا تُدخَل له علامة بيد. */
  const columnLocked =
    (openCriterion !== null && targetCriterionCode(tp.target) === openCriterion.code) ||
    (openMark === "tp" && tp.target === TP_COMPONENT);

  /**
   * «أين وقفت؟» هو سؤال كل حصة. والجواب يختلف بالسياق: في وضع العمود هو من
   * لم يُدخَل له شيء في هذا العمود، وفي الجدول العادي من لا علامة له أصلًا.
   */
  const waiting = (student: Student) => {
    if (isReading) return readingCount(student.id) === 0;
    const record = recordOf(student.id);
    if (openCriterion) return typeof record?.criteria?.[openCriterion.code] !== "number";
    if (openMark) return record?.[openMark] === null || record?.[openMark] === undefined;
    return averageOf(student.id) === null;
  };

  const todo = students.filter(waiting).length;
  const filled = students.length - todo;
  const low = students.filter((s) => {
    const average = averageOf(s.id);
    return average !== null && average < 10;
  }).length;

  // الترتيب والرتبة يُحسبان على القسم كله، فالتصفية تُخفي سطورًا ولا تغيّر رتبة.
  const rows = students
    .filter((s) => nameMatches(s.full_name, query))
    .filter((s) => (filter === "todo" ? waiting(s) : true))
    .filter((s) => {
      if (filter !== "low") return true;
      const average = averageOf(s.id);
      return average !== null && average < 10;
    })
    .map((s) => ({ student: s, average: averageOf(s.id) }));

  return (
    <section className="view">
      <div className="vhead">
        <button className="icbtn" onClick={onBack} aria-label="رجوع">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <div>
          <h2>{klass.name}</h2>
          <p>
            {isReading
              ? `الفصل ${term} · قراءة`
              : open
              ? `الفصل ${term} · تنقّط عمود ${open.label}`
              : `الفصل ${term} · معدل القسم ${fmt(stats.mean)}`}
          </p>
        </div>
        {onGroups && (
          <>
            <div className="hspace" />
            <button
              className="btn soft sm"
              onClick={onGroups}
              aria-label="الأفواج والأعمال التطبيقية"
            >
              الأفواج
            </button>
          </>
        )}
      </div>

      {open && openCriterion && !columnLocked && (
        <small className="chint">اضغط مطوّلًا على الرقم لتمسحه فيعود «لم يُقيَّم».</small>
      )}

      {open && columnLocked && (
        <div className="note">
          هذا العمود يُحسب من حصص الأعمال التطبيقية لمن نُقِّط فيها. ومن لم يُنقَّط
          فيها تُدخل له علامته هنا.
        </div>
      )}

      {/* الواجب يُصحَّح للقسم كله مرة واحدة، لا تلميذًا تلميذًا: يُختار العمود
          مرة ثم يُنزَل على الأسماء بعدّاد لكل سطر. */}
      {students.length > 0 && (
        <div className="colbar">
          <span className="collab">عرض:</span>
          <div className="chips">
            {/* العودة إلى الحالة العامة بزرّ ظاهر: إعادة النقر على العمود المختار
                تُلغيه، لكن أحدًا لا يخمّن ذلك. */}
            <button
              aria-pressed={column === null}
              onClick={() => {
                setColumn(null);
                setFilter("all");
              }}
            >
              الكل
            </button>
            {columns.map((c) => (
              <button
                key={c.key}
                aria-pressed={column === c.key}
                onClick={() => {
                  setColumn(column === c.key ? null : c.key);
                  setFilter("all");
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isReading && students.length > 0 && (
        <ReadingPanel
          students={students}
          attemptsOf={readingCount}
          reading={reading}
          count={readCount}
          onCount={onReadCount}
          draft={live}
          onDraft={onDraft}
          onSave={onSaveReadings}
        />
      )}

      {/* عدّاد التقدّم وتصفيته في زرّ واحد: الرقم يقول أين وقفت، والضغط
          يُظهر الباقين وحدهم فلا يُبحث عنهم بالنظر في ستّة وثلاثين سطرًا. */}
      {students.length > 0 && (
        <div className="filterbar">
          <div className="chips">
            <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              الكل
            </button>
            <button
              aria-pressed={filter === "todo"}
              onClick={() => setFilter(filter === "todo" ? "all" : "todo")}
              disabled={todo === 0}
            >
              {isReading ? "لم يقرأ بعد" : open ? "بلا إدخال" : "بلا علامة"} {todo}
            </button>
            {!open && (
              <button
                aria-pressed={filter === "low"}
                onClick={() => setFilter(filter === "low" ? "all" : "low")}
                disabled={low === 0}
              >
                تحت 10 · {low}
              </button>
            )}
          </div>
          <div className="hspace" />
          <span
            className={todo === 0 ? "pill ok" : "pill"}
            title={isReading ? `قرأ ${filled} من ${students.length} مرة على الأقل` : open ? `أدخلتَ لـ ${filled} من ${students.length}` : `نُقِّط ${filled} من ${students.length}`}
          >
            {filled}/{students.length}
          </span>
        </div>
      )}

      {students.length > 8 && (
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            id="class-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن تلميذ"
            aria-label="ابحث عن تلميذ"
          />
          {query && (
            <button className="clearb" onClick={() => setQuery("")} aria-label="امسح البحث">
              ×
            </button>
          )}
        </div>
      )}

      {students.length === 0 ? (
        <div className="card empty">
          <h3>القسم بلا تلاميذ</h3>
          <p>أضف الأسماء، اسمًا في كل سطر.</p>
          <button className="btn soft" onClick={onAddStudents}>+ تلاميذ</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="card empty">
          <h3>
            {query
              ? `لا اسم يطابق «${query}»`
              : filter === "todo"
                ? isReading
                  ? "قرأ القسم كله مرة على الأقل"
                  : "لم يبقَ أحد — القسم كله منقَّط"
                : "لا أحد تحت 10"}
          </h3>
          <button
            className="btn soft"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            أظهر القسم كله
          </button>
        </div>
      ) : (
        <div className="slist">
          {rows.map(({ student, average }, index) =>
            open ? (
              <div key={student.id} className="srow colmode">
                <span className="rank num">{index + 1}</span>
                <button className="sname asname" onClick={() => onPick(student)}>
                  {student.full_name}
                  {state(student) && (
                    <small className="nbadge" title={state(student)}>{state(student)}</small>
                  )}
                </button>
                {isReading ? (
                  <>
                    <span className="sreads num" title="محاولات هذا الفصل">
                      {readingCount(student.id) ? `${readingCount(student.id)}×` : "—"}
                    </span>
                    {/* المتطوّع: من رفع يده يُضاف إلى القائمة فوق، والنقرة الثانية تُخرجه */}
                    <button
                      className="volbtn"
                      aria-pressed={inDraft.has(student.id)}
                      aria-label={
                        inDraft.has(student.id)
                          ? `أخرج ${student.full_name} من قائمة القراءة`
                          : `أضف ${student.full_name} إلى قائمة القراءة`
                      }
                      onClick={() => onDraft(toggleVolunteer(live, student))}
                    >
                      {inDraft.has(student.id) ? "✓" : "+"}
                    </button>
                  </>
                ) : columnLocked && tp.averageOf(student.id) !== null ? (
                  <span className="rowlock num" title="محسوبة من حصص الأعمال التطبيقية">
                    {fmt(tp.averageOf(student.id))} / 20 · حصص
                  </span>
                ) : openCriterion ? (
                  <RowCounter
                    criterion={openCriterion}
                    record={recordOf(student.id)}
                    onChange={(value) => onCriterion(student.id, openCriterion.code, value)}
                  />
                ) : openMark ? (
                  <RowMark
                    field={openMark}
                    record={recordOf(student.id)}
                    onChange={(value) => onMark(student.id, openMark, value)}
                  />
                ) : null}
              </div>
            ) : (
              <button key={student.id} className="srow" onClick={() => onPick(student)}>
                <span className="rank num">{average === null ? "–" : rank.get(student.id)}</span>
                <span className="sname">
                  {student.full_name}
                  {state(student) && (
                    <small className="nbadge" title={state(student)}>{state(student)}</small>
                  )}
                </span>
                <span className="sreads">{readingCount(student.id) ? `${readingCount(student.id)}×` : ""}</span>
                <span className={`savg num${average === null ? " none" : average < 10 ? " low" : ""}`}>
                  {fmt(average)}
                </span>
                <span className="gradecell">{grade(average)}</span>
              </button>
            ),
          )}
        </div>
      )}

      <div className="pickbar">
        {open ? (
          <button className="btn ghost" onClick={() => setColumn(null)}>
            {isReading ? "أنهِ القراءة" : "أنهِ العمود"}
          </button>
        ) : (
          <>
            <button className="btn soft" onClick={onAddStudents}>+ تلميذ</button>
            <button
              className="btn ghost"
              aria-expanded={more}
              onClick={() => setMore(!more)}
            >
              ⋯ خيارات القسم
            </button>
          </>
        )}
      </div>
      {more && !open && (
        <div className="pickbar">
          <button className="btn warn" onClick={onDelete}>حذف القسم</button>
        </div>
      )}
    </section>
  );
}

/**
 * عدّاد سطر واحد في وضع العمود: ناقص ورقم وزائد، مضغوطة لتسع الاسم معها.
 * نفس حساب بطاقة التلميذ (bump/shownValue)، فلا يختلف ما يُخزَّن باختلاف
 * المكان الذي نُقِّط منه.
 */
export function RowCounter({
  criterion, record, onChange,
}: {
  criterion: Criterion;
  record: RecordRow | undefined;
  onChange: (value: number | null) => void;
}) {
  const ceiling = Number(criterion.ceiling);
  const step = stepFor(criterion);
  const stored = record?.criteria?.[criterion.code];
  const value = typeof stored === "number" ? stored : null;
  const assessed = value !== null;
  const shown = shownValue(criterion, value);
  const isDeduct = criterion.kind === "deduct";

  const atFloor = isDeduct ? shown === 0 : !assessed || shown === 0;
  const atRoof = (shown ?? 0) >= ceiling && (isDeduct || assessed);

  /*
   * المسح بالضغط المطوّل على الرقم لا بنقرة: الرقم في وسط ما يُضغط بالإبهام،
   * وكانت لمسة تمرّ عليه تعيد التلميذ إلى «لم يُقيَّم» بصمت. والمسح الصريح
   * ما زال في بطاقة التلميذ.
   */
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const release = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
  };

  return (
    <div className="rowc">
      <button
        className="rcbtn"
        onClick={() => onChange(bump(criterion, value, -step))}
        disabled={atFloor}
        aria-label={`${criterion.label}: أنقص ${step}`}
      >
        −
      </button>
      <span
        className={assessed || isDeduct ? "rcval num" : "rcval num none"}
        title={assessed ? "اضغط مطوّلًا لتمسح فيعود غير مقيَّم" : "لم يُقيَّم"}
        onPointerDown={() => {
          if (!assessed) return;
          release();
          hold.current = setTimeout(() => {
            hold.current = null;
            onChange(null);
          }, 600);
        }}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        onContextMenu={(e) => e.preventDefault()}
      >
        {shown === null ? "—" : fmt(shown, shown % 1 ? 1 : 0)}
      </span>
      <button
        className="rcbtn"
        onClick={() => onChange(bump(criterion, value, step))}
        disabled={atRoof}
        aria-label={`${criterion.label}: أضف ${step}`}
      >
        +
      </button>
    </div>
  );
}

/** مركّبة من 20 في وضع العمود: خانة رقم، والفراغ يعني «لم يُنقَّط». */
export function RowMark({
  field, record, onChange,
}: {
  field: MarkField;
  record: RecordRow | undefined;
  onChange: (value: number | null) => void;
}) {
  const current = record?.[field] ?? null;
  const [refused, setRefused] = useState(false);
  return (
    <div className="rowm">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={20}
        step={0.25}
        defaultValue={current ?? ""}
        key={`${field}-${current ?? ""}`}
        aria-label="العلامة من 20"
        aria-invalid={refused}
        title={refused ? MARK_HINT : undefined}
        onChange={() => setRefused(false)}
        onBlur={(e) => {
          const read = readMark(e.target);
          if (read.kind === "bad") {
            e.target.value = String(current ?? "");
            setRefused(true);
            return;
          }
          setRefused(false);
          if (read.kind === "empty") {
            if (current !== null) onChange(null);
            return;
          }
          if (read.value !== current) onChange(read.value);
        }}
        onKeyDown={(e) => {
          // Enter ينتقل إلى التلميذ التالي: اليد لا تترك لوحة المفاتيح.
          if (e.key !== "Enter") return;
          e.preventDefault();
          const field = e.currentTarget;
          const inputs = Array.from(
            field.closest(".slist")?.querySelectorAll(".rowm input") ?? [],
          ) as HTMLInputElement[];
          const next = inputs[inputs.indexOf(field) + 1];
          if (next) next.focus();
          else e.currentTarget.blur();
        }}
      />
      <i className="num">/ 20</i>
      {refused && <small className="ferr" role="alert">{MARK_HINT}</small>}
    </div>
  );
}
