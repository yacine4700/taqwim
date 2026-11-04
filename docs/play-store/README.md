# نشر «دفتر التقويم» على Google Play — الحالة والخطوات

آخر فحص: 4 نوفمبر 2026، على `main` = 2ecd580، وفرع التجهيز `play-store-prep`.

| الملف | ما فيه |
| --- | --- |
| `data-safety.md` | جرد البيانات من الشفرة، وإجابات Data safety |
| `store-listing.md` | الاسم والوصفان والفئة ومواصفات الصور |
| `app-access.md` | دخول المراجعين وما يحتاجه حسابهم |
| `declarations.md` | التصنيف والجمهور والإعلانات والصلاحيات والإقرارات |
| `../../android/README.md` | بناء الغلاف والتوقيع وassetlinks، و`preflight.mjs` |

## الحالة بأربعة مستويات

| المستوى | الحالة | ما ينقص |
| --- | --- | --- |
| جاهز تقنيًّا | **لا** | لم يُبنَ AAB. بيئتي بلا Android SDK ولا Bubblewrap (npm وخوادم Google محجوبة). لا أعرف إصدار Bubblewrap الذي بنيت به الـAPK في 31 أكتوبر: ما قبل 1.25.0 يهدف API 35، وPlay يشترط 36، و`preflight.mjs` يكشف ذلك. لم يُجرَّب على هاتف ولا فُحص `assetlinks.json` المنشور من هنا. |
| جاهز من ناحية السياسات والوثائق | **مسودّة** | صفحة حذف الحساب العامة وتحديث الخصوصية في فرع لم يُدمج؛ تحتاج اعتمادك وبريد التواصل. Feature graphic ولقطات الشاشة غير موجودة. |
| جاهز للرفع إلى Internal testing | **لا** | يلزم: AAB بهدف 36، وإنشاء التطبيق في Play Console، وقرار اسم الحزمة والتوقيع. |
| جاهز للإنتاج | **لا** | فوق ما سبق: حساب مراجعة، وبصمة Play App Signing في `assetlinks.json` منشورة، ولقطات، و**اختبار مغلق بـ 12 مختبِرًا 14 يومًا متصلة** إن كان حساب المطوّر شخصيًّا أُنشئ بعد 13 نوفمبر 2023. ومن العوائق المعروفة في `claude/تسليم-المشروع.md`: الخطة المجانية لـ Supabase (تجمّد بعد أسبوع)، والطابور لم يُجرَّب طرفًا إلى طرف على هاتف. |

## قرارات معلّقة — لا أتخذها عنك

1. **اسم الحزمة (لا يتغيّر بعد أول رفع).** `assetlinks.json` المنشور فيه `app.vercel.taqwim_theta.twa`
   (من APK بنيته في 31 أكتوبر)، و`android/README.md` اقترح `io.github.yacine4700.taqwim`.
   - الإبقاء على `app.vercel.taqwim_theta.twa`: من ثبّت الـAPK يبقى على التطبيق نفسه. عيبه شكلي: الاسم فيه
     `vercel` و`theta` ويبقى ولو غيّرت النطاق.
   - اسم جديد: تطبيق آخر في نظر Android؛ من ثبّت الـAPK يحذفه ويثبّت نسخة المتجر.
2. **مفتاح توقيع التطبيق في Play App Signing.**
   - (أ) Google تولّد المفتاح (افتراضي Play): مفتاحك الحالي يصير «مفتاح رفع» يمكن استبداله إن ضاع. تُضاف بصمة
     Google إلى `assetlinks.json`. نسخة المتجر لا تُحدِّث الـAPK المثبَّت يدويًّا (شهادتان مختلفتان).
   - (ب) ترفع مفتاحك الحالي ليكون مفتاح توقيع التطبيق: الشهادة واحدة، فمن ثبّت الـAPK يحدّث من المتجر،
     وبصمة واحدة تكفي. لكنه قرار لا رجعة فيه لهذا التطبيق، ويلزمك حينها مفتاح رفع ثانٍ.
3. **النطاق.** `taqwim-theta.vercel.app` مؤقّت بقرارك. تغييره بعد النشر ممكن بتحديث للغلاف (اسم الحزمة يبقى)،
   لكن كل نسخة قديمة تفتح بشريط عنوان حتى تُحدَّث.
4. **بريد التواصل العام** في Play وفي `NEXT_PUBLIC_CONTACT_EMAIL`. بغيره لا تظهر فقرة «لا تستطيع الدخول؟» في
   صفحة الحذف ولا قسم التواصل في الخصوصية.
