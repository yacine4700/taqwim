"use client";

/**
 * الأفواج وحصص الأعمال التطبيقية لقسم واحد.
 *
 * ثلاثة أبواب في شاشة واحدة:
 * - الحصص: تُنشأ وتُنقَّط لكل تلميذ، وهذا وحده ما يعمل دون شبكة (يمرّ بالطابور).
 * - الأفواج: تقسيم القسم وتسمية الأفواج ونقل تلميذ بينها. يحتاج الشبكة.
 * - الربط: أين تذهب نقطة الأعمال التطبيقية. مركّبتها إن كانت عنده، وإلا معيارٌ
 *   من التقويم المستمر يختاره. المعدّل يُحسب من الحصص ولا يُخزَّن.
 *
 * الحساب كله في src/lib/scoring.ts وgroups.ts (مختبَر). هنا عرضٌ وإدخال فقط.
 */

import { useMemo, useState } from "react";
import {
  MAX_GROUPS,
  cleanGroupName,
  cleanSessionTitle,
  groupCountProblem,
  groupLabel,
  membership,
  parseMark,
  sessionLabel,
  shortDate,
  todayISO,
  type Group,
} from "@/lib/groups";
import {
  canTargetCriterion,
  criterionTarget,
  describeTarget,
  fmt,
  targetCriterionCode,
  TP_COMPONENT,
  type Component,
  type Criterion,
  type TpMark,
  type TpSession,
  type TpTarget,
} from "@/lib/scoring";

type KlassInfo = { id: string; name: string; tp_target: TpTarget };
type StudentInfo = { id: string; full_name: string; group_id: string | null };
type Mode = "list" | "random";
/** الشاشة الرئيسية هي الحصص؛ الأفواج والربط صفحتان فرعيتان تُفتحان منها عند الحاجة. */
type Part = "main" | "groups" | "link";

type Props = {
  klass: KlassInfo;
  students: StudentInfo[];
  groups: Group[];
  sessions: TpSession[];
  tpMarks: TpMark[];
  term: number;
  criteria: Criterion[];
  components: Component[];
  tpAverageById: Map<string, number>;
  online: boolean;
  onBack: () => void;
  onTarget: (target: TpTarget) => void;
  onCreateGroups: (count: number, mode: Mode) => Promise<boolean>;
  onRedistribute: (mode: Mode) => Promise<boolean>;
  onAddGroup: () => Promise<void>;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (group: Group) => void;
  onMoveStudent: (studentId: string, groupId: string | null) => void;
  onCreateSession: (input: {
    class_id: string;
    group_id: string | null;
    held_on: string;
    title: string | null;
  }) => string;
  onEditSession: (id: string, patch: { held_on?: string; title?: string | null }) => void;
  onDeleteSession: (session: TpSession) => void;
  onMark: (sessionId: string, studentId: string, score: number | null, absent: boolean) => void;
  say: (text: string) => void;
};

