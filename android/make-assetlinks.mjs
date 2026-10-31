#!/usr/bin/env node
/**
 * يكتب public/.well-known/assetlinks.json: الملف الذي يثبت لـ Chrome أن تطبيق Android
 * وهذا الموقع لصاحب واحد، فيفتح التطبيق بلا شريط عنوان (TWA).
 *
 * الاستعمال (من أي مكان):
 *   node android/make-assetlinks.mjs [--out <ملف>] <packageId> <SHA256> [<SHA256> ...]
 *
 * يضيف ولا يحذف: إن وُجد الملف تبقى بصماته السابقة وتُلحق الجديدة بها، فبصمة مفتاحك
 * وبصمة مفتاح Play تجتمعان بأمرين متتاليين أو بأمر واحد. لإزالة بصمة عدّل الملف بيدك.
 *
 * أي خطأ (حزمة أو بصمة غير صالحة، ملف موجود تالف) يُطبع ويخرج برمز 1، ولا يُمسّ الملف.
 * هذا الملف لا يُستورد: المنطق في android/assetlinks.mjs.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeAssetLinks } from "./assetlinks.mjs";

const USAGE = "الاستعمال: node android/make-assetlinks.mjs [--out <ملف>] <packageId> <SHA256> [<SHA256> ...]";

function fail(message) {
  console.error(`خطأ: ${message}`);
  process.exit(1);
}

function parse(argv) {
  const args = [...argv];
  let out = null;
  const rest = [];
  while (args.length) {
    const a = args.shift();
    if (a === "--out") {
      out = args.shift();
      if (!out) fail(`--out بلا مسار.\n${USAGE}`);
    } else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (a.startsWith("--")) {
      fail(`خيار غير معروف: ${a}\n${USAGE}`);
    } else {
      rest.push(a);
    }
  }
  const [packageId, ...fingerprints] = rest;
  if (!packageId) fail(USAGE);
  if (!fingerprints.length) fail(`لا بصمة. أعطِ بصمة SHA-256 واحدة على الأقل.\n${USAGE}`);
  return { out, packageId, fingerprints };
}

try {
  const { out, packageId, fingerprints } = parse(process.argv.slice(2));
  // الافتراضي public/.well-known في المستودع الذي فيه هذا الملف، أيًّا كان مكان التشغيل.
  const target = out
    ? resolve(out)
    : resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", ".well-known", "assetlinks.json");

  let existing = null;
  if (existsSync(target)) {
    try {
      existing = JSON.parse(readFileSync(target, "utf8"));
    } catch (problem) {
      fail(`الملف الموجود ${target} ليس JSON صالحًا (${problem.message}). لم يُمسّ.`);
    }
  }

  const { json, added, kept } = mergeAssetLinks(existing, packageId, fingerprints);
  mkdirSync(dirname(target), { recursive: true });
  // كتابة ثم إعادة تسمية: انقطاع في المنتصف لا يترك ملفًا نصفه مكتوب.
  const temp = `${target}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(json, null, 2) + "\n");
  renameSync(temp, target);
  const total = kept + added;
  console.log(`كُتب ${target}`);
  console.log(`  ${packageId}: ${total} بصمة (أُضيف ${added}، بقي ${kept} من قبل)`);
} catch (problem) {
  fail(problem && problem.message ? problem.message : String(problem));
}
