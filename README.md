# رزنامة التوجيه الفني للتربية البدنية – منطقة العاصمة التعليمية (2026–2027)

تقويم تفاعلي عربي (RTL) يقرأ المواعيد **مباشرةً** من تقويم Google العام، ويعمل على جميع الهواتف.

**الرابط:** https://bokashi1.github.io/pe-capital-calendar/

## كيف تصل التعديلات؟
1. **مباشر:** الصفحة تجلب ملف ICS العام من Google عبر وسطاء CORS عامة (allorigins, codetabs, …) — أي تعديل في تقويم Google يظهر عند فتح الصفحة أو خلال 3 دقائق إن كانت مفتوحة.
2. **نسخة احتياطية:** GitHub Actions (`ops/refresh-calendar.yml` — يجب نقله إلى `.github/workflows/` لتفعيله، انظر أدناه) ينزّل الملف كل ~10 دقائق إلى `data/events.ics` ولا يُنشئ commit إلا عند تغيّر المحتوى. تُستخدم إذا تعطلت جميع الوسطاء.
3. **بدون اتصال:** آخر بيانات ناجحة تُحفظ في المتصفح (localStorage).

لمزيد من الموثوقية يمكن نشر الوسيط الخاص المجاني في `proxy/apps-script.gs` ووضع رابطه في `CUSTOM_PROXY` داخل `assets/app.js`.

## الملفات
- `index.html`, `assets/style.css`, `assets/app.js` — الواجهة (بدون أي خطوة بناء).
- `assets/ics.js` — محلل ICS (طي الأسطر، الترميز، TZID، أيام كاملة، RRULE/EXDATE/RECURRENCE-ID).
- `vendor/qrcode.js` — مكتبة QR (Kazuhiko Arase, MIT).
- `manifest.webmanifest`, `sw.js`, `icons/` — للإضافة إلى الشاشة الرئيسية.

## Calendar
- ID: `149ccba232b830c7557629b747f383272b6576bc8ef69c284663f897ad860b2d@group.calendar.google.com`
- ICS: https://calendar.google.com/calendar/ical/149ccba232b830c7557629b747f383272b6576bc8ef69c284663f897ad860b2d%40group.calendar.google.com/public/basic.ics

## تفعيل التحديث التلقائي للنسخة الاحتياطية (مرة واحدة)
لم يُنشر ملف الـ workflow تلقائيًا لأن صلاحية `workflow` غير متاحة لرمز gh الحالي. للتفعيل:

```bash
gh auth refresh -h github.com -s workflow   # وافق من المتصفح
mkdir -p .github/workflows && git mv ops/refresh-calendar.yml .github/workflows/
git commit -m "Enable calendar snapshot workflow" && git push
gh workflow run refresh-calendar.yml
```
أو من موقع GitHub: Add file → Create new file → `.github/workflows/refresh-calendar.yml` والصق محتوى `ops/refresh-calendar.yml`.