export default function GroupsView(props: Props) {
  const { klass, students, groups, sessions, tpMarks, term, criteria, components, onBack } = props;
  const [part, setPart] = useState<Part>("main");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const target = describeTarget(klass.tp_target, criteria, components);
  const opened = sessions.find((s) => s.id === openId) ?? null;

  return (
    <section className="view">
      <div className="vhead">
        <button
          className="icbtn"
          onClick={() => (part === "main" ? onBack() : setPart("main"))}
          aria-label={part === "main" ? "رجوع إلى التلاميذ" : "رجوع إلى الحصص"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <div>
          <h2>{klass.name}</h2>
          <p>
            {part === "groups" ? "الأفواج" : part === "link" ? "أين تُحسب نقطة الأعمال التطبيقية" : "الأعمال التطبيقية"} · الفصل {term}
          </p>
        </div>
      </div>

      {part === "main" && (
        <SessionsPart
          klass={klass}
          students={students}
          groups={groups}
          sessions={sessions}
          tpMarks={tpMarks}
          term={term}
          target={target}
          tpAverageById={props.tpAverageById}
          onOpen={setOpenId}
          onNew={() => setCreating(true)}
          onLink={() => setPart("link")}
          onGroups={() => setPart("groups")}
        />
      )}

      {part === "groups" && (
        <GroupsPart
          students={students}
          groups={groups}
          online={props.online}
          onCreateGroups={props.onCreateGroups}
          onRedistribute={props.onRedistribute}
          onAddGroup={props.onAddGroup}
          onRenameGroup={props.onRenameGroup}
          onDeleteGroup={props.onDeleteGroup}
          onMoveStudent={props.onMoveStudent}
        />
      )}

      {part === "link" && (
        <LinkPart
          current={klass.tp_target}
          target={target}
          criteria={criteria}
          components={components}
          online={props.online}
          onTarget={props.onTarget}
        />
      )}

      {creating && (
        <NewSessionSheet
          groups={groups}
          onClose={() => setCreating(false)}
          onCreate={(input) => {
            const id = props.onCreateSession({ class_id: klass.id, ...input });
            setCreating(false);
            setPart("main");
            setOpenId(id);
            // أول حصة في قسم لم يُربط بعد: تُربط بمركّبة الأعمال التطبيقية إن كانت
            // مفعّلة، فلا يبقى الأستاذ أمام خطوة لم يعرف أنها لازمة. يغيّره من «الربط».
            const tp = components.find((c) => c.code === "tp");
            if (!klass.tp_target && tp?.active && props.online) {
              props.onTarget(TP_COMPONENT);
              props.say(`معدّل حصصك يُحسب في «${tp.label}». غيّر ذلك من «أين تُحسب النقطة».`);
            }
          }}
        />
      )}

      {opened && (
        <SessionSheet
          session={opened}
          students={students}
          groups={groups}
          marks={tpMarks.filter((m) => m.session_id === opened.id)}
          online={props.online}
          onClose={() => setOpenId(null)}
          onEdit={props.onEditSession}
          onDelete={(s) => {
            setOpenId(null);
            props.onDeleteSession(s);
          }}
          onMark={props.onMark}
          say={props.say}
        />
      )}
    </section>
  );
}

/* ================= الحصص ================= */

function SessionsPart({
  klass, students, groups, sessions, tpMarks, term, target, tpAverageById,
  onOpen, onNew, onLink, onGroups,
}: {
  klass: KlassInfo;
  students: StudentInfo[];
  groups: Group[];
  sessions: TpSession[];
  tpMarks: TpMark[];
  term: number;
  target: { ok: boolean; label: string };
  tpAverageById: Map<string, number>;
  onOpen: (id: string) => void;
  onNew: () => void;
  onLink: () => void;
  onGroups: () => void;
}) {
  const inTerm = useMemo(
    () => sessions.filter((s) => s.term === term).sort((a, b) => b.held_on.localeCompare(a.held_on)),
    [sessions, term],
  );

  /** لكل حصة: كم نُقِّط فيها ومعدّلها. الغائب وغير المنقَّط خارجان. */
  const summary = useMemo(() => {
    const out = new Map<string, { scored: number; mean: number | null }>();
    for (const s of inTerm) {
      const scores = tpMarks
        .filter((m) => m.session_id === s.id && !m.absent && m.score !== null)
        .map((m) => Number(m.score));
      out.set(s.id, {
        scored: scores.length,
        mean: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      });
    }
    return out;
  }, [inTerm, tpMarks]);

  const counts = useMemo(() => {
    const ids = new Set(inTerm.map((s) => s.id));
    const out = new Map<string, number>();
    for (const m of tpMarks) {
      if (!ids.has(m.session_id) || m.absent || m.score === null) continue;
      out.set(m.student_id, (out.get(m.student_id) ?? 0) + 1);
    }
    return out;
  }, [inTerm, tpMarks]);

  const groupName = (id: string | null) => {
    if (!id) return "كل القسم";
    const index = groups.findIndex((g) => g.id === id);
    return index < 0 ? "كل القسم" : groupLabel(groups[index], index);
  };

  return (
    <>
      {!target.ok && inTerm.length > 0 && (
        <div className="note warn">
          نقطة الأعمال التطبيقية غير مربوطة ({target.label})، فمعدّل الحصص لا يدخل
          أي حساب بعد.{" "}
          <button className="clearb" onClick={onLink}>اربطها</button>
        </div>
      )}

      <div className="pickbar">
        <button className="btn" onClick={onNew}>+ حصة جديدة</button>
        {target.ok && <span className="pill ok">تُحسب في: {target.label}</span>}
      </div>

      {inTerm.length === 0 ? (
        <div className="card empty">
          <h3>لا حصص في الفصل {term}</h3>
          <p>
            اضغط «حصة جديدة» ثم نقّط التلاميذ من 20. معدّل حصص كل تلميذ هو ما
            يدخل نقطته. الحصة تكون لكل القسم، أو لفوج إن قسّمته.
          </p>
        </div>
      ) : (
        <div className="slist">
          {inTerm.map((s) => {
            const info = summary.get(s.id);
            return (
              <button key={s.id} className="srow" onClick={() => onOpen(s.id)}>
                <span className="sname">
                  {sessionLabel(s)}
                  <small className="nbadge">{groupName(s.group_id)}</small>
                </span>
                <span className="sreads">{shortDate(s.held_on)}</span>
                <span className="sreads num">{info?.scored ?? 0} منقَّط</span>
                <span className={`savg num${info?.mean == null ? " none" : ""}`}>
                  {fmt(info?.mean ?? null, 1)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {inTerm.length > 0 && (
        <details className="card gcard">
          <summary>معدّل كل تلميذ في الفصل {term}</summary>
          <div className="slist" style={{ marginTop: 10 }}>
            {students.map((s) => (
              <div key={s.id} className="srow2">
                <span className="k">{s.full_name}</span>
                <span className="sreads num">{counts.get(s.id) ?? 0} حصص</span>
                <span className={`savg num${tpAverageById.has(s.id) ? "" : " none"}`}>
                  {fmt(tpAverageById.get(s.id) ?? null)}
                </span>
              </div>
            ))}
          </div>
          <p className="muted-note">
            الحصة التي لم يُنقَّط فيها التلميذ أو غاب عنها لا تدخل معدّله، ولا
            تُحسب صفرًا.
          </p>
        </details>
      )}

      <div className="slist">
        <button className="srow" onClick={onGroups}>
          <span className="sname">
            الأفواج
            <small className="nbadge">
              {groups.length > 0 ? `${groups.length} أفواج` : "لم يُقسَّم القسم · اختياري"}
            </small>
          </span>
        </button>
        <button className="srow" onClick={onLink}>
          <span className="sname">
            أين تُحسب نقطة الأعمال التطبيقية
            <small className="nbadge">{target.ok ? target.label : "لم تُربط بعد"}</small>
          </span>
        </button>
      </div>
    </>
  );
}

function NewSessionSheet({
  groups, onClose, onCreate,
}: {
  groups: Group[];
  onClose: () => void;
  onCreate: (input: { group_id: string | null; held_on: string; title: string | null }) => void;
}) {
  const [group, setGroup] = useState(groups[0]?.id ?? "");
  const [day, setDay] = useState(todayISO());
  const [title, setTitle] = useState("");

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>حصة أعمال تطبيقية</h3>
          <button className="icbtn" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="fld">
          <label className="elab" htmlFor="ns-group">الفوج</label>
          <select id="ns-group" value={group} onChange={(e) => setGroup(e.target.value)}>
            {groups.map((g, i) => (
              <option key={g.id} value={g.id}>{groupLabel(g, i)}</option>
            ))}
            <option value="">كل القسم</option>
          </select>
        </div>
        <div className="fld">
          <label className="elab" htmlFor="ns-day">التاريخ</label>
          <input id="ns-day" className="inp" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div className="fld">
          <label className="elab" htmlFor="ns-title">عنوان الحصة (اختياري)</label>
          <input
            id="ns-title"
            className="inp"
            value={title}
            maxLength={60}
            placeholder="مثلًا: تشريح زهرة"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <p className="lead">تُنشأ الحصة وتُنقَّط ولو لم تكن هناك شبكة، وتُرسل عند عودتها.</p>
        <button
          className="btn full"
          disabled={!day}
          onClick={() => onCreate({ group_id: group || null, held_on: day, title: cleanSessionTitle(title) })}
        >
          ابدأ التنقيط
        </button>
      </div>
    </>
  );
}

function SessionSheet({
  session, students, groups, marks, online, onClose, onEdit, onDelete, onMark, say,
}: {
  session: TpSession;
  students: StudentInfo[];
  groups: Group[];
  marks: TpMark[];
  online: boolean;
  onClose: () => void;
  onEdit: (id: string, patch: { held_on?: string; title?: string | null }) => void;
  onDelete: (session: TpSession) => void;
  onMark: (sessionId: string, studentId: string, score: number | null, absent: boolean) => void;
  say: (text: string) => void;
}) {
  const [same, setSame] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const byStudent = useMemo(() => new Map(marks.map((m) => [m.student_id, m])), [marks]);

  /** تلاميذ الفوج، وكلّ من له علامة في الحصة ولو انتقل من فوجها: لا تُخفى علامة. */
  const list = useMemo(() => {
    const ids = new Set<string>();
    for (const s of students) {
      if (!session.group_id || s.group_id === session.group_id) ids.add(s.id);
    }
    for (const m of marks) ids.add(m.student_id);
    return students.filter((s) => ids.has(s.id));
  }, [students, session.group_id, marks]);

  const scores = marks.filter((m) => !m.absent && m.score !== null).map((m) => Number(m.score));
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const absentCount = marks.filter((m) => m.absent).length;
  const groupIndex = groups.findIndex((g) => g.id === session.group_id);
  const groupName = groupIndex < 0 ? "كل القسم" : groupLabel(groups[groupIndex], groupIndex);

  function applySame() {
    const parsed = parseMark(same);
    if (parsed === "invalid" || parsed === null) {
      say("اكتب علامة من 0 إلى 20");
      return;
    }
    let n = 0;
    for (const s of list) {
      const mark = byStudent.get(s.id);
      if (mark && (mark.absent || mark.score !== null)) continue;
      onMark(session.id, s.id, parsed, false);
      n++;
    }
    say(n ? `طُبّقت ${parsed} على ${n} تلميذًا` : "كل التلاميذ لهم علامة أو غياب");
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>{sessionLabel(session)}</h3>
          <button className="icbtn" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="totals top">
          <div className="stat"><b className="num">{fmt(mean)}</b><small>معدّل الحصة</small></div>
          <div className="stat"><b className="num">{scores.length}/{list.length}</b><small>نُقِّط</small></div>
          <div className="stat"><b className="num">{absentCount}</b><small>غائب</small></div>
        </div>

        <p className="lead" style={{ marginTop: 10 }}>
          {groupName} · الفصل {session.term}. العلامة من 20، والفراغ يعني «لم يُنقَّط»
          فلا يدخل المعدّل ولا يُحسب صفرًا. و«غ» للغائب.
        </p>

        <div className="fld line">
          <div className="flab"><b>علامة واحدة لمن بلا علامة</b></div>
          <div className="mk">
            <input
              dir="ltr"
              type="text"
              inputMode="decimal"
              value={same}
              onChange={(e) => setSame(e.target.value)}
              aria-label="علامة تُطبَّق على من لم يُنقَّط"
              placeholder="/ 20"
            />
          </div>
          <button className="btn soft" onClick={applySame}>طبّق</button>
        </div>

        <div className="slist">
          {list.map((s) => {
            const mark = byStudent.get(s.id);
            const score = mark && !mark.absent && mark.score !== null ? Number(mark.score) : null;
            const absent = !!mark?.absent;
            return (
              <div key={s.id} className="srow2 tprow">
                <span className="k">{s.full_name}</span>
                <input
                  className="tpin"
                  dir="ltr"
                  type="text"
                  inputMode="decimal"
                  key={`${s.id}-${score ?? ""}-${absent ? "a" : ""}`}
                  defaultValue={score ?? ""}
                  disabled={absent}
                  placeholder={absent ? "غائب" : "—"}
                  aria-label={`علامة ${s.full_name} من 20`}
                  onBlur={(e) => {
                    const parsed = parseMark(e.target.value);
                    if (parsed === "invalid") {
                      e.target.value = score === null ? "" : String(score);
                      return;
                    }
                    if (parsed === score) return;
                    onMark(session.id, s.id, parsed, false);
                  }}
                  onKeyDown={(e) => {
                    // Enter ينتقل إلى التلميذ التالي: اليد لا تترك لوحة المفاتيح.
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const field = e.currentTarget;
                    const inputs = Array.from(
                      field.closest(".slist")?.querySelectorAll("input.tpin:not(:disabled)") ?? [],
                    ) as HTMLInputElement[];
                    const next = inputs[inputs.indexOf(field) + 1];
                    if (next) next.focus();
                    else field.blur();
                  }}
                />
                <button
                  className={absent ? "clearb on" : "clearb"}
                  aria-pressed={absent}
                  aria-label={absent ? `ألغِ غياب ${s.full_name}` : `${s.full_name} غائب`}
                  onClick={() => onMark(session.id, s.id, null, !absent)}
                >
                  غ
                </button>
              </div>
            );
          })}
        </div>

        <div className="fld">
          <label className="elab" htmlFor="ss-day">التاريخ</label>
          <input
            id="ss-day"
            className="inp"
            type="date"
            value={session.held_on}
            onChange={(e) => e.target.value && onEdit(session.id, { held_on: e.target.value })}
          />
        </div>
        <div className="fld">
          <label className="elab" htmlFor="ss-title">العنوان (اختياري)</label>
          <input
            id="ss-title"
            className="inp"
            key={session.title ?? ""}
            defaultValue={session.title ?? ""}
            maxLength={60}
            onBlur={(e) => {
              const next = cleanSessionTitle(e.target.value);
              if (next !== (session.title ?? null)) onEdit(session.id, { title: next });
            }}
          />
        </div>

        {confirmDelete ? (
          <div className="fld">
            <div className="note bad">
              تُحذف الحصة وعلامات {list.length} تلميذًا فيها، ويتغيّر معدّلهم. لا رجوع.
            </div>
            <div className="srow2">
              <button className="btn ghost" onClick={() => setConfirmDelete(false)}>تراجع</button>
              <div className="hspace" />
              <button className="btn danger" disabled={!online} onClick={() => onDelete(session)}>
                احذف الحصة
              </button>
            </div>
          </div>
        ) : (
          <button className="btn warn full" onClick={() => setConfirmDelete(true)}>
            حذف الحصة
          </button>
        )}
        {confirmDelete && !online && (
          <div className="note warn">الحذف يحتاج اتصالًا.</div>
        )}
      </div>
    </>
  );
}

/* ================= الأفواج ================= */

function GroupsPart({
  students, groups, online,
  onCreateGroups, onRedistribute, onAddGroup, onRenameGroup, onDeleteGroup, onMoveStudent,
}: {
  students: StudentInfo[];
  groups: Group[];
  online: boolean;
  onCreateGroups: (count: number, mode: Mode) => Promise<boolean>;
  onRedistribute: (mode: Mode) => Promise<boolean>;
  onAddGroup: () => Promise<void>;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (group: Group) => void;
  onMoveStudent: (studentId: string, groupId: string | null) => void;
}) {
  const [count, setCount] = useState(2);
  const [mode, setMode] = useState<Mode>("list");
  const [busy, setBusy] = useState(false);
  const [redo, setRedo] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { byGroup, ungrouped } = useMemo(() => membership(students, groups), [students, groups]);
  const nameOf = useMemo(() => new Map(students.map((s) => [s.id, s.full_name])), [students]);
  const problem = groupCountProblem(count, students.length);

  const modeChips = (
    <div className="chips" role="group" aria-label="طريقة التوزيع">
      <button aria-pressed={mode === "list"} onClick={() => setMode("list")}>
        حسب القائمة
      </button>
      <button aria-pressed={mode === "random"} onClick={() => setMode("random")}>
        عشوائي
      </button>
    </div>
  );

  if (groups.length === 0) {
    return (
      <div className="card gcard">
        <h3>قسّم القسم إلى أفواج</h3>
        <p className="lead" style={{ margin: 0 }}>
          الأفواج ثابتة طوال السنة. لكل فوج حصصه، ولكل تلميذ علامته فيها. التسمية
          اختيارية، ويمكنك نقل تلميذ بين فوج وآخر بعد التقسيم.
        </p>
        <div className="fld" style={{ borderBottom: 0 }}>
          <div className="flab"><b>عدد الأفواج</b></div>
          <div className="chips" role="group" aria-label="عدد الأفواج">
            {[2, 3, 4, 5, 6].map((n) => (
              <button key={n} aria-pressed={count === n} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="fld" style={{ borderBottom: 0 }}>
          <div className="flab">
            <b>توزيع التلاميذ</b>
            <small>
              {mode === "list" ? "كتل متتالية من قائمة القسم" : "خلط ثم تقسيم"}
            </small>
          </div>
          {modeChips}
        </div>
        {problem && <div className="note warn">{problem}</div>}
        {!online && <div className="note warn">تقسيم القسم يحتاج اتصالًا.</div>}
        <button
          className="btn"
          disabled={busy || !online || problem !== ""}
          onClick={async () => {
            setBusy(true);
            await onCreateGroups(count, mode);
            setBusy(false);
          }}
        >
          {busy ? "لحظة…" : `قسّم إلى ${count} أفواج`}
        </button>
      </div>
    );
  }

  return (
    <>
      {!online && <div className="note warn">إدارة الأفواج تحتاج اتصالًا. الحصص وتنقيطها لا.</div>}

      {groups.map((g, i) => {
        const members = byGroup.get(g.id) ?? [];
        return (
          <div key={g.id} className="card gcard">
            <div className="ghead">
              <input
                className="inp gname"
                key={`${g.id}-${g.name ?? ""}`}
                defaultValue={g.name ?? ""}
                placeholder={`فوج ${i + 1}`}
                maxLength={40}
                aria-label={`اسم الفوج ${i + 1}`}
                disabled={!online}
                onBlur={(e) => {
                  if (cleanGroupName(e.target.value) !== (g.name ?? null)) {
                    onRenameGroup(g.id, e.target.value);
                  }
                }}
              />
              <span className="pill">{members.length} تلميذًا</span>
              <button
                className="clearb"
                disabled={!online}
                onClick={() => setConfirmDelete(confirmDelete === g.id ? null : g.id)}
              >
                حذف
              </button>
            </div>

            {confirmDelete === g.id && (
              <div className="note bad">
                يخرج تلاميذه منه ولا يُحذف أحد، وتبقى حصصه وعلاماتها.
                <div className="pickbar" style={{ marginTop: 8 }}>
                  <button className="btn danger" onClick={() => { setConfirmDelete(null); onDeleteGroup(g); }}>
                    احذف الفوج
                  </button>
                  <button className="btn ghost" onClick={() => setConfirmDelete(null)}>تراجع</button>
                </div>
              </div>
            )}

            {members.length === 0 ? (
              <p className="lead" style={{ margin: 0 }}>لا تلاميذ في هذا الفوج.</p>
            ) : (
              <div className="slist">
                {members.map((id) => (
                  <div key={id} className="srow2">
                    <span className="k">{nameOf.get(id)}</span>
                    <select
                      value={g.id}
                      disabled={!online}
                      aria-label={`فوج ${nameOf.get(id) ?? ""}`}
                      onChange={(e) => onMoveStudent(id, e.target.value === "" ? null : e.target.value)}
                    >
                      {groups.map((x, j) => (
                        <option key={x.id} value={x.id}>{groupLabel(x, j)}</option>
                      ))}
                      <option value="">بلا فوج</option>
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {ungrouped.length > 0 && (
        <div className="card gcard">
          <div className="ghead">
            <h3 style={{ flex: 1 }}>بلا فوج</h3>
            <span className="pill warn">{ungrouped.length}</span>
          </div>
          <p className="lead" style={{ margin: 0 }}>
            هؤلاء لن يظهروا في حصة فوج. اختر فوجًا لكل منهم.
          </p>
          <div className="slist">
            {ungrouped.map((id) => (
              <div key={id} className="srow2">
                <span className="k">{nameOf.get(id)}</span>
                <select
                  value=""
                  disabled={!online}
                  aria-label={`ضع ${nameOf.get(id) ?? ""} في فوج`}
                  onChange={(e) => e.target.value && onMoveStudent(id, e.target.value)}
                >
                  <option value="">اختر فوجًا</option>
                  {groups.map((x, j) => (
                    <option key={x.id} value={x.id}>{groupLabel(x, j)}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pickbar">
        <button
          className="btn soft"
          disabled={!online || busy || groups.length >= MAX_GROUPS}
          onClick={async () => {
            setBusy(true);
            await onAddGroup();
            setBusy(false);
          }}
        >
          + فوج
        </button>
        <button className="btn ghost" disabled={!online || busy || groups.length < 2} onClick={() => setRedo(!redo)}>
          أعد التوزيع
        </button>
      </div>

      {redo && (
        <div className="card gcard">
          <div className="note warn">
            يُوزَّع كل التلاميذ من جديد على الأفواج الحالية، ويُمحى ما نقلتَه يدويًا.
            حصصك وعلاماتها لا تتأثر: مفتاحها التلميذ لا الفوج.
          </div>
          {modeChips}
          <div className="pickbar">
            <button
              className="btn"
              disabled={busy || !online}
              onClick={async () => {
                setBusy(true);
                await onRedistribute(mode);
                setBusy(false);
                setRedo(false);
              }}
            >
              {busy ? "لحظة…" : "أعد التوزيع"}
            </button>
            <button className="btn ghost" onClick={() => setRedo(false)}>تراجع</button>
          </div>
        </div>
      )}
    </>
  );
}

/* ================= الربط ================= */

function LinkPart({
  current, target, criteria, components, online, onTarget,
}: {
  current: TpTarget;
  target: { ok: boolean; label: string };
  criteria: Criterion[];
  components: Component[];
  online: boolean;
  onTarget: (target: TpTarget) => void;
}) {
  const tp = components.find((c) => c.code === "tp");
  const eligible = criteria.filter(canTargetCriterion);
  const currentCode = targetCriterionCode(current);

  return (
    <>
      <div className={target.ok ? "note" : "note warn"}>
        {current
          ? `مربوطة الآن بـ: ${target.label}`
          : "لم تربط نقطة الأعمال التطبيقية بعد. اختر أين تذهب نقطة هذا القسم."}
      </div>

      {!online && <div className="note warn">تغيير الربط يحتاج اتصالًا.</div>}

      <div className="card gcard">
        <h3>مركّبة الأعمال التطبيقية</h3>
        {tp && tp.active ? (
          <>
            <p className="lead" style={{ margin: 0 }}>
              معدّل حصص التلميذ يصير نقطة «{tp.label}» مباشرة، بمعاملها في معدّل المادة.
            </p>
            <button
              className={current === TP_COMPONENT ? "btn" : "btn soft"}
              disabled={!online}
              onClick={() => onTarget(TP_COMPONENT)}
            >
              {current === TP_COMPONENT ? "✓ مربوطة" : `اربط بـ«${tp.label}»`}
            </button>
          </>
        ) : (
          <p className="lead" style={{ margin: 0 }}>
            مركّبة الأعمال التطبيقية مطفأة في الإعدادات، فلا تدخل معدّل المادة. إن
            كانت عندك فعّلها من الإعدادات، وإلا أضف النقطة إلى معيار أدناه.
          </p>
        )}
      </div>

      <div className="card gcard">
        <h3>أو أضفها إلى معيار من التقويم المستمر</h3>
        {eligible.length === 0 ? (
          <p className="lead" style={{ margin: 0 }}>
            لا معيار إضافة عندك. أضف معيارًا من الإعدادات (نقطة انطلاقه صفر)
            وسمِّه مثلًا «الأعمال التطبيقية».
          </p>
        ) : (
          <>
            <p className="lead" style={{ margin: 0 }}>
              يُحوَّل المعدّل من 20 إلى سقف المعيار، فمعدّل 16 في معيار سقفه 4 يصير 3.2.
              تصلح معايير الإضافة وحدها (المشاركة، الواجبات…) لا معيار الخصم.
            </p>
            <div className="chips" role="group" aria-label="المعيار">
              {eligible.map((c) => (
                <button
                  key={c.id}
                  aria-pressed={currentCode === c.code}
                  disabled={!online}
                  onClick={() => onTarget(criterionTarget(c.code))}
                >
                  {c.label} · {c.ceiling}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {current && (
        <button className="btn ghost" disabled={!online} onClick={() => onTarget(null)}>
          فكّ الربط
        </button>
      )}

      <div className="note">
        المعدّل يُحسب من الحصص ولا يُخزَّن، فتعديل علامة في حصة يغيّره فورًا. ومن لم
        يُنقَّط في أي حصة تبقى علامته اليدوية في الخانة كما هي. وتغيير الربط لا يمسّ
        علامة سبق أن كتبتها.
      </div>
    </>
  );
}
