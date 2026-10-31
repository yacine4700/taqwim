/* عامل الخدمة: به يفتح التطبيق المثبَّت والشبكة مقطوعة.
 *
 * ما يخبّئه: هيكل الصفحة وملفات Next الثابتة والخطوط والأيقونات — أي ما يلزم
 * لرسم الشاشة. أما البيانات فلا: نسخة الأقسام والعلامات في IndexedDB، وطابور
 * ما لم يُرسل معها، وكلاهما من شأن التطبيق لا من شأن هذا الملف.
 *
 * ولا يُخبَّأ شيء من Supabase أبدًا: علامةٌ قديمة تُعاد من الخبيئة أسوأ من
 * رسالة «لا اتصال».
 */

const VERSION = "v1";
const SHELL = `taqwim-shell-${VERSION}`;
const ASSETS = `taqwim-assets-${VERSION}`;
const FONTS = `taqwim-fonts-${VERSION}`;
const KEEP = [SHELL, ASSETS, FONTS];

self.addEventListener("install", () => {
  // لا تمهيد مسبق: أول فتح وهو متصل يملأ الخبيئة بما استُعمل فعلًا.
  self.skipWaiting();
});

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
 * - cache-app: يخبّئ هيكل /app إن لم يكن مخبّأً. بعد الدخول ينتقل التطبيق إلى /app
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
    event.waitUntil(warmApp());
  }
});

/** يجلب /app ويخبّئه إن لم يكن مخبّأً. التحويل إلى /login (لا جلسة) لا يُخبَّأ. */
async function warmApp() {
  try {
    if (await caches.match("/app")) return;
    const fresh = await fetch("/app", { credentials: "same-origin" });
    if (fresh.ok && !fresh.redirected) await cachePut(SHELL, "/app", fresh);
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

/** الصفحة: الشبكة أولًا ليبقى المحتوى طازجًا، والخبيئة عند سقوطها. */
async function handlePage(request) {
  try {
    const fresh = await fetch(request);
    // التحويل إلى /login يعني انتهاء الجلسة، ولا يُخبَّأ مكان الصفحة.
    if (fresh.ok && !fresh.redirected) await cachePut(SHELL, request, fresh);
    return fresh;
  } catch (failure) {
    const hit = (await caches.match(request)) || (await caches.match("/app"));
    if (hit) return hit;
    throw failure;
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
