"use client";

import { kvGet, kvKeys } from "@/lib/localdb";
import type { Op } from "@/lib/outbox";

/**
 * كل ما لم يُرسل على هذا الجهاز، لأيّ حساب. تستعمله شاشة الخطأ، وهي لا تعرف
 * معرّف الأستاذ لأن الخطأ قد يقع قبل أن تُرسم الصفحة التي تحمله. قراءة فقط:
 * لا تمسّ الطابور.
 */
export async function readPendingOps(): Promise<Op[]> {
  try {
    const keys = await kvKeys("queue:");
    const all: Op[] = [];
    for (const key of keys) {
      const saved = await kvGet<Op[]>(key);
      if (Array.isArray(saved)) all.push(...saved);
    }
    return all;
  } catch {
    return [];
  }
}
