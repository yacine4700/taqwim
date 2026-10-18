"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { firstClassOf, groupBySchool, groupOf, resolveSessionClass } from "@/lib/schools";
import { optionsFor, pickForSession, type Criterion } from "@/lib/scoring";
import { Klass, School, Student } from "./types";

export function SessionView({
  classes, schools, studentsOf, attemptsOf, term, reading,
  classId, onClassId, count, onCount, picked, setPicked, scores, setScores, onSave,
}: {
  classes: Klass[];
  schools: School[];
  studentsOf: (id: string) => Student[];
  attemptsOf: (id: string) => number;
  term: number;
  /** معيار القراءة المحسوب تلقائيًا، إن أبقاه الأستاذ في معاييره. */
  reading: Criterion | undefined;
  /** القسم والعدد محفوظان في الجهاز، فلا يُعادان في كل حصة. */
  classId: string;
  onClassId: (id: string) => void;
  count: number;
  onCount: (n: number) => void;
  /** القائمة المختارة ونقاطها، تعيشان في AppClient فتنجوان من تبديل التبويب. */
  picked: Student[];
  setPicked: Dispatch<SetStateAction<Student[]>>;
  scores: Record<string, number | "skip">;
  setScores: Dispatch<SetStateAction<Record<string, number | "skip">>>;
  onSave: (entries: Array<{ studentId: string; score: number }>) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);

  /* القسم المحفوظ قد يُحذف من جهاز آخر: لا تبقى الحصة على قسم لا وجود له */
  useEffect(() => {
    const wanted = resolveSessionClass(groupBySchool(classes, schools), classId);
    if (wanted !== classId) onClassId(wanted);
  }, [classes, schools, classId, onClassId]);

  if (!classes.length) {
    return (
      <section className="view">
        <div className="vhead">
          <div>
            <h2>محاولات الحصة</h2>
          </div>
        </div>
        <div className="card empty">
          <h3>لا أقسام بعد</h3>
          <p>استورد قسمًا أولًا من تبويب الأقسام.</p>
        </div>
      </section>
    );
  }

  /* المؤسسة قبل القسم، كما في شاشة الأقسام: أسماء الأقسام تتشابه بين ثانويتين،
     ومن يقف أمام تلاميذ مؤسسة لا يريد أن يقرأ في قائمة سبعة أقسام معًا.
     مؤسسة واحدة: لا معنى لقائمة بخيار واحد، فلا تظهر. */
  const groups = groupBySchool(classes, schools);
  const group = groupOf(groups, classId) ?? groups[0];
  const list = studentsOf(classId);
  const unread = list.filter((s) => attemptsOf(s.id) === 0).length;
  const chosen = picked.filter((s) => typeof scores[s.id] === "number").length;

  /** يستبدل تلميذًا بالتالي في العدل: الأقل محاولات ممن ليسوا في القائمة. */
  function swap(student: Student) {
    const already = new Set(picked.map((p) => p.id));
    const [next] = pickForSession(
      list.filter((s) => !already.has(s.id)),
      attemptsOf,
      1,
    );
    if (!next) return;
    setPicked((ps) => ps.map((p) => (p.id === student.id ? next : p)));
    setScores((s) => {
      const rest = { ...s };
      delete rest[student.id];
      return rest;
    });
  }
  // سلّم التنقيط من سقف معيار القراءة نفسه، فلو رفعه الأستاذ إلى 6 ظهرت 6.
  const scale = reading ? optionsFor({ ...reading, kind: "add" }) : [0, 1, 2, 3, 4];

  return (
    <section className="view">
      <div className="vhead">
        <div>
          <h2>محاولات الحصة</h2>
          <p>الأقل محاولات أولًا، والاختيار عشوائي بين المتساوين.</p>
        </div>
      </div>

      <div className="pickbar">
        {groups.length > 1 && (
          <select
            id="session-school"
            aria-label="المؤسسة"
            style={{ flex: "1 1 100%" }}
            value={group.key}
            onChange={(e) => {
              onClassId(firstClassOf(groups, e.target.value));
              setPicked([]);
              setScores({});
            }}
          >
            {groups.map((g) => (
              <option key={g.key} value={g.key}>{g.name}</option>
            ))}
          </select>
        )}
        <select
          id="session-class"
          aria-label="القسم"
          value={classId}
          onChange={(e) => {
            onClassId(e.target.value);
            setPicked([]);
            setScores({});
          }}
        >
          {group.classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select id="session-count" value={count} onChange={(e) => onCount(Number(e.target.value))}>
          {[3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <button
          className="btn"
          onClick={() => {
            setPicked(pickForSession(list, attemptsOf, count));
            setScores({});
          }}
        >
          اختر {count}
        </button>
      </div>

      <div className="note">
        لم تُقرأ لهم بعد: {unread} من {list.length} · الفصل {term}
      </div>

      {!reading && (
        <div className="note warn">
          لا معيار قراءة في إعداداتك، فالمحاولات تُسجَّل ولا تدخل التقويم
          المستمر. أضف معيارًا من الإعدادات إن أردت أن تُحسب.
        </div>
      )}

      {picked.length === 0 ? (
        <div className="card empty">
          <h3>جاهز للحصة</h3>
          <p>اضغط «اختر» فتظهر أسماء هذه الحصة، ثم انقر نقطة كل تلميذ واحفظ.</p>
        </div>
      ) : (
        <>
          {picked.map((student) => (
            <div key={student.id} className="card pcard">
              <div className="pn">
                <b>{student.full_name}</b>
                <span className="pill">
                  {attemptsOf(student.id) ? `${attemptsOf(student.id)} محاولات` : "أول محاولة"}
                </span>
                {/* الاسم يخرج والقائمة لا تُعاد: الغائب لا يُنقص الحصة واحدًا */}
                <button className="clearb" onClick={() => swap(student)}>بدّله</button>
              </div>
              <div className="scorerow">
                {scale.map((n) => (
                  <button
                    key={n}
                    aria-pressed={scores[student.id] === n}
                    onClick={() => setScores((s) => ({ ...s, [student.id]: n }))}
                  >
                    {n}
                  </button>
                ))}
                <button
                  className="skip"
                  aria-pressed={scores[student.id] === "skip"}
                  onClick={() => setScores((s) => ({ ...s, [student.id]: "skip" }))}
                >
                  غائب
                </button>
              </div>
            </div>
          ))}
          <button
            className="btn"
            disabled={!chosen || saving}
            onClick={async () => {
              setSaving(true);
              const entries = picked
                .filter((s) => typeof scores[s.id] === "number")
                .map((s) => ({ studentId: s.id, score: scores[s.id] as number }));
              const ok = await onSave(entries);
              setSaving(false);
              if (ok) {
                setPicked([]);
                setScores({});
              }
            }}
          >
            {saving ? "جارٍ الحفظ…" : `حفظ ${chosen} محاولة`}
          </button>
        </>
      )}
    </section>
  );
}
