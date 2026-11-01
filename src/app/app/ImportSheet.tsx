"use client";

import { normalizeName } from "@/lib/names";
import {
  cleanPastedText,
  gridToCsv,
  MAX_AI_SHEETS,
  parseSheetGrid,
  sheetIsEmpty,
  sheetLabel,
  type Grid,
} from "@/lib/rosterParse";
import { countWord } from "@/lib/outbox";
import { useRef, useState } from "react";
import { CreateResult, School } from "./types";

/** الملف كما هو، حين يعجز المتصفّح عن فكّ ترميز الصورة (HEIC من آيفون مثلًا). */
function fileAsBase64(file: File): Promise<{ data: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      resolve({ data: url.slice(url.indexOf(",") + 1), mime: file.type || "image/jpeg" });
    };
    reader.readAsDataURL(file);
  });
}

/** يصغّر الصورة قبل إرسالها: صورة الهاتف 4 ميغا تُبطئ الرفع ولا تزيد دقّة. */
async function shrinkImage(file: File): Promise<{ data: string; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const long = Math.max(bitmap.width, bitmap.height);
  const scale = long > 1600 ? 1600 / long : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { data: url.slice(url.indexOf(",") + 1), mime: "image/jpeg" };
}

/** CSV عربي قد يكون UTF-8 أو windows-1256 (Excel القديم): يُجرَّب الأول ثم الثاني. */
async function decodeCsv(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  return utf8.includes("�") ? new TextDecoder("windows-1256").decode(bytes) : utf8;
}

/** ورقة القسم صفحتان على الأكثر، وهو ما يقبله الخادم أيضًا. */
const MAX_SHOTS = 2;

/** من أين جاءت الأسماء: يعرفه الأستاذ ليعرف أين يدقّق. */
type How = "ministry" | "header" | "column" | "ai" | "typed";
const HOW: Record<How, string> = {
  ministry: "من ملف الإشراف",
  header: "من أعمدة الملف",
  column: "من الملف",
  ai: "قراءة الذكاء الاصطناعي — راجعها",
  typed: "مكتوب",
};

type Draft = {
  id: number;
  name: string;
  /** الأسماء نصًّا، سطر لكل تلميذ: تبقى قابلة للتصحيح باليد قبل الإنشاء. */
  text: string;
  include: boolean;
  open: boolean;
  how: How;
  /** الورقة أو الصورة التي جاء منها، تُعرض حين يتعدّد ما في الملف. */
  origin: string;
  status: "idle" | "busy" | "done";
  /** سبب الفشل أو النقص، بالأحمر في البطاقة نفسها. */
  error: string;
  errorField: "name" | "names" | "";
};

type Msg = { kind: "ok" | "warn" | "bad"; text: string } | null;

type AiSheet = { sheet: string; cls: string; names: string[] };

/**
 * استيراد أقسام: يختار الأستاذ مصدر الأسماء (كاميرا، معرض، ملف Excel، أو كتابة)
 * فتظهر بطاقة لكل قسم وُجد، يراجعها ويصحّح ثم ينشئها كلها معًا.
 *
 * القاعدة في قراءة الملفات: الشفرة أولًا (مجانية، ولا تغادر الأسماء الهاتف)،
 * وما عجزت عنه ورقةٌ بعينها يُرسل نصًّا إلى Gemini. الصور تذهب إلى Gemini
 * مباشرة. وفي النهاية الأسماء نصّ قابل للتعديل: لا تُحفظ قراءة خاطئة.
 */
