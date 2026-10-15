"use client";

/**
 * ملء وثيقة حجز النقاط.
 *
 * الوثيقة تُرسل وزاريًا ولها بنية مضبوطة، فالتطبيق لا يصنع واحدة من عنده:
 * الأستاذ يرفع التي نزّلها، والتطبيق يكتب العلامات في خاناتها ويعيدها بكل
 * ترويساتها وتنسيقها وحمايتها كما كانت. وهي تحمل أقسامه كلها في أوراق،
 * فتُملأ في مرة واحدة.
 *
 * والمطابقة بالأسماء تُعرض قبل الكتابة لا بعدها: الأستاذ يرى من طُوبق ومن لم
 * يُطابَق، فلا تنزل علامة في سطر غير صاحبها دون أن يراها.
 */

import { useMemo, useState } from "react";
import {
  fillSheet,
  matchStudents,
  readMinistryFile,
  round2,
  saveMinistryFile,
  type MinistryDoc,
  type MinistrySheet,
  type Write,
} from "@/lib/ministry";
import {
  componentValues,
  type Component,
  type Criterion,
  type Reading,
  type RecordRow,
} from "@/lib/scoring";

type Klass = { id: string; name: string };
type Student = { id: string; full_name: string };

type Plan = {
  klass: Klass;
  sheet: MinistrySheet | null;
  matched: number;
  total: number;
  /** تلاميذ القسم بلا سطر في الوثيقة. */
  unmatched: string[];
  writes: Write[];
  marks: number;
  missingColumns: string[];
};

