/* Web push opt-in (OneSignal Web SDK v16, "Custom Code" setup).
 * The push worker lives in its own scope (push/onesignal/) so the caching worker sw.js is untouched.
 * iPhone/iPad: Web Push only works when the site is opened from the Home Screen (iOS/iPadOS 16.4+),
 * so Safari visitors get Arabic "Add to Home Screen" guidance instead of a prompt.
 */
(function () {
  'use strict';
  // >>> PLACEHOLDER: paste the OneSignal App ID (Settings > Keys & IDs). Empty = feature hidden.
  var ONESIGNAL_APP_ID = '06c4f1bf-d868-46f4-ba0c-88a4be80d7e7';
  // <<<
  var BASE = location.pathname.replace(/[^/]*$/, '');          // "/pe-capital-calendar/"
  var btn = document.getElementById('btnNotify'), txt = document.getElementById('btnNotifyText');
  if (!btn) return;
  var P = function () { return window.PECAL || {}; };
  var UA = navigator.userAgent;
  var isIOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var OS = null;

  function toast(m) { if (P().toast) P().toast(m); }
  function sheet(html) { if (P().showSheet) P().showSheet(html, 'push'); }
  function setOn(on) {
    btn.classList.toggle('on', !!on);
    txt.textContent = on ? 'الإشعارات مفعّلة ✓' : 'فعّل الإشعارات';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  var SHARE_ICO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l4 4h-3v9h-2V6H8zm-7 9h4v2H7v7h10v-7h-2v-2h4v11H5z"/></svg>';
  function iosGuide() {
    sheet('<h2>تفعيل الإشعارات على iPhone</h2>' +
      '<p class="muted">يسمح نظام iPhone بالإشعارات فقط بعد إضافة الرزنامة إلى الشاشة الرئيسية (يتطلب iOS ‏16.4 أو أحدث).</p>' +
      '<ol class="ios-steps">' +
      '<li><span>افتح هذه الصفحة في متصفح <b>Safari</b>.</span></li>' +
      '<li><span>اضغط زر المشاركة ' + SHARE_ICO + ' أسفل الشاشة.</span></li>' +
      '<li><span>اختر <b>«إضافة إلى الشاشة الرئيسية»</b> ثم <b>«إضافة»</b>.</span></li>' +
      '<li><span>افتح الرزنامة من أيقونتها على الشاشة الرئيسية، ثم اضغط <b>«فعّل الإشعارات»</b> واختر <b>«سماح»</b>.</span></li>' +
      '</ol><p class="muted small">إذا كان إصدار iOS أقدم من 16.4 فحدِّث الجهاز من الإعدادات ← عام ← تحديث البرنامج.</p>');
  }
  function blockedGuide() {
    sheet('<h2>الإشعارات محظورة</h2><p class="muted">سبق رفض الإشعارات لهذا الموقع. لتفعيلها: افتح إعدادات المتصفح (أو إعدادات الجهاز ← الإشعارات) واسمح بالإشعارات لهذه الرزنامة، ثم أعد تحميل الصفحة.</p>');
  }

  function loadSdk(cb) {
    if (OS) return cb(OS);
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(function (OneSignal) {
      return OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        serviceWorkerPath: BASE.replace(/^\//, '') + 'push/onesignal/OneSignalSDKWorker.js',
        serviceWorkerParam: { scope: BASE + 'push/onesignal/' },
        autoResubscribe: true,
        notifyButton: { enable: false },
        welcomeNotification: { title: 'رزنامة التربية البدنية', message: 'تم تفعيل الإشعارات ✓ سنبلغك بأي تعديل على البطولات.' }
      }).then(function () {
        OS = OneSignal;
        setOn(OneSignal.User.PushSubscription.optedIn);
        OneSignal.User.PushSubscription.addEventListener('change', function (e) { setOn(e.current.optedIn); });
        cb(OS);
      });
    });
    var s = document.createElement('script');
    s.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'; s.defer = true;
    s.onerror = function () { toast('تعذّر تحميل خدمة الإشعارات، حاول لاحقًا'); };
    document.head.appendChild(s);
  }

  btn.addEventListener('click', function () {
    if (isIOS && !standalone) return iosGuide();
    if (!supported) return toast('متصفحك لا يدعم الإشعارات. جرّب Chrome أو Safari الحديث.');
    if (!ONESIGNAL_APP_ID) return toast('الإشعارات قيد الإعداد — قريبًا');
    if (Notification.permission === 'denied') return blockedGuide();
    btn.disabled = true;
    // requestPermission must stay inside the user gesture (required on iOS).
    var ask = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
    ask.then(function (perm) {
      if (perm !== 'granted') { btn.disabled = false; return perm === 'denied' ? blockedGuide() : null; }
      loadSdk(function (OneSignal) {
        btn.disabled = false;
        if (OneSignal.User.PushSubscription.optedIn) {
          if (confirm('هل تريد إيقاف الإشعارات على هذا الجهاز؟')) { OneSignal.User.PushSubscription.optOut(); toast('تم إيقاف الإشعارات'); }
        } else {
          OneSignal.User.PushSubscription.optIn().then(function () { toast('تم تفعيل الإشعارات ✓'); });
        }
      });
    }).catch(function () { btn.disabled = false; });
  });

  // Show the button where it can work (or where we can guide). Hidden on unsupported desktop browsers.
  if (supported || isIOS) {
    btn.hidden = false;
    // Returning subscriber: load SDK quietly to keep the subscription fresh and show the "on" state.
    if (ONESIGNAL_APP_ID && supported && Notification.permission === 'granted') loadSdk(function () {});
  }
})();
