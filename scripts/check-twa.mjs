/**
 * اختبار فحص الغلاف قبل Google Play: android/twa-check.mjs (المنطق) وandroid/preflight.mjs
 * (الأمر يُشغَّل فعلًا على مشروع وهمي في مجلد مؤقت). وفحص صفحات المتجر العامة:
 * /delete-account و/privacy موجودتان، خارج الوسيط وعامل الخدمة، ويشير بعضهما إلى بعض.
 *
 * البصمات هنا بيانات اختبار. لا يُقرأ مفتاح حقيقي ولا يُكتب شيء في المستودع.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAssetLinks } from "../android/assetlinks.mjs";
import {
  PLAY_MIN_TARGET_SDK,
  assetLinkPrints,
  checkProject,
  compareLive,
  fingerprintsFromKeytool,
  insideRepo,
  parseGradle,
} from "../android/twa-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let ok = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    ok++;
    console.log(`  ok   ${name}`);
  } catch (problem) {
    failed++;
    console.log(`  FAIL ${name}: ${problem.message}`);
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg || "assertion");
}

const PKG = "app.example.taqwim";
const A = "14:6D:E9:83:C5:73:06:98:BC:60:A4:C2:CE:13:3B:76:16:5E:C7:79:34:05:E2:4A:D1:7B:E4:11:2D:89:BF:3A";
const B = "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";
const LINKS = buildAssetLinks(PKG, [A]);

const GRADLE = `
android {
    compileSdkVersion 36
    defaultConfig {
        applicationId "${PKG}"
        minSdkVersion 21
        targetSdkVersion 36
        versionCode 3
        versionName "3"
    }
}`;
const TWA = {
  packageId: PKG,
  host: "taqwim.example",
  startUrl: "/app",
  display: "standalone",
  orientation: "portrait",
  appVersionCode: 3,
  appVersionName: "3",
  signingKey: { path: "/home/t/taqwim-android/taqwim-release.keystore", alias: "taqwim" },
};
const BASE = {
  twa: TWA,
  gradle: parseGradle(GRADLE),
  assetlinks: LINKS,
  host: "taqwim.example",
  signingKeyAbs: TWA.signingKey.path,
  repoRoot: "/home/t/taqwim",
};
const levels = (r) => r.filter((x) => x.level === "error").map((x) => x.msg);
const warns = (r) => r.filter((x) => x.level === "warn").map((x) => x.msg);

console.log("— build.gradle");
check("Groovy: الأرقام والاسم", () => {
  const g = parseGradle(GRADLE);
  expect(g.targetSdk === 36 && g.compileSdk === 36 && g.minSdk === 21, JSON.stringify(g));
  expect(g.versionCode === 3 && g.versionName === "3" && g.applicationId === PKG);
});
check("Kotlin DSL: targetSdk = 35", () => {
  const g = parseGradle(`defaultConfig { applicationId = "${PKG}"\n targetSdk = 35\n versionCode = 7 }`);
  expect(g.targetSdk === 35 && g.versionCode === 7 && g.applicationId === PKG, JSON.stringify(g));
});
check("ملف فارغ: كل شيء null", () => {
  const g = parseGradle("");
  expect(Object.values(g).every((v) => v === null));
});
check("شرط Play الحالي 36", () => expect(PLAY_MIN_TARGET_SDK === 36));

console.log("— keytool");
check("بصمة من ناتج keytool -printcert", () => {
  const out = `Signer #1:\n\nCertificate #1:\nOwner: CN=Yacine\n\t SHA1: 00:11\n\t SHA256: ${A}\nSignature algorithm name: SHA256withRSA`;
  const fps = fingerprintsFromKeytool(out);
  expect(fps.length === 1 && fps[0] === A, JSON.stringify(fps));
});
check("سطر «SHA256withRSA» لا يُحسب بصمة", () =>
  expect(fingerprintsFromKeytool("Signature algorithm name: SHA256withRSA").length === 0));
check("موقِّعان: بصمتان بلا تكرار", () =>
  expect(fingerprintsFromKeytool(`SHA256: ${A}\nSHA-256: ${B}\nSHA256: ${A}`).length === 2));

console.log("— المشروع السليم");
check("لا خطأ ولا تنبيه", () => {
  const r = checkProject(BASE);
  expect(!levels(r).length && !warns(r).length, JSON.stringify(r));
});

console.log("— ما يمنع الرفع");
check("targetSdk 35 خطأ ويذكر Bubblewrap 1.25.0", () => {
  const r = checkProject({ ...BASE, gradle: parseGradle(GRADLE.replace("targetSdkVersion 36", "targetSdkVersion 35")) });
  expect(levels(r).some((m) => m.includes("1.25.0")), JSON.stringify(r));
});
check("الحزمة ليست في assetlinks: خطأ", () => {
  const r = checkProject({ ...BASE, assetlinks: buildAssetLinks("other.pkg.app", [A]) });
  expect(levels(r).some((m) => m.includes("assetlinks")));
});
check("نطاق غير المقصود: خطأ", () =>
  expect(levels(checkProject({ ...BASE, host: "taqwim-theta.vercel.app" })).length === 1));
check("startUrl غير /app: خطأ", () =>
  expect(levels(checkProject({ ...BASE, twa: { ...TWA, startUrl: "/" } })).length === 1));
check("display browser: خطأ", () =>
  expect(levels(checkProject({ ...BASE, twa: { ...TWA, display: "minimal-ui" } })).length === 1));
check("مفتاح التوقيع داخل المستودع: خطأ", () => {
  const r = checkProject({ ...BASE, signingKeyAbs: "/home/t/taqwim/android/k.keystore" });
  expect(levels(r).some((m) => m.includes("مفتاح التوقيع")));
});
check("applicationId يخالف packageId: خطأ", () => {
  const r = checkProject({ ...BASE, gradle: parseGradle(GRADLE.replace(`"${PKG}"`, '"x.y.z"')) });
  expect(levels(r).some((m) => m.includes("applicationId")));
});
check("لا twa-manifest: خطأ واحد ويتوقف", () => {
  const r = checkProject({ ...BASE, twa: null });
  expect(r.length === 1 && r[0].level === "error");
});
check("لا build.gradle: خطأ", () => expect(levels(checkProject({ ...BASE, gradle: null })).length === 1));

console.log("— تنبيهات لا تمنع");
check("appVersionCode لا يطابق versionCode: تنبيه", () => {
  const r = checkProject({ ...BASE, twa: { ...TWA, appVersionCode: 2 } });
  expect(!levels(r).length && warns(r).length === 1);
});
check("حقل غائب (اسم تغيّر في إصدار Bubblewrap): تنبيه لا خطأ", () => {
  const { orientation, display, ...rest } = TWA;
  const r = checkProject({ ...BASE, twa: rest });
  expect(!levels(r).length && warns(r).length === 1, JSON.stringify(r));
});

console.log("— بصمة الحزمة المبنية");
check("AAB موقّع بمفتاح الرفع وبصمته ليست في assetlinks: تنبيه Play App Signing لا خطأ", () => {
  const r = checkProject({ ...BASE, signerPrints: [B], forPlay: true });
  expect(!levels(r).length && warns(r).some((m) => m.includes("مفتاح توقيع التطبيق")));
});
check("APK للتوزيع المباشر وبصمته ليست في assetlinks: خطأ", () =>
  expect(levels(checkProject({ ...BASE, signerPrints: [B], forPlay: false })).length === 1));
check("بصمة الموقِّع في assetlinks: سليم", () =>
  expect(!levels(checkProject({ ...BASE, signerPrints: [A], forPlay: false })).length));
check("حزمة بلا توقيع: خطأ", () => expect(levels(checkProject({ ...BASE, signerPrints: [] })).length === 1));

console.log("— المساعدات");
check("insideRepo لا يخلط taqwim بـ taqwim-android", () => {
  expect(insideRepo("/home/t/taqwim/x.jks", "/home/t/taqwim"));
  expect(!insideRepo("/home/t/taqwim-android/x.jks", "/home/t/taqwim"));
  expect(!insideRepo(null, "/home/t/taqwim"));
});
check("assetLinkPrints يتجاهل حزمًا أخرى ومدخلات بلا العلاقة", () => {
  const mixed = [...buildAssetLinks("other.pkg.app", [B]), { relation: ["x"], target: { namespace: "android_app", package_name: PKG, sha256_cert_fingerprints: [B] } }, ...LINKS];
  const p = assetLinkPrints(mixed, PKG);
  expect(p.length === 1 && p[0] === A);
});
check("compareLive: بصمة في المستودع لم تُنشر بعد", () => {
  const repo = buildAssetLinks(PKG, [A, B]);
  const c = compareLive(repo, LINKS, PKG);
  expect(c.missing.length === 1 && c.missing[0] === B && c.have === 1);
});

console.log("— الأمر نفسه على مشروع وهمي");
const tmp = mkdtempSync(join(tmpdir(), "taqwim-twa-"));
try {
  const proj = join(tmp, "taqwim-android");
  mkdirSync(join(proj, "app"), { recursive: true });
  // الحزمة الوحيدة في assetlinks.json الحقيقي في المستودع، ليمرّ فحص الحزمة
  const real = JSON.parse(readFileSync(join(ROOT, "public", ".well-known", "assetlinks.json"), "utf8"));
  const realPkg = real[0].target.package_name;
  writeFileSync(join(proj, "twa-manifest.json"), JSON.stringify({ ...TWA, packageId: realPkg, signingKey: { path: "./k.keystore", alias: "taqwim" } }));
  writeFileSync(join(proj, "app", "build.gradle"), GRADLE.replace(`"${PKG}"`, `"${realPkg}"`));
  const run = (args) => spawnSync(process.execPath, [join(ROOT, "android", "preflight.mjs"), ...args], { encoding: "utf8" });

  check("مشروع سليم: رمز 0", () => {
    const r = run(["--project", proj]);
    expect(r.status === 0, r.stdout + r.stderr);
    expect(r.stdout.includes("0 خطأ"));
  });
  check("targetSdk 35: رمز 1", () => {
    writeFileSync(join(proj, "app", "build.gradle"), GRADLE.replace(`"${PKG}"`, `"${realPkg}"`).replace("targetSdkVersion 36", "targetSdkVersion 35"));
    const r = run(["--project", proj]);
    expect(r.status === 1, r.stdout);
  });
  check("مجلد بلا مشروع: رمز 1", () => expect(run(["--project", tmp]).status === 1));
  check("بلا --project: رمز 1 ورسالة الاستعمال", () => {
    const r = run([]);
    expect(r.status === 1 && r.stderr.includes("--project"));
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("— الصفحات العامة التي يطلبها المتجر");
const mw = readFileSync(join(ROOT, "src", "middleware.ts"), "utf8");
const del = readFileSync(join(ROOT, "src", "app", "delete-account", "page.tsx"), "utf8");
const priv = readFileSync(join(ROOT, "src", "app", "privacy", "page.tsx"), "utf8");
const sw = readFileSync(join(ROOT, "public", "sw.js"), "utf8");
check("/delete-account لا يحوّلها الوسيط إلى الدخول", () => {
  const guarded = mw.match(/\[("[^"]+"(?:,\s*"[^"]+")*)\]\.some\(\(p\) => path\.startsWith\(p\)\)/);
  expect(guarded, "لم يُعثر على قائمة المسارات المحمية");
  const list = JSON.parse(`[${guarded[1]}]`);
  expect(!list.some((p) => "/delete-account".startsWith(p)), list.join(","));
  expect(!list.some((p) => "/privacy".startsWith(p)));
});
check("صفحة الحذف تسمّي التطبيق وتشير إلى /account و/privacy", () => {
  expect(del.includes("دفتر التقويم") && del.includes('href="/account"') && del.includes('href="/privacy"'));
});
check("صفحة الحذف تذكر المهلة والنسخ الاحتياطية", () => expect(del.includes("7 أيام") && del.includes("12 شهرًا")));
check("سياسة الخصوصية تشير إلى صفحة الحذف ولقسم الحذف مرساة", () =>
  expect(priv.includes('href="/delete-account"') && priv.includes('id="delete"')));
check("سياسة الخصوصية تذكر Gemini لملفات Excel لا للصور وحدها", () => expect(priv.includes("Excel") && priv.includes("Gemini")));
check("سياسة الخصوصية لا تقول «كل ليلة» عن النسخ (صار أسبوعيًّا)", () => expect(!priv.includes("كل ليلة")));
check("عامل الخدمة لا يخبّئ صفحة الحذف", () => expect(!sw.includes("delete-account")));

console.log(`\ntwa: ${ok} نجح، ${failed} فشل`);
process.exit(failed ? 1 : 0);
