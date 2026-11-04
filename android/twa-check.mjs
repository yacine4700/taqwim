/**
 * فحص مشروع الغلاف (Bubblewrap) قبل رفعه إلى Google Play — منطق صافٍ بلا ملفات ولا شبكة.
 * يستعمله android/preflight.mjs (سطر الأوامر) وscripts/check-twa.mjs (الاختبار).
 *
 * لماذا: مشروع الغلاف على حاسوب الأستاذ لا في المستودع، والأخطاء التي تُسقط النشر
 * لا تظهر إلا بعد الرفع أو على هاتف: targetSdk أقل من شرط Play، أو اسم حزمة لا
 * يطابق assetlinks.json فيظهر شريط العنوان، أو رقم إصدار لم يُرفع، أو مفتاح توقيع
 * داخل المستودع.
 *
 * أسماء الحقول في twa-manifest.json كما يكتبها Bubblewrap (packageId, host,
 * startUrl, appVersionCode, appVersionName, signingKey, fingerprints, display,
 * orientation). لم تُجرَّب على ملف حقيقي من حاسوب الأستاذ: الحقل الغائب يُبلَّغ
 * «تحذيرًا» لا خطأ، فلا يمنع الفحصُ بناءً سليمًا بسبب اسم حقل تغيّر.
 */

import { normalizeFingerprint, RELATION } from "./assetlinks.mjs";

/** شرط Google Play للتطبيقات الجديدة وتحديثاتها منذ 31 أوت 2026 (Android 16). يرتفع كل سنة. */
export const PLAY_MIN_TARGET_SDK = 36;

/**
 * اسم الحزمة المعتمد (4 نوفمبر 2026). لا يتغيّر بعد أول رفع إلى Play، ولا يُعاد استعماله ولو حُذف التطبيق.
 * الحزمة السابقة app.vercel.taqwim_theta.twa كانت لـAPK تجريبي وحده، وتبقى في assetlinks.json حتى
 * يزول ذاك الـAPK من الأجهزة.
 */
export const DECIDED_PACKAGE = "io.github.yacine4700.taqwim";

/** القيم التي يُبنى عليها الغلاف: من public/manifest.webmanifest والوسيط. */
export const EXPECTED = {
  startUrl: "/app",
  orientation: "portrait",
  displays: ["standalone", "fullscreen"],
};

function num(text, re) {
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}
function str(text, re) {
  const m = text.match(re);
  return m ? m[1] : null;
}