export default function ExportSheet({
  classes, studentsOf, criteria, components, recordOf, readingsOf, term, onClose, say,
}: {
  classes: Klass[];
  studentsOf: (classId: string) => Student[];
  criteria: Criterion[];
  components: Component[];
  recordOf: (studentId: string) => RecordRow | undefined;
  readingsOf: (studentId: string) => Reading[];
  term: number;
  onClose: () => void;
  say: (text: string) => void;
}) {
  const [doc, setDoc] = useState<MinistryDoc | null>(null);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  /** اختيار الأستاذ: معرّف القسم ← اسم الورقة، أو "" لتركه. */
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  async function open(file: File) {
    setStatus("جارٍ القراءة…");
    setDone(false);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const opened = await readMinistryFile(bytes);
      setDoc(opened);
      setFileName(file.name);

      // لكل قسم أفضل ورقة: أكثرها تطابقًا بالأسماء، وتفضَّل أوراق الفصل نفسه.
      const picks: Record<string, string> = {};
      const used = new Set<string>();
      for (const klass of classes) {
        const mine = studentsOf(klass.id);
        if (!mine.length) continue;
        let best: { sheet: MinistrySheet; score: number } | null = null;
        for (const sheet of opened.sheets) {
          if (used.has(sheet.name)) continue;
          if (!sheet.columns.some((c) => c.component)) continue;
          const hits = matchStudents(mine, sheet.students).pairs.length;
          const score = hits * 10 + (sheet.term === term ? 1 : 0);
          if (hits > 0 && (!best || score > best.score)) best = { sheet, score };
        }
        if (best) {
          picks[klass.id] = best.sheet.name;
          used.add(best.sheet.name);
        }
      }
      setChoice(picks);
      const count = Object.keys(picks).length;
      setStatus(
        count
          ? `${opened.sheets.length} ورقة في الملف، طابقتُ ${count} منها بأقسامك.`
          : `${opened.sheets.length} ورقة في الملف، ولم يطابق أيٌّ منها أسماء أقسامك.`,
      );
    } catch (problem) {
      setDoc(null);
      setStatus(problem instanceof Error ? problem.message : "تعذّرت قراءة الملف");
    }
  }

  const plans = useMemo<Plan[]>(() => {
    if (!doc) return [];
    return classes.map((klass) => {
      const mine = studentsOf(klass.id);
      const sheet = doc.sheets.find((s) => s.name === choice[klass.id]) ?? null;
      if (!sheet) {
        return { klass, sheet: null, matched: 0, total: mine.length, unmatched: [], writes: [], marks: 0, missingColumns: [] };
      }
      const pairing = matchStudents(mine, sheet.students);
      const writes: Write[] = [];
      const missing = new Set<string>();
      let marks = 0;
      const codes = new Set(sheet.columns.map((c) => c.component));
      for (const { student, row } of pairing.pairs) {
        const values = componentValues(criteria, recordOf(student.id), readingsOf(student.id));
        for (const component of components) {
          if (!component.active) continue;
          const value = round2(values[component.code] ?? null);
          if (!codes.has(component.code)) {
            if (value !== null) missing.add(component.label);
            continue;
          }
          writes.push({ row: row.row, component: component.code, value });
          if (value !== null) marks++;
        }
      }
      return {
        klass,
        sheet,
        matched: pairing.pairs.length,
        total: mine.length,
        unmatched: pairing.unmatched.map((s) => s.full_name),
        writes,
        marks,
        missingColumns: [...missing],
      };
    });
  }, [doc, classes, choice, studentsOf, criteria, components, recordOf, readingsOf]);

  const active = plans.filter((p) => p.sheet);
  const totalMarks = active.reduce((sum, p) => sum + p.marks, 0);
  const wrongTerm = active.filter((p) => p.sheet && p.sheet.term !== null && p.sheet.term !== term);

  function run() {
    if (!doc) return;
    setBusy(true);
    try {
      for (const plan of active) {
        if (plan.sheet) fillSheet(plan.sheet, plan.writes);
      }
      const bytes = saveMinistryFile(doc);
      const blob = new Blob([bytes as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName.replace(/\.xlsx$/i, "") + ` - ف${term} ممتلئة.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      setDone(true);
      say(`نُزّلت الوثيقة: ${totalMarks} علامة`);
    } catch (problem) {
      setStatus(problem instanceof Error ? problem.message : "تعذّر إنشاء الملف");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>ملء وثيقة حجز النقاط</h3>
          <button className="icbtn" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="fld">
          <div className="flab">
            <b>الوثيقة التي نزّلتها</b>
            <small>xlsx — تُملأ خاناتها وتعود بترويساتها وتنسيقها كما هي</small>
          </div>
          <input
            id="ministry-file"
            className="inp"
            style={{ width: "100%" }}
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void open(file);
            }}
          />
        </div>

        {status && <div className="note">{status}</div>}

        {doc && (
          <>
            {plans.map((plan) => (
              <div key={plan.klass.id} className={plan.sheet ? "crit" : "crit off"}>
                <div className="critop">
                  <div className="k" style={{ flex: 1, minWidth: 0 }}>
                    <b>{plan.klass.name}</b>
                    <small>
                      {plan.sheet
                        ? `${plan.matched} من ${plan.total} مطابقًا · ${plan.marks} علامة`
                        : `${plan.total} تلميذًا — لن يُملأ`}
                    </small>
                  </div>
                  <select
                    value={choice[plan.klass.id] ?? ""}
                    aria-label={`ورقة ${plan.klass.name}`}
                    onChange={(e) =>
                      setChoice((c) => ({ ...c, [plan.klass.id]: e.target.value }))
                    }
                  >
                    <option value="">لا تملأ</option>
                    {doc.sheets.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name} · {s.group || s.subject}
                      </option>
                    ))}
                  </select>
                </div>
                {plan.sheet && (
                  <small className="chint">
                    {plan.sheet.subject} · الفصل {plan.sheet.term ?? "؟"} ·{" "}
                    {plan.sheet.columns
                      .filter((c) => c.component)
                      .map((c) => c.label.replace(" /20", ""))
                      .join(" ، ")}
                  </small>
                )}
                {plan.unmatched.length > 0 && (
                  <small className="chint" style={{ color: "var(--sand)" }}>
                    بلا سطر في الوثيقة فلن يُملأ لهم: {plan.unmatched.join(" ، ")}
                  </small>
                )}
                {plan.missingColumns.length > 0 && (
                  <small className="chint" style={{ color: "var(--sand)" }}>
                    لا خانة في هذه الورقة لـ: {plan.missingColumns.join(" ، ")}
                  </small>
                )}
              </div>
            ))}

            {wrongTerm.length > 0 && (
              <div className="note warn">
                أنت في الفصل {term}، وورقة {wrongTerm[0].klass.name} للفصل{" "}
                {wrongTerm[0].sheet?.term}. بدّل الفصل من أعلى الشاشة أو اختر ورقة أخرى.
              </div>
            )}

            <div className="note">
              ستُكتب {totalMarks} علامة في {active.length} ورقة. ولن يُكتب شيء في
              خانة تلميذ لم يُطابَق، ولا في خانة لم تُنقَّط بعد.
            </div>

            <button
              className="btn"
              style={{ marginTop: 14 }}
              disabled={busy || !totalMarks}
              onClick={run}
            >
              {busy ? "جارٍ الملء…" : done ? "نزّلها مرة أخرى" : "املأ الوثيقة ونزّلها"}
            </button>

            {done && (
              <div className="note" style={{ marginTop: 10 }}>
                افتحها وتأكّد قبل الإرسال.
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
