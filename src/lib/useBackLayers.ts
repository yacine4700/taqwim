"use client";

import { useEffect, useRef } from "react";
import { backAction } from "./backAction";

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
 *
 * `blocked`: ورقة إلزامية مفتوحة (لا تُغلق بنقرة خارجها ولا بزرّ، كإصلاح قسم بلا
 * مؤسسة). لها مدخلها في السجلّ كأي طبقة، لكن الرجوع لا يغلقها: يُعاد المدخل فتبقى
 * الورقة وتبقى الأسفل منها، ولا يخرج الأستاذ من التطبيق وهي مفتوحة.
 */

export function useBackLayers(count: number, closeTop: () => void, blocked = false) {
  /** مداخل السجلّ التي كتبناها ولم تُزَل بعد. */
  const depth = useRef(0);
  /** أحداث popstate التي سبّبناها نحن بـ history.go، فلا تُعامَل رجوعًا من الأستاذ. */
  const own = useRef(0);
  const top = useRef(closeTop);
  top.current = closeTop;
  const isBlocked = useRef(blocked);
  isBlocked.current = blocked;
  // الورقة الإلزامية طبقة لها مدخل، فلا يجد الرجوع سجلًّا فارغًا ويخرج من التطبيق.
  const total = count + (blocked ? 1 : 0);

  useEffect(() => {
    if (total > depth.current) {
      for (let i = depth.current; i < total; i++) {
        window.history.pushState({ layer: i + 1 }, "");
      }
    } else if (total < depth.current) {
      own.current += 1;
      window.history.go(total - depth.current);
    }
    depth.current = total;
  }, [total]);

  useEffect(() => {
    const onPop = () => {
      const action = backAction({
        own: own.current,
        depth: depth.current,
        blocked: isBlocked.current,
      });
      if (action === "own") {
        own.current -= 1;
        return;
      }
      if (action === "exit") return;
      if (action === "stay") {
        // المتصفّح أزال مدخل الورقة: يُكتب من جديد فتبقى مكانها والعمق كما هو.
        window.history.pushState({ layer: depth.current }, "");
        return;
      }
      // المتصفّح أزال مدخلنا بنفسه، فلا نُرجِع السجلّ ثانية بعد الإغلاق.
      depth.current -= 1;
      top.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
