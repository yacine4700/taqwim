#!/usr/bin/env node
/**
 * فحص ما قبل الرفع إلى Google Play لمشروع الغلاف (Bubblewrap) على حاسوبك.
 *
 * الاستعمال (من أي مكان، بعد `bubblewrap build`):
 *   node <مستودع taqwim>/android/preflight.mjs --project ~/taqwim-android \
 *        [--host taqwim-theta.vercel.app] [--aab app-release-bundle.aab | --apk app-release-signed.apk] [--live]
 *
 * يقرأ twa-manifest.json وapp/build.gradle من مجلد المشروع، وassetlinks.json من هذا المستودع.
 * --aab / --apk: يقرأ بصمة شهادة الموقِّع بـ `keytool -printcert -jarfile` (شهادة عامة، لا سرّ فيها،
 *                ولا يُطلب ولا يُقرأ ملف المفتاح ولا كلمة مروره).
 * --assetlinks:  ملف assetlinks.json آخر بدل الذي في المستودع (للاختبار).
 * --live:        يجلب https://<host>/.well-known/assetlinks.json ويقارنه بما في المستودع.
 *
 * لا يكتب شيئًا ولا يعدّل شيئًا. يخرج برمز 1 إن وُجد خطأ يمنع الرفع.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DECIDED_PACKAGE, checkProject, compareLive, fingerprintsFromKeytool, parseGradle } from "./twa-check.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE =
  "الاستعمال: node android/preflight.mjs --project <مجلد Bubblewrap> [--host <النطاق>] [--aab <ملف> | --apk <ملف>] [--live] [--assetlinks <ملف>]";

function fail(msg) {
  console.error(`خطأ: ${msg}`);
  process.exit(1);
}

function parse(argv) {
  const o = { project: null, host: null, aab: null, apk: null, assetlinks: null, live: false };
  const a = [...argv];
  while (a.length) {
    const k = a.shift();
    if (k === "--live") o.live = true;
    else if (k === "-h" || k === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (["--project", "--host", "--aab", "--apk", "--assetlinks"].includes(k)) {
      const v = a.shift();
      if (!v) fail(`${k} بلا قيمة.\n${USAGE}`);
      o[k.slice(2)] = v;
    } else fail(`خيار غير معروف: ${k}\n${USAGE}`);
  }
  if (!o.project) fail(USAGE);
  if (o.aab && o.apk) fail("أعطِ --aab أو --apk، لا الاثنين.");
  return o;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`${path}: ${e.message}`);
  }
}

const opts = parse(process.argv.slice(2));
const project = resolve(opts.project);
const twaPath = resolve(project, "twa-manifest.json");
const gradlePath = resolve(project, "app", "build.gradle");
const twa = existsSync(twaPath) ? readJson(twaPath) : null;
const gradle = existsSync(gradlePath) ? parseGradle(readFileSync(gradlePath, "utf8")) : null;
const linksPath = opts.assetlinks ? resolve(opts.assetlinks) : resolve(REPO, "public", ".well-known", "assetlinks.json");
const assetlinks = existsSync(linksPath) ? readJson(linksPath) : [];
const host = opts.host ?? twa?.host ?? null;

let signingKeyAbs = null;
if (twa?.signingKey?.path) {
  signingKeyAbs = isAbsolute(twa.signingKey.path) ? twa.signingKey.path : resolve(project, twa.signingKey.path);
}

let signerPrints = null;
const pkgFile = opts.aab ?? opts.apk;
if (pkgFile) {
  if (!existsSync(pkgFile)) fail(`لا ملف: ${pkgFile}`);
  const r = spawnSync("keytool", ["-printcert", "-jarfile", resolve(pkgFile)], { encoding: "utf8" });
  if (r.error) fail(`تعذّر تشغيل keytool (${r.error.message}). هل JDK مثبّت؟`);
  signerPrints = fingerprintsFromKeytool(`${r.stdout}\n${r.stderr}`);
}

const results = checkProject({
  twa,
  gradle,
  assetlinks,
  host,
  signingKeyAbs,
  repoRoot: REPO,
  signerPrints,
  forPlay: !opts.apk,
  expectedPackage: DECIDED_PACKAGE,
});

if (opts.live && host && twa?.packageId) {
  const url = `https://${host}/.well-known/assetlinks.json`;
  try {
    const res = await fetch(url, { redirect: "manual" });
    const type = res.headers.get("content-type") ?? "";
    if (res.status !== 200) results.push({ level: "error", msg: `${url} ردّ بـ ${res.status} (التحويل غير مقبول).` });
    else {
      if (!type.includes("application/json")) results.push({ level: "warn", msg: `${url} نوعه ${type}، والمطلوب application/json.` });
      const live = await res.json();
      const cmp = compareLive(assetlinks, live, twa.packageId);
      if (cmp.missing.length) {
        results.push({ level: "error", msg: `المنشور ينقصه ${cmp.missing.length} بصمة مما في المستودع: ادمج في main وانتظر النشر.` });
      } else results.push({ level: "ok", msg: `المنشور على ${host} يطابق المستودع (${cmp.have} بصمة).` });
    }
  } catch (e) {
    results.push({ level: "warn", msg: `تعذّر جلب ${url}: ${e.message}` });
  }
}

const mark = { ok: "✓", warn: "!", error: "✗" };
for (const r of results) console.log(`${mark[r.level]} ${r.msg}`);
const errors = results.filter((r) => r.level === "error").length;
const warns = results.filter((r) => r.level === "warn").length;
console.log(`\n${errors} خطأ، ${warns} تنبيه.`);
process.exit(errors ? 1 : 0);
