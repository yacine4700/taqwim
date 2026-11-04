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
import { buildAssetLinks, checkPackage } from "../android/assetlinks.mjs";
import {
  DECIDED_PACKAGE,
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
check("APK مباشر: الحزمة ليست في assetlinks خطأ", () => {
  const r = checkProject({ ...BASE, forPlay: false, assetlinks: buildAssetLinks("other.pkg.app", [A]) });
  expect(levels(r).some((m) => m.includes("assetlinks")));
});
check("AAB لـPlay: الحزمة ليست بعد في assetlinks تنبيه لا خطأ (تنتظر بصمة Play)", () => {
  const r = checkProject({ ...BASE, forPlay: true, assetlinks: buildAssetLinks("other.pkg.app", [A]) });
  expect(!levels(r).length && warns(r).some((m) => m.includes("Play")), JSON.stringify(r));
});
check("اسم الحزمة المعتمد: يطابق فيمرّ", () => {
  const r = checkProject({ ...BASE, expectedPackage: PKG });
  expect(!levels(r).length);
});
check("اسم حزمة غير المعتمد (الاسم القديم مثلًا): خطأ يذكر bubblewrap update", () => {
  const r = checkProject({ ...BASE, expectedPackage: DECIDED_PACKAGE });
  expect(levels(r).some((m) => m.includes(DECIDED_PACKAGE) && m.includes("bubblewrap update")), JSON.stringify(r));
});
check("الاسم المعتمد صالح ولا يحمل اسم المنصّة", () => {
  checkPackage(DECIDED_PACKAGE);
  expect(DECIDED_PACKAGE === "io.github.yacine4700.taqwim");
  expect(!/vercel|theta/.test(DECIDED_PACKAGE));
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
  // assetlinks مؤقّت فيه الحزمة المعتمدة: الملف الحقيقي في المستودع لا يضمّها قبل بصمة Play
  const realPkg = DECIDED_PACKAGE;
  const linksFile = join(tmp, "assetlinks.json");
  writeFileSync(linksFile, JSON.stringify(buildAssetLinks(realPkg, [A])));
  writeFileSync(join(proj, "twa-manifest.json"), JSON.stringify({ ...TWA, packageId: realPkg, signingKey: { path: "./k.keystore", alias: "taqwim" } }));
  writeFileSync(join(proj, "app", "build.gradle"), GRADLE.replace(`"${PKG}"`, `"${realPkg}"`));
  const run = (args) => spawnSync(process.execPath, [join(ROOT, "android", "preflight.mjs"), ...args, "--assetlinks", linksFile], { encoding: "utf8" });

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
  check("packageId القديم في twa-manifest: رمز 1", () => {
    writeFileSync(join(proj, "app", "build.gradle"), GRADLE.replace(`"${PKG}"`, `"${realPkg}"`));
    writeFileSync(join(proj, "twa-manifest.json"), JSON.stringify({ ...TWA, packageId: "app.vercel.taqwim_theta.twa", signingKey: { path: "./k.keystore", alias: "taqwim" } }));
    const r = run(["--project", proj]);
    expect(r.status === 1 && r.stdout.includes(DECIDED_PACKAGE), r.stdout);
  });
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
  expect(!list.some((p) => "/terms".startsWith(p)), "/terms عامة");
  expect(list.includes("/consent"), "/consent خلف الجلسة");
});
check("صفحة الحذف تسمّي التطبيق وتشير إلى /account و/privacy", () => {
  expect(del.includes("دفتر التقويم") && del.includes('href="/account"') && del.includes('href="/privacy"'));
});
check("صفحة الحذف تذكر المهلة والنسخ الاحتياطية", () => expect(del.includes("7 أيام") && del.includes("12 شهرًا")));
check("سياسة الخصوصية تشير إلى صفحة الحذف ولقسم الحذف مرساة", () =>
  expect(priv.includes('href="/delete-account"') && priv.includes('id="delete"')));
check("سياسة الخصوصية تذكر Gemini لملفات Excel لا للصور وحدها", () => expect(priv.includes("Excel") && priv.includes("Gemini")));
check("سياسة الخصوصية لا تقول «كل ليلة» عن النسخ (صار أسبوعيًّا)", () => expect(!priv.includes("كل ليلة")));
check("لا وعد مطلق بمهلة الحذف ولا بمدة النسخ: صيغتا «عادةً» و«نحو»", () => {
  for (const page of [priv, del]) {
    expect(!page.includes("أقصاه 14"), "مهلة 14 يومًا ليست مضمونة");
    expect(!page.includes("12 شهرًا على الأكثر"), "12 شهرًا على الأكثر ليست مضمونة");
    expect(page.includes("عادةً خلال 14 يومًا") && page.includes("نحو 13 شهرًا بعد الحذف"));
    expect(!page.includes("نحو 12 شهرًا"), "المدة الصحيحة نحو 13 شهرًا بعد الحذف (12 + سلة Drive)");
  }
});
check("الخصوصية تذكر أن ورقة Excel تُرسل كلها إلى Gemini لا الأسماء وحدها", () => expect(priv.includes("كل</strong>") || priv.includes("<strong>كل</strong>")));
check("سجلّ العمليات: الحذف بطلب الأستاذ يختلف عن حذف المشرف الفوري (بريد مقنَّع وسبب)", () => {
  for (const page of [priv, del]) expect(page.includes("مقنَّعًا") && page.includes("مشرف التطبيق"));
});
check("الخصوصية: Gemini المدفوع بلا تضخيم — لا تحسين منتجات، مع استثناءات التسجيل والإفصاح القانوني", () => {
  expect(priv.includes("الخدمات المدفوعة") && priv.includes("لتحسين منتجاتها"), "ادعاء المستوى المدفوع");
  expect(priv.includes("لكن لذلك استثناءات") && priv.includes("كشف مخالفات") && priv.includes("قانون"), "الاستثناءات");
  expect(priv.includes("للأساتذة وحدهم") && priv.includes("لا حسابات للتلاميذ"), "التطبيق للأساتذة وحدهم");
  expect(priv.includes("بكل ما يظهر فيها من أسماء وغيرها") && priv.includes("أي بلد"), "إفصاح بيانات التلاميذ ضمن طلب الأستاذ وبلد التخزين");
  // عبارات أوسع مما تسمح به شروط Google
  for (const bad of ["لا تُسجَّل", "لا تسجّل Google", "لا يطّلع", "لا يراها أحد", "تُحذف فورًا", "لا تُخزَّن"]) {
    expect(!priv.includes(bad), `عبارة أوسع من الشروط: ${bad}`);
  }
});
check("لا عنوان بريد مكتوب في الصفحات العامة: يأتي من NEXT_PUBLIC_CONTACT_EMAIL وحده", () => {
  const login = readFileSync(join(ROOT, "src", "app", "login", "page.tsx"), "utf8");
  for (const [name, text] of [["privacy", priv], ["delete-account", del], ["login", login], ["terms", readFileSync(join(ROOT, "src", "app", "terms", "page.tsx"), "utf8")]]) {
    expect(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test(text), `بريد مكتوب في ${name}`);
  }
  expect(priv.includes("process.env.NEXT_PUBLIC_CONTACT_EMAIL") && del.includes("process.env.NEXT_PUBLIC_CONTACT_EMAIL"));
  const envEx = readFileSync(join(ROOT, ".env.example"), "utf8");
  expect(/^NEXT_PUBLIC_CONTACT_EMAIL=taqwimsupport@gmail\.com$/m.test(envEx), "بريد الدعم الرسمي في .env.example");
});
/* ----- الإقرار والموافقة (أستاذ، 18 سنة فأكثر، خصوصية وشروط) ----- */
const SRC = (...p) => readFileSync(join(ROOT, "src", ...p), "utf8");
const authLib = SRC("lib", "auth.ts");
const loginSrc = SRC("app", "login", "page.tsx");
const fieldSrc = SRC("app", "ConsentField.tsx");
const consentPage = SRC("app", "consent", "page.tsx");
const consentClient = SRC("app", "consent", "ConsentClient.tsx");
const appPage = SRC("app", "app", "page.tsx");
const mwSrc = SRC("middleware.ts");
const termsSrc = SRC("app", "terms", "page.tsx");
const REQUIRED_TEXT = "أقرّ بأنني أستاذ، وأن عمري 18 سنة أو أكثر، وأوافق على سياسة الخصوصية وشروط استخدام التطبيق";
/** ما يظهر فعلًا من نصّ JSX: الأسطر تُقصّ وتُلصق بلا فراغ، و{" "} فراغ صريح، والوسوم تسقط. */
function jsxText(src) {
  const span = src.slice(src.indexOf("<span>"), src.indexOf("</span>"));
  return span.split("\n").map((l) => l.trim()).join("").replace(/\{" "\}/g, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
check("نصّ الإقرار المطلوب حرفيًّا في خانة الموافقة وفي auth.ts", () => {
  expect(jsxText(fieldSrc) === `${REQUIRED_TEXT}.`, `النصّ الظاهر: ${jsxText(fieldSrc)}`);
  expect(authLib.includes(`"${REQUIRED_TEXT}"`), "CONSENT_TEXT في auth.ts");
  expect(/href="\/privacy"/.test(fieldSrc) && /href="\/terms"/.test(fieldSrc), "رابطا الخصوصية والشروط");
});
check("الخانة إلزامية: required في HTML، وconsentProblem قبل signUp، وزرّ الإنشاء لا يتجاوزها", () => {
  expect(/<input[^>]*type="checkbox"[^>]*required|<input[\s\S]{0,200}required/.test(fieldSrc), "required في الخانة");
  expect(loginSrc.includes("<ConsentField checked={accepted}"), "التسجيل يستعمل الخانة المشتركة");
  const consentAt = loginSrc.indexOf("consentProblem(accepted)");
  const signUpAt = loginSrc.indexOf("supabase.auth.signUp");
  expect(consentAt > 0 && signUpAt > consentAt, "الفحص في الشفرة قبل signUp");
  expect(/const \[accepted, setAccepted\] = useState\(false\)/.test(loginSrc), "تبدأ غير محدَّدة");
});
check("النسخة الجديدة: PRIVACY_VERSION في المصدر والنسخة المرآة في check-auth متطابقتان", () => {
  const m = /export const PRIVACY_VERSION = "([^"]+)"/.exec(authLib);
  const mirror = /const PRIVACY_VERSION = "([^"]+)"/.exec(readFileSync(join(ROOT, "scripts", "check-auth.mjs"), "utf8"));
  expect(m && mirror && m[1] === mirror[1] && m[1] !== "2026-11-04", `المصدر ${m && m[1]} والمرآة ${mirror && mirror[1]}`);
});
check("الحساب القائم يُحوَّل إلى /consent بعد فحص مهلة الحذف، و/consent محميّة بالوسيط", () => {
  const del = appPage.indexOf("pendingPurge(status)");
  const gate = appPage.indexOf("needsConsent(user.user_metadata)");
  const open = appPage.indexOf("<AppClient");
  expect(del > 0 && gate > del && open > gate, "الترتيب: حذف ← موافقة ← التطبيق");
  expect(appPage.includes('redirect("/consent")'));
  expect(mwSrc.includes('"/consent"'), "الوسيط");
  expect(consentPage.includes('redirect("/login")') && consentPage.includes('redirect("/app")') && consentPage.includes("needsConsent("));
});
check("حفظ الموافقة: updateUser بـconsentMetadata وبالطريقة نفسها (بيانات المستخدم لا جدول جديد)", () => {
  expect(consentClient.includes("auth.updateUser({ data: consentMetadata(new Date()) })"));
  expect(consentClient.includes("consentProblem(accepted)"));
  expect(!/from\("|\.rpc\(/.test(consentClient), "لا استعلام قاعدة بيانات");
  expect(loginSrc.includes("signupMetadata(name, new Date())"));
});
check("لا جمع لتاريخ ميلاد أو وثيقة هوية في التسجيل ولا الموافقة", () => {
  for (const [n, t] of [["login", loginSrc], ["consent", consentClient], ["field", fieldSrc]]) {
    expect(!/birth|ميلاد|passport|جواز|بطاقة التعريف|national_id/i.test(t), `أثر في ${n}`);
  }
  expect(!/type="date"/.test(loginSrc + consentClient));
});
check("«الخروج» من شاشة الموافقة لا يمحو ما على الجهاز (علامات لم تُرسل)", () => {
  expect(!/kvDel|clearAppCaches|outbox/.test(consentClient));
});
check("صفحة /terms: لا بريد مكتوب، وتذكر 18 سنة وأن لا حسابات للتلاميذ، والخصوصية تربط بها", () => {
  expect(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test(termsSrc) && termsSrc.includes("process.env.NEXT_PUBLIC_CONTACT_EMAIL"));
  expect(termsSrc.includes("18 سنة") && termsSrc.includes("لا حسابات للتلاميذ"));
  expect(priv.includes('href="/terms"') && priv.includes("18 سنة"));
});
check("عامل الخدمة لا يخبّئ /consent ولا /terms", () => expect(!sw.includes("consent") && !sw.includes("terms")));
/* ----- مراجعة 4 نوفمبر: مطابقة النصوص للشفرة ----- */
const importSrc = SRC("app", "app", "ImportSheet.tsx");
const termsPage = readFileSync(join(ROOT, "src", "app", "terms", "page.tsx"), "utf8");
check("Excel: لا إرسال إلى Gemini قبل موافقة صريحة تسمّي الأوراق", () => {
  const read = importSrc.slice(importSrc.indexOf("async function readWorkbook"), importSrc.indexOf("async function sendPendingAi"));
  expect(read.length > 0 && !read.includes("askAi("), "readWorkbook لا ينادي askAi");
  expect(read.includes("setPendingAi({ sheets: hard"), "الأوراق تنتظر الموافقة");
  expect(importSrc.includes("أرسلها إلى Gemini") && importSrc.includes("لا، سأكتبها بيدي"));
  expect(importSrc.includes("onClick={() => void sendPendingAi()}") && importSrc.includes("onClick={declinePendingAi}"));
});
check("Excel: الأوراق المخفية لا تُرسل أبدًا", () => {
  const hiddenAt = importSrc.indexOf("} else if (hiddenFlags[index]) {");
  const aiAt = importSrc.indexOf("} else if (hard.length < MAX_AI_SHEETS) {");
  expect(hiddenAt > 0 && aiAt > hiddenAt, "فحص Hidden قبل الإضافة إلى ما يُرسل");
  expect(importSrc.includes("book.Workbook?.Sheets"));
});
check("الصورة: لا يُرسل الملف الأصلي (EXIF) إن تعذّر التصغير، وتنبيه Google تحت زرّ القراءة", () => {
  expect(!importSrc.includes("fileAsBase64"), "لا بديل يرسل الأصل");
  expect(importSrc.includes('id="import-ai-notice"') && /إلى Gemini من Google/.test(importSrc));
});
check("الخصوصية والحذف: مصطلحات صحيحة (تجزئة لا تشفير، SHA-1، معرّف داخلي)", () => {
  for (const page of [priv, del]) {
    expect(!page.includes("مُشفَّرةً بطريقة") && !page.includes("المحفوظة مُشفَّرة"), "كلمة السر تجزئة");
    expect(!page.includes("معرّف رقمي"), "المعرّف UUID");
  }
  expect(priv.includes("bcrypt") && priv.includes("SHA-1") && !priv.includes("بصمتها المشفّرة"));
});
check("الخصوصية: النسخ لا «تُشفَّر قبل أن تغادر الخادم»، وخوادم GitHub تعالجها صريحة", () => {
  expect(!priv.includes("قبل أن تغادر الخادم"));
  expect(priv.includes("خوادم GitHub تعالج البيانات غير") && priv.includes("مشفّرة دقائق"));
});
check("منطقة الخادم: vercel.json على fra1، والخصوصية تقول فرانكفورت وخارج الجزائر", () => {
  const vj = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  expect(JSON.stringify(vj.regions) === '["fra1"]', "regions");
  expect(priv.includes("خارج الجزائر") && priv.includes("ومعالجته في فرانكفورت"));
});
check("الخصوصية: المشرف، والسجلّ ومدته، والاستعادة، وغير المؤكَّد، والجهاز، والحقوق", () => {
  for (const t of ["لوحة الإشراف", "سنة واحدة", "استعادته من نسخة", "لم يُؤكَّد بريده", "لا تمسحها", "السلطة الوطنية لحماية", "خانة الغياب"]) {
    expect(priv.includes(t), t);
  }
  expect(!priv.includes("هي لك وحدك"));
  // استثناءات trim_audit_log في ترحيل 20261104190000: النصّ يطابق الدالة
  const mig = readFileSync(join(ROOT, "supabase", "migrations", "20261104190000_audit_log_retention.sql"), "utf8");
  expect(mig.includes("interval '1 year'") && mig.includes("private.audit_hold") && mig.includes("deletion_requests") && mig.includes("banned_until"));
  for (const t of ["ما زال موقوفًا", "طلب حذف لم يُنفَّذ", "محجوز مؤقتًا لتحقيق"]) expect(priv.includes(t), t);
});
check("الروابط: /terms من الدخول والإعدادات والحذف والخصوصية", () => {
  expect(loginSrc.includes('href="/terms"') && SRC("app", "app", "SettingsView.tsx").includes('href="/terms"'));
  expect(del.includes('href="/terms"') && priv.includes('href="/terms"') && termsPage.includes('href="/privacy"'));
});
check("الشروط والخصوصية: صفة المشغّل بلا اسم شخصي", () => {
  for (const t of [priv, termsPage]) expect(t.includes("أستاذٌ في التعليم الثانوي بالجزائر، بصفته الفردية"));
});
check("عامل الخدمة لا يخبّئ صفحة الحذف", () => expect(!sw.includes("delete-account")));

console.log(`\ntwa: ${ok} نجح، ${failed} فشل`);
process.exit(failed ? 1 : 0);