export function ImportSheet({
  onClose, onCreate, onFinish, schools, defaultSchool, onAddSchool, online, existingNames,
}: {
  onClose: () => void;
  onCreate: (name: string, names: string[], schoolId: string) => Promise<CreateResult>;
  /** بعد دفعة إنشاء: يحمّل ويفتح أول قسم، ويغلق الورقة إن نجح كل شيء. */
  onFinish: (firstId: string | null, made: number, students: number, allDone: boolean) => Promise<void>;
  schools: School[];
  /** مؤسسة آخر قسم استُورد: الأستاذ يستورد أقسام ثانوية في جلسة واحدة. */
  defaultSchool: string | null;
  onAddSchool: (name: string) => Promise<School | null>;
  online: boolean;
  /** أسماء أقسامه الحالية، ليُنبَّه إلى قسم موجود بالاسم نفسه. */
  existingNames: string[];
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const nextId = useRef(1);
  const [schoolId, setSchoolId] = useState<string>(defaultSchool ?? schools[0]?.id ?? "");
  const [newSchool, setNewSchool] = useState("");
  /** حقل المؤسسة الجديدة مفتوح، ولو كان للأستاذ مؤسسات. */
  const [adding, setAdding] = useState(schools.length === 0);
  const [schoolError, setSchoolError] = useState(false);
  /** نتيجة القراءة، ملاصقة لأزرار المصادر التي ضُغطت. */
  const [readMsg, setReadMsg] = useState<Msg>(null);
  /** خطأ التحقق والإنشاء، ملاصق لزرّ الإنشاء. */
  const [problem, setProblem] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  /** صور الورقة: صفحة أو صفحتان، تُقرآن معًا. */
  const [shots, setShots] = useState<Array<{ url: string; data: string; mime: string }>>([]);

  const known = new Set(existingNames.map(normalizeName));
  const hasDrafts = drafts.length > 0;

  function makeDraft(init: Partial<Draft> & { how: How }): Draft {
    return {
      id: nextId.current++,
      name: "",
      text: "",
      include: true,
      open: init.how === "ai" || init.how === "typed" || init.how === "column",
      origin: "",
      status: "idle",
      error: "",
      errorField: "",
      ...init,
    };
  }

  function patch(id: number, change: Partial<Draft>) {
    setDrafts((before) => before.map((d) => (d.id === id ? { ...d, ...change } : d)));
  }

  /* ---------- المصادر ---------- */

  /** تُضاف الصور إلى ما اختير، حتى صفحتين: ورقة القسم قد تكون صفحتين. */
  async function addShots(files: File[]) {
    const room = MAX_SHOTS - shots.length;
    if (room <= 0) {
      setReadMsg({ kind: "warn", text: "صفحتان على الأكثر. احذف واحدة لتضيف غيرها." });
      return;
    }
    const taken = files.slice(0, room);
    const ready = await Promise.all(
      taken.map(async (file) => {
        const { data, mime } = await shrinkImage(file).catch(() => fileAsBase64(file));
        return { url: `data:${mime};base64,${data}`, data, mime };
      }),
    );
    setShots((before) => [...before, ...ready]);
    setReadMsg(
      files.length > room ? { kind: "warn", text: "صفحتان على الأكثر: أخذتُ الأولى." } : null,
    );
  }

  /** الصفحتان تُقرآن في طلب واحد: النموذج يرى القائمة كاملة فلا يكرّر ولا يقطع. */
  async function readShots() {
    if (!shots.length) return;
    setReading(true);
    setReadMsg({ kind: "ok", text: "جارٍ قراءة الصور…" });
    try {
      const response = await fetch("/api/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: shots.map((shot) => ({ data: shot.data, mime: shot.mime })),
        }),
      });
      const payload = (await response.json()) as {
        cls?: string;
        names?: string[];
        error?: string;
      };
      if (!response.ok) {
        setReadMsg({ kind: "bad", text: payload.error ?? "تعذّرت قراءة الصور. أعد المحاولة أو اكتب الأسماء." });
        return;
      }
      const found = payload.names ?? [];
      if (!found.length) {
        setReadMsg({ kind: "bad", text: "لم أجد أسماء في الصورة. صوّر الورقة كاملة وواضحة، أو اكتب الأسماء." });
        return;
      }
      setDrafts((before) => [
        ...before,
        makeDraft({ how: "ai", name: payload.cls ?? "", text: found.join("\n"), origin: "صورة" }),
      ]);
      setShots([]);
      setReadMsg({ kind: "ok", text: `قرأتُ ${found.length} اسمًا — راجعها قبل الإنشاء.` });
    } catch {
      setReadMsg({ kind: "bad", text: "تعذّرت قراءة الصور. تحقّق من الشبكة وأعد المحاولة، أو اكتب الأسماء." });
    } finally {
      setReading(false);
    }
  }

  /** أوراق عجزت عنها الشفرة: تُرسل نصًّا إلى الخادم ليقرأها Gemini. */
  async function askAi(
    sheets: Array<{ name: string; csv: string }>,
  ): Promise<{ ok: true; sheets: AiSheet[] } | { ok: false; error: string }> {
    try {
      const response = await fetch("/api/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheets }),
      });
      const payload = (await response.json()) as { sheets?: AiSheet[]; error?: string };
      if (!response.ok) return { ok: false, error: payload.error ?? "تعذّرت القراءة." };
      return { ok: true, sheets: payload.sheets ?? [] };
    } catch {
      return { ok: false, error: "تعذّر الوصول إلى الخدمة. تحقّق من الشبكة." };
    }
  }

  async function readWorkbook(file: File) {
    setReading(true);
    setReadMsg({ kind: "ok", text: "جارٍ قراءة الملف…" });
    try {
      const XLSX = await import("xlsx");
      const book = /\.csv$/i.test(file.name)
        ? XLSX.read(await decodeCsv(file), { type: "string" })
        : XLSX.read(await file.arrayBuffer(), { type: "array" });

      const local: Draft[] = [];
      const hard: Array<{ name: string; csv: string }> = [];
      const unread: string[] = [];
      const many = book.SheetNames.length > 1;
      for (const sheetName of book.SheetNames) {
        const grid = XLSX.utils.sheet_to_json(book.Sheets[sheetName], {
          header: 1,
          raw: false,
          defval: null,
        }) as unknown as Grid;
        if (sheetIsEmpty(grid)) continue;
        const found = parseSheetGrid(grid, sheetName);
        if (found) {
          local.push(
            makeDraft({
              how: found.how,
              name: found.cls,
              text: found.names.join("\n"),
              origin: many ? sheetName : "",
            }),
          );
        } else if (hard.length < MAX_AI_SHEETS) {
          hard.push({ name: sheetName, csv: gridToCsv(grid) });
        } else {
          unread.push(sheetName);
        }
      }

      if (local.length) setDrafts((before) => [...before, ...local]);

      let fromAi = 0;
      let aiError = "";
      if (hard.length) {
        setReadMsg({
          kind: "ok",
          text: local.length
            ? `قرأتُ ${local.length} من الملف مباشرة، وأقرأ ${hard.length} بالذكاء الاصطناعي…`
            : `أقرأ ${hard.length} ورقة بالذكاء الاصطناعي…`,
        });
        const result = await askAi(hard);
        if (result.ok) {
          const fresh: Draft[] = [];
          for (const item of hard) {
            const back = result.sheets.find((r) => r.sheet === item.name);
            if (back && back.names.length) {
              fresh.push(
                makeDraft({
                  how: "ai",
                  name: back.cls || sheetLabel(item.name),
                  text: back.names.join("\n"),
                  origin: many ? item.name : "",
                }),
              );
            } else {
              unread.push(item.name);
            }
          }
          fromAi = fresh.length;
          if (fresh.length) setDrafts((before) => [...before, ...fresh]);
        } else {
          aiError = result.error;
          unread.push(...hard.map((h) => h.name));
        }
      }

      const total = local.length + fromAi;
      if (!total) {
        setReadMsg({
          kind: "bad",
          text: aiError
            ? `لم أجد قوائم أسماء في الملف. ${aiError} اكتب الأسماء أو جرّب ملفًا آخر.`
            : "لم أجد قوائم أسماء في الملف. اكتب الأسماء أو جرّب ملفًا آخر.",
        });
        return;
      }
      const parts = [`وجدتُ ${total} ${total === 1 ? "قسمًا" : total === 2 ? "قسمين" : "أقسام"}`];
      if (fromAi) parts.push(`${fromAi} منها بالذكاء الاصطناعي، فراجعها`);
      let text = parts.join(": ");
      if (unread.length) {
        text += `. لم أجد أسماء في: ${unread.join("، ")}${aiError ? ` (${aiError})` : ""}`;
      }
      setReadMsg({ kind: unread.length ? "warn" : "ok", text: `${text}.` });
    } catch {
      setReadMsg({ kind: "bad", text: "الملف غير مقروء. تأكد أنه Excel (xlsx) أو CSV، أو اكتب الأسماء." });
    } finally {
      setReading(false);
    }
  }

  function startTyping() {
    const draft = makeDraft({ how: "typed" });
    setDrafts((before) => [...before, draft]);
    setReadMsg(null);
    // تنزل الشاشة إلى خانة الأسماء الجديدة فيكتب الأستاذ فورًا
    window.setTimeout(() => document.getElementById(`draft-names-${draft.id}`)?.focus(), 60);
  }

  /* ---------- الإنشاء ---------- */

  function chosenDrafts() {
    return drafts.filter((d) => d.include && d.status !== "done");
  }

  function failAt(elementId: string, text: string) {
    setProblem(text);
    // بعد أن ترسم React ما فتحه الخطأ (خانة أسماء مطويّة تُفتح مثلًا)
    window.setTimeout(() => {
      const el = document.getElementById(elementId);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        el.focus({ preventScroll: true });
      }
    }, 60);
  }

  async function createAll() {
    const chosen = chosenDrafts();
    if (!chosen.length) {
      setProblem(drafts.some((d) => d.status === "done") ? "" : "اختر قسمًا واحدًا على الأقل.");
      return;
    }

    // التحقق كله قبل أن يُنشأ شيء: كل بطاقة ناقصة تحمل سببها بالأحمر.
    const issues = new Map<number, Pick<Draft, "error" | "errorField">>();
    const seenNames = new Set<string>();
    for (const d of chosen) {
      const key = normalizeName(d.name);
      if (!d.name.trim()) {
        issues.set(d.id, { error: "اكتب اسم القسم.", errorField: "name" });
      } else if (seenNames.has(key)) {
        issues.set(d.id, { error: "اسم القسم مكرّر في هذه القائمة. غيّره ليتميّز.", errorField: "name" });
      } else if (!cleanPastedText(d.text).names.length) {
        issues.set(d.id, { error: "لا أسماء في هذا القسم. اكتبها أو ألغ اختيار القسم.", errorField: "names" });
      }
      seenNames.add(key);
    }
    if (issues.size || !schoolId) {
      setDrafts((before) =>
        before.map((d) => {
          const issue = issues.get(d.id);
          return issue ? { ...d, ...issue, open: issue.errorField === "names" ? true : d.open } : d;
        }),
      );
      setSchoolError(!schoolId);
      const first = chosen.find((d) => issues.has(d.id));
      if (first) {
        const field = issues.get(first.id)?.errorField === "names" ? "names" : "name";
        failAt(`draft-${field}-${first.id}`, "بعض الأقسام تحتاج إصلاحًا قبل الإنشاء، وسببه بالأحمر في بطاقته.");
      } else {
        failAt("import-school", "اختر مؤسسة القسم أو أضفها.");
      }
      return;
    }

    setProblem("");
    setSchoolError(false);
    setBusy(true);
    let firstId: string | null = null;
    let made = 0;
    let students = 0;
    let failedFirst: number | null = null;
    for (const d of chosen) {
      patch(d.id, { status: "busy", error: "", errorField: "" });
      const names = cleanPastedText(d.text).names;
      const result = await onCreate(d.name.trim(), names, schoolId);
      if (result.ok) {
        patch(d.id, { status: "done" });
        firstId ??= result.id;
        made++;
        students += result.students;
      } else {
        patch(d.id, { status: "idle", error: result.error, errorField: "" });
        failedFirst ??= d.id;
      }
    }
    const failed = failedFirst !== null;
    if (made > 0) {
      // تحمّل الأقسام التي نجحت ولو فشل غيرها؛ وإن نجح الكل تُغلق الورقة.
      await onFinish(firstId, made, students, !failed);
    }
    if (failed) {
      setBusy(false);
      failAt(
        `draft-card-${failedFirst}`,
        made > 0
          ? "أُنشئ بعض الأقسام وتعذّر بعضها. سبب كل فشل بالأحمر في بطاقته — اضغط الزرّ مرة أخرى لإعادة المحاولة."
          : "تعذّر الإنشاء. سببه بالأحمر في البطاقة — اضغط الزرّ مرة أخرى لإعادة المحاولة.",
      );
    }
  }

  const chosen = chosenDrafts();
  const total = chosen.reduce((sum, d) => sum + cleanPastedText(d.text).names.length, 0);
  const createLabel = busy
    ? "جارٍ الإنشاء…"
    : chosen.length === 0
      ? "لا قسم مختار"
      : `${chosen.length === 1 ? "أنشئ القسم" : chosen.length === 2 ? "أنشئ القسمين" : `أنشئ ${chosen.length} أقسام`} (${total} تلميذًا)`;

  const sourceTiles = (
    <div className="srcgrid">
      {shots.length < MAX_SHOTS && (
        <label className={hasDrafts || shots.length ? "shot small" : "shot"}>
          <input
            id="import-camera"
            type="file"
            accept="image/*"
            capture="environment"
            disabled={reading || busy}
            onChange={(e) => {
              const files: File[] = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (files.length) void addShots(files);
            }}
          />
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8h3.5L8 6h8l1.5 2H21v11H3z" />
            <circle cx="12" cy="13.5" r="3.5" />
          </svg>
          <b>الكاميرا</b>
          {!hasDrafts && !shots.length && <small>صوّر الورقة الآن</small>}
        </label>
      )}
      {shots.length < MAX_SHOTS && (
        <label className={hasDrafts || shots.length ? "shot small" : "shot"}>
          <input
            id="import-photo"
            type="file"
            accept="image/*"
            multiple
            disabled={reading || busy}
            onChange={(e) => {
              const files: File[] = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (files.length) void addShots(files);
            }}
          />
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="M21 16l-5-5-8 8" />
          </svg>
          <b>المعرض</b>
          {!hasDrafts && !shots.length && <small>اختر من صورك</small>}
        </label>
      )}
      <label className={hasDrafts || shots.length ? "shot small" : "shot"}>
        <input
          id="import-file"
          type="file"
          accept=".xlsx,.xls,.csv"
          disabled={reading || busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void readWorkbook(file);
          }}
        />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v4h4M9 12l5 6M14 12l-5 6" />
        </svg>
        <b>ملف Excel</b>
        {!hasDrafts && !shots.length && <small>أقسام عدة في ملف واحد</small>}
      </label>
      <button
        type="button"
        className={hasDrafts || shots.length ? "shot small" : "shot"}
        disabled={reading || busy}
        onClick={startTyping}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20h4L19 9l-4-4L4 16z" />
          <path d="M13.5 6.5l4 4" />
        </svg>
        <b>اكتبها بيدك</b>
        {!hasDrafts && !shots.length && <small>اكتب أو الصق الأسماء</small>}
      </button>
    </div>
  );

  return (
    <>
      {/* بعد أن تظهر أقسام للمراجعة لا يغلق الضغط خارج الورقة شيئًا: لمسة عابرة لا تضيّع ما راجعه الأستاذ */}
      <div className="scrim" onClick={hasDrafts || busy ? undefined : onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>قسم جديد</h3>
          <button className="icbtn" onClick={onClose} disabled={busy} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {!online && (
          <div className="note bad" role="alert" style={{ marginTop: 10 }}>
            لا اتصال بالإنترنت. قراءة الصور وإنشاء الأقسام تحتاجان الشبكة، وتبقى الأسماء هنا حتى يعود.
          </div>
        )}

        <div className="fld">
          <div className="flab">
            <b>{hasDrafts ? "أضف قسمًا آخر" : "من أين تأتي الأسماء؟"}</b>
            {!hasDrafts && <small>ورقة القسم مطبوعة أو بخطّ اليد، أو ملف فيه عدة أقسام</small>}
          </div>

          {shots.length > 0 && (
            <>
              <div className="shotrow">
                {shots.map((shot, index) => (
                  <div key={shot.url} className="thumb">
                    {/* صورة محلّية لم تُرفع بعد: next/image لا يعالج data: */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot.url} alt={`صفحة ${index + 1}`} />
                    <button
                      className="icbtn danger"
                      aria-label={`احذف صفحة ${index + 1}`}
                      onClick={() => setShots((before) => before.filter((_, i) => i !== index))}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="btn full"
                style={{ marginBottom: 10 }}
                disabled={reading || !online}
                onClick={() => void readShots()}
              >
                {reading
                  ? "جارٍ القراءة…"
                  : `اقرأ الأسماء من ${countWord(shots.length, "الصورة", "الصورتين", "الصور", "الصور")}`}
              </button>
              {shots.length < MAX_SHOTS && <small className="note" style={{ display: "block", marginBottom: 8 }}>الورقة صفحتان؟ أضف الثانية قبل القراءة.</small>}
            </>
          )}

          {sourceTiles}

          {readMsg && (
            <div
              className={`note ${readMsg.kind === "ok" ? "ok" : readMsg.kind}`}
              role={readMsg.kind === "bad" ? "alert" : "status"}
              style={{ marginTop: 10 }}
            >
              {readMsg.text}
            </div>
          )}
        </div>

        {hasDrafts && (
          <div className="fld">
            <div className="flab">
              <b>الأقسام</b>
              <small>راجع كل قسم قبل الإنشاء · ألغِ علامة ما لا تريده</small>
            </div>
            {drafts.map((d) => {
              const parsed = cleanPastedText(d.text);
              const key = normalizeName(d.name);
              const sameAsExisting = !!key && known.has(key);
              const sameAsEarlier = !!key && drafts.some((o) => o.id < d.id && o.include && normalizeName(o.name) === key);
              return (
                <div key={d.id} id={`draft-card-${d.id}`} className={`dcard${d.status === "done" ? " done" : d.error ? " error" : ""}`}>
                  <div className="dtop">
                    <input
                      type="checkbox"
                      checked={d.include}
                      disabled={d.status === "done" || busy}
                      onChange={(e) => patch(d.id, { include: e.target.checked })}
                      aria-label="أنشئ هذا القسم"
                    />
                    <input
                      id={`draft-name-${d.id}`}
                      className="inp"
                      value={d.name}
                      disabled={d.status === "done" || busy}
                      aria-invalid={d.errorField === "name"}
                      placeholder="اسم القسم، مثال: أولى علوم 3"
                      onChange={(e) => {
                        patch(d.id, { name: e.target.value, error: "", errorField: "" });
                        setProblem("");
                      }}
                    />
                    {d.status !== "done" && (
                      <button
                        className="icbtn danger"
                        disabled={busy}
                        aria-label="احذف هذا القسم من القائمة"
                        onClick={() => setDrafts((before) => before.filter((o) => o.id !== d.id))}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    )}
                  </div>

                  <div className="dmeta">
                    <span className={`dbadge${d.how === "ai" ? " warn" : ""}`}>{HOW[d.how as How]}</span>
                    {d.origin && <span>{d.origin}</span>}
                    <b>{parsed.names.length} تلميذًا</b>
                    {d.status === "done" ? (
                      <span className="dok">✓ أُنشئ</span>
                    ) : d.status === "busy" ? (
                      <span>جارٍ الإنشاء…</span>
                    ) : (
                      <button className="clearb" onClick={() => patch(d.id, { open: !d.open })}>
                        {d.open ? "أخفِ الأسماء" : "راجع الأسماء"}
                      </button>
                    )}
                  </div>

                  {d.status !== "done" && (sameAsExisting || sameAsEarlier || parsed.repeated.length > 0) && (
                    <div className="dwarn">
                      {sameAsExisting && <div>عندك قسم بهذا الاسم من قبل: غيّر الاسم إن كان قسمًا آخر.</div>}
                      {sameAsEarlier && <div>اسم هذا القسم يطابق قسمًا آخر في القائمة.</div>}
                      {parsed.repeated.length > 0 && (
                        <div>اسم مكرّر داخل القسم: {parsed.repeated.slice(0, 2).join("، ")}{parsed.repeated.length > 2 ? "…" : ""} — تأكد أنهما تلميذان.</div>
                      )}
                    </div>
                  )}

                  {d.open && d.status !== "done" && (
                    <textarea
                      id={`draft-names-${d.id}`}
                      className="inp"
                      style={{ minHeight: 130 }}
                      value={d.text}
                      disabled={busy}
                      aria-invalid={d.errorField === "names"}
                      placeholder={"اللقب الاسم\nاللقب الاسم\n…"}
                      onChange={(e) => {
                        patch(d.id, { text: e.target.value, error: "", errorField: "" });
                        setProblem("");
                      }}
                      onBlur={() => {
                        // ما يراه الأستاذ هو ما يُنشأ: الترقيم والتواريخ تُقصّ من الخانة نفسها
                        const clean = cleanPastedText(d.text);
                        if (clean.names.join("\n") !== d.text.trim() && clean.names.length) {
                          patch(d.id, { text: clean.names.join("\n") });
                        }
                      }}
                    />
                  )}

                  {d.error && (
                    <div className="ferr" role="alert">{d.error}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* المؤسسة تُسأل هنا لا بعد الاستيراد: رأس الكشف يأخذها، ونقل قسم
            بعد تنقيطه أصعب من اختياره مرة. وهي واحدة لكل أقسام الدفعة. */}
        {hasDrafts && (
          <div className="fld">
            <div className="flab">
              <b>المؤسسة</b>
              <small>لازمة — تظهر في رأس كشف {drafts.length > 1 ? "هذه الأقسام" : "هذا القسم"}</small>
            </div>
            {schools.length > 0 && !adding && (
              <div className="pickbar">
                <select
                  id="import-school"
                  style={{ flex: 1, minWidth: 0 }}
                  value={schoolId}
                  disabled={busy}
                  onChange={(e) => { setSchoolId(e.target.value); setSchoolError(false); }}
                >
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {/* مؤسسة جديدة دون مغادرة الورقة: الأستاذ يستورد قسم ثانوية
                    لم يُدخلها بعد، فلا يُطرد إلى الإعدادات ثم يعود. */}
                <button className="btn soft" onClick={() => setAdding(true)} aria-label="أضف مؤسسة">
                  + مؤسسة
                </button>
              </div>
            )}
            {(schools.length === 0 || adding) && (
              <div className="pickbar addrow">
                <input
                  id="import-school"
                  className="inp"
                  value={newSchool}
                  aria-invalid={schoolError}
                  onChange={(e) => setNewSchool(e.target.value)}
                  placeholder="اسم الثانوية"
                />
                <button
                  className="btn soft"
                  disabled={!newSchool.trim()}
                  onClick={async () => {
                    const created = await onAddSchool(newSchool.trim());
                    if (created) {
                      setSchoolId(created.id);
                      setSchoolError(false);
                      setNewSchool("");
                      setAdding(false);
                    }
                  }}
                >
                  أضفها
                </button>
                {schools.length > 0 && (
                  <button className="clearb" onClick={() => setAdding(false)}>تراجع</button>
                )}
              </div>
            )}
            {schoolError && <div className="ferr" role="alert" style={{ marginTop: 6 }}>اختر مؤسسة أو أضف واحدة.</div>}
          </div>
        )}

        {hasDrafts && (
          <>
            {problem && (
              <div id="import-problem" className="note bad" role="alert" style={{ marginTop: 10 }}>
                {problem}
              </div>
            )}
            <button
              className="btn"
              style={{ marginTop: 14 }}
              disabled={busy || reading || !online || chosen.length === 0}
              onClick={() => void createAll()}
            >
              {createLabel}
            </button>
          </>
        )}
      </div>
    </>
  );
}
