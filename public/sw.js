/* عامل الخدمة: به يفتح التطبيق المثبَّت والشبكة مقطوعة.
 *
 * ما يخبّئه: هيكل الصفحة وملفات Next الثابتة والخطوط والأيقونات — أي ما يلزم
 * لرسم الشاشة. أما البيانات فلا: نسخة الأقسام والعلامات في IndexedDB، وطابور
 * ما لم يُرسل معها، وكلاهما من شأن التطبيق لا من شأن هذا الملف.
 *
 * ولا يُخبَّأ شيء من Supabase أبدًا: علامةٌ قديمة تُعاد من الخبيئة أسوأ من
 * رسالة «لا اتصال».
 *
 * الجهاز قد يكون مشتركًا بين أساتذة، وصفحة /app تحمل بريد صاحبها ومعرّفه. فـ:
 * - لا يُخبَّأ من الصفحات إلا /app، ولا يُعرض هيكلها مكان صفحة أخرى (كان /login
 *   بلا شبكة يُعرض هيكلَ آخر من دخل).
 * - الهيكل مقرون بصاحبه (OWNER): الصفحة تخبر العامل بمعرّف أستاذها، وإن اختلف
 *   عن صاحب الهيكل المخبّأ يُمحى ويُجلب من جديد.
 * - كل صفحة /login يقدّمها الخادم (خروج، أو جلسة انتهت فحوِّل إليها) تمحو الهيكل:
 *   من لا جلسة له لا يُترك له هيكل أستاذ.
 * - بلا شبكة ولا هيكل: صفحة «لا اتصال» عامّة (/offline.html) لا تحمل شيئًا من أي حساب.
 * - التحويل (إلى /login أو غيره) لا يُخبَّأ أبدًا مكان /app.
 */

const VERSION = "v2";
const SHELL = `taqwim-shell-${VERSION}`;
const ASSETS = `taqwim-assets-${VERSION}`;
const FONTS = `taqwim-fonts-${VERSION}`;
const KEEP = [SHELL, ASSETS, FONTS];
/** مفتاح في خبيئة الهيكل يحفظ معرّف صاحب /app المخبّأ. ليس عنوانًا يُطلب من الخادم. */
const OWNER = "/__taqwim-shell-owner";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  // لا تمهيد للصفحات: أول فتح وهو متصل يملأ الخبيئة بما استُعمل فعلًا. صفحة «لا اتصال»
  // وحدها تُجلب الآن، وهي ثابتة لا تخصّ أحدًا.
  event.waitUntil(ensureOffline().then(() => self.skipWaiting()));
});

/** يخبّئ صفحة «لا اتصال» العامّة إن لم تكن مخبّأة. بلا شبكة: يبقى خطأ المتصفح المعتاد. */
async function ensureOffline() {
  try {
    const cache = await caches.open(SHELL);
    if (await cache.match(OFFLINE)) return;
    const page = await fetch(OFFLINE, { cache: "no-store" });
    if (page.ok && !page.redirected) await cache.put(OFFLINE, page);
  } catch {
    /* تعاد المحاولة عند التثبيت التالي أو صفحة /login التالية */
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("taqwim-") && !KEEP.includes(n)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * رسالتان من الصفحة:
 * - clear-cache: الخروج من الحساب يمسح كل ما خُبّئ، فالجهاز قد يكون مشتركًا.
 *   (والصفحة تمحو الخبيئة بنفسها أيضًا قبل أن تغادر، فلا تعتمد على هذه الرسالة وحدها.)
 * - cache-app {owner}: يخبّئ هيكل /app لصاحبه. بعد الدخول ينتقل التطبيق إلى /app
 *   بتنقّل داخلي (طلب _rsc، وهو خارج الخبيئة أدناه)، فلا تمرّ الصفحة الكاملة بهذا
 *   العامل أبدًا حتى أول إعادة فتح للتطبيق؛ ومن انقطع اتصاله قبلها فتح تطبيقه على
 *   خطأ. وهذا ما يعدّه Chrome عطلًا في تطبيقات TWA (HTTP 200 دون اتصال).
 */
self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "clear-cache") {
    event.waitUntil(
      caches.keys().then((names) =>
        Promise.all(names.filter((n) => n.startsWith("taqwim-")).map((n) => caches.delete(n))),
      ),
    );
  } else if (type === "cache-app") {
    const owner = typeof event.data.owner === "string" ? event.data.owner : "";
    event.waitUntil(warmApp(owner));
  }
});

/** يمحو هيكل /app وصاحبه. ملفات Next والخطوط والصفحة العامّة لا تخصّ أحدًا فتبقى. */
async function dropShell() {
  const cache = await caches.open(SHELL);
  await cache.delete("/app");
  await cache.delete(OWNER);
}

async function shellOwner() {
  const hit = await (await caches.open(SHELL)).match(OWNER);
  return hit ? await hit.text() : null;
}

