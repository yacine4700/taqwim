"use client";

import { groupBySchool } from "@/lib/schools";
import { classStats, fmt } from "@/lib/scoring";
import { Klass, School } from "./types";
import { Kpi } from "./parts";

const BINS: Array<[number, number, string]> = [
  [0, 5, "أقل من 5"], [5, 8, "5 – 8"], [8, 10, "8 – 10"], [10, 12, "10 – 12"],
  [12, 14, "12 – 14"], [14, 16, "14 – 16"], [16, 20.01, "16 – 20"],
];

export function StatsView({
  classes, schools, statsOf, statsInTerm, term,
}: {
  classes: Klass[];
  schools: School[];
  statsOf: (id: string) => ReturnType<typeof classStats>;
  /** إحصاء القسم في فصل آخر، لمقارنة معدله بمعدل الفصل السابق. */
  statsInTerm: (id: string, term: number) => ReturnType<typeof classStats>;
  term: number;
}) {
  const groups = groupBySchool(classes, schools);

  function statCard(klass: Klass) {
    const st = statsOf(klass.id);
    const counts = BINS.map(([lo, hi]) => st.values.filter((v) => v >= lo && v < hi).length);
    const peak = Math.max(1, ...counts);
    const before = term > 1 ? statsInTerm(klass.id, term - 1) : null;
    const change = st.mean !== null && before?.mean != null ? st.mean - before.mean : null;
    return (
      <div key={klass.id} className="card">
        <div className="srow2">
          <div className="k">
            <b>{klass.name}</b>
            <small>{st.scored} منقَّطًا من {st.total}</small>
            {/* السهم والإشارة معًا: اللون وحده لا يقول شيئًا لمن لا يميّزه */}
            {change !== null && before?.mean != null && (
              <small className={change < 0 ? "delta down" : "delta"}>
                {`الفصل ${term - 1}: ${fmt(before.mean)} · ${
                  Math.abs(change) < 0.005 ? "بلا تغيّر" : `${change > 0 ? "▲ +" : "▼ −"}${fmt(Math.abs(change))}`
                }`}
              </small>
            )}
          </div>
          <span className="pill">{st.mean === null ? "—" : `${fmt(st.mean)} / 20`}</span>
        </div>
        {st.scored > 0 && (
          <>
            <div className="kpis">
              <Kpi value={fmt(st.median)} label="الوسيط" />
              <Kpi value={fmt(st.sd)} label="الانحراف" />
              <Kpi value={fmt(st.max)} label="أعلى" />
              <Kpi value={fmt(st.min)} label="أدنى" />
              <Kpi value={st.passRate === null ? "—" : `${Math.round(st.passRate * 100)}%`} label="فاق 10" />
            </div>
            <div className="dist">
              {BINS.map(([, , label], i) => (
                <div key={label} className="drow">
                  <span className="dl">{label}</span>
                  <span className="db">
                    <i style={{ width: `${Math.round((counts[i] / peak) * 100)}%` }} />
                  </span>
                  <span className="dn num">{counts[i]}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <section className="view">
      <div className="vhead">
        <div>
          <h2>الإحصاء</h2>
          <p>الفصل {term}</p>
        </div>
      </div>
      {classes.length === 0 ? (
        <div className="card empty">
          <h3>لا بيانات</h3>
          <p>استورد قسمًا أولًا.</p>
        </div>
      ) : (
        /* مجمّع بالمؤسسة كشاشة الأقسام: صاحب ثانويتين لا يقرأ سبعة أقسام متتالية
           بأسماء متشابهة. مؤسسة واحدة: لا عنوان، فلا شيء يتغيّر عنده. */
        groups.map((group) => {
          const values = group.classes.flatMap((k) => statsOf(k.id).values);
          const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
          return (
            <div key={group.key} className="statgroup">
              {groups.length > 1 && (
                <div className="grouphead">
                  <h3>{group.name}</h3>
                  <span className="pill">
                    {values.length} منقَّطًا{mean === null ? "" : ` · معدلهم ${fmt(mean)}`}
                  </span>
                </div>
              )}
              {group.classes.map(statCard)}
            </div>
          );
        })
      )}
    </section>
  );
}
