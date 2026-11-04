"use client";

/**
 * خانة الإقرار والموافقة: مصدر واحد لنصّها في التسجيل (/login) وشاشة /consent، فلا يختلف
 * النصّ بين الموضعين. عبارتا السياسة والشروط رابطان يُفتحان في تبويب جديد كي لا يضيع
 * ما كُتب في النموذج. النصّ نفسه في CONSENT_TEXT (src/lib/auth.ts) للوثائق والاختبار.
 */
export default function ConsentField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="consent">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required
      />
      <span>
        أقرّ بأنني أستاذ، وأن عمري 18 سنة أو أكثر، وأوافق على{" "}
        <a href="/privacy" target="_blank" rel="noopener">
          سياسة الخصوصية
        </a>{" "}
        و
        <a href="/terms" target="_blank" rel="noopener">
          شروط استخدام التطبيق
        </a>
        .
      </span>
    </label>
  );
}
