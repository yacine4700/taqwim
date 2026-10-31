/* اختبار عامل الخدمة (public/sw.js) ومحو الخبيئة عند الخروج (src/lib/appCache.ts):
   لا يُعرض هيكل /app لأستاذ على أستاذ آخر يستعمل الجهاز نفسه، ولا بعد الخروج، ولا
   يُخبَّأ تحويلٌ إلى /login مكان /app.

   يحمّل الملف الحقيقي في بيئة معزولة (vm) فيها: خادم مُحاكى يتبع الوسيط (/app بلا
   جلسة يُحوَّل إلى /login، و/login بجلسة يُحوَّل إلى /app)، وCacheStorage في الذاكرة،
   وشبكة يمكن قطعها. ليست متصفحًا: لا تُختبر هنا دورة حياة العامل الحقيقية ولا Chrome.
   يحتاج Node 22.6 فأحدث مع --experimental-strip-types. */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { clearAppCaches } from "../src/lib/appCache.ts";

const ORIGIN = "https://taqwim.test";
const SW = readFileSync(process.env.SW_FILE || new URL("../public/sw.js", import.meta.url), "utf8");

let passed = 0, failed = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++; else failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
}

/* ---------- CacheStorage في الذاكرة ---------- */
const keyOf = (r) => new URL(typeof r === "string" ? r : r.url, ORIGIN).href;
class MemCache {
  constructor() { this.m = new Map(); }
  async match(r) { const hit = this.m.get(keyOf(r)); return hit ? hit.clone() : undefined; }
  async put(r, res) { this.m.set(keyOf(r), res.clone()); }
  async delete(r) { return this.m.delete(keyOf(r)); }
  async keys() { return [...this.m.keys()]; }
}
class MemStorage {
  constructor() { this.c = new Map(); }
  async open(n) { if (!this.c.has(n)) this.c.set(n, new MemCache()); return this.c.get(n); }
  async keys() { return [...this.c.keys()]; }
  async delete(n) { return this.c.delete(n); }
  async has(n) { return this.c.has(n); }
  async match(r) { for (const c of this.c.values()) { const hit = await c.match(r); if (hit) return hit; } return undefined; }
}

/* ---------- خادم مُحاكى ---------- */
function page(body, url, { redirected = false } = {}) {
  const res = new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  Object.defineProperty(res, "url", { value: new URL(url, ORIGIN).href });
  Object.defineProperty(res, "redirected", { value: redirected });
  return res;
}
/** ما يعيده fetch لتنقّل (redirect: manual) يُحوَّل: استجابة معتمة بلا رأس ولا جسم. */
function opaqueRedirect(url) {
  return { ok: false, status: 0, type: "opaqueredirect", redirected: false, url: new URL(url, ORIGIN).href,
           headers: new Headers(), clone() { return this; } };
}
const appHtml = (who) => `<html>/app teacherId=${who} email=${who}@school.dz</html>`;

function makeWorld() {
  const world = { online: true, session: null, fetches: [], caches: new MemStorage(), listeners: {} };
  world.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
    const navigate = typeof input === "object" && input.mode === "navigate";
    world.fetches.push(url.pathname);
    if (!world.online) throw new TypeError("Failed to fetch");
    if (url.pathname === "/offline.html") return page("<html>لا اتصال بالإنترنت</html>", "/offline.html");
    if (url.pathname === "/app") {
      if (world.session) return page(appHtml(world.session), "/app");
      // الوسيط يحوّل إلى /login: التنقّل يرى تحويلًا معتمًا، وfetch العادي يتبعه
      return navigate ? opaqueRedirect("/app") : page("<html>login</html>", "/login", { redirected: true });
    }
    if (url.pathname === "/login") {
      if (world.session) return navigate ? opaqueRedirect("/login") : page(appHtml(world.session), "/app", { redirected: true });
      return page("<html>login</html>", "/login");
    }
    return page(`<html>${url.pathname}</html>`, url.pathname);
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener(type, fn) { (world.listeners[type] ||= []).push(fn); },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(SW, { self, caches: world.caches, fetch: world.fetch, Response, Headers, URL, console });
  world.emit = async (type, event) => {
    let pending = null;
    const ev = { ...event, waitUntil(p) { pending = p; }, respondWith(p) { pending = p; } };
    for (const fn of world.listeners[type] || []) fn(ev);
    return pending;
  };
  world.install = async () => { await world.emit("install", {}); await world.emit("activate", {}); };
  /** تنقّل: نصّ ما يراه الأستاذ، أو «خطأ المتصفح» إن لم يجد العامل شيئًا. */
  world.open = async (path) => {
    try {
      const res = await world.emit("fetch", { request: { url: ORIGIN + path, method: "GET", mode: "navigate", redirect: "manual" } });
      if (!res) return "(لم يعترضه العامل)";
      return res.type === "opaqueredirect" ? "(تحويل)" : await res.text();
    } catch {
      return "(خطأ المتصفح: لا اتصال)";
    }
  };
  world.message = (data) => world.emit("message", { data });
  world.shell = async () => { const hit = await world.caches.match("/app"); return hit ? await hit.text() : null; };
  return world;
}

