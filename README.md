# رزنامة التوجيه الفني للتربية البدنية – منطقة العاصمة التعليمية (2026–2027)

تقويم تفاعلي عربي (RTL) يقرأ المواعيد **مباشرةً** من تقويم Google العام، ويعمل على جميع الهواتف.

**الرابط:** https://bokashi1.github.io/pe-capital-calendar/

## كيف تصل التعديلات؟
1. **مباشر من حساب Google (موصى به):** سكربت Google Apps Script في `proxy/apps-script.gs` يقرأ الرزنامة عبر `CalendarApp` من حساب المالك ويعيد JSON. بعد نشره ووضع رابطه في `CUSTOM_PROXY` داخل `assets/app.js` تصبح الصفحة تقرأ منه أولًا (التعديل يظهر خلال ~20 ثانية).
2. **نسخة المستودع:** GitHub Actions (`.github/workflows/refresh-calendar.yml`) ينزّل ملف ICS العام ويقارنه بصيغة موحّدة (`scripts/ics_normalize.py`: فك طي الأسطر، حذف DTSTAMP، ترتيب الأحداث حسب UID) ولا يُنشئ commit إلا عند تعديل حقيقي. `data/meta.json.updatedAt` = وقت آخر تعديل فعلي. (ملاحظة: GitHub قد يؤخّر الجدولة لساعات في المستودعات الهادئة.)
3. **بدون اتصال:** آخر بيانات تُحفظ في المتصفح.

## نشر المصدر المباشر (Apps Script) — مرة واحدة
1. افتح https://script.google.com بحساب Google الذي يملك الرزنامة (أو يراها) → **New project** → سمِّه `PE Calendar API`.
2. احذف محتوى `Code.gs` والصق محتوى الملف `proxy/apps-script.gs` → **Save**.
3. اختر الدالة `testOutput` واضغط **Run** → **Review permissions** → اختر الحساب → **Advanced → Go to PE Calendar API** → **Allow**. يجب أن يظهر في السجل عدد الأحداث.
4. **Deploy → New deployment →** ⚙ **Web app** → Execute as: **Me** → Who has access: **Anyone** → **Deploy**.
5. انسخ **Web app URL** (ينتهي بـ `/exec`) وافتحه في المتصفح للتأكد أنه يعرض JSON فيه `"events"`.
6. ضع الرابط في `var CUSTOM_PROXY = '...';` داخل `assets/app.js`، وارفع رقم `?v=` في `index.html`، ثم commit + push.
عند تعديل السكربت لاحقًا: Deploy → Manage deployments → ✎ → Version: New version → Deploy (الرابط لا يتغير).

## الملفات
- `index.html`, `assets/style.css`, `assets/app.js` — الواجهة (بدون أي خطوة بناء).
- `assets/ics.js` — محلل ICS (طي الأسطر، الترميز، TZID، أيام كاملة، RRULE/EXDATE/RECURRENCE-ID).
- `vendor/qrcode.js` — مكتبة QR (Kazuhiko Arase, MIT).
- `manifest.webmanifest`, `sw.js`, `icons/` — للإضافة إلى الشاشة الرئيسية.

## Calendar
- ID: `149ccba232b830c7557629b747f383272b6576bc8ef69c284663f897ad860b2d@group.calendar.google.com`
- ICS: https://calendar.google.com/calendar/ical/149ccba232b830c7557629b747f383272b6576bc8ef69c284663f897ad860b2d%40group.calendar.google.com/public/basic.ics

## Push notifications (OneSignal, branch `push-notifications`)
- Opt-in button «فعّل الإشعارات» → `assets/push.js` (set `ONESIGNAL_APP_ID`). iPhone users outside the Home-Screen app get Arabic install guidance.
- Push worker: `push/onesignal/OneSignalSDKWorker.js`, scope `/pe-capital-calendar/push/onesignal/` (separate from the caching `sw.js`). Never move/rename it once live.
- OneSignal dashboard: Web platform → **Custom Code**, Site URL `https://bokashi1.github.io`.
- Actions secrets `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY` → automatic messages on calendar changes (`scripts/push_notify.py diff`), `push-send.yml` (manual backup), `push-reminders.yml` (needs repo variable `PUSH_REMINDERS=on`).
