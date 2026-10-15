#!/usr/bin/env python3
"""أيقونات التطبيق على الشاشة الرئيسية.

ترسم دفترًا مفتوحًا بهامش من جهة اليمين وعلامة صحّ — بألوان globals.css نفسها.
تُشغَّل مرة عند تغيير الشكل فقط، ونتيجتها محفوظة في public/:

    python3 scripts/make-icons.py

تحتاج Pillow، وهي ليست من تبعيات المشروع: الأيقونات ملفات ثابتة في المستودع
ولا تُبنى مع التطبيق.
"""

from PIL import Image, ImageDraw

PRIMARY = (14, 106, 86)      # --primary
PAPER = (247, 251, 249)
SAND = (154, 100, 24)        # --sand
LINE = (200, 216, 209)

S = 4096                      # نرسم كبيرًا ثم نصغّر، فتخرج الحواف ناعمة


def draw(full_bleed: bool) -> Image.Image:
    """full_bleed: أيقونة maskable يقتطع النظام أطرافها، فيُترك هامش أوسع."""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # الخلفية: مربّع أخضر بزوايا مستديرة، أو ملء كامل للـ maskable
    if full_bleed:
        d.rectangle([0, 0, S, S], fill=PRIMARY)
        inset, radius = int(S * 0.26), int(S * 0.03)
    else:
        d.rounded_rectangle([0, 0, S, S], radius=int(S * 0.22), fill=PRIMARY)
        inset, radius = int(S * 0.20), int(S * 0.035)

    # ورقة الدفتر
    page = [inset, int(inset * 1.06), S - inset, S - int(inset * 1.06)]
    d.rounded_rectangle(page, radius=radius, fill=PAPER)

    left, top, right, bottom = page
    width, height = right - left, bottom - top

    # هامش الدفتر من جهة اليمين — الكتابة عربية
    margin_x = right - int(width * 0.17)
    d.line([margin_x, top + int(height * 0.08), margin_x, bottom - int(height * 0.08)],
           fill=SAND, width=int(S * 0.012))

    # ثلاثة أسطر في أعلى الورقة: صفوف التلاميذ
    for share in (0.20, 0.34, 0.48):
        y = top + height * share
        d.line([left + int(width * 0.13), y, margin_x - int(width * 0.07), y],
               fill=LINE, width=int(S * 0.020))

    # علامة الصحّ تحتها: النقطة وصلت
    w = int(S * 0.050)
    x0, y0 = left + int(width * 0.16), top + int(height * 0.74)
    d.line([x0, y0, x0 + int(width * 0.14), y0 + int(height * 0.13)],
           fill=PRIMARY, width=w, joint="curve")
    d.line([x0 + int(width * 0.14), y0 + int(height * 0.13),
            x0 + int(width * 0.46), y0 - int(height * 0.14)],
           fill=PRIMARY, width=w, joint="curve")

    return img


def save(img: Image.Image, name: str, size: int, opaque: bool = False) -> None:
    out = img.resize((size, size), Image.LANCZOS)
    if opaque:
        flat = Image.new("RGB", (size, size), PRIMARY)
        flat.paste(out, (0, 0), out)
        out = flat
    out.save(f"public/{name}")
    print(f"public/{name}")


plain = draw(full_bleed=False)
masked = draw(full_bleed=True)

save(plain, "icon-192.png", 192)
save(plain, "icon-512.png", 512)
save(masked, "icon-maskable-512.png", 512, opaque=True)
save(masked, "apple-touch-icon.png", 180, opaque=True)
save(plain, "favicon-32.png", 32)
