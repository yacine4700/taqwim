"use client";

/**
 * كشف القسم جاهزًا للطبع أو الحفظ PDF.
 *
 * لا مكتبة PDF: الصفحة تُنسَّق للطبع ويفتح المتصفّح حوار الطبع، ومنه «احفظ
 * كـ PDF». فالنتيجة نصّ عربي حقيقي قابل للبحث والنسخ لا صورة، وتعمل دون
 * شبكة، ولا تزيد التطبيق مكتبةً ثقيلة لا تُحسن رسم العربية أصلًا.
 *
 * والحالة الخاصة للتلميذ لا تُطبع: هي «لك وحدك» كما وُعد الأستاذ في بطاقته،
 * والكشف ورقة تُرى وتُعلَّق وتُسلَّم.
 */

import { useState } from "react";
import {
  classStats,
  componentValues,
  fmt,
  grade,
  shownValue,
  termAverage,
  type Component,
  type Criterion,
  type Reading,
  type RecordRow,
} from "@/lib/scoring";

type Klass = { id: string; name: string };
type Student = { id: string; full_name: string };
type Profile = { full_name: string; subject: string | null; school_name: string | null };

export default function PrintView({
  klass, students, criteria, components, profile, term, recordOf, readingsOf, onClose,
}: {
  klass: Klass;
  students: Student[];
  criteria: Criterion[];
  components: Component[];
  profile: Profile;
  term: number;
  recordOf: (studentId: string) => RecordRow | undefined;
  readingsOf: (studentId: string) => Reading[];
  onClose: () => void;
}) {
  const [detailed, setDetailed] = useState(true);
  const [byRank, setByRank] = useState(false);

  const marks = components.filter((c) => c.code !== "cc" && c.active);
  const ccLabel = components.find((c) => c.code === "cc")?.label ?? "التقويم المستمر";

  const rows = students.map((student) => {
    const record = recordOf(student.id);
    const readings = readingsOf(student.id);
    const values = componentValues(criteria, record, readings);
    return {
      student,
      record,
      readings,
      values,
      average: termAverage(components, values),
    };
  });

  const ranked = [...rows]
    .filter((r) => r.average !== null)
    .sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
  const rank = new Map(ranked.map((r, i) => [r.student.id, i + 1]));
  const ordered = byRank
    ? [...rows].sort((a, b) => (b.average ?? -1) - (a.average ?? -1))
    : rows;

  const stats = classStats(
    rows.map((r) => r.average),
    rows.filter((r) => r.readings.length === 0).length,
  );

  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div className="printwrap">
      <div className="printbar gut">
        <button className="icbtn" onClick={onClose} aria-label="إغلاق">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div className="kinds" role="group" aria-label="شكل الكشف">
          <button aria-pressed={detailed} onClick={() => setDetailed(!detailed)}>
            أعمدة المعايير
          </button>
          <button aria-pressed={byRank} onClick={() => setByRank(!byRank)}>
            ترتيب بالمعدل
          </button>
        </div>
        <div className="hspace" />
        <button className="btn" onClick={() => window.print()}>اطبع أو احفظ PDF</button>
      </div>

      <div className="paper">
        <div className="phead">
          <div className="pline">الجمهورية الجزائرية الديمقراطية الشعبية</div>
          <div className="pline">وزارة التربية الوطنية</div>
          {profile.school_name && <div className="pline strong">{profile.school_name}</div>}
          <h1>كشف نقاط القسم</h1>
          <div className="pmeta">
            <span><b>القسم:</b> {klass.name}</span>
            <span><b>الفصل:</b> {term}</span>
            {profile.subject && <span><b>المادة:</b> {profile.subject}</span>}
            {profile.full_name && <span><b>الأستاذ:</b> {profile.full_name}</span>}
            <span><b>التاريخ:</b> {stamp}</span>
          </div>
        </div>

        <table className="ptable">
          <thead>
            <tr>
              <th className="tiny">الرقم</th>
              <th className="wide">الاسم واللقب</th>
              {detailed &&
                criteria.map((c) => (
                  <th key={c.id} className="narrow">
                    {c.label}
                    <i>/{Number(c.ceiling)}</i>
                  </th>
                ))}
              <th className="narrow">{ccLabel}<i>/20</i></th>
              {marks.map((c) => (
                <th key={c.id} className="narrow">
                  {c.label}
                  <i>/20</i>
                </th>
              ))}
              <th className="narrow">المعدل</th>
              <th className="tiny">الرتبة</th>
              <th className="gradecol">التقدير</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((row, index) => (
              <tr key={row.student.id}>
                <td className="num">{index + 1}</td>
                <td className="name">{row.student.full_name}</td>
                {detailed &&
                  criteria.map((c) => {
                    if (c.kind === "auto") {
                      // معيار القراءة: نقطته متوسط محاولات الفصل.
                      const average =
                        row.readings.length === 0
                          ? null
                          : row.readings.reduce((sum, r) => sum + Number(r.score), 0) /
                            row.readings.length;
                      return (
                        <td key={c.id} className="num">
                          {average === null ? "—" : fmt(average, 1)}
                        </td>
                      );
                    }
                    const stored = row.record?.criteria?.[c.code];
                    const shown = shownValue(c, typeof stored === "number" ? stored : null);
                    return (
                      <td key={c.id} className="num">
                        {shown === null ? "—" : fmt(shown, shown % 1 ? 1 : 0)}
                      </td>
                    );
                  })}
                <td className="num">{fmt(row.values.cc)}</td>
                {marks.map((c) => (
                  <td key={c.id} className="num">{fmt(row.values[c.code] ?? null)}</td>
                ))}
                <td className={row.average !== null && row.average < 10 ? "num low" : "num strong"}>
                  {fmt(row.average)}
                </td>
                <td className="num">{row.average === null ? "—" : rank.get(row.student.id)}</td>
                <td className="gradecol">{grade(row.average)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="pfoot">
          <div className="pstats">
            <span><b>التلاميذ:</b> {stats.total}</span>
            <span><b>المنقَّطون:</b> {stats.scored}</span>
            <span><b>معدل القسم:</b> {fmt(stats.mean)}</span>
            <span><b>الوسيط:</b> {fmt(stats.median)}</span>
            <span><b>الانحراف:</b> {fmt(stats.sd)}</span>
            <span>
              <b>فاق 10:</b>{" "}
              {stats.passRate === null ? "—" : `${Math.round(stats.passRate * 100)}%`}
            </span>
          </div>
          <div className="psign">
            <span>إمضاء الأستاذ</span>
            <span>إمضاء المدير</span>
          </div>
        </div>
      </div>
    </div>
  );
}
