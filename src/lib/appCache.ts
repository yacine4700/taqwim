/**
 * محو خبيئة عامل الخدمة من الصفحة نفسها، عند الخروج.
 *
 * هيكل /app المخبّأ يحمل بريد الأستاذ ومعرّفه، والجهاز قد يكون مشتركًا. رسالة
 * clear-cache إلى العامل لا جواب لها ولا تُنتظر، وقد لا يكون للصفحة عامل يتحكّم فيها
 * بعد، فكانت المغادرة إلى /login قد تسبق المحو. هنا يُنتظر المحو قبل المغادرة.
 *
 * فشل المحو لا يمنع الخروج: بقاء الجلسة أسوأ. والعامل يمحو الهيكل أيضًا عند أول
 * صفحة /login يقدّمها الخادم (public/sw.js). يُختبر في scripts/check-sw.mjs.
 */
type CacheStore = Pick<CacheStorage, "keys" | "delete">;

export async function clearAppCaches(
  store: CacheStore | undefined = typeof caches === "undefined" ? undefined : caches,
): Promise<number> {
  if (!store) return 0;
  try {
    const names = (await store.keys()).filter((n) => n.startsWith("taqwim-"));
    await Promise.all(names.map((n) => store.delete(n)));
    return names.length;
  } catch {
    return 0;
  }
}
