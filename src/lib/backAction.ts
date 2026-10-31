/* قرار زرّ الرجوع صافٍ بلا React، فيُختبر في scripts/check-back.mjs. يستعمله useBackLayers.ts. */

/** ما يُفعل حين يصل popstate. صافٍ ليُختبر في scripts/check-back.mjs. */
export type BackAction = "own" | "stay" | "exit" | "close";

export function backAction(s: { own: number; depth: number; blocked: boolean }): BackAction {
  // أطلقناه نحن بـ history.go فليس رجوعًا من الأستاذ.
  if (s.own > 0) return "own";
  // ورقة إلزامية: لا تُغلق، ويُعاد مدخلها.
  if (s.blocked && s.depth > 0) return "stay";
  // لا شيء من مداخلنا بقي: الرجوع يُخرج من التطبيق كما كان.
  if (s.depth === 0) return "exit";
  return "close";
}
