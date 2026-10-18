"use client";

import { groupBySchool } from "@/lib/schools";
import { countWord } from "@/lib/outbox";
import { classStats, fmt } from "@/lib/scoring";
import { Klass, School } from "./types";
import { Stat } from "./parts";

/**
 * ما يبقى على الأستاذ في أول أسبوع.
 *
 * الخطوات التي تمّت تختفي وحدها، والبطاقة كلها تختفي حين تتمّ كلها — فلا
 * تبقى في الشاشة سنةً كاملة. ولا تُعرض خطوة لا يعرف الأستاذ أنها ناقصة:
 * المعايير أُنشئت له افتراضًا، لكن مجموعها قد يخرج عن 20 وهو لا يدري.
 */
function StartCard({
  steps, onDismiss,
}: {
  steps: Array<{ key: string; label: string; hint: string; action: string; onDo: () => void }>;
  onDismiss: () => void;
}) {
  if (!steps.length) return null;
  return (
    <div className="card startcard">
      <div className="srow2">
        <b>لتبدأ</b>
        <div className="hspace" />
        <button className="clearb" onClick={onDismiss}>أخفِ</button>
      </div>
      {steps.map((step) => (
        <div key={step.key} className="srow2">
          <div className="k">
            {step.label}
            <small>{step.hint}</small>
          </div>
          <button className="btn soft" onClick={step.onDo}>{step.action}</button>
        </div>
      ))}
    </div>
  );
}

export function ClassesView({
  loading, classes, schools, studentCount, statsOf, onOpen, onImport, onNewSchool,
  openSchool, onOpenSchool, start, onDismissStart,
}: {
  loading: boolean;
  classes: Klass[];
  schools: School[];
  studentCount: number;
  statsOf: (id: string) => ReturnType<typeof classStats>;
  onOpen: (id: string) => void;
  onImport: () => void;
  onNewSchool: () => void;
  /** المؤسسة المفتوحة، أو null فتُعرض بطاقاتها. */
  openSchool: string | null;
  onOpenSchool: (key: string | null) => void;
  start: Array<{ key: string; label: string; hint: string; action: string; onDo: () => void }>;
  onDismissStart: () => void;
}) {
  const groups = groupBySchool(classes, schools);
  /** مؤسسة واحدة: لا معنى لشاشة بطاقة واحدة، فتُعرض أقسامها رأسًا. */
  const single = groups.length === 1 ? groups[0] : null;
  const current = single ?? groups.find((g) => g.key === openSchool) ?? null;

  return (
    <section className="view">
      <div className="vhead">
        {current && !single && (
          <button className="icbtn" onClick={() => onOpenSchool(null)} aria-label="رجوع إلى المؤسسات">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        )}
        <div>
          <h2>{current && !single ? current.name : "أقسامي"}</h2>
          {classes.length > 0 && (
            <p>
              {current
                ? `${countWord(current.classes.length, "قسم واحد", "قسمان", "أقسام", "قسمًا")} · ${current.classes.reduce((sum, k) => sum + statsOf(k.id).total, 0)} تلميذًا`
                : `${studentCount} تلميذًا في ${countWord(classes.length, "قسم واحد", "قسمان", "أقسام", "قسمًا")}`}
            </p>
          )}
        </div>
        <div className="hspace" />
        {/* الاستيراد من شاشة المؤسسات لا من داخل واحدة: القسم الجديد قد
            يكون لأيّهما، ومؤسسته تُختار في ورقة الاستيراد نفسها. */}
        {!current ? (
          <button className="btn soft" onClick={onNewSchool}>+ مؤسسة</button>
        ) : null}
        {!current || single ? (
          <button className="btn soft" onClick={onImport}>+ قسم</button>
        ) : null}
      </div>

      {!loading && <StartCard steps={start} onDismiss={onDismissStart} />}

      {loading ? (
        <div className="card empty">
          <h3>جارٍ تحميل أقسامك…</h3>
        </div>
      ) : classes.length === 0 ? (
        <div className="card empty">
          <h3>لا أقسام بعد</h3>
          <p>ارفع ملف الإشراف التربوي (xlsx) فيُنشأ القسم بأسماء تلاميذه، أو الصق الأسماء سطرًا لكل تلميذ.</p>
          <button className="btn" onClick={onImport}>استيراد قائمة</button>
        </div>
      ) : !current ? (
        /* شاشة المؤسسات: بطاقاتها وحدها، تُفتح الواحدة فتُعرض أقسامها.
           لا تُعرض الأقسام هنا، فصاحب ثانويتين يرى ثانويتيه لا سبعة أقسام. */
        <div className="schooltiles">
          {groups.map((group) => {
            const stats = group.classes.map((k) => statsOf(k.id));
            const students = stats.reduce((sum, st) => sum + st.total, 0);
            const scored = stats.reduce((sum, st) => sum + st.scored, 0);
            return (
              <button
                key={group.key}
                className="tile"
                onClick={() => onOpenSchool(group.key)}
              >
                <b>{group.name}</b>
                <span className="hspace" />
                <i className="num">{scored}/{students}</i>
                <small>منقَّطون</small>
                <div className="bar">
                  <i style={{ width: `${students ? Math.round((scored / students) * 100) : 0}%` }} />
                </div>
                <small>
                  {countWord(group.classes.length, "قسم واحد", "قسمان", "أقسام", "قسمًا")}
                </small>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid">
          {current.classes.map((klass) => {
            const st = statsOf(klass.id);
            const covered = st.total - st.unread;
            return (
              <button key={klass.id} className="card clscard" onClick={() => onOpen(klass.id)}>
                <div className="top">
                  <h3>{klass.name}</h3>
                  <span className="pill">{st.total} تلميذًا</span>
                </div>
                <div className="statrow">
                  <Stat value={fmt(st.mean)} label="معدل القسم" />
                  <Stat value={`${st.scored}/${st.total}`} label="منقَّطون" />
                  <Stat value={`${covered}/${st.total}`} label="قُرئ لهم" />
                </div>
                <div className="bar">
                  <i style={{ width: `${st.total ? Math.round((covered / st.total) * 100) : 0}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
