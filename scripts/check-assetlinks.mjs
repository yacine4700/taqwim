/**
 * اختبار assetlinks.json: المنطق (android/assetlinks.mjs) والأمر نفسه
 * (android/make-assetlinks.mjs) يُشغَّل فعلًا في مجلد مؤقت ويُقرأ ما كتبه.
 * الصيغة التي يقرؤها Chrome صارمة، وخطأ فيها يُسقط التحقق فيُفتح التطبيق بشريط عنوان.
 *
 * البصمات هنا بيانات اختبار تُكتب في مجلد مؤقت فقط، لا في public/ أبدًا.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAssetLinks, mergeAssetLinks, normalizeFingerprint } from "../android/assetlinks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "android", "make-assetlinks.mjs");

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
function throws(fn) {
  try {
    fn();
  } catch {
    return true;
  }
  return false;
}

const PKG = "io.github.yacine4700.taqwim";
const A = "14:6D:E9:83:C5:73:06:98:BC:60:A4:C2:CE:13:3B:76:16:5E:C7:79:34:05:E2:4A:D1:7B:E4:11:2D:89:BF:3A";
const B = "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";
const C = "00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF";

console.log("— assetlinks: المنطق");
check("بصمة بالصيغة المعتادة تبقى كما هي", () => expect(normalizeFingerprint(A) === A));
check("حروف صغيرة وبلا نقطتين: تُوحَّد", () =>
  expect(normalizeFingerprint(A.replace(/:/g, "").toLowerCase()) === A));
check("بادئة SHA256: كما تطبعها keytool تُحذف", () =>
  expect(normalizeFingerprint(`SHA256: ${A}`) === A));
check("بصمة قصيرة أو غير سداسية تُرفض", () => {
  expect(throws(() => normalizeFingerprint("AA:BB")));
  expect(throws(() => normalizeFingerprint("ZZ".repeat(32))));
});
check("البنية: علاقة handle_all_urls وnamespace android_app", () => {
  const [entry] = buildAssetLinks(PKG, [A]);
  expect(JSON.stringify(entry.relation) === '["delegate_permission/common.handle_all_urls"]');
  expect(entry.target.namespace === "android_app");
  expect(entry.target.package_name === PKG);
  expect(entry.target.sha256_cert_fingerprints.length === 1);
});
check("بصمتان (مفتاحك ومفتاح Play) في المدخلة نفسها", () => {
  const [entry] = buildAssetLinks(PKG, [A, B]);
  expect(entry.target.sha256_cert_fingerprints.join() === [A, B].join());
});
check("بصمة مكررة بصيغتين تُدمج", () => {
  const [entry] = buildAssetLinks(PKG, [A, A.toLowerCase()]);
  expect(entry.target.sha256_cert_fingerprints.length === 1);
});
check("اسم حزمة غير صالح أو بلا بصمة: خطأ", () => {
  expect(throws(() => buildAssetLinks("taqwim", [A])));
  expect(throws(() => buildAssetLinks("1abc.def", [A])));
  expect(throws(() => buildAssetLinks(PKG, [])));
});
check("الدمج: بصمة جديدة تُلحق والسابقة تبقى أولًا", () => {
  const { json, added, kept } = mergeAssetLinks(buildAssetLinks(PKG, [A]), PKG, [B]);
  expect(json[0].target.sha256_cert_fingerprints.join() === [A, B].join());
  expect(added === 1 && kept === 1);
});
check("الدمج: مدخلة حزمة أخرى تبقى كما هي حرفيًّا", () => {
  const other = { relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "org.example.other", sha256_cert_fingerprints: [C] } };
  const { json } = mergeAssetLinks([other], PKG, [A]);
  expect(json.length === 2 && JSON.stringify(json[0]) === JSON.stringify(other));
});
check("الدمج: ملف ليس مصفوفة أو فيه بصمة تالفة يُرفض", () => {
  expect(throws(() => mergeAssetLinks({ x: 1 }, PKG, [A])));
  expect(throws(() => mergeAssetLinks([{ relation: [], target: { namespace: "android_app", sha256_cert_fingerprints: ["AA"] } }], PKG, [A])));
});

/* ---------- الأمر نفسه ---------- */
const work = mkdtempSync(join(tmpdir(), "assetlinks-"));
const run = (args, opts = {}) => {
  const r = spawnSync(process.execPath, args, { encoding: "utf8", cwd: opts.cwd ?? work });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const printsOf = (f) => read(f).find((e) => e.target.package_name === PKG).target.sha256_cert_fingerprints;

console.log("— assetlinks: تشغيل الأمر فعليًّا");
try {
  const out = join(work, "a", "assetlinks.json");

  check("يكتب الملف برمز 0 ويقول ما فعل", () => {
    const r = run([CLI, "--out", out, PKG, `SHA256: ${A}`]);
    expect(r.code === 0, `code ${r.code}: ${r.err}`);
    expect(existsSync(out), "لم يُكتب الملف");
    expect(printsOf(out).join() === A);
    expect(/أُضيف 1/.test(r.out), r.out);
  });
  check("تشغيل ثانٍ ببصمة أخرى يضيفها ولا يحذف الأولى", () => {
    const r = run([CLI, "--out", out, PKG, B]);
    expect(r.code === 0, r.err);
    expect(printsOf(out).join() === [A, B].join(), JSON.stringify(printsOf(out)));
  });
  check("إعادة بصمة موجودة لا تكرّرها", () => {
    const r = run([CLI, "--out", out, PKG, A.toLowerCase()]);
    expect(r.code === 0 && printsOf(out).length === 2);
  });
  check("بصمة غير صالحة: رمز غير صفري ورسالة، والملف كما كان", () => {
    const before = readFileSync(out, "utf8");
    const r = run([CLI, "--out", out, PKG, "AA:BB"]);
    expect(r.code !== 0, `code ${r.code}`);
    expect(/بصمة SHA-256 غير صالحة/.test(r.err), r.err);
    expect(readFileSync(out, "utf8") === before);
  });
  check("اسم حزمة غير صالح: رمز غير صفري ورسالة", () => {
    const r = run([CLI, "--out", join(work, "x.json"), "taqwim", A]);
    expect(r.code !== 0 && /اسم الحزمة غير صالح/.test(r.err), r.err);
    expect(!existsSync(join(work, "x.json")));
  });
  check("بلا وسائط أو بلا بصمة: رمز غير صفري وطريقة الاستعمال", () => {
    const r1 = run([CLI]);
    const r2 = run([CLI, PKG]);
    expect(r1.code !== 0 && /الاستعمال/.test(r1.err), r1.err);
    expect(r2.code !== 0 && /لا بصمة/.test(r2.err), r2.err);
  });
  check("خيار غير معروف: رمز غير صفري", () => {
    const r = run([CLI, "--replace", PKG, A]);
    expect(r.code !== 0 && /خيار غير معروف/.test(r.err), r.err);
  });
  check("ملف موجود تالف (ليس JSON): رمز غير صفري، ولا يُكتب فوقه", () => {
    const bad = join(work, "bad.json");
    writeFileSync(bad, "{ نصف ملف");
    const r = run([CLI, "--out", bad, PKG, A]);
    expect(r.code !== 0 && /ليس JSON صالحًا/.test(r.err), r.err);
    expect(readFileSync(bad, "utf8") === "{ نصف ملف");
  });
  check("ملف موجود ببنية خاطئة: رمز غير صفري، ولا يُكتب فوقه", () => {
    const bad = join(work, "obj.json");
    writeFileSync(bad, '{"hello":1}');
    const r = run([CLI, "--out", bad, PKG, A]);
    expect(r.code !== 0 && readFileSync(bad, "utf8") === '{"hello":1}', r.err);
  });

  // نسخة من المستودع في مجلد مؤقت: الأمر بلا --out يكتب في public/.well-known بجوارها،
  // فيُختبر المسار الافتراضي دون كتابة شيء في public/ الحقيقي.
  const repo = join(work, "repo");
  mkdirSync(join(repo, "android"), { recursive: true });
  copyFileSync(CLI, join(repo, "android", "make-assetlinks.mjs"));
  copyFileSync(join(ROOT, "android", "assetlinks.mjs"), join(repo, "android", "assetlinks.mjs"));
  const defaultOut = join(repo, "public", ".well-known", "assetlinks.json");
  const reset = () => rmSync(join(repo, "public"), { recursive: true, force: true });

  check("بلا --out: يكتب public/.well-known/assetlinks.json في مستودعه", () => {
    reset();
    const r = run([join(repo, "android", "make-assetlinks.mjs"), PKG, A]);
    expect(r.code === 0 && existsSync(defaultOut), r.err);
  });
  check("عبر مسار رمزي إلى الأمر: يكتب ولا يخرج صامتًا برمز 0", () => {
    reset();
    const link = join(work, "link.mjs");
    symlinkSync(join(repo, "android", "make-assetlinks.mjs"), link);
    const r = run([link, PKG, A]);
    expect(r.code === 0, `code ${r.code}: ${r.err}`);
    expect(existsSync(defaultOut), "لم يُكتب شيء عبر المسار الرمزي");
  });
  check("عبر مجلد رمزي إلى المستودع: يكتب", () => {
    reset();
    const linkedRepo = join(work, "repo-link");
    symlinkSync(repo, linkedRepo, "dir");
    const r = run([join(linkedRepo, "android", "make-assetlinks.mjs"), PKG, A]);
    expect(r.code === 0 && existsSync(defaultOut), `code ${r.code}: ${r.err}`);
  });
  check("بمسار غير مطبَّع (android/../android/…) ومن مجلد آخر: يكتب", () => {
    reset();
    const odd = join(repo, "android", "..", "android", "make-assetlinks.mjs");
    const r = run([relative(work, odd).replace("android/make", "android/../android/make"), PKG, A], { cwd: work });
    expect(r.code === 0 && existsSync(defaultOut), `code ${r.code}: ${r.err}`);
  });
  check("بمسار نسبي من جذر المستودع (كما في README)", () => {
    reset();
    const r = run(["android/make-assetlinks.mjs", PKG, A], { cwd: repo });
    expect(r.code === 0 && existsSync(defaultOut), r.err);
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}

/* ---------- الوسيط لا يمسّ الملف ---------- */
console.log("— الوسيط (src/middleware.ts)");
check("مسار /.well-known/ خارج مرشّح الوسيط، و/app و/login داخله", () => {
  const src = readFileSync(join(ROOT, "src", "middleware.ts"), "utf8");
  const m = src.match(/matcher:\s*\[\s*"([^"]+)"/);
  expect(m, "لم يوجد matcher");
  // تقريب لما يفعله Next بالنمط (path-to-regexp): الجزء بين القوسين تعبير منتظم على المسار.
  const re = new RegExp("^" + m[1].replace(/\\\\/g, "\\") + "$");
  expect(!re.test("/.well-known/assetlinks.json"), "assetlinks.json يمرّ بالوسيط");
  expect(re.test("/app") && re.test("/login") && re.test("/account"), "صفحات الحساب خرجت من الوسيط");
});

console.log(`\n${ok} ok, ${failed} failed`);
if (failed) process.exit(1);
