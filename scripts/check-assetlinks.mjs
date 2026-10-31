/**
 * اختبار توليد assetlinks.json (android/make-assetlinks.mjs): الصيغة التي يقرؤها
 * Chrome صارمة، وخطأ فيها يُسقط التحقق فيُفتح التطبيق بشريط متصفح.
 */
import { buildAssetLinks, normalizeFingerprint } from "../android/make-assetlinks.mjs";

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

const A = "14:6D:E9:83:C5:73:06:98:BC:60:A4:C2:CE:13:3B:76:16:5E:C7:79:34:05:E2:4A:D1:7B:E4:11:2D:89:BF:3A";
const B = "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

console.log("— assetlinks");
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
  const [entry] = buildAssetLinks("io.github.yacine4700.taqwim", [A]);
  expect(JSON.stringify(entry.relation) === '["delegate_permission/common.handle_all_urls"]');
  expect(entry.target.namespace === "android_app");
  expect(entry.target.package_name === "io.github.yacine4700.taqwim");
  expect(entry.target.sha256_cert_fingerprints.length === 1);
});
check("بصمتان (مفتاحك ومفتاح Play) في المدخلة نفسها", () => {
  const [entry] = buildAssetLinks("io.github.yacine4700.taqwim", [A, B]);
  expect(entry.target.sha256_cert_fingerprints.join() === [A, B].join());
});
check("بصمة مكررة بصيغتين تُدمج", () => {
  const [entry] = buildAssetLinks("io.github.yacine4700.taqwim", [A, A.toLowerCase()]);
  expect(entry.target.sha256_cert_fingerprints.length === 1);
});
check("اسم حزمة غير صالح أو بلا بصمة: خطأ", () => {
  expect(throws(() => buildAssetLinks("taqwim", [A])));
  expect(throws(() => buildAssetLinks("1abc.def", [A])));
  expect(throws(() => buildAssetLinks("io.github.yacine4700.taqwim", [])));
});
check("الناتج JSON صالح يُقرأ ثانية", () => {
  const text = JSON.stringify(buildAssetLinks("io.github.yacine4700.taqwim", [A]));
  expect(Array.isArray(JSON.parse(text)));
});

console.log(`\n${ok} ok, ${failed} failed`);
if (failed) process.exit(1);
