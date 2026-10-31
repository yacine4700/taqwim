#!/usr/bin/env node
/**
 * يولّد public/.well-known/assetlinks.json: الملف الذي يثبت لـ Chrome أن تطبيق
 * Android وهذا الموقع لصاحب واحد، فيفتح التطبيق كاملًا بلا شريط متصفح (TWA).
 *
 * الاستعمال (من جذر المشروع):
 *   node android/make-assetlinks.mjs <packageId> <SHA256> [<SHA256> ...]
 *
 * أعطه بصمة كل مفتاح توقيع تُثبَّت به نسخة من التطبيق: مفتاحك أنت للـ APK الذي
 * توزّعه بنفسك، ومفتاح «توقيع التطبيق» من Play Console إن نُشر التطبيق في Play.
 * الصيغة والعلاقة كما في وثائق Chrome (Android Concepts for Web Developers).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** اسم حزمة Android: مقطعان أو أكثر، يبدأ كل مقطع بحرف. */
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** يقبل بصمة بالنقطتين أو دونهما وبأي حالة أحرف، ويعيدها 32 زوجًا كبيرة مفصولة بنقطتين. */
export function normalizeFingerprint(value) {
  const hex = String(value).trim().replace(/^SHA-?256\s*[:=]?\s*/i, "").replace(/[:\s-]/g, "");
  if (!/^[0-9A-Fa-f]{64}$/.test(hex)) {
    throw new Error(`بصمة SHA-256 غير صالحة: «${value}» (المطلوب 64 خانة سداسية عشرية)`);
  }
  return hex.toUpperCase().match(/.{2}/g).join(":");
}

export function buildAssetLinks(packageId, fingerprints) {
  if (!PACKAGE_RE.test(String(packageId))) {
    throw new Error(`اسم الحزمة غير صالح: «${packageId}»`);
  }
  if (!fingerprints.length) throw new Error("لا بصمة. أعطِ بصمة واحدة على الأقل.");
  const unique = [...new Set(fingerprints.map(normalizeFingerprint))];
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageId,
        sha256_cert_fingerprints: unique,
      },
    },
  ];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const [packageId, ...fingerprints] = process.argv.slice(2);
  try {
    if (!packageId) throw new Error("الاستعمال: node android/make-assetlinks.mjs <packageId> <SHA256> [<SHA256> ...]");
    const json = buildAssetLinks(packageId, fingerprints);
    const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", ".well-known", "assetlinks.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(json, null, 2) + "\n");
    console.log(`كُتب ${out}`);
  } catch (problem) {
    console.error(problem.message);
    process.exit(1);
  }
}
