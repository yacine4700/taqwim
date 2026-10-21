/**
 * تخزين محلي بسيط على IndexedDB: نسخة البيانات الأخيرة وطابور ما لم يُرسل.
 *
 * لماذا IndexedDB لا localStorage: الطابور قد يحمل علامات قسم كامل، وكتابته
 * غير متزامنة فلا توقف الواجهة عند كل ضغطة زرّ.
 *
 * وإن تعذّر الفتح (نافذة خاصة، أو منع تخزين الموقع) نعمل من الذاكرة وحدها:
 * يبقى التطبيق شغّالًا في الحصة، وتضيع المعلّقات بإغلاق الصفحة لا قبله —
 * ولهذا يُنبَّه الأستاذ أن التخزين المحلي غير متاح.
 */

const DB_NAME = "taqwim";
const STORE = "kv";
const DB_VERSION = 1;

/** متاح؟ يُملأ عند أول محاولة فتح. */
let durable: boolean | null = null;
const memory = new Map<string, unknown>();
let opening: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        durable = false;
        return resolve(null);
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        durable = true;
        resolve(request.result);
      };
      request.onerror = () => {
        durable = false;
        resolve(null);
      };
      request.onblocked = () => {
        durable = false;
        resolve(null);
      };
    } catch {
      durable = false;
      resolve(null);
    }
  });
  return opening;
}

/**
 * الحفظ الدائم: بدونه يحقّ للمتصفّح أن يمسح IndexedDB — وفيها الطابور — حين
 * تمتلئ ذاكرة الهاتف. الطلب لا يضمن القبول: كروم يقرّر بنفسه (التثبيت على
 * الشاشة الرئيسية يرجّحه)، وفايرفوكس يسأل المستخدم. والرفض ليس عطلًا:
 * التطبيق يعمل كما كان، ويُقال للأستاذ ما معناه.
 *
 * - "persisted": لا يمسحه المتصفّح إلا بفعل المستخدم.
 * - "best-effort": يُحفظ، لكن قد يُمسح عند ضيق المساحة.
 * - "unsupported": المتصفّح لا يعرف الطلب أصلًا.
 */
export type Persistence = "persisted" | "best-effort" | "unsupported";

export async function ensurePersistence(): Promise<Persistence> {
  try {
    const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
    if (!storage || typeof storage.persist !== "function") return "unsupported";
    if (typeof storage.persisted === "function" && (await storage.persisted())) {
      return "persisted";
    }
    return (await storage.persist()) ? "persisted" : "best-effort";
  } catch {
    return "best-effort";
  }
}

/** هل الحفظ المحلي يصمد بعد إغلاق الصفحة؟ null قبل أول قراءة. */
export function isDurable(): boolean | null {
  return durable;
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(STORE, mode);
          const request = work(tx.objectStore(STORE));
          request.onsuccess = () => resolve(request.result as T);
          request.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          durable = false;
          resolve(null);
        }
      }),
  );
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const stored = await run<T>("readonly", (store) => store.get(key));
  if (stored !== null && stored !== undefined) return stored;
  const fallback = memory.get(key);
  return fallback === undefined ? null : (fallback as T);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  // البنى التي نحفظها بسيطة (مصفوفات وكائنات عادية)، لكن نسخة منفصلة أأمن من
  // تمرير مرجع تمسكه React وقد يتغيّر قبل أن تكتمل الكتابة.
  const copy = JSON.parse(JSON.stringify(value)) as unknown;
  await run("readwrite", (store) => store.put(copy, key));
}

export async function kvDel(key: string): Promise<void> {
  memory.delete(key);
  await run("readwrite", (store) => store.delete(key));
}

export async function kvClear(): Promise<void> {
  memory.clear();
  await run("readwrite", (store) => store.clear());
}

/** المفاتيح التي تبدأ ببادئة: لشاشة الخطأ، وهي لا تعرف معرّف الأستاذ. */
export async function kvKeys(prefix: string): Promise<string[]> {
  const stored = (await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys())) ?? [];
  const names = new Set<string>();
  for (const key of stored) {
    if (typeof key === "string" && key.startsWith(prefix)) names.add(key);
  }
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) names.add(key);
  }
  return [...names];
}
