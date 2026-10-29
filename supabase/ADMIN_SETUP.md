# تجهيز حساب المشرف

الحساب المخصَّص للإشراف: `yacinalg58@gmail.com` (موجود في الإنتاج، مؤكَّد البريد، بلا تلاميذ ولا عامل مصادقة).

> هذا الملف إجراء يدوي. لا شيء فيه يُنفَّذ من التطبيق، ولا من هذا المستودع.

## قبل أي خطوة (مرة واحدة)

1. نسخة احتياطية حديثة ناجحة (تشغيل الليلة الماضية في `taqwim-ops`).
2. في لوحة Supabase ← Authentication ← Multi-Factor: فعّل **TOTP** (التسجيل والتحقق). بدونه يفشل الربط برسالة «غير مفعّل».
3. الترحيل `20261022130000_admin_and_deletion_grace.sql` مطبَّق، والاختبار التجريبي على مشروع مؤقت نجح (انظر ترتيب النشر في تقرير الفرع).
4. افتح الإشراف في **متصفح أو ملف شخصي منفصل**: الحساب نفسه في المتصفح نفسه يُخرج جلسة الأستاذ ويترك ما في الطابور معلّقًا.

## الترتيب (لا تبدّله)

1. افتح `/admin/login` وادخل بالبريد وكلمة السر. الحساب غير مُدرج بعد، فتظهر خطوة **ربط تطبيق المصادقة**. اربطه وأدخل الرمز. تُنهى الجلسة وتظهر رسالة أن الحساب غير مُدرج.
2. تحقّق أن للحساب عاملًا واحدًا مؤكَّدًا وأنه عاملك (إن كان أكثر فقد سبقك أحد إلى الربط، فاحذف الكل وأعد من الخطوة 1):

   ```sql
   select f.id, f.factor_type, f.status, f.created_at
   from auth.mfa_factors f join auth.users u on u.id = f.user_id
   where lower(u.email) = 'yacinalg58@gmail.com';
   -- المتوقع: صف واحد، totp، verified، بتاريخ الآن.
   ```

3. أدرج الحساب (يدرج صفًا واحدًا فقط إن كان البريد صحيحًا، ولا شيء إن أخطأت فيه):

   ```sql
   insert into private.admins (user_id, note)
   select id, 'مشرف التطبيق' from auth.users where lower(email) = 'yacinalg58@gmail.com';
   -- المتوقع: INSERT 0 1
   ```

4. ادخل من جديد في `/admin/login` بالبريد وكلمة السر والرمز. تفتح اللوحة، وفي رأسها عدّاد صلاحية الرمز (12 ساعة).

## ضياع الهاتف أو تطبيق المصادقة

لا رموز احتياطية. الإجراء من لوحة Supabase (SQL Editor) وبصلاحياتك كصاحب المشروع:

```sql
delete from auth.mfa_factors where user_id = (select id from auth.users where lower(email) = 'yacinalg58@gmail.com');
delete from auth.sessions    where user_id = (select id from auth.users where lower(email) = 'yacinalg58@gmail.com');
```

بعدها ادخل `/admin/login`: الحساب مُدرج وبلا عامل، فتظهر خطوة الربط من جديد. (المشرف المُدرج بلا عامل يستطيع الربط، فاجعل كلمة سر هذا الحساب قوية ومنفردة.)

## سحب صلاحية المشرف

```sql
delete from private.admins where user_id = (select id from auth.users where lower(email) = 'yacinalg58@gmail.com');
```

تسقط الصلاحية فورًا في كل دالة إدارية، ولا حاجة لإنهاء الجلسات.