const leaks = (text, who) => typeof text === "string" && text.includes(`teacherId=${who}`);

/* ---------- 1. مستخدم دخل وفتح /app ---------- */
console.log("— 1. الأستاذ A دخل وفتح /app");
{
  const w = makeWorld();
  await w.install();
  w.session = "A";
  t("يرى صفحته", leaks(await w.open("/app"), "A"), true);
  await w.message({ type: "cache-app", owner: "A" });
  t("هيكله مخبّأ باسمه", leaks(await w.shell(), "A"), true);
  w.fetches.length = 0;
  await w.message({ type: "cache-app", owner: "A" });
  t("رسالة ثانية من صاحبه لا تجلب /app ثانية", w.fetches.includes("/app"), false);
  w.online = false;
  t("دون اتصال: يفتح دفتره", leaks(await w.open("/app"), "A"), true);
  t("دون اتصال، /login لا يعرض هيكل A مكانها", leaks(await w.open("/login"), "A"), false);
  t("دون اتصال، صفحة أخرى (/account) لا تعرض هيكل A", leaks(await w.open("/account"), "A"), false);
}
{
  const w = makeWorld();
  await w.install();
  w.session = "A";
  await w.message({ type: "cache-app", owner: "A" }); // دخل بتنقّل داخلي: الصفحة الكاملة لم تمرّ بالعامل
  t("بعد الدخول بتنقّل داخلي: الرسالة تخبّئ /app", leaks(await w.shell(), "A"), true);
  w.online = false;
  t("وهكذا يفتح دون اتصال من أول مرة", leaks(await w.open("/app"), "A"), true);
}

/* ---------- 2. الخروج ---------- */
console.log("— 2. A سجّل خروجه");
{
  const w = makeWorld();
  await w.install();
  w.session = "A";
  await w.open("/app");
  await w.message({ type: "cache-app", owner: "A" });
  // ما تفعله signOut: تمحو الصفحة الخبيئة وتنتظر، ثم الرسالة، ثم إنهاء الجلسة، ثم /login
  const removed = await clearAppCaches(w.caches);
  await w.message({ type: "clear-cache" });
  w.session = null;
  t("الصفحة محت خبيئة التطبيق", removed > 0, true);
  t("لا هيكل /app بعد الخروج", await w.shell(), null);
  t("ينتقل إلى /login", await w.open("/login"), "<html>login</html>");
  t("و/login أعادت صفحة «لا اتصال» العامّة", !!(await w.caches.match("/offline.html")), true);
  t("/app بلا جلسة: تحويل لا صفحة", await w.open("/app"), "(تحويل)");
  t("ولا يُخبَّأ التحويل", await w.shell(), null);
}
{
  const w = makeWorld();
  await w.install();
  w.session = "A";
  await w.open("/app");
  await w.message({ type: "cache-app", owner: "A" });
  // الصفحة لم تستطع المحو (لا caches، أو فشل) والرسالة ضاعت: يكفي أن يقدّم الخادم /login
  w.session = null;
  await w.open("/login");
  t("المحو فاته: أول /login من الخادم يمحو هيكل A", await w.shell(), null);
}
t("clearAppCaches بلا CacheStorage لا يرمي", await clearAppCaches(undefined), 0);
t("clearAppCaches لا يمسّ خبيئة لا تخصّ التطبيق", await (async () => {
  const s = new MemStorage(); await s.open("taqwim-shell-v2"); await s.open("other-lib");
  await clearAppCaches(s); return await s.keys();
})(), ["other-lib"]);

