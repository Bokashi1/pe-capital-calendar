/* Privacy-friendly visit counter — no cookies, no personal data, no account.
 * Uses the free Abacus counter API (https://abacus.jasoncameron.dev). Fire-and-forget:
 * never blocks rendering, all errors are swallowed.
 * Counters: visits, visitors (first visit per device), day-YYYYMMDD, dayu-YYYYMMDD (devices per day), act-*.
 * A device can opt out (e.g. the owner's own phone) from /stats.html → localStorage 'pecal.noTrack'.
 */
(function () {
  'use strict';
  var BASE = 'https://abacus.jasoncameron.dev/hit/pecal-bokashi1-x7k2/';
  function off() {
    try { if (localStorage.getItem('pecal.noTrack')) return true; } catch (e) {}
    if (navigator.webdriver) return true;                       // headless test runs
    if (/^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname)) return true;
    return false;
  }
  function hit(key) {
    if (off()) return;
    try {
      var url = BASE + encodeURIComponent(key);
      if (window.fetch) fetch(url, { mode: 'cors', keepalive: true, cache: 'no-store', credentials: 'omit' }).catch(function () {});
      else { var i = new Image(); i.src = url; }
    } catch (e) {}
  }
  function kwDay() { var d = new Date(Date.now() + 3 * 3600000); return d.toISOString().slice(0, 10).replace(/-/g, ''); }
  window.peTrack = function (action) { if (action) hit('act-' + action); };
  function onLoad() {
    if (off()) return;
    var day = kwDay();
    hit('visits'); hit('day-' + day);
    try {
      if (!localStorage.getItem('pecal.v')) { localStorage.setItem('pecal.v', String(Date.now())); hit('visitors'); }
      if (localStorage.getItem('pecal.vd') !== day) { localStorage.setItem('pecal.vd', day); hit('dayu-' + day); }
      var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
      if (standalone) hit('act-open-homescreen');
    } catch (e) {}
  }
  var later = function () { (window.requestIdleCallback || function (f) { setTimeout(f, 1500); })(onLoad); };
  if (document.readyState === 'complete') later(); else window.addEventListener('load', later);
  // any element with data-track="name" counts a click
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-track]');
    if (el) window.peTrack(el.getAttribute('data-track'));
  }, true);
})();