5. **نصّ سياسة الخصوصية** (فرع `play-store-prep`): اعتمده قبل الدمج. رُفعت نسختها إلى `2026-11-04`، فمن
   ينشئ حسابًا بعد الدمج تُسجَّل موافقته على النسخة الجديدة.
6. **حساب شخصي أم مؤسسة في Play Console** (ورسوم التسجيل لمرة واحدة، 25 دولارًا وقت آخر اطلاع — تحقّق في
   الصفحة: هذا يمسّ مبدأ «0 دينار»).
7. Data safety: ثلاثة أسئلة في آخر `data-safety.md`.

## ما يلزم لبناء AAB على حاسوبك

مشروع الغلاف ومفتاحه عندك (`~/taqwim-android` بحسب الدليل)، ولم أنشئ ولم ألمس أي مفتاح.

```bash
node -v                                # 18 أو أحدث
npm i -g @bubblewrap/cli@latest        # يجب 1.25.0 أو أحدث (targetSdk 36)
bubblewrap --version
bubblewrap doctor                      # يفحص JDK وAndroid SDK؛ يعرض تنزيلهما إن غابا
cd ~/taqwim-android
cp twa-manifest.json twa-manifest.json.bak
bubblewrap update                      # يعيد توليد app/build.gradle بقالب الإصدار الجديد ويرفع versionCode
bubblewrap build                       # يسأل كلمة مرور المفتاح؛ يُنتج app-release-bundle.aab وapp-release-signed.apk
node ~/<مسار>/taqwim/android/preflight.mjs --project . --aab app-release-bundle.aab --live
```

`preflight` يجب أن ينتهي بـ «0 خطأ». التنبيه الوحيد المقبول قبل إنشاء التطبيق في Play: «بصمة موقِّع هذه الحزمة
(مفتاح الرفع) ليست في assetlinks.json» إن اخترت (أ) — وفي حالتك بصمة مفتاحك موجودة أصلًا، فلن يظهر.

## خطواتك في Play Console بالترتيب

1. حساب مطوّر (شخصي أو مؤسسة) والتحقق من الهوية.
2. **Create app**: الاسم «دفتر التقويم المستمر»، اللغة الافتراضية العربية، App (لا Game)، Free. الإقرارات.
3. **App content** (يمكن قبل أي بناء):
   Privacy policy ← `https://<النطاق>/privacy` · App access ← `app-access.md` · Ads ← No ·
   Content rating ← `declarations.md` · Target audience ← 18+ · Data safety ← `data-safety.md` (ورابط الحذف
   `https://<النطاق>/delete-account`) · Government apps ← No · Financial / Health ← لا ينطبق · Advertising ID ← No.
4. **Store listing** ← `store-listing.md`، مع الأيقونة وFeature graphic واللقطات.
5. **Testing ← Internal testing ← Create release**: هنا تختار Play App Signing (القرار 2)، ثم ترفع
   `app-release-bundle.aab`. أضف بريدك وبريد مختبِر أو اثنين.
6. **Setup ← App signing (App integrity)**: انسخ بصمة SHA-256 لـ«App signing key certificate»، ثم:
   ```bash
   node android/make-assetlinks.mjs app.vercel.taqwim_theta.twa "SHA256: <البصمة من Play>"
   ```
   (باسم الحزمة الذي قرّرته.) يضيف ولا يحذف بصمتك. commit إلى فرع، ثم دمج ونشر بموافقتك، ثم
   `preflight.mjs --live`.
7. ثبّت من رابط Internal testing على هاتفك: يجب أن يفتح بلا شريط عنوان. نفّذ قائمة الاختبار في
   `android/README.md` (الخطوة 6).
8. **Closed testing** بـ 12 مختبِرًا على الأقل 14 يومًا متصلة (إن انطبق الشرط على حسابك)، ثم Apply for production.
9. **Production**: بعد قبول الطلب.

## ما أحتاجه منك لإكمال الباقي

- قراراتك في البنود 1 و2 و4 و5 أعلاه.
- ناتج `preflight.mjs` بعد البناء (لا يحوي سرًّا).
- بعد الخطوة 6: البصمة من Play (عامة، لا سرّ فيها) إن أردتني أن أضيفها وأفتح الدمج.
- البريد المخصّص لحساب المراجعة بعد أن تنشئه وتؤكّده (كلمة مروره لا تُرسلها لي).
