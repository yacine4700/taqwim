/**
 * منطق assetlinks.json صافيًا: لا قراءة ولا كتابة ملفات ولا process. يستعمله
 * android/make-assetlinks.mjs (سطر الأوامر) وscripts/check-assetlinks.mjs (الاختبار).
 *
 * كان المنطق والأمر في ملف واحد، والأمر يعمل فقط إن طابق مسار التشغيل مسارَ الملف
 * (فحص isMain). عبر مسار رمزي أو مسار مكتوب بشكل آخر لم يتطابقا، فخرج الأمر بلا
 * شيء وبرمز 0. الآن الأمر ملف لا يُستورد، فيعمل دائمًا حين يُشغَّل.
 *
 * الصيغة والعلاقة كما في وثائق Chrome (Android Concepts for Web Developers) و
 * Digital Asset Links.
 */

/** اسم حزمة Android: مقطعان أو أكثر، يبدأ كل مقطع بحرف. */
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
export const RELATION = "delegate_permission/common.handle_all_urls";

/** يقبل بصمة بالنقطتين أو دونهما وبأي حالة أحرف، ويعيدها 32 زوجًا كبيرة مفصولة بنقطتين. */
export function normalizeFingerprint(value) {
  const hex = String(value).trim().replace(/^SHA-?256\s*[:=]?\s*/i, "").replace(/[:\s-]/g, "");
  if (!/^[0-9A-Fa-f]{64}$/.test(hex)) {
    throw new Error(`بصمة SHA-256 غير صالحة: «${value}» (المطلوب 64 خانة سداسية عشرية)`);
  }
  return hex.toUpperCase().match(/.{2}/g).join(":");
}

export function checkPackage(packageId) {
  if (!PACKAGE_RE.test(String(packageId))) {
    throw new Error(`اسم الحزمة غير صالح: «${packageId}» (مثال صحيح: io.github.yacine4700.taqwim)`);
  }
}

/** مدخلة TWA لحزمة: هل هي «فتح كل الروابط» لتطبيق Android بهذا الاسم؟ */
function isTwaEntry(entry, packageId) {
  return !!entry && Array.isArray(entry.relation) && entry.relation.includes(RELATION) &&
    entry.target && entry.target.namespace === "android_app" && entry.target.package_name === packageId;
}

/** يتحقق من بنية ملف موجود قبل الدمج فيه. ملف تالف يُرفض ولا يُكتب فوقه. */
export function checkExisting(existing) {
  if (!Array.isArray(existing)) {
    throw new Error("الملف الموجود ليس مصفوفة JSON كما يشترط Digital Asset Links. أصلحه يدويًّا أو احذفه ثم أعد الأمر.");
  }
  existing.forEach((entry, i) => {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.relation) || !entry.target || typeof entry.target !== "object") {
      throw new Error(`المدخلة رقم ${i + 1} في الملف الموجود ناقصة (relation وtarget). أصلحها يدويًّا.`);
    }
    if (entry.target.namespace === "android_app") {
      const prints = entry.target.sha256_cert_fingerprints;
      if (!Array.isArray(prints)) {
        throw new Error(`المدخلة رقم ${i + 1} في الملف الموجود بلا sha256_cert_fingerprints. أصلحها يدويًّا.`);
      }
      prints.forEach((p) => normalizeFingerprint(p));
    }
  });
}

/**
 * يضيف البصمات إلى مدخلة الحزمة ولا يحذف شيئًا: البصمات السابقة تبقى في أولها بترتيبها،
 * والجديدة تُلحق بها بلا تكرار، ومدخلات الحزم الأخرى تبقى كما هي حرفيًّا.
 * يعيد { json, added, kept }.
 */
export function mergeAssetLinks(existing, packageId, fingerprints) {
  checkPackage(packageId);
  if (!fingerprints.length) throw new Error("لا بصمة. أعطِ بصمة واحدة على الأقل.");
  const incoming = fingerprints.map(normalizeFingerprint);
  const base = existing ?? [];
  checkExisting(base);

  const json = structuredClone(base);
  let entry = json.find((e) => isTwaEntry(e, packageId));
  const before = entry ? entry.target.sha256_cert_fingerprints.map(normalizeFingerprint) : [];
  const all = [...new Set([...before, ...incoming])];
  if (entry) {
    entry.target.sha256_cert_fingerprints = all;
  } else {
    entry = {
      relation: [RELATION],
      target: { namespace: "android_app", package_name: packageId, sha256_cert_fingerprints: all },
    };
    json.push(entry);
  }
  return { json, added: all.length - before.length, kept: before.length };
}

/** ملف جديد لحزمة: الدمج في لا شيء. */
export function buildAssetLinks(packageId, fingerprints) {
  return mergeAssetLinks([], packageId, fingerprints).json;
}
