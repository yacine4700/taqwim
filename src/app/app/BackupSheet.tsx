"use client";

import { useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import {
  applyImport,
  backupCounts,
  backupFileName,
  backupSheets,
  conflictCount,
  currentState,
  parseBackup,
  planImport,
  planSize,
  verifyImport,
  type Backup,
  type ImportOptions,
  type ImportPlan,
} from "@/lib/backup";
import { supabaseDb } from "@/lib/backupDb";
import { groupLabel } from "@/lib/groups";
import { countWord, type Op } from "@/lib/outbox";

type Supabase = ReturnType<typeof createClient>;

/* ---------- التنزيل ---------- */

/** يُنزّل الملف على الجهاز. أعاد true إن بدأ التنزيل (لا يُعرف من المتصفّح أكثر من ذلك). */
export function downloadBlob(name: string, blob: Blob): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    // بعد مهلة: بعض المتصفّحات تقرأ الرابط بعد عودة click
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch {
    return false;
  }
}

export function backupJson(backup: Backup): Blob {
  return new Blob([JSON.stringify(backup, null, 1)], { type: "application/json" });
}

async function backupXlsx(backup: Backup): Promise<Blob> {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  book.Workbook = { Views: [{ RTL: true }] };
  for (const sheet of backupSheets(backup, (g, i) => groupLabel(g, i))) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    ws["!cols"] = sheet.rows[0]?.map((_, i) => ({ wch: i === 1 ? 28 : 12 }));
    XLSX.utils.book_append_sheet(book, ws, sheet.name);
  }
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** مشاركة الملف (بريد، Drive، واتساب…) حيث يدعمها المتصفّح، وهي الأنسب على الهاتف. */
async function shareFile(name: string, blob: Blob): Promise<boolean> {
  try {
    const file = new File([blob], name, { type: blob.type });
    if (!navigator.canShare?.({ files: [file] })) return false;
    await navigator.share({ files: [file], title: name });
    return true;
  } catch {
    return false;
  }
}