/** يقرأ من app/build.gradle (Groovy أو Kotlin DSL) ما يهمّ Play. الغائب null. */
export function parseGradle(text) {
  const t = String(text ?? "");
  return {
    applicationId: str(t, /\bapplicationId\s*=?\s*["']([^"']+)["']/),
    targetSdk: num(t, /\btargetSdk(?:Version)?\s*=?\s*\(?\s*(\d+)/),
    compileSdk: num(t, /\bcompileSdk(?:Version)?\s*=?\s*\(?\s*(\d+)/),
    minSdk: num(t, /\bminSdk(?:Version)?\s*=?\s*\(?\s*(\d+)/),
    versionCode: num(t, /\bversionCode\s*=?\s*(\d+)/),
    versionName: str(t, /\bversionName\s*=?\s*["']([^"']+)["']/),
  };
}

/** بصمات SHA-256 من ناتج `keytool -printcert -jarfile` (قد يكون فيه أكثر من موقِّع). */
export function fingerprintsFromKeytool(text) {
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(/SHA-?256\s*:\s*([0-9A-Fa-f:]{64,95})/);
    if (!m) continue;
    try {
      const fp = normalizeFingerprint(m[1]);
      if (!out.includes(fp)) out.push(fp);
    } catch {
      /* سطر يشبه البصمة وليس بها: يُتجاهل */
    }
  }
  return out;
}

/** بصمات الحزمة في assetlinks.json، موحَّدة. [] إن لم تكن الحزمة فيه. */
export function assetLinkPrints(assetlinks, packageId) {
  if (!Array.isArray(assetlinks)) return [];
  const prints = [];
  for (const e of assetlinks) {
    if (!e || !Array.isArray(e.relation) || !e.relation.includes(RELATION)) continue;
    if (!e.target || e.target.namespace !== "android_app" || e.target.package_name !== packageId) continue;
    for (const p of e.target.sha256_cert_fingerprints ?? []) {
      try {
        prints.push(normalizeFingerprint(p));
      } catch {
        /* بصمة تالفة: يكشفها checkExisting في make-assetlinks */
      }
    }
  }
  return prints;
}

/** هل المسار داخل المستودع؟ مقارنة نصّية لمسارين مطلقين موحَّدين. */
export function insideRepo(absPath, repoRoot) {
  if (!absPath || !repoRoot) return false;
  const root = repoRoot.replace(/[\\/]+$/, "");
  return absPath === root || absPath.startsWith(root + "/") || absPath.startsWith(root + "\\");
}

/**
 * يفحص المشروع ويعيد قائمة { level: "error" | "warn" | "ok", msg }.
 * - twa: محتوى twa-manifest.json (أو null)
 * - gradle: ناتج parseGradle (أو null)
 * - assetlinks: محتوى public/.well-known/assetlinks.json في المستودع
 * - host: النطاق المقصود (من سطر الأوامر)
 * - signingKeyAbs: المسار المطلق لمفتاح التوقيع كما في twa-manifest، وrepoRoot
 * - signerPrints: بصمات موقِّع الحزمة المبنية (من keytool)، أو null إن لم تُعطَ حزمة
 * - forPlay: الحزمة للرفع إلى Play (فبصمتها بصمة مفتاح الرفع، لا ما في assetlinks بالضرورة)
 */
export function checkProject({ twa, gradle, assetlinks, host, signingKeyAbs, repoRoot, signerPrints = null, forPlay = true, expectedPackage = null }) {
  const out = [];
  const ok = (msg) => out.push({ level: "ok", msg });
  const warn = (msg) => out.push({ level: "warn", msg });
  const error = (msg) => out.push({ level: "error", msg });

  if (!twa) {
    error("لا twa-manifest.json: هل المجلد هو مجلد مشروع Bubblewrap؟");
    return out;
  }

  const pkg = twa.packageId;
  if (!pkg) error("twa-manifest.json بلا packageId.");
  else if (expectedPackage && pkg !== expectedPackage) {
    error(`packageId = ${pkg}، والمعتمد ${expectedPackage}. غيّره في twa-manifest.json ثم \`bubblewrap update\` (والمفتاح لا يتغيّر).`);
  } else ok(`اسم الحزمة: ${pkg} (لا يتغيّر بعد أول رفع إلى Play)`);

  if (!twa.host) warn("twa-manifest.json بلا host.");
  else if (host && twa.host !== host) error(`النطاق في الغلاف ${twa.host} غير النطاق المقصود ${host}.`);
  else ok(`النطاق: ${twa.host}`);

  if (twa.startUrl === undefined) warn("twa-manifest.json بلا startUrl.");
  else if (twa.startUrl !== EXPECTED.startUrl) error(`startUrl = ${twa.startUrl}، والمتوقع ${EXPECTED.startUrl} كما في manifest.webmanifest.`);
  else ok(`startUrl: ${twa.startUrl}`);

  if (twa.display === undefined) warn("twa-manifest.json بلا display.");
  else if (!EXPECTED.displays.includes(twa.display)) error(`display = ${twa.display}: الغلاف لا يملأ الشاشة إلا بـ standalone أو fullscreen.`);
  else ok(`display: ${twa.display}`);

  if (twa.orientation !== undefined && twa.orientation !== EXPECTED.orientation) {
    warn(`orientation = ${twa.orientation}، والموقع يعلن ${EXPECTED.orientation}.`);
  }

  // الإصدار
  if (!gradle) {
    error("لا app/build.gradle: شغّل `bubblewrap update` أو `bubblewrap build` مرة لتوليده.");
  } else {
    if (gradle.targetSdk == null) warn("لم يُعثر على targetSdkVersion في app/build.gradle.");
    else if (gradle.targetSdk < PLAY_MIN_TARGET_SDK) {
      error(`targetSdkVersion ${gradle.targetSdk} أقل من شرط Play (${PLAY_MIN_TARGET_SDK}). حدّث Bubblewrap إلى 1.25.0 أو أحدث ثم \`bubblewrap update\`.`);
    } else ok(`targetSdkVersion: ${gradle.targetSdk}`);

    if (gradle.applicationId && pkg && gradle.applicationId !== pkg) {
      error(`applicationId في build.gradle (${gradle.applicationId}) غير packageId (${pkg}). أعد \`bubblewrap update\`.`);
    }
    if (gradle.versionCode == null) warn("لم يُعثر على versionCode في app/build.gradle.");
    else ok(`versionCode: ${gradle.versionCode}، versionName: ${gradle.versionName ?? "؟"}`);
    if (twa.appVersionCode != null && gradle.versionCode != null && Number(twa.appVersionCode) !== gradle.versionCode) {
      warn(`appVersionCode في twa-manifest (${twa.appVersionCode}) غير versionCode في build.gradle (${gradle.versionCode}): شغّل \`bubblewrap update\`.`);
    }
  }

  // مفتاح التوقيع: خارج المستودع دائمًا
  if (!twa.signingKey || !twa.signingKey.path) warn("twa-manifest.json بلا signingKey.path.");
  else if (insideRepo(signingKeyAbs, repoRoot)) error("مفتاح التوقيع داخل مستودع taqwim. انقله خارجه (لا يُدفع إلى Git أبدًا).");
  else ok(`مفتاح التوقيع خارج المستودع (الاسم المستعار: ${twa.signingKey.alias ?? "؟"})`);

  // assetlinks
  const linked = pkg ? assetLinkPrints(assetlinks, pkg) : [];
  if (pkg && !linked.length) {
    if (forPlay) {
      warn(
        `الحزمة ${pkg} ليست بعد في public/.well-known/assetlinks.json. متوقَّع قبل إنشاء التطبيق في Play Console: ` +
          "تُضاف بصمة «مفتاح توقيع التطبيق» من Play (make-assetlinks.mjs). قبل ذلك يفتح التطبيق بشريط عنوان.",
      );
    } else {
      error(`الحزمة ${pkg} ليست في public/.well-known/assetlinks.json: سيفتح هذا الـAPK بشريط عنوان.`);
    }
  } else if (pkg) {
    ok(`assetlinks.json فيه ${linked.length} بصمة للحزمة ${pkg}`);
  }

  if (signerPrints) {
    if (!signerPrints.length) error("لم تُقرأ بصمة الموقِّع من الحزمة (غير موقّعة؟).");
    for (const fp of signerPrints) {
      if (linked.includes(fp)) ok(`بصمة موقِّع الحزمة موجودة في assetlinks.json`);
      else if (forPlay) {
        warn(
          "بصمة موقِّع هذه الحزمة (مفتاح الرفع) ليست في assetlinks.json. هذا طبيعي مع Play App Signing: " +
            "ما يلزم هو بصمة «مفتاح توقيع التطبيق» من Play Console ← سلامة التطبيق، تُضاف بعد إنشاء التطبيق هناك.",
        );
      } else {
        error("بصمة موقِّع هذا الـAPK ليست في assetlinks.json: سيفتح بشريط عنوان.");
      }
    }
  }

  return out;
}

/** يقارن assetlinks.json المنشور بما في المستودع: كل بصمة في المستودع يجب أن تكون منشورة. */
export function compareLive(repoLinks, liveLinks, packageId) {
  const want = assetLinkPrints(repoLinks, packageId);
  const have = assetLinkPrints(liveLinks, packageId);
  const missing = want.filter((fp) => !have.includes(fp));
  return { want: want.length, have: have.length, missing };
}
