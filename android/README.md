# تغليف «دفتر التقويم» كتطبيق Android (TWA)

التطبيق هنا غلاف رقيق يفتح الموقع نفسه (`taqwim-theta.vercel.app`) في Chrome بملء الشاشة.
لا كود Android يُكتب، ولا يتغيّر شيء من Next.js وSupabase وVercel. تحديثات الواجهة والمنطق
تصل بنشر Vercel كالمعتاد؛ والغلاف لا يُعاد بناؤه إلا عند رفع مستوى API أو تغيير الأيقونة أو الاسم.

> هذا المجلد لا يحتوي مشروع Android ولا مفتاح التوقيع. المفتاح يبقى عندك وحدك (انظر «مفتاح التوقيع»).

## ما يلزم على حاسوبك

- Node.js 18 أو أحدث.
- `npm i -g @bubblewrap/cli` (من غير `sudo`).
- عند أول تشغيل يعرض Bubblewrap تنزيل JDK وAndroid SDK تلقائيًا: وافق. والبديل `bubblewrap doctor`
  لفحص إعدادك بنفسك.
- هاتف Android (للتجربة) مع تفعيل «خيارات المطوّر» ثم «تصحيح USB»، أو انقل ملف الـAPK إليه وثبّته.

## الخطوات

### 1) أنشئ مشروع الغلاف (مرة واحدة)

```bash
mkdir taqwim-android && cd taqwim-android      # خارج مستودع المشروع
bubblewrap init --manifest=https://taqwim-theta.vercel.app/manifest.webmanifest
```

يقرأ Bubblewrap الاسم والألوان والأيقونات من `manifest.webmanifest`، ويسألك عن الباقي. الإجابات المقترحة
(صياغة الأسئلة قد تختلف قليلًا بين إصدارات Bubblewrap):

| السؤال | الجواب المقترح |
| --- | --- |
| Domain / host | `taqwim-theta.vercel.app` (أو نطاقك الخاص إن اشتريته، **قرّره قبل التوزيع**) |
| Start URL | `/app` |
| Application name | `دفتر التقويم المستمر` |
| Short name / launcher name | `دفتر التقويم` |
| Application ID (package) | `io.github.yacine4700.taqwim` (اسم الحزمة **لا يتغيّر بعد التوزيع**) |
| Display mode / orientation | `standalone` / `portrait` |
| Theme color / background | `#0e6a56` / `#f5f8f6` |
| Notifications | لا |
| Signing key | أنشئ مفتاحًا جديدًا (انظر أدناه) |

### 2) مفتاح التوقيع

أنشئه حين يطلبه Bubblewrap (يحفظه في `android.keystore` بجوار المشروع) ويسألك كلمتي مرور.

- **لا تضعه في Git ولا ترسله لأحد.** احفظ منه نسختين على جهازين مختلفين، وكلمتي المرور في مدير كلمات سر.
- ضياعه يعني أنك لن تستطيع تحديث الغلاف: من ثبّت نسختك سيضطر لحذفها وتثبيت أخرى بمفتاح جديد.

### 3) ابنِ الـAPK

```bash
bubblewrap build
```

الناتج في مجلد المشروع: `app-release-signed.apk` (للتوزيع المباشر) و`app-release-bundle.aab` (لـGoogle Play لاحقًا).
تأكد من `targetSdkVersion` في `app/build.gradle` الناتج: يشترط Google Play 36 للتطبيقات الجديدة منذ 31 أغسطس 2026.

### 4) خذ بصمة المفتاح وولِّد assetlinks.json

```bash
keytool -printcert -jarfile app-release-signed.apk | grep SHA256
```

(على ويندوز استبدل `grep SHA256` بـ`findstr SHA256`.) ثم من **جذر مستودع taqwim**:

```bash
node android/make-assetlinks.mjs io.github.yacine4700.taqwim "SHA256: AA:BB:...:FF"
```

يكتب `public/.well-known/assetlinks.json`. ارفعه (commit) وادمج الفرع في `main` لينشره Vercel؛ تحقق بعدها أن
`https://taqwim-theta.vercel.app/.well-known/assetlinks.json` يفتح في المتصفح ويعرض البصمة.

> الملف يُنشر في الإنتاج فقط بعد الدمج في `main`. قبل ذلك سيفتح التطبيق بشريط عنوان (Custom Tab) لا بملء الشاشة.

### 5) ثبّت وجرّب على الهاتف

```bash
adb install app-release-signed.apk
```

أو انقل الملف إلى الهاتف وافتحه (يطلب «السماح بالتثبيت من هذا المصدر»). إن ظهر شريط عنوان أعلى الشاشة فالتحقق
فشل: راجع الاسم والبصمة، وللتشخيص:

```bash
adb logcat -v brief | grep -e OriginVerifier -e digital_asset_links
```

### 6) قائمة اختبار على الهاتف (قبل أن توزّعه)

1. يفتح بملء الشاشة بلا شريط عنوان.
2. دخول، ثم خروج، ثم دخول بحساب ثانٍ: لا أثر لبيانات الأول.
3. نسيت كلمة السر: افتح رابط الرسالة من تطبيق البريد. هل يكمل داخل التطبيق أم يفتح Chrome؟ وهل تكتمل الجلسة؟
4. **دون اتصال:** سجّل الدخول، أغلق التطبيق وأعد فتحه، فعّل وضع الطيران، أدخل علامات، أغلق التطبيق وأعد فتحه
   دون شبكة، ثم أعد الشبكة وتأكد أن كل علامة وصلت مرة واحدة.
5. **أول تشغيل:** ثبّت التطبيق، سجّل الدخول، وفعّل وضع الطيران **قبل** إغلاقه وإعادة فتحه: يجب أن يفتح (إصلاح `sw.js`).
6. تنزيل ملفات xlsx وJSON، طباعة الكشف إلى PDF، مشاركة ملف، تصوير قائمة التلاميذ، وزر الرجوع.

## التوزيع المباشر (بلا Google Play)

أرسل `app-release-signed.apk` بواتساب أو تيليغرام أو رابط تنزيل. على الأستاذ السماح بالتثبيت من المصدر
الذي فتح منه الملف، وقد يظهر تحذير Play Protect. التحديثات للواجهة والمنطق تصل تلقائيًا؛ الغلاف نفسه لا يتحدّث
إلا بتثبيت APK جديد.

## لاحقًا: Google Play

استعمل `app-release-bundle.aab` مع Play App Signing. أضف بصمة «مفتاح توقيع التطبيق» من Play Console إلى
`assetlinks.json` بجانب بصمتك:

```bash
node android/make-assetlinks.mjs io.github.yacine4700.taqwim "SHA256: <بصمتك>" "SHA256: <بصمة Play>"
```

نسخة Play توقّع بمفتاح Google لا بمفتاحك، فمن ثبّت APKك مباشرة قد يضطر لحذفه قبل تثبيت نسخة المتجر.
ويحتاج المتجر أيضًا ما ورد في تقرير النشر: رابط عام لطلب حذف الحساب، وحساب تجريبي للمراجعين، وتصحيح نص
الخصوصية عن Gemini.