/* ---------- 3. أستاذ آخر على الجهاز نفسه ---------- */
console.log("— 3. B فتح التطبيق على جهاز A");
{
  const w = makeWorld();
  await w.install();
  w.session = "A";
  await w.open("/app");
  await w.message({ type: "cache-app", owner: "A" });
  await clearAppCaches(w.caches);
  w.session = null;
  await w.open("/login");
  w.session = "B"; // B يدخل، والتطبيق ينتقل إلى /app بتنقّل داخلي
  await w.message({ type: "cache-app", owner: "B" });
  t("الهيكل المخبّأ لـB", leaks(await w.shell(), "B"), true);
  t("ولا أثر لـA فيه", leaks(await w.shell(), "A"), false);
  w.online = false;
  const seen = await w.open("/app");
  t("B دون اتصال يرى دفتره", leaks(seen, "B"), true);
  t("ولا يرى شيئًا من A", leaks(seen, "A"), false);
}
{
  // أسوأ الحالات: لم يمرّ أحد بـ/login والهيكل ما يزال لـA (لا يحدث في المسار العادي)
  const w = makeWorld();
  await w.install();
  w.session = "A";
  await w.open("/app");
  await w.message({ type: "cache-app", owner: "A" });
  w.session = "B";
  await w.message({ type: "cache-app", owner: "B" });
  t("صاحب مختلف: يُستبدل هيكل A بهيكل B", [leaks(await w.shell(), "A"), leaks(await w.shell(), "B")], [false, true]);
}
{
  const w = makeWorld();
  await w.install();
  w.session = "A";
  await w.open("/app");
  await w.message({ type: "cache-app", owner: "A" });
  w.session = "B";
  w.online = false; // صفحة B تُرسل رسالتها والشبكة مقطوعة: لا يُجلب هيكلها
  await w.message({ type: "cache-app", owner: "B" });
  t("صاحب مختلف بلا شبكة: يُمحى هيكل A ولو تعذّر جلب هيكل B", await w.shell(), null);
  t("فلا يرى B دفتر A دون اتصال", leaks(await w.open("/app"), "A"), false);
}
{
  // B يفتح /app بتحميل كامل: تنقّل يمرّ بالعامل، ثم رسالة صفحته
  const w = makeWorld();
  await w.install();
  w.session = "A";
  await w.open("/app");
  await w.message({ type: "cache-app", owner: "A" });
  w.session = "B";
  await w.open("/app");
  await w.message({ type: "cache-app", owner: "B" });
  t("تحميل كامل لـ/app بحساب B: الهيكل لـB وحده", [leaks(await w.shell(), "A"), leaks(await w.shell(), "B")], [false, true]);
}

/* ---------- 4. فتح التطبيق دون اتصال بعد الخروج ---------- */
console.log("— 4. دون اتصال بعد الخروج");
{
  const w = makeWorld();
  await w.install();
  w.session = "A";
  await w.open("/app");
  await w.message({ type: "cache-app", owner: "A" });
  await clearAppCaches(w.caches);
  await w.message({ type: "clear-cache" });
  w.session = null;
  await w.open("/login");
  w.online = false;
  const a = await w.open("/app");
  t("/app: صفحة «لا اتصال» العامّة", a.includes("لا اتصال بالإنترنت"), true);
  t("ولا شيء من A", leaks(a, "A"), false);
  t("/login: صفحة «لا اتصال» لا هيكل A", leaks(await w.open("/login"), "A"), false);
}
{
  const w = makeWorld();
  await w.install();
  w.session = "A";
  await w.open("/app");
  await w.message({ type: "cache-app", owner: "A" });
  await clearAppCaches(w.caches);
  w.session = null;
  w.online = false; // خرج والشبكة مقطوعة: الخروج المحلي، ولا /login من الخادم
  const a = await w.open("/app");
  t("خرج بلا شبكة: لا يُعرض هيكل A", leaks(a, "A"), false);
}

/* ---------- 5. التحويل إلى /login لا يُخبَّأ مكان /app ---------- */
console.log("— 5. التحويل إلى /login");
{
  const w = makeWorld();
  await w.install();
  w.session = null;
  t("تنقّل إلى /app بلا جلسة: يعود التحويل كما هو", await w.open("/app"), "(تحويل)");
  t("ولا يُخبَّأ مكان /app", await w.shell(), null);
  await w.message({ type: "cache-app", owner: "A" }); // صفحة قديمة ترسل والجلسة انتهت
  t("fetch يتبع التحويل إلى /login: لا يُخبَّأ مكان /app", await w.shell(), null);
}
{
  const w = makeWorld();
  await w.install();
  w.session = "A";
  await w.open("/app");
  await w.message({ type: "cache-app", owner: "A" });
  w.session = null; // انتهت الجلسة على الخادم
  t("/app بعد انتهاء الجلسة: تحويل", await w.open("/app"), "(تحويل)");
  await w.open("/login");
  t("ثم /login: لا يبقى هيكل A", await w.shell(), null);
}

/* ---------- الترقية من الإصدار السابق ---------- */
console.log("— الترقية من v1");
{
  const w = makeWorld();
  const old = await w.caches.open("taqwim-shell-v1");
  await old.put("/login", page(appHtml("A"), "/app"));
  await old.put("/app", page(appHtml("A"), "/app"));
  await w.install();
  t("تفعيل v2 يمحو خبيئة v1 كلها (وفيها صفحات غير /app)", (await w.caches.keys()).includes("taqwim-shell-v1"), false);
}

console.log(`\n${passed} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