/** صفحة /app كاملة لأستاذ: نجاح بلا تحويل. ما عدا ذلك (تحويل إلى /login، خطأ) لا يُخبَّأ. */
function isAppPage(response) {
  return !!response && response.ok && !response.redirected && response.type !== "opaqueredirect" &&
    new URL(response.url || "/app", self.location.origin).pathname === "/app";
}

/**
 * يخبّئ هيكل /app لصاحبه.
 * - هيكل لصاحب آخر: يُمحى أولًا، فلا يبقى ولو فشل الجلب.
 * - هيكل بلا صاحب معروف: هو ما خبّأه تنقّل هذه الصفحة نفسها، فيُنسب إلى من أرسل الرسالة.
 */
async function warmApp(owner) {
  if (!owner) return;
  try {
    const known = await shellOwner();
    if (known !== null && known !== owner) await dropShell();
    const cache = await caches.open(SHELL);
    if (known === owner && (await cache.match("/app"))) return;
    if (known === null && (await cache.match("/app"))) {
      await cache.put(OWNER, new Response(owner));
      return;
    }
    const fresh = await fetch("/app", { credentials: "same-origin" });
    if (!isAppPage(fresh)) return;
    await cache.put("/app", fresh.clone());
    await cache.put(OWNER, new Response(owner));
  } catch {
    /* لا شبكة الآن: تعاد المحاولة عند فتح التطبيق التالي */
  }
}

function isFont(url) {
  return url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
}

async function cachePut(cacheName, request, response) {
  if (!response || !response.ok || response.status === 206) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
}

/**
 * الصفحات: الشبكة أولًا. لا يُخبَّأ إلا /app، ولا يُعرض هيكله بلا شبكة إلا مكان /app نفسه.
 */
async function handlePage(request) {
  const path = new URL(request.url).pathname;
  let fresh;
  try {
    fresh = await fetch(request);
  } catch (failure) {
    if (path === "/app") {
      const hit = await caches.match("/app");
      if (hit) return hit;
    }
    const offline = await caches.match(OFFLINE);
    if (offline) return offline;
    throw failure;
  }
  // الخادم قدّم /login (أو حوّل إليها): لا جلسة، فلا يبقى هيكل أستاذ على الجهاز.
  const landed = fresh.url ? new URL(fresh.url).pathname : path;
  if (path === "/login" || landed === "/login" || isRedirectTo(fresh, "/login")) {
    await dropShell();
    // الخروج يمحو الخبيئة كلها، وفيها صفحة «لا اتصال»: تُعاد هنا والشبكة قائمة.
    await ensureOffline();
  } else if (path === "/app" && isAppPage(fresh)) {
    // تنقّل إلى /app: صاحبه مجهول هنا، فيُمحى الصاحب السابق وتنسبه رسالة cache-app من الصفحة.
    const cache = await caches.open(SHELL);
    const previous = await shellOwner();
    await cache.put("/app", fresh.clone());
    if (previous !== null) await cache.delete(OWNER);
  }
  return fresh;
}

/** تحويل لم يُتبَع (التنقّل يطلب redirect: manual) نحو مسار معيّن، إن أمكن معرفته. */
function isRedirectTo(response, path) {
  if (response.status < 300 || response.status >= 400) return false;
  const where = response.headers && response.headers.get("location");
  if (!where) return false;
  try {
    return new URL(where, self.location.origin).pathname === path;
  } catch {
    return false;
  }
}

/** ملفات Next الثابتة: اسمها يحمل بصمتها، فالخبيئة أولًا بلا تحقّق. */
async function handleImmutable(request, cacheName) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const fresh = await fetch(request);
  await cachePut(cacheName, request, fresh);
  return fresh;
}

/** البقية: من الخبيئة فورًا، مع تحديثها في الخلفية. */
async function handleRevalidate(request, cacheName) {
  const hit = await caches.match(request);
  const network = fetch(request)
    .then((fresh) => {
      void cachePut(cacheName, request, fresh);
      return fresh;
    })
    .catch(() => null);
  if (hit) return hit;
  const fresh = await network;
  if (fresh) return fresh;
  throw new Error("offline");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (isFont(url)) {
    event.respondWith(handleRevalidate(request, FONTS));
    return;
  }

  // Supabase وكل ما هو خارج الموقع: إلى الشبكة مباشرة بلا خبيئة.
  if (url.origin !== self.location.origin) return;

  // طلبات React للتنقّل الداخلي: لا تُخبَّأ، فهي ليست صفحة كاملة.
  if (url.searchParams.has("_rsc")) return;

  // الإشراف لا يُخبَّأ أبدًا: لا نسخة منه تُعرض بلا شبكة، ولا يُخبَّأ ما فيه من أسماء الحسابات.
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return;

  if (request.mode === "navigate") {
    event.respondWith(handlePage(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleImmutable(request, ASSETS));
    return;
  }

  if (url.pathname.startsWith("/_next/") || url.pathname.endsWith(".png") ||
      url.pathname.endsWith(".webmanifest") || url.pathname.endsWith(".ico")) {
    event.respondWith(handleRevalidate(request, ASSETS));
  }
});