export function canShareFiles(): boolean {
  try {
    const probe = new File(["x"], "x.json", { type: "application/json" });
    return typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

/* ---------- الورقة ---------- */

/**
 * «نسختي»: تصدير عمل الأستاذ كله إلى ملف يحمله، واستيراده منه.
 *
 * التصدير يعمل دون شبكة (من نسخة الجهاز، ويُقال ما ينقصها). الاستيراد يحتاج
 * الشبكة، ولا يبدأ وفي الطابور ما لم يُرسل: الكتابة المباشرة لا تتسابق مع
 * الطابور على الصف نفسه. ولا يكتب شيئًا قبل أن يرى الأستاذ ما سيحدث ويوافق.
 */
export function BackupSheet({
  supabase, teacherId, online, queue, makeBackup, onExported, onImported, onReplay, onClose,
}: {
  supabase: Supabase;
  teacherId: string;
  online: boolean;
  queue: Op[];
  /** نسخة الآن: من الخادم إن أمكن، وإلا من الجهاز. */
  makeBackup: () => Promise<Backup | null>;
  /** يُسجَّل ما ضمّه ملفٌّ نُزِّل، لبوّابة الخروج. */
  onExported: (backup: Backup) => void;
  onImported: () => void;
  onReplay: (ops: Op[]) => void;
  onClose: () => void;
}) {
  const [part, setPart] = useState<"export" | "import">("export");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ tone: "" | "warn" | "bad"; text: string } | null>(null);
  const [last, setLast] = useState<Backup | null>(null);

  const [file, setFile] = useState<Backup | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [foreignOk, setForeignOk] = useState(false);
  const [options, setOptions] = useState<ImportOptions>({ replaceSettings: false, replaceMarks: false });
  const [replay, setReplay] = useState(false);
  const [done, setDone] = useState<{ ok: boolean; text: string; problems: string[] } | null>(null);

  const sharing = canShareFiles();

  async function exportAs(kind: "json" | "xlsx", how: "download" | "share") {
    setBusy(kind === "json" ? "نسخة JSON…" : "جدول Excel…");
    setMessage(null);
    try {
      const backup = await makeBackup();
      if (!backup) {
        setMessage({ tone: "bad", text: "لم تُحمَّل بياناتك بعد على هذا الجهاز. انتظر لحظة ثم أعد." });
        return;
      }
      const now = new Date();
      const name = backupFileName(now, kind);
      const blob = kind === "json" ? backupJson(backup) : await backupXlsx(backup);
      const sent = how === "share" ? await shareFile(name, blob) : downloadBlob(name, blob);
      if (!sent) {
        setMessage({ tone: "bad", text: "لم يكتمل الحفظ. جرّب «نزّل» بدل «أرسل»، أو متصفّحًا آخر." });
        return;
      }
      setLast(backup);
      if (kind === "json") onExported(backup);
      setMessage({
        tone: backup.source === "device" ? "warn" : "",
        text:
          backup.source === "device"
            ? "حُفظت النسخة من هذا الجهاز لأن الشبكة غير متاحة. ينقصها المستوى والشعبة والسنة الدراسية لكل قسم، وملاحظات محاولات القراءة. صدّر من جديد حين تعود الشبكة."
            : `حُفظ الملف «${name}». احتفظ به خارج هذا الهاتف أيضًا (بريدك أو Drive).`,
      });
    } catch (problem) {
      setMessage({ tone: "bad", text: problem instanceof Error ? problem.message : "تعذّر التصدير" });
    } finally {
      setBusy("");
    }
  }

  async function pick(input: File) {
    setFile(null);
    setPlan(null);
    setDone(null);
    setMessage(null);
    setForeignOk(false);
    setReplay(false);
    setOptions({ replaceSettings: false, replaceMarks: false });
    setBusy("قراءة الملف…");
    try {
      const parsed = parseBackup(await input.text());
      if (!parsed.ok) {
        setMessage({ tone: "bad", text: parsed.problem });
        return;
      }
      setFile(parsed.backup);
      if (parsed.droppedPending) {
        setMessage({
          tone: "warn",
          text: `${countWord(parsed.droppedPending, "عملية معلّقة", "عمليتان معلّقتان", "عمليات معلّقة", "عملية معلّقة")} في الملف لا يعرفها هذا الإصدار، وستُترك.`,
        });
      }
      if (!online) return;
      // بلا جلسة تُرجع القراءة جداول فارغة بلا خطأ (RLS)، فتبدو كل الصفوف
      // «جديدة». المقارنة لا تكون إلا بحساب الأستاذ نفسه.
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id !== teacherId) {
        setMessage({ tone: "bad", text: "انتهت جلستك. ادخل من جديد ثم أعد اختيار الملف." });
        return;
      }
      setBusy("مقارنة الملف بحسابك…");
      setPlan(await planImport(parsed.backup, await currentState(supabaseDb(supabase), teacherId)));
    } catch (problem) {
      setMessage({ tone: "bad", text: problem instanceof Error ? problem.message : "تعذّرت قراءة حسابك" });
    } finally {
      setBusy("");
    }
  }

  async function run() {
    if (!plan || !file) return;
    setBusy("الكتابة في حسابك…");
    setDone(null);
    try {
      const db = supabaseDb(supabase);
      const result = await applyImport(db, plan, teacherId, options);
      if (!result.ok) {
        setDone({
          ok: false,
          text: `توقّف الاستيراد بعد ${result.written} صفًّا: ${result.problem}. ما كُتب باقٍ، وإعادة الاستيراد بالملف نفسه تُكمل الباقي دون تكرار.`,
          problems: [],
        });
        onImported();
        return;
      }
      setBusy("التحقّق مما كُتب…");
      const check = await verifyImport(db, plan, options);
      const toReplay = replay && !plan.foreign ? plan.pending : [];
      if (toReplay.length) onReplay(toReplay);
      setDone({
        ok: check.ok,
        text: check.ok
          ? `كُتب ${result.written} صفًّا، وقُرئ حسابك بعدها فطابق الملف في ${check.checked} صفًّا بقيمها.${toReplay.length ? ` وأُعيدت ${toReplay.length} عملية معلّقة إلى طابور الإرسال.` : ""}`
          : `كُتب ${result.written} صفًّا، لكن ${check.problems.length} منها لا يطابق الملف بعد القراءة:`,
        problems: check.problems.slice(0, 8),
      });
      onImported();
      setPlan(null);
    } catch (problem) {
      setDone({ ok: false, text: problem instanceof Error ? problem.message : "تعذّر الاستيراد", problems: [] });
    } finally {
      setBusy("");
    }
  }

  const counts = file ? backupCounts(file.data) : null;
  const conflicts = plan ? conflictCount(plan) : null;
  const size = plan ? planSize(plan) : 0;
  const blockedByQueue = queue.length > 0;
  const canRun =
    !!plan && !busy && online && !blockedByQueue && (!plan.foreign || foreignOk) &&
    (size > 0 || options.replaceSettings || options.replaceMarks || (replay && plan.pending.length > 0));

  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onClose} />
      <div className="sheet" role="dialog" aria-label="نسختي">
        <div className="shead">
          <h3>نسختي</h3>
          <button className="icbtn" onClick={onClose} disabled={!!busy} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="segmented" role="group" aria-label="نسختي" style={{ marginTop: 12 }}>
          <button aria-pressed={part === "export"} onClick={() => setPart("export")} disabled={!!busy}>
            تصدير
          </button>
          <button aria-pressed={part === "import"} onClick={() => setPart("import")} disabled={!!busy}>
            استيراد
          </button>
        </div>

        {part === "export" && (
          <>
            <p className="lead" style={{ marginTop: 12 }}>
              ملفٌّ على هاتفك فيه كل عملك: الأقسام والتلاميذ وحالاتهم الخاصة، والأفواج، والمعايير
              والمركّبات، وعلامات الفصول الثلاثة، ومحاولات القراءة، وحصص الأعمال التطبيقية
              وعلاماتها{queue.length ? "، وما لم يصل الخادم بعد" : ""}. لو ضاع حسابك تستعيده منه.
            </p>

            <div className="card">
              <div className="srow2">
                <div className="k">
                  نسخة للاستعادة
                  <small>JSON — تُستورد في هذا التطبيق، في حسابك أو حساب جديد</small>
                </div>
                {sharing && (
                  <button className="btn ghost sm" disabled={!!busy} onClick={() => void exportAs("json", "share")}>
                    أرسل
                  </button>
                )}
                <button className="btn sm" disabled={!!busy} onClick={() => void exportAs("json", "download")}>
                  نزّل
                </button>
              </div>
              <div className="srow2">
                <div className="k">
                  جدول للقراءة
                  <small>Excel — المعدلات لكل قسم وفصل، دون الحالات الخاصة</small>
                </div>
                {sharing && (
                  <button className="btn ghost sm" disabled={!!busy} onClick={() => void exportAs("xlsx", "share")}>
                    أرسل
                  </button>
                )}
                <button className="btn soft sm" disabled={!!busy} onClick={() => void exportAs("xlsx", "download")}>
                  نزّل
                </button>
              </div>
            </div>

            {!online && (
              <div className="note warn" style={{ marginTop: 12 }}>
                لا اتصال: تُؤخذ النسخة من هذا الجهاز. فيها العلامات كلها وما لم يُرسل، وينقصها
                المستوى والشعبة والسنة الدراسية للأقسام وملاحظات محاولات القراءة.
              </div>
            )}
            {last && (
              <div className="note" style={{ marginTop: 12 }}>
                في آخر ملف: {backupCounts(last.data).classes} أقسام، {backupCounts(last.data).students} تلميذًا،
                {" "}{backupCounts(last.data).records} صفّ علامات، {backupCounts(last.data).readings} محاولة قراءة
                {last.pending.length ? `، و${last.pending.length} عملية لم تُرسل` : ""}.
              </div>
            )}
          </>
        )}

        {part === "import" && (
          <>
            <p className="lead" style={{ marginTop: 12 }}>
              اختر ملف «نسختي» (JSON). لا يُكتب شيء قبل أن ترى ما سيحدث وتوافق، ولا يُكتب فوق
              علامة موجودة إلا إن اخترت ذلك.
            </p>
            <input
              id="backup-file"
              className="inp"
              style={{ width: "100%" }}
              type="file"
              accept=".json,application/json"
              disabled={!!busy}
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                if (chosen) void pick(chosen);
                e.target.value = "";
              }}
            />

            {file && counts && (
              <div className="note" style={{ marginTop: 12 }}>
                ملف بتاريخ {file.exported_at.slice(0, 10)}
                {file.source === "device" ? " (من نسخة جهاز)" : ""}: {counts.classes} أقسام،
                {" "}{counts.students} تلميذًا، {counts.records} صفّ علامات، {counts.readings} محاولة قراءة،
                {" "}{counts.sessions} حصة أعمال تطبيقية.
              </div>
            )}

            {file && !online && (
              <div className="note warn" style={{ marginTop: 12 }}>
                الاستيراد يحتاج اتصالًا. الملف سليم؛ أعد اختياره حين تعود الشبكة.
              </div>
            )}

            {plan && (
              <>
                {plan.foreign && (
                  <div className="note warn" style={{ marginTop: 12 }}>
                    هذا الملف من حساب آخر
                    {file?.teacher.email ? (
                      <>
                        {" "}(<bdi dir="ltr">{file.teacher.email}</bdi>)
                      </>
                    ) : null}
                    .
                    ما فيه سيُضاف إلى حسابك أنت، باسمك، ولا يُمسّ ذلك الحساب.
                    <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                      <input type="checkbox" checked={foreignOk} onChange={(e) => setForeignOk(e.target.checked)} />
                      فهمت، أضفه إلى حسابي
                    </label>
                  </div>
                )}

                <div className="card" style={{ marginTop: 12 }}>
                  <div className="srow2">
                    <div className="k">
                      يُضاف إلى حسابك
                      <small>
                        {plan.insert.classes.length} أقسام، {plan.insert.students.length} تلميذًا،
                        {" "}{plan.insert.records.length} صفّ علامات، {plan.insert.readings.length} محاولة،
                        {" "}{plan.insert.tp_sessions.length} حصة، {plan.insert.tp_marks.length} علامة حصة
                      </small>
                    </div>
                    <span className="pill ok">{size}</span>
                  </div>
                  <div className="srow2">
                    <div className="k">
                      موجود من قبل ويُترك
                      <small>بالمعرّف نفسه أو بالقيم نفسها، فلا يتكرّر</small>
                    </div>
                    <span className="pill">
                      {plan.kept.classes + plan.kept.students + plan.kept.records + plan.kept.readings + plan.kept.tp_marks}
                    </span>
                  </div>
                </div>

                {conflicts && conflicts.settings > 0 && (
                  <div className="note warn" style={{ marginTop: 12 }}>
                    {conflicts.settings} من المعايير والمركّبات في حسابك تختلف عن الملف (
                    {[...plan.conflicts.criteria, ...plan.conflicts.components].map((c) => c.label).join("، ")}).
                    تُترك كما هي ما لم تختر غير ذلك. استبدالها يغيّر حساب كل العلامات الحالية.
                    <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                      <input
                        type="checkbox"
                        checked={options.replaceSettings}
                        onChange={(e) => setOptions((o) => ({ ...o, replaceSettings: e.target.checked }))}
                      />
                      استبدلها بإعدادات الملف
                    </label>
                  </div>
                )}

                {conflicts && conflicts.marks > 0 && (
                  <div className="note warn" style={{ marginTop: 12 }}>
                    {conflicts.marks} علامة في حسابك تختلف عن الملف، منها:{" "}
                    {[...plan.conflicts.records, ...plan.conflicts.tp_marks].slice(0, 4).map((c) => c.label).join("، ")}
                    {conflicts.marks > 4 ? "…" : ""}. تُترك علامات حسابك ما لم تختر غير ذلك.
                    <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                      <input
                        type="checkbox"
                        checked={options.replaceMarks}
                        onChange={(e) => setOptions((o) => ({ ...o, replaceMarks: e.target.checked }))}
                      />
                      استبدلها بعلامات الملف
                    </label>
                  </div>
                )}

                {(plan.pending.length > 0 || plan.pendingOrphans > 0) && (
                  <div className="note" style={{ marginTop: 12 }}>
                    في الملف {plan.pending.length + plan.pendingOrphans} عملية لم تصل الخادم يوم صُدِّر.
                    {plan.pendingOrphans > 0 && ` ${plan.pendingOrphans} منها لتلاميذ ليسوا في الملف ولا في حسابك، فتُترك.`}
                    {plan.pending.length > 0 && !plan.foreign && (
                      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                        <input type="checkbox" checked={replay} onChange={(e) => setReplay(e.target.checked)} />
                        أعد إرسال {plan.pending.length} منها (تحلّ محلّ قيم أولئك التلاميذ في الخادم)
                      </label>
                    )}
                    {plan.pending.length > 0 && plan.foreign && " عمليات حساب آخر لا تُعاد في حسابك."}
                  </div>
                )}

                {blockedByQueue && (
                  <div className="note bad" style={{ marginTop: 12 }}>
                    في هذا الجهاز ما لم يُرسل بعد. انتظر وصوله أولًا، حتى لا يتسابق الاستيراد والطابور على
                    العلامة نفسها.
                  </div>
                )}

                {size === 0 && conflicts && conflicts.settings + conflicts.marks === 0 && plan.pending.length === 0 && (
                  <div className="note" style={{ marginTop: 12 }}>
                    كل ما في الملف موجود في حسابك بقيمه. لا شيء يُستورد.
                  </div>
                )}

                <button className="btn" style={{ marginTop: 14, width: "100%" }} disabled={!canRun} onClick={() => void run()}>
                  استورد
                </button>
              </>
            )}

            {done && (
              <div className={done.ok ? "note" : "note bad"} style={{ marginTop: 12 }}>
                {done.text}
                {done.problems.length > 0 && (
                  <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
                    {done.problems.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        {busy && <div className="note" style={{ marginTop: 12 }}>{busy}</div>}
        {message && (
          <div className={message.tone ? `note ${message.tone}` : "note"} style={{ marginTop: 12 }}>
            {message.text}
          </div>
        )}
      </div>
    </>
  );
}
