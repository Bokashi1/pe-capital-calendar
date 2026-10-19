// OneSignal push worker — dedicated file + scope (/pe-capital-calendar/push/onesignal/) so it
// never conflicts with the site's caching worker (sw.js, scope /pe-capital-calendar/).
// Do NOT move or rename this file once live: subscribers are bound to this URL.
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
