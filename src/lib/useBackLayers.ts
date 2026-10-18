"use client";

import { useEffect, useRef } from "react";

/**
 * زرّ الرجوع في الهاتف يغلق «الطبقة» العليا لا الصفحة.
 *
 * التطبيق كله في عنوان واحد (/app): القسم والبطاقة والنوافذ حالة في الشاشة لا
 * صفحات، فزرّ الرجوع في أندرويد كان يُخرج الأستاذ من التطبيق وهو في بطاقة
 * تلميذ. هنا يُكتب في سجلّ المتصفّح مدخلٌ لكل طبقة تُفتح، فيُغلق الضغط على
 * الرجوع الطبقة العليا ويبقى في الصفحة.
 *
 * `count` عدد الطبقات المفتوحة الآن، و`closeTop` يغلق العليا منها. وإن أُغلقت
 * طبقة بزرّ في الشاشة لا بالرجوع، يُرجَع السجلّ خطوة بصمت ليبقى مطابقًا لها.
 */
export function useBackLayers(count: number, closeTop: () => void) {
  /** مداخل السجلّ التي كتبناها ولم تُزَل بعد. */
  const depth = useRef(0);
  /** أحداث popstate التي سبّبناها نحن بـ history.go، فلا تُعامَل رجوعًا من الأستاذ. */
  const own = useRef(0);
  const top = useRef(closeTop);
  top.current = closeTop;

  useEffect(() => {
    if (count > depth.current) {
      for (let i = depth.current; i < count; i++) {
        window.history.pushState({ layer: i + 1 }, "");
      }
    } else if (count < depth.current) {
      own.current += 1;
      window.history.go(count - depth.current);
    }
    depth.current = count;
  }, [count]);

  useEffect(() => {
    const onPop = () => {
      if (own.current > 0) {
        own.current -= 1;
        return;
      }
      // لا شيء من مداخلنا بقي: الرجوع يُخرج من التطبيق كما كان.
      if (depth.current === 0) return;
      // المتصفّح أزال مدخلنا بنفسه، فلا نُرجِع السجلّ ثانية بعد الإغلاق.
      depth.current -= 1;
      top.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
