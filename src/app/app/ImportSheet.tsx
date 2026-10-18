"use client";

import { countWord } from "@/lib/outbox";
import { useState } from "react";
import { School } from "./types";

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

type Source = "photo" | "file" | "paste";

/** ورقة القسم صفحتان على الأكثر، وهو ما يقبله الخادم أيضًا. */
const MAX_SHOTS = 2;

/**
 * استيراد قسم من ثلاثة أبواب: صورة الورقة، أو ملف الإشراف التربوي، أو لصق
 * الأسماء. وكانت الثلاثة مكدّسة في ورقة واحدة طويلة، والأستاذ يستعمل بابًا
 * واحدًا في المرة — فصارت تُختار أولًا ولا يظهر إلا بابها.
 *
 * والأسماء في النهاية نصّ واحد مهما كان مصدرها: ما يُقرأ من صورة أو ملف
 * يبقى قابلًا للتصحيح باليد قبل الإنشاء، فلا تُحفظ قراءة خاطئة.
 */
export function ImportSheet({
  onClose, onCreate, schools, defaultSchool, onAddSchool,
}: {
  onClose: () => void;
  onCreate: (name: string, names: string[], schoolId: string) => void;
  schools: School[];
  /** مؤسسة آخر قسم استُورد: الأستاذ يستورد أقسام ثانوية في جلسة واحدة. */
  defaultSchool: string | null;
  onAddSchool: (name: string) => Promise<School | null>;
}) {
  const [source, setSource] = useState<Source>("photo");
  const [name, setName] = useState("");
  const [schoolId, setSchoolId] = useState<string>(defaultSchool ?? schools[0]?.id ?? "");
  const [newSchool, setNewSchool] = useState("");
  /** حقل المؤسسة الجديدة مفتوح، ولو كان للأستاذ مؤسسات. */
  const [adding, setAdding] = useState(schools.length === 0);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  /** صور الورقة: صفحة أو صفحتان، تُقرآن معًا. */
  const [shots, setShots] = useState<Array<{ url: string; data: string; mime: string }>>([]);

  async function readFile(file: File) {
    setReading(true);
    setStatus("جارٍ قراءة الملف…");
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer, { type: "array" });
      let best: { cls: string; names: string[] } | null = null;
      for (const sheetName of book.SheetNames) {
        const found = parseSupervision(XLSX, book.Sheets[sheetName]);
        if (found && (!best || found.names.length > best.names.length)) best = found;
      }
      if (!best) {
        setStatus("لم أجد قائمة أسماء في الملف.");
        return;
      }
      if (best.cls && !name) setName(best.cls);
      setText(best.names.join("\n"));
      setStatus(`وجدت ${best.names.length} اسمًا${best.cls ? ` للقسم: ${best.cls}` : ""}`);
    } catch {
      setStatus("الملف غير مقروء. جرّب لصق الأسماء.");
    } finally {
      setReading(false);
    }
  }

  /** تُضاف الصور إلى ما اختير، حتى صفحتين: ورقة القسم قد تكون صفحتين. */
  async function addShots(files: File[]) {
    const room = MAX_SHOTS - shots.length;
    if (room <= 0) {
      setStatus(`صفحتان على الأكثر. احذف واحدة لتضيف غيرها.`);
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
    setStatus(
      files.length > room
        ? "صفحتان على الأكثر: أخذتُ الأولى."
        : "",
    );
  }

  /** الصفحتان تُقرآن في طلب واحد: النموذج يرى القائمة كاملة فلا يكرّر ولا يقطع. */
  async function readShots() {
    if (!shots.length) return;
    setReading(true);
    setStatus("جارٍ قراءة الصور…");
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
        setStatus(payload.error ?? "تعذّرت قراءة الصور.");
        return;
      }
      const found = payload.names ?? [];
      if (!found.length) {
        setStatus("لم أجد أسماء. صوّر الورقة كاملة وواضحة.");
        return;
      }
      if (payload.cls && !name) setName(payload.cls);
      setText(found.join("\n"));
      setStatus(`قرأتُ ${found.length} اسمًا — راجعها قبل الإنشاء.`);
    } catch {
      setStatus("تعذّرت قراءة الصور. أعد المحاولة أو الصق الأسماء.");
    } finally {
      setReading(false);
    }
  }

  const names = text.split("\n").map((t) => t.trim()).filter((t) => t.length > 1);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="shead">
          <h3>قسم جديد</h3>
          <button className="icbtn" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="segmented" role="group" aria-label="مصدر الأسماء">
          <button aria-pressed={source === "photo"} onClick={() => setSource("photo")}>
            صورة
          </button>
          <button aria-pressed={source === "file"} onClick={() => setSource("file")}>
            ملف الإشراف
          </button>
          <button aria-pressed={source === "paste"} onClick={() => setSource("paste")}>
            لصق
          </button>
        </div>

        {source === "photo" && (
          <div className="fld">
            <div className="flab">
              <b>ورقة القسم</b>
              <small>مطبوعة أو بخطّ اليد · صفحتان على الأكثر</small>
            </div>

            {shots.length > 0 && (
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
            )}

            {/* زرّان صريحان: capture يفتح الكاميرا مباشرة، وبدونه يفتح المعرض.
                الاعتماد على أن الهاتف يعرض الاختيارين معًا لا يصحّ في كل متصفّح،
                وأقلّها التطبيق المثبّت على أندرويد الذي يفتح المعرض وحده. */}
            {shots.length < MAX_SHOTS && (
              <div className="shotpick">
                <label className={shots.length ? "shot small" : "shot"}>
                  <input
                    id="import-camera"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={reading}
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
                  {!shots.length && <small>صوّر الورقة الآن</small>}
                </label>
                <label className={shots.length ? "shot small" : "shot"}>
                  <input
                    id="import-photo"
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={reading}
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
                  {!shots.length && <small>اختر من صورك</small>}
                </label>
              </div>
            )}

            {shots.length > 0 && (
              <button
                className="btn full"
                style={{ marginTop: 10 }}
                disabled={reading}
                onClick={() => void readShots()}
              >
                {reading
                  ? "جارٍ القراءة…"
                  : `اقرأ الأسماء من ${countWord(shots.length, "الصورة", "الصورتين", "الصور", "الصور")}`}
              </button>
            )}
          </div>
        )}

        {source === "file" && (
          <div className="fld">
            <div className="flab">
              <b>ملف الإشراف التربوي</b>
              <small>xlsx — يُقرأ اسم القسم والأسماء تلقائيًا</small>
            </div>
            <input
              id="import-file"
              className="inp"
              style={{ width: "100%" }}
              type="file"
              accept=".xlsx,.xls"
              disabled={reading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
          </div>
        )}

        {status && <div className="note">{status}</div>}

        <div className="fld">
          <div className="flab">
            <b>{source === "paste" ? "الصق الأسماء" : "الأسماء"}</b>
            <small>سطر لكل تلميذ · {names.length}</small>
          </div>
          <textarea
            id="import-names"
            className="inp"
            style={{ minHeight: source === "paste" ? 150 : 110 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"اللقب الاسم\nاللقب الاسم\n…"}
          />
        </div>

        <div className="fld">
          <div className="flab">
            <b>اسم القسم</b>
          </div>
          <input
            id="import-class"
            className="inp"
            style={{ width: "100%" }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: ثانية ثانوي علوم تجريبية -3-"
          />
        </div>

        {/* المؤسسة تُسأل هنا لا بعد الاستيراد: رأس الكشف يأخذها، ونقل قسم
            بعد تنقيطه أصعب من اختياره مرة. */}
        <div className="fld">
          <div className="flab">
            <b>المؤسسة</b>
            <small>لازمة — تظهر في رأس كشف هذا القسم</small>
          </div>
          {schools.length > 0 && !adding && (
            <div className="pickbar">
              <select
                id="import-school"
                style={{ flex: 1, minWidth: 0 }}
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
              >
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {/* مؤسسة جديدة دون مغادرة الورقة: الأستاذ يستورد قسم ثانوية
                  لم يُدخلها بعد، فلا يُطرد إلى الإعدادات ثم يعود. */}
              <button
                className="btn soft"
                onClick={() => setAdding(true)}
                aria-label="أضف مؤسسة"
              >
                + مؤسسة
              </button>
            </div>
          )}
          {(schools.length === 0 || adding) && (
            <div className="pickbar addrow">
              <input
                id="import-newschool"
                className="inp"
                value={newSchool}
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
        </div>

        <button
          className="btn"
          style={{ marginTop: 14 }}
          disabled={busy || reading}
          onClick={() => {
            if (!name.trim()) return setStatus("اكتب اسم القسم.");
            if (!names.length) return setStatus("لا أسماء بعد: صوّر الورقة أو ارفع الملف أو الصقها.");
            // المؤسسة إلزامية: قسمٌ بلا واحدة يُطبع رأس كشفه ناقصًا.
            if (!schoolId) return setStatus("اختر مؤسسة القسم أو أضفها.");
            setBusy(true);
            onCreate(name.trim(), names, schoolId);
          }}
        >
          {busy ? "جارٍ الإنشاء…" : `أنشئ القسم (${names.length} تلميذًا)`}
        </button>
      </div>
    </>
  );
}

/* ملفات الإشراف التربوي تضع القسم في I2 والأسماء في العمود C ابتداءً من السطر 7 */
function parseSupervision(
  XLSX: typeof import("xlsx"),
  sheet: import("xlsx").WorkSheet,
): { cls: string; names: string[] } | null {
  const grid = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
    header: 1,
    raw: false,
    defval: null,
  });

  let cls = "";
  for (const row of grid.slice(0, 6)) {
    for (const cell of row ?? []) {
      const text = cell == null ? "" : String(cell);
      if (text.includes("القسم") && text.includes(":")) {
        cls = text.split(":").slice(1).join(":").trim();
      }
    }
  }

  let header = -1;
  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    const row = grid[i] ?? [];
    if (row.some((cell) => cell != null && String(cell).trim() === "الرقم")) {
      header = i;
      break;
    }
  }
  if (header < 0) return null;

  const headerRow = grid[header] ?? [];
  let nameColumn = headerRow.findIndex(
    (cell) => cell != null && (String(cell).includes("الاسم") || String(cell).includes("اللقب")),
  );
  if (nameColumn < 0) nameColumn = 2;

  const names: string[] = [];
  for (let i = header + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const name = row[nameColumn] == null ? "" : String(row[nameColumn]).trim();
    const number = row[0];
    if (name && number != null && String(number).trim() !== "" && !Number.isNaN(Number(number))) {
      names.push(name);
    }
  }
  return names.length ? { cls, names } : null;
}
