/* رزنامة التوجيه الفني للتربية البدنية – منطقة العاصمة التعليمية
 * Plain JS, no build step. Data is read LIVE from the public Google Calendar ICS. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- config
  var CAL_ID = '149ccba232b830c7557629b747f383272b6576bc8ef69c284663f897ad860b2d@group.calendar.google.com';
  var ICS_URL = 'https://calendar.google.com/calendar/ical/' + encodeURIComponent(CAL_ID) + '/public/basic.ics';
  var WEBCAL_URL = ICS_URL.replace(/^https:/, 'webcal:');
  var SITE_URL = 'https://bokashi1.github.io/pe-capital-calendar/';
  var GCAL_SUBSCRIBE = 'https://calendar.google.com/calendar/u/0?cid=' + btoa(CAL_ID).replace(/=+$/, '');
  var GCAL_VIEW = 'https://calendar.google.com/calendar/embed?src=' + encodeURIComponent(CAL_ID) + '&ctz=Asia%2FKuwait&hl=ar';
  var OUTLOOK_SUBSCRIBE = 'https://outlook.live.com/calendar/0/addfromweb?url=' + encodeURIComponent(ICS_URL) +
    '&name=' + encodeURIComponent('رزنامة التربية البدنية – العاصمة');
  var SNAPSHOTS = [
    // same-origin copy (note: raw.githubusercontent.com is NOT used — from a github.io page, HTTP/2
    // connection coalescing can route it to GitHub Pages and return 404)
    'data/events.ics'
  ];
  // Public CORS proxies, tried in order (the last one that worked is tried first next time).
  var PROXIES = [
    { name: 'allorigins', make: function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); } },
    { name: 'codetabs', make: function (u) { return 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u); } },
    { name: 'cors.lol', make: function (u) { return 'https://api.cors.lol/?url=' + encodeURIComponent(u); } },
    { name: 'everyorigin', json: true, make: function (u) { return 'https://everyorigin.jwvbremen.nl/api/get?url=' + encodeURIComponent(u); } },
    { name: 'allorigins-json', json: true, make: function (u) { return 'https://api.allorigins.win/get?url=' + encodeURIComponent(u); } },
    { name: 'cors.eu.org', make: function (u) { return 'https://cors.eu.org/' + u; } },
    { name: 'corsproxy.io', make: function (u) { return 'https://corsproxy.io/?url=' + encodeURIComponent(u); } }
  ];
  // Optional: your own always-on proxy (e.g. the Google Apps Script in /proxy/apps-script.gs). Leave '' to disable.
  // When set, it is tried first, before the public proxies.
  var CUSTOM_PROXY = '';
  if (CUSTOM_PROXY) PROXIES.unshift({ name: 'custom', make: function (u) { return CUSTOM_PROXY + (CUSTOM_PROXY.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(); } });
  var PROXY_TIMEOUT = 15000;
  var PROXY_STAGGER = 2500;  // the last proxy that worked gets a head start, then the others race
  var AUTO_REFRESH_MS = 3 * 60 * 1000;
  var OFF = 3 * 3600000;          // Kuwait = UTC+3 (no DST)
  var DAY = 86400000;
  var LS = { data: 'pecal.data.v1', filters: 'pecal.filters.v1', view: 'pecal.view.v1', proxy: 'pecal.proxy.v1' };

  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var DAYS_SHORT = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
  var STAGES = [
    { key: 'ابتدائي', re: /^ابتدائ/, color: 'var(--st-ibt)' },
    { key: 'متوسط', re: /^متوسط/, color: 'var(--st-mot)' },
    { key: 'ثانوي', re: /^ثانوي/, color: 'var(--st-than)' },
    { key: 'رياض الأطفال', re: /^رياض/, color: '#14b8a6' }
  ];
  var TYPES = [
    { key: 'داخلية', re: /^داخلي/, color: 'var(--t-in)', label: 'داخلية' },
    { key: 'خارجية', re: /^خارجي/, color: 'var(--t-out)', label: 'خارجية' }
  ];
  var EMOJI = [
    [/القدم/, '⚽'], [/السل[ةه]/, '🏀'], [/اليد/, '🤾'], [/الطائر[ةه]/, '🏐'], [/الطاول[ةه]|تنس طاول/, '🏓'],
    [/القوى|جري|عدو/, '🏃'], [/جمباز/, '🤸'], [/لياق/, '💪'], [/سباح/, '🏊'], [/التنس/, '🎾'], [/الريش[ةه]/, '🏸'],
    [/شطرنج/, '♟️'], [/اجتماع/, '🗓️'], [/ورش[ةه]|دور[ةه] تدريب/, '📚'], [/مهرجان|فعالي/, '🎉']
  ];

  // ---------------------------------------------------------------- state
  var state = {
    events: [], calName: '', source: null, fetchedAt: 0, sig: '',
    stage: '', type: '', sports: [], q: '', view: 'list', showPast: false,
    month: null, selDay: null, liveOk: false, inflight: false, lastAttempt: 0
  };
  try { var f = JSON.parse(localStorage.getItem(LS.filters) || '{}'); state.stage = f.stage || ''; state.type = f.type || ''; state.sports = f.sports || []; } catch (e) {}
  try { state.view = localStorage.getItem(LS.view) === 'month' ? 'month' : 'list'; } catch (e) {}

  // ---------------------------------------------------------------- helpers
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // keep number ranges like 2026–2027 in reading order inside RTL text
  function bidi(s) { return String(s == null ? '' : s).replace(/(\d+)\s*([–—\-\/])\s*(\d+)/g, '\u2066$1$2$3\u2069'); }
  function escT(s) { return esc(bidi(s)); }
  function kw(ms) { var d = new Date(ms + OFF); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; }
  function dayKey(ms) { return Math.floor((ms + OFF) / DAY); }
  function keyParts(k) { var d = new Date(k * DAY); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() }; }
  function keyOf(y, m, d) { return Math.floor(Date.UTC(y, m, d) / DAY); }
  function todayKey() { return dayKey(Date.now()); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(ms) { var p = kw(ms), h = p.h % 12 || 12; return h + ':' + pad(p.mi) + ' ' + (p.h < 12 ? 'ص' : 'م'); }
  function fmtDayLong(k) { var p = keyParts(k); return DAYS[p.wd] + ' ' + p.d + ' ' + MONTHS[p.m] + ' ' + p.y; }
  function fmtDayShort(k) { var p = keyParts(k); return p.d + ' ' + MONTHS[p.m]; }
  function plural(n, one, two, few, many) { return n === 1 ? one : n === 2 ? two : (n >= 3 && n <= 10 ? n + ' ' + few : n + ' ' + many); }
  function daysWord(n) { return plural(n, 'يوم واحد', 'يومان', 'أيام', 'يومًا'); }
  function relDay(k) {
    var diff = k - todayKey();
    if (diff === 0) return 'اليوم'; if (diff === 1) return 'غدًا'; if (diff === -1) return 'أمس';
    if (diff > 1 && diff <= 10) return 'بعد ' + daysWord(diff);
    return '';
  }
  function normAr(s) {
    return String(s || '').toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
      .replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x660); })
      .replace(/\s+/g, ' ').trim();
  }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2600); }
  function copy(text, okMsg) {
    function fallback() { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(okMsg || 'تم النسخ'); } catch (e) { prompt('انسخ الرابط:', text); } ta.remove(); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast(okMsg || 'تم النسخ'); }, fallback); else fallback();
  }
  var UA = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isMac = /Macintosh/.test(UA) && !isIOS;
  var isAndroid = /Android/i.test(UA);

  // ---------------------------------------------------------------- event enrichment
  function htmlToText(s) {
    if (!/[<&]/.test(s)) return s;
    var html = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|tr)>/gi, '$&\n').replace(/<li[^>]*>/gi, '$&• ').replace(/<\/li>/gi, '$&\n');
    try { var doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html'); return doc.body.textContent || ''; }
    catch (e) { return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
  }
  function normSport(s) {
    s = s.replace(/\s+/g, ' ').trim();
    var m;
    if ((m = /^كر[ةه] (?!ال)(\S+)$/.exec(s))) return 'كرة ال' + m[1];
    if ((m = /^(?:ألعاب|العاب) (?!ال)(\S+)$/.exec(s))) return 'ألعاب ال' + m[1];
    if (/^(جمباز|سباحة|لياقة)$/.test(s)) return 'ال' + s;
    return s.replace(/^العاب /, 'ألعاب ');
  }
  function splitSports(s) {
    return s.split(/\s*[،,\/+]\s*|\s+و\s+|\s+و(?=(?:ال|كر[ةه]|ألعاب|العاب|جمباز|سباح))/).map(function (x) { return x.trim(); }).filter(Boolean).map(normSport);
  }
  function emojiFor(s) { for (var i = 0; i < EMOJI.length; i++) if (EMOJI[i][0].test(s)) return EMOJI[i][1]; return '🏅'; }
  function stageOf(tok) { tok = (tok || '').trim(); for (var i = 0; i < STAGES.length; i++) if (STAGES[i].re.test(tok)) return STAGES[i].key; return ''; }
  function typeOf(tok) { tok = (tok || '').trim(); for (var i = 0; i < TYPES.length; i++) if (TYPES[i].re.test(tok)) return TYPES[i].key; return ''; }
  function stageColor(st) { for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === st) return STAGES[i].color; return 'var(--brand)'; }
  function typeColor(t) { for (var i = 0; i < TYPES.length; i++) if (TYPES[i].key === t) return TYPES[i].color; return 'var(--muted)'; }

  var NOTE_KEYS = /^(مرجع|المصدر|مصدر|ملاحظ|ملاحظة تنظيمية)/;
  function parseDescription(text) {
    var lines = text.split(/\n/).map(function (l) { return l.replace(/\u00a0/g, ' ').trim(); }).filter(Boolean);
    var fields = {}, order = [], schools = [], notes = [], free = [], inSchools = false;
    lines.forEach(function (l) {
      var num = /^(?:\d+|[٠-٩]+)\s*[.\-)–]\s*(.+)$/.exec(l) || /^[•·\-]\s*(.+)$/.exec(l);
      if (num && (inSchools || /مدرس|^م\s*\//.test(num[1]))) { schools.push(num[1].trim()); inSchools = true; return; }
      var kv = /^([^:：]{2,40})[:：]\s*(.*)$/.exec(l);
      if (kv) {
        var k = kv[1].trim(), v = kv[2].trim();
        inSchools = /المدارس|الفرق|المشارك/.test(k) && !v;
        if (inSchools) return;
        if (NOTE_KEYS.test(k)) { notes.push(k + ': ' + v); return; }
        if (!(k in fields)) order.push(k);
        fields[k] = v; return;
      }
      inSchools = false;
      (free.length || order.length ? notes : free).push(l);
    });
    return { fields: fields, order: order, schools: schools, notes: notes, intro: free };
  }

  function enrich(ev) {
    var tokens = ev.summary.split('|').map(function (t) { return t.trim(); }).filter(Boolean);
    var stage = '', type = '', rest = [];
    tokens.forEach(function (t) {
      var s = stageOf(t), ty = typeOf(t);
      if (s && !stage) { stage = s; return; }
      if (s) return;
      if (ty) { if (!type) type = ty; return; }
      if (rest.indexOf(t) < 0) rest.push(t);
    });
    var descText = htmlToText(ev.description || '');
    var d = parseDescription(descText);
    var F = d.fields;
    if (!stage && F['المرحلة']) stage = stageOf(F['المرحلة']);
    if (!type && /كأس التفوق|خارجي/.test(descText.slice(0, 120))) type = 'خارجية';
    var sportRaw = rest.join(' – ') || F['اللعبة'] || F['نوع البطولة'] || '';
    var sports = sportRaw ? splitSports(sportRaw) : [];
    var title = sports.length ? sports.join(' و') : (tokens.length ? tokens.join(' – ') : (ev.summary || 'موعد'));
    title = title.replace(/\s+و(?=ال)/g, ' و');
    var allDay = ev.dateOnly || (ev.end > ev.start && (ev.start + OFF) % DAY === 0 && (ev.end + OFF) % DAY === 0);
    var startDay = dayKey(ev.start);
    var endDay = allDay ? dayKey(ev.end - 1) : dayKey(Math.max(ev.start, ev.end - 1));
    var intro = d.intro.join(' ');
    var group = F['تفاصيل المجموعة'] || F['المجموعة'] || '';
    var subtitle = group || (/كأس التفوق/.test(intro) ? 'بطولة كأس التفوق العام' : '') || intro.split('–')[0].trim();
    var emojis = []; sports.forEach(function (s) { var e = emojiFor(s); if (emojis.indexOf(e) < 0) emojis.push(e); });
    if (!emojis.length) emojis.push(emojiFor(title + ' ' + descText.slice(0, 200)));
    var endUnknown = /وقت النهاية:\s*غير محدد|مدة ساعة واحدة مستخدمة/.test(descText);
    var e = {
      raw: ev, uid: ev.uid, id: hash(ev.instanceKey || (ev.uid + ev.start)), start: ev.start, end: ev.end,
      allDay: allDay, startDay: startDay, endDay: endDay, multiDay: endDay > startDay,
      stage: stage, type: type, sports: sports, title: title, emojis: emojis.slice(0, 2),
      location: ev.location, desc: descText, fields: F, fieldOrder: d.order, schools: d.schools, notes: d.notes, intro: d.intro,
      group: group, subtitle: subtitle, endUnknown: endUnknown, color: stageColor(stage),
      cleanTitle: [stage, type, title].filter(Boolean).join(' | ')
    };
    e.search = normAr([ev.summary, title, stage, type, ev.location, descText].join(' '));
    e.schoolsNorm = e.schools.map(normAr);
    return e;
  }

  // ---------------------------------------------------------------- data loading
  function withTimeout(ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return { signal: ctl ? ctl.signal : undefined, done: function () { clearTimeout(timer); } };
  }
  function looksLikeICS(t) { return typeof t === 'string' && /BEGIN:VCALENDAR/.test(t) && /END:VCALENDAR/.test(t); }
  function fetchICS(url, isJson) {
    var to = withTimeout(PROXY_TIMEOUT);
    return fetch(url, { cache: 'no-store', signal: to.signal, credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var ct = r.headers.get('content-type') || '';
      if (isJson || /json/.test(ct)) {
        return r.text().then(function (t) {
          var txt = t;
          try { var j = JSON.parse(t); txt = j.contents || j.html || j.body || j.data || j.content || ''; } catch (e) {}
          if (/^data:[^,]*;base64,/.test(txt)) { var bin = atob(txt.split(',')[1]); var u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; }
          return txt;
        });
      }
      return r.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }).then(function (data) {
      to.done();
      var text = ICS.bytesToText(data);
      if (!looksLikeICS(text)) throw new Error('not ics');
      return text;
    }, function (err) { to.done(); throw err; });
  }
  function fetchLive() {
    var order = PROXIES.slice(), last;
    try { last = localStorage.getItem(LS.proxy); } catch (e) {}
    order.sort(function (a, b) { return (b.name === last) - (a.name === last); });
    var target = ICS_URL + '?nocache=' + Date.now();
    return new Promise(function (resolve, reject) {
      var pending = order.length, done = false, timers = [];
      function fail() { if (--pending === 0 && !done) reject(new Error('all proxies failed')); }
      order.forEach(function (p, i) {
        timers.push(setTimeout(function () {
          if (done) { fail(); return; }
          fetchICS(p.make(target), p.json).then(function (t) {
            if (done) return;
            done = true; timers.forEach(clearTimeout);
            try { localStorage.setItem(LS.proxy, p.name); } catch (e) {}
            resolve({ text: t, via: p.name });
          }, function (err) { if (window.console) console.warn('[proxy]', p.name, err && err.message); fail(); });
        }, i === 0 ? 0 : PROXY_STAGGER + (i - 1) * 300));
      });
    });
  }

  function fetchSnapshot() {
    var i = 0;
    function next() {
      if (i >= SNAPSHOTS.length) return Promise.reject(new Error('no snapshot'));
      var u = SNAPSHOTS[i++];
      return fetchICS(u + (u.indexOf('?') < 0 ? '?' : '&') + 't=' + Math.floor(Date.now() / 60000), false)
        .then(function (t) { return { text: t, via: u.indexOf('raw.githubusercontent') >= 0 ? 'github-raw' : 'pages' }; }, next);
    }
    return next();
  }
  function signature(text) { return hash(text.replace(/^DTSTAMP:.*$/mg, '')); }

  function apply(text, source, via, at) {
    var sig = signature(text);
    state.source = source; state.via = via || ''; state.fetchedAt = at || Date.now();
    if (sig !== state.sig) {
      var cal = ICS.parseICS(text);
      state.sig = sig;
      state.calName = cal.name;
      state.events = cal.events.map(enrich);
      buildChips(); buildSchoolList(); render();
      openFromHash();
    }
    if (source !== 'cache') { try { localStorage.setItem(LS.data, JSON.stringify({ text: text, source: source, via: via, at: state.fetchedAt })); } catch (e) {} }
    setStatus();
  }

  function refresh(manual) {
    if (state.inflight) return;
    state.inflight = true; state.lastAttempt = Date.now();
    setStatus('loading');
    var liveDone = false, snapUsed = false, snapText = null;
    // Snapshot in parallel (renders fast for first-time visitors); live data always wins.
    var snapP = fetchSnapshot().then(function (r) {
      snapText = r;
      if (!liveDone && (!state.events.length || state.source === 'cache')) { apply(r.text, 'snapshot', r.via); snapUsed = true; setStatus('loading'); }
    }, function () {});
    fetchLive().then(function (r) {
      liveDone = true; state.liveOk = true;
      apply(r.text, 'live', r.via);
      if (manual) toast('تم التحديث من تقويم Google ✓');
    }, function () {
      liveDone = true;
      return snapP.then(function () {
        if (snapText) { apply(snapText.text, 'snapshot', snapText.via); if (manual) toast('تم التحديث من النسخة الاحتياطية'); }
        else if (state.events.length) { setStatus('offline'); if (manual) toast('تعذّر الاتصال — تُعرض آخر بيانات محفوظة'); }
        else { setStatus('error'); }
      });
    }).then(function () { state.inflight = false; }, function () { state.inflight = false; });
  }

  function setStatus(mode) {
    var el = $('status'), txt = $('statusText');
    el.className = 'status';
    var when = state.fetchedAt ? fmtTime(state.fetchedAt) + ' · ' + fmtDayShort(dayKey(state.fetchedAt)) : '';
    if (mode === 'loading') {
      el.classList.add('loading');
      txt.textContent = state.events.length ? 'جارٍ التحقق من التحديثات المباشرة…' + (when ? ' (آخر تحديث ' + when + ')' : '') : 'جارٍ تحميل المواعيد…';
      return;
    }
    if (mode === 'error') { el.classList.add('off'); txt.textContent = 'تعذّر تحميل المواعيد. تحقّق من الاتصال ثم اضغط «تحديث الآن».'; renderError(); return; }
    if (mode === 'offline' || state.source === 'cache') { el.classList.add('off'); txt.textContent = 'بدون اتصال — آخر بيانات محفوظة: ' + when + ' (بتوقيت الكويت)'; return; }
    if (state.source === 'live') { el.classList.add('live'); txt.textContent = 'مباشر من تقويم Google · آخر تحديث: ' + when + ' (الكويت)'; return; }
    if (state.source === 'snapshot') { el.classList.add('snap'); txt.textContent = 'من النسخة الاحتياطية · آخر تحديث: ' + when + ' (الكويت)'; }
  }

  // ---------------------------------------------------------------- filtering
  function qTokens() { return normAr(state.q).split(' ').filter(function (t) { return t.length > 0; }); }
  function matches(e, toks) {
    if (state.stage && e.stage !== state.stage) return false;
    if (state.type && e.type !== state.type) return false;
    if (state.sports.length && !e.sports.some(function (s) { return state.sports.indexOf(s) >= 0; })) return false;
    for (var i = 0; i < toks.length; i++) if (e.search.indexOf(toks[i]) < 0) return false;
    return true;
  }
  function filtered() { var t = qTokens(); return state.events.filter(function (e) { return matches(e, t); }); }
  function matchedSchools(e, toks) {
    if (!toks.length) return [];
    return e.schools.filter(function (s, i) { var n = e.schoolsNorm[i]; return toks.every(function (t) { return n.indexOf(t) >= 0; }); });
  }
  function saveFilters() { try { localStorage.setItem(LS.filters, JSON.stringify({ stage: state.stage, type: state.type, sports: state.sports })); } catch (e) {} }

  // ---------------------------------------------------------------- chips
  function chip(label, pressed, color, n, attrs) {
    return '<button type="button" class="chip" aria-pressed="' + pressed + '" style="--c:' + color + '" ' + attrs + '>' + label +
      (n != null ? ' <span class="n">' + n + '</span>' : '') + '</button>';
  }
  function buildChips() {
    var ev = state.events, cnt = {};
    ev.forEach(function (e) { cnt['s:' + e.stage] = (cnt['s:' + e.stage] || 0) + 1; cnt['t:' + e.type] = (cnt['t:' + e.type] || 0) + 1; e.sports.forEach(function (s) { cnt['p:' + s] = (cnt['p:' + s] || 0) + 1; }); });
    var h = chip('كل المراحل', !state.stage, 'var(--brand)', null, 'data-stage=""');
    STAGES.forEach(function (s) { if (cnt['s:' + s.key]) h += chip(s.key, state.stage === s.key, s.color, cnt['s:' + s.key], 'data-stage="' + esc(s.key) + '"'); });
    $('stageChips').innerHTML = h;
    h = chip('كل البطولات', !state.type, 'var(--brand)', null, 'data-type=""');
    TYPES.forEach(function (t) { if (cnt['t:' + t.key]) h += chip(t.label, state.type === t.key, t.color, cnt['t:' + t.key], 'data-type="' + esc(t.key) + '"'); });
    $('typeChips').innerHTML = h;
    var sports = Object.keys(cnt).filter(function (k) { return k.indexOf('p:') === 0; }).map(function (k) { return k.slice(2); })
      .sort(function (a, b) { return cnt['p:' + b] - cnt['p:' + a] || a.localeCompare(b, 'ar'); });
    state.sports = state.sports.filter(function (s) { return sports.indexOf(s) >= 0; });
    h = chip('🏅 كل الألعاب', !state.sports.length, 'var(--accent)', null, 'data-sport=""');
    sports.forEach(function (s) { h += chip(emojiFor(s) + ' ' + esc(s), state.sports.indexOf(s) >= 0, 'var(--accent)', cnt['p:' + s], 'data-sport="' + esc(s) + '"'); });
    $('sportChips').innerHTML = h;
  }
  function buildSchoolList() {
    var set = {};
    state.events.forEach(function (e) { e.schools.forEach(function (s) { set[s.replace(/\s+/g, ' ')] = 1; }); });
    $('schoolsList').innerHTML = Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'ar'); }).map(function (s) { return '<option value="' + esc(s) + '">'; }).join('');
  }

  // ---------------------------------------------------------------- rendering
  function tagsHTML(e) {
    var h = '';
    if (e.stage) h += '<span class="tag" style="--tc:' + e.color + '">' + esc(e.stage) + '</span>';
    if (e.type) h += '<span class="tag" style="--tc:' + typeColor(e.type) + '">' + (e.type === 'خارجية' ? '🏆 ' : '') + esc(e.type) + '</span>';
    if (e.multiDay) h += '<span class="tag" style="--tc:var(--muted)">' + daysWord(e.endDay - e.startDay + 1) + '</span>';
    return h;
  }
  function timeHTML(e) {
    if (e.allDay) return e.multiDay ? '<span>' + (e.endDay - e.startDay + 1) + '</span><small>أيام</small>' : '<span>📅</span><small>طوال اليوم</small>';
    var p = kw(e.start), h = p.h % 12 || 12;
    return '<span>' + h + ':' + pad(p.mi) + '</span><small>' + (p.h < 12 ? 'صباحًا' : 'مساءً') + '</small>';
  }
  function cardHTML(e, toks) {
    var hits = matchedSchools(e, toks);
    var sub = hits.length ? '🏫 ' + esc(hits[0]) + (hits.length > 1 ? ' +' + (hits.length - 1) : '')
      : '📍 ' + esc(e.location || 'المكان يحدد لاحقًا') + (e.subtitle ? ' · ' + escT(e.subtitle) : '');
    var past = (e.allDay ? e.endDay < todayKey() : e.end < Date.now());
    return '<button type="button" class="card' + (past ? ' past' : '') + '" data-id="' + e.id + '" style="--sc:' + e.color + '">' +
      '<span class="sport-ico" style="' + (e.emojis.length > 1 ? 'font-size:1.05rem' : '') + '">' + e.emojis.join('') + '</span>' +
      '<span class="card-main"><span class="card-title">' + esc(e.title) + '</span>' +
      '<span class="card-sub" style="display:block">' + sub + '</span>' +
      '<span class="tags">' + tagsHTML(e) + '</span></span>' +
      '<span class="card-time">' + timeHTML(e) + '</span></button>';
  }
  function dayHeadHTML(k, sub) {
    var p = keyParts(k), rel = relDay(k);
    return '<div class="day-head"><div class="day-badge"><b>' + p.d + '</b><small>' + MONTHS[p.m] + '</small></div>' +
      '<div><div class="day-title">' + DAYS[p.wd] + (rel ? '<span class="rel">' + rel + '</span>' : '') + '</div>' +
      '<div class="muted small">' + fmtDayLong(k) + (sub ? ' · ' + sub : '') + '</div></div></div>';
  }
  function countWord(n) { return plural(n, 'موعد واحد', 'موعدان', 'مواعيد', 'موعدًا'); }

  function renderList(list) {
    var tk = todayKey(), toks = qTokens();
    var upcoming = list.filter(function (e) { return e.endDay >= tk; });
    var past = list.filter(function (e) { return e.endDay < tk; });
    var shown = state.showPast ? list : upcoming;
    var groups = {}, keys = [];
    shown.forEach(function (e) {
      var k = state.showPast ? e.startDay : Math.max(e.startDay, tk);
      if (!groups[k]) { groups[k] = []; keys.push(k); }
      groups[k].push(e);
    });
    keys.sort(function (a, b) { return a - b; });
    var h = '';
    if (past.length) h += '<div class="past-toggle"><button type="button" class="link-btn" id="togglePast">' +
      (state.showPast ? 'إخفاء المواعيد السابقة' : 'عرض المواعيد السابقة (' + past.length + ')') + '</button></div>';
    if (!keys.length) {
      h += '<div class="empty"><div class="big">🔎</div><p>' + (state.events.length ? 'لا توجد مواعيد قادمة مطابقة.' : 'لا توجد مواعيد بعد.') + '</p>' +
        (hasFilters() ? '<button type="button" class="btn btn-soft" id="clearFilters">مسح عوامل التصفية</button>' : '') + '</div>';
    }
    keys.forEach(function (k) {
      h += '<section class="day' + (k === tk ? ' today' : '') + '">' + dayHeadHTML(k) + '<div class="cards">' +
        groups[k].map(function (e) { return cardHTML(e, toks); }).join('') + '</div></section>';
    });
    $('listView').innerHTML = h;
  }
  function hasFilters() { return !!(state.stage || state.type || state.sports.length || state.q); }

  function renderMonth(list) {
    var tk = todayKey();
    if (!state.month) { var t = keyParts(tk); state.month = { y: t.y, m: t.m }; }
    var y = state.month.y, m = state.month.m;
    var first = keyOf(y, m, 1), startWd = keyParts(first).wd, dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    var byDay = {};
    list.forEach(function (e) { for (var k = e.startDay; k <= e.endDay; k++) (byDay[k] = byDay[k] || []).push(e); });
    if (state.selDay == null || keyParts(state.selDay).m !== m || keyParts(state.selDay).y !== y) {
      if (tk >= first && tk < first + dim) state.selDay = tk;
      else { state.selDay = first; for (var k0 = first; k0 < first + dim; k0++) if (byDay[k0]) { state.selDay = k0; break; } }
    }
    var h = '<div class="month-head"><button type="button" class="btn btn-soft" data-mnav="-1" aria-label="الشهر السابق">→</button>' +
      '<div style="text-align:center"><h2>' + MONTHS[m] + ' ' + y + '</h2><button type="button" class="link-btn small" data-mnav="0">اليوم</button></div>' +
      '<button type="button" class="btn btn-soft" data-mnav="1" aria-label="الشهر التالي">←</button></div>';
    h += '<div class="grid" role="grid">';
    DAYS_SHORT.forEach(function (d) { h += '<div class="wd">' + d + '</div>'; });
    var start = first - startWd, cells = Math.ceil((startWd + dim) / 7) * 7;
    for (var i = 0; i < cells; i++) {
      var k = start + i, p = keyParts(k), evs = byDay[k] || [];
      var cls = 'cell' + (p.m !== m ? ' out' : '') + (k === tk ? ' today' : '') + (k === state.selDay ? ' sel' : '') + (p.wd === 5 || p.wd === 6 ? ' weekend' : '');
      var dots = evs.slice(0, 4).map(function (e) { return '<i style="--sc:' + e.color + '"></i>'; }).join('') + (evs.length > 4 ? '<i class="more">+' + (evs.length - 4) + '</i>' : '');
      h += '<button type="button" class="' + cls + '" data-day="' + k + '" aria-label="' + esc(fmtDayLong(k) + (evs.length ? '، ' + countWord(evs.length) : '')) + '">' +
        '<span class="num">' + p.d + '</span><span class="dots">' + dots + '</span></button>';
    }
    h += '</div><div class="legend">' + STAGES.filter(function (s) { return state.events.some(function (e) { return e.stage === s.key; }); })
      .map(function (s) { return '<span><i style="--sc:' + s.color + '"></i>' + s.key + '</span>'; }).join('') + '</div>';
    var sel = byDay[state.selDay] || [];
    h += '<section class="day' + (state.selDay === tk ? ' today' : '') + '">' + dayHeadHTML(state.selDay, sel.length ? countWord(sel.length) : '') +
      (sel.length ? '<div class="cards">' + sel.map(function (e) { return cardHTML(e, qTokens()); }).join('') + '</div>'
        : '<div class="empty" style="padding:18px"><p>لا توجد مواعيد في هذا اليوم.</p></div>') + '</section>';
    $('monthView').innerHTML = h;
  }

  var nextTarget = null;
  function renderNext(list) {
    var now = Date.now(), tk = todayKey(), cand = null, ongoing = false;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var isOn = e.allDay ? (e.startDay <= tk && e.endDay >= tk) : (e.start <= now && e.end > now);
      if (isOn) { cand = e; ongoing = true; break; }
      if (e.start > now) { cand = e; break; }
    }
    var el = $('nextCard'); el.classList.remove('skeleton');
    if (!cand) {
      el.innerHTML = '<div class="next-top"><span>الحدث القادم</span></div><p class="next-title">🎉 لا توجد مواعيد قادمة' + (hasFilters() ? ' مطابقة للتصفية' : '') + '</p>';
      el.removeAttribute('data-id'); nextTarget = null; return;
    }
    nextTarget = { id: cand.id, at: ongoing ? (cand.allDay ? (cand.endDay + 1) * DAY - OFF : cand.end) : cand.start, ongoing: ongoing };
    el.setAttribute('data-id', cand.id);
    var when = (cand.allDay ? (cand.multiDay ? fmtDayShort(cand.startDay) + ' – ' + fmtDayShort(cand.endDay) : fmtDayLong(cand.startDay) + ' · طوال اليوم')
      : fmtDayLong(cand.startDay) + ' · ' + fmtTime(cand.start));
    el.innerHTML = '<div class="next-top"><span>' + (ongoing ? '<span class="live-pill"><i></i>جارٍ الآن</span>' : '⏱️ الحدث القادم' + (hasFilters() ? ' (حسب التصفية)' : '')) + '</span>' +
      '<span>' + (relDay(cand.startDay) || '') + '</span></div>' +
      '<p class="next-title"><span>' + cand.emojis.join('') + '</span>' + esc(cand.title) + '</p>' +
      '<div class="tags" style="margin-top:2px">' + tagsHTML(cand) + '</div>' +
      '<div class="next-meta" style="margin-top:4px">📅 ' + esc(when) + ' · 📍 ' + esc(cand.location || 'يحدد لاحقًا') + '</div>' +
      '<div class="countdown" aria-label="' + (ongoing ? 'ينتهي بعد' : 'يبدأ بعد') + '">' +
      '<div><b id="cdD">0</b><span>يوم</span></div><div><b id="cdH">0</b><span>ساعة</span></div><div><b id="cdM">0</b><span>دقيقة</span></div><div><b id="cdS">0</b><span>ثانية</span></div></div>';
    tick();
  }
  var lastTickDay = null;
  function tick() {
    var tk = todayKey();
    if (lastTickDay !== null && tk !== lastTickDay) { lastTickDay = tk; render(); return; }
    lastTickDay = tk;
    if (!nextTarget) return;
    var diff = nextTarget.at - Date.now();
    if (diff <= 0) { render(); return; }
    var s = Math.floor(diff / 1000);
    var set = function (id, v) { var n = $(id); if (n && n.textContent !== String(v)) n.textContent = v; };
    set('cdD', Math.floor(s / 86400)); set('cdH', Math.floor(s % 86400 / 3600)); set('cdM', Math.floor(s % 3600 / 60)); set('cdS', s % 60);
  }

  function render() {
    if (!state.sig) { // nothing loaded yet → keep skeletons
      $('listView').innerHTML = '<div class="cards">' + [1, 2, 3].map(function () { return '<div class="card skeleton" style="height:84px"></div>'; }).join('') + '</div>';
      return;
    }
    var list = filtered();
    $('resultCount').textContent = state.events.length ? countWord(list.length) + (hasFilters() ? ' مطابقة' : ' في الرزنامة') : '';
    renderNext(list);
    $('tabList').setAttribute('aria-selected', state.view === 'list');
    $('tabMonth').setAttribute('aria-selected', state.view === 'month');
    $('listView').hidden = state.view !== 'list';
    $('monthView').hidden = state.view !== 'month';
    if (state.view === 'list') renderList(list); else renderMonth(list);
  }
  function renderError() {
    if (state.events.length) return;
    $('nextCard').classList.remove('skeleton');
    $('nextCard').innerHTML = '<p class="next-title">⚠️ تعذّر تحميل المواعيد</p><p class="muted">تحقّق من الاتصال بالإنترنت ثم حاول مجددًا.</p>';
    $('listView').innerHTML = '<div class="empty"><button type="button" class="btn btn-brand" id="retry">إعادة المحاولة</button></div>';
  }

  // ---------------------------------------------------------------- sheet (modal)
  var sheetPushed = false, sheetKind = null;
  function showSheet(html, kind, hashVal) {
    $('sheetBody').innerHTML = html;
    $('sheet').hidden = false; $('backdrop').hidden = false;
    document.body.style.overflow = 'hidden';
    $('sheetBody').scrollTop = 0;
    sheetKind = kind;
    if (hashVal && location.hash !== hashVal) { history.pushState({ sheet: 1 }, '', hashVal); sheetPushed = true; }
    setTimeout(function () { $('sheetClose').focus({ preventScroll: true }); }, 50);
  }
  function hideSheet() { $('sheet').hidden = true; $('backdrop').hidden = true; document.body.style.overflow = ''; sheetKind = null; }
  function closeSheet() {
    hideSheet();
    if (location.hash) {
      if (sheetPushed) { sheetPushed = false; history.back(); }
      else history.replaceState(null, '', location.pathname + location.search);
    }
  }
  window.addEventListener('popstate', function () {
    if (!location.hash && !$('sheet').hidden) { sheetPushed = false; hideSheet(); }
    else openFromHash();
  });
  function openFromHash() {
    var m = /^#e=([\w-]+)/.exec(location.hash);
    if (m) { var e = findEvent(m[1]); if (e) openEvent(e, false); return; }
    if (location.hash === '#qr' && sheetKind !== 'qr') openQR(false);
    if (location.hash === '#subscribe' && sheetKind !== 'sub') openSubscribe(false);
  }
  function findEvent(id) { for (var i = 0; i < state.events.length; i++) if (state.events[i].id === id) return state.events[i]; return null; }

  function mapsUrl(loc) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(loc.replace(/^م\s*\/\s*/, 'مدرسة ') + '، الكويت'); }
  function hasPlace(loc) { return loc && !/يحدد لاحق|غير محدد/.test(loc); }

  function openEvent(e, push) {
    var toks = qTokens(), hits = matchedSchools(e, toks);
    var dateTxt = e.multiDay ? 'من ' + fmtDayLong(e.startDay) + '<br>إلى ' + fmtDayLong(e.endDay) + ' (' + daysWord(e.endDay - e.startDay + 1) + ')' : fmtDayLong(e.startDay);
    var timeTxt = e.allDay ? 'طوال اليوم' + (/غير محدد/.test(e.desc) ? ' — الساعة غير محددة بعد' : '')
      : fmtTime(e.start) + (e.endUnknown ? ' (وقت النهاية غير محدد)' : ' – ' + fmtTime(e.end));
    var rel = relDay(e.startDay);
    var h = '<div class="ev-hero" style="--sc:' + e.color + '"><span class="sport-ico">' + e.emojis.join('') + '</span><div>' +
      '<h2 id="sheetTitle">' + esc(e.title) + '</h2><div class="tags">' + tagsHTML(e) + '</div></div></div>';
    if (e.subtitle && e.subtitle !== e.group) h += '<p class="muted" style="margin:10px 0 0">' + escT(e.subtitle) + '</p>';
    h += '<div class="info">' +
      '<div class="info-row"><span class="ico">📅</span><div><b>التاريخ' + (rel ? ' · ' + rel : '') + '</b>' + dateTxt + '</div></div>' +
      '<div class="info-row"><span class="ico">⏰</span><div><b>الوقت (بتوقيت الكويت)</b>' + esc(timeTxt) + '</div></div>' +
      '<div class="info-row"><span class="ico">📍</span><div><b>المكان</b>' + (hasPlace(e.location)
        ? '<a href="' + mapsUrl(e.location) + '" target="_blank" rel="noopener">' + esc(e.location) + ' ↗</a>' : esc(e.location || 'يحدد لاحقًا')) + '</div></div>';
    if (e.group) h += '<div class="info-row"><span class="ico">👥</span><div><b>تفاصيل المجموعة</b>' + escT(e.group) + '</div></div>';
    var skip = /^(العام الدراسي|المرحلة|نوع البطولة|اللعبة|وقت البداية|وقت النهاية|تفاصيل المجموعة|المجموعة|المكان|الموقع)$/;
    e.fieldOrder.forEach(function (k) {
      if (skip.test(k) || !e.fields[k]) return;
      h += '<div class="info-row"><span class="ico">ℹ️</span><div><b>' + esc(k) + '</b>' + escT(e.fields[k]) + '</div></div>';
    });
    h += '</div>';
    if (e.schools.length) {
      h += '<h3>🏫 المدارس المشاركة (' + e.schools.length + ')</h3><ol class="schools" style="--sc:' + e.color + '">' +
        e.schools.map(function (s) { return '<li' + (hits.indexOf(s) >= 0 ? ' class="hit"' : '') + '>' + esc(s) + '</li>'; }).join('') + '</ol>';
    }
    h += '<div class="actions">' +
      '<a class="btn btn-brand" href="' + esc(gcalTemplate(e)) + '" target="_blank" rel="noopener">أضف إلى Google</a>' +
      '<button type="button" class="btn btn-soft" data-act="ics" data-id="' + e.id + '">' + (isIOS || isMac ? 'أضف لتقويم Apple' : 'تنزيل ملف التقويم') + '</button>' +
      '<button type="button" class="btn btn-soft wide" data-act="share-ev" data-id="' + e.id + '">مشاركة هذا الموعد</button></div>';
    var extra = e.intro.concat(e.notes);
    if (extra.length) h += '<details class="notes"><summary>ملاحظات ومراجع</summary>' + extra.map(function (n) { return '<p>' + escT(n) + '</p>'; }).join('') + '</details>';
    showSheet(h, 'event', push === false ? null : '#e=' + e.id);
  }

  // ---------------------------------------------------------------- add-to-calendar (single event)
  function ymd(k) { var p = keyParts(k); return p.y + pad(p.m + 1) + pad(p.d); }
  function utcStamp(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function eventDetails(e, max) {
    var lines = [];
    if (e.subtitle) lines.push(e.subtitle);
    if (e.group && e.group !== e.subtitle) lines.push('المجموعة: ' + e.group);
    if (e.schools.length) { lines.push('المدارس المشاركة:'); e.schools.forEach(function (s, i) { lines.push((i + 1) + '. ' + s); }); }
    var t = lines.join('\n');
    if (max && t.length > max) t = t.slice(0, max) + '…';
    return t + '\n\nالتفاصيل الكاملة: ' + SITE_URL + '#e=' + e.id;
  }
  function gcalTemplate(e) {
    var dates = e.allDay ? ymd(e.startDay) + '/' + ymd(e.endDay + 1) : utcStamp(e.start) + '/' + utcStamp(e.end);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(e.cleanTitle) +
      '&dates=' + dates + '&ctz=Asia%2FKuwait&location=' + encodeURIComponent(e.location || '') + '&details=' + encodeURIComponent(eventDetails(e, 700));
  }
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function fold(line) {
    var out = [], cur = '', bytes = 0, enc = new TextEncoder();
    for (var ch of line) { var b = enc.encode(ch).length; if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; } cur += ch; bytes += b; }
    out.push(cur); return out.join('\r\n ');
  }
  function buildEventICS(e) {
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PE Capital//Calendar//AR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      'UID:' + (e.uid || e.id) + '-' + e.id, 'DTSTAMP:' + utcStamp(Date.now())];
    if (e.allDay) { L.push('DTSTART;VALUE=DATE:' + ymd(e.startDay)); L.push('DTEND;VALUE=DATE:' + ymd(e.endDay + 1)); }
    else { L.push('DTSTART:' + utcStamp(e.start)); L.push('DTEND:' + utcStamp(e.end)); }
    L.push('SUMMARY:' + icsEscape(e.cleanTitle));
    if (e.location) L.push('LOCATION:' + icsEscape(e.location));
    L.push('DESCRIPTION:' + icsEscape(eventDetails(e)));
    L.push('URL:' + SITE_URL + '#e=' + e.id);
    if (!e.allDay) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(e.cleanTitle), 'TRIGGER:-PT60M', 'END:VALARM');
    L.push('END:VEVENT', 'END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  function downloadEventICS(e) {
    var ics = buildEventICS(e), name = 'pe-' + ymd(e.startDay) + '-' + e.id + '.ics';
    if (isIOS) { window.location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics); return; }
    var url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('تم تنزيل الملف — افتحه لإضافته إلى التقويم');
  }

  // ---------------------------------------------------------------- subscribe sheet
  function openSubscribe(push) {
    var apple = { cls: 'apple', href: WEBCAL_URL, icon: '', title: 'تقويم iPhone / iPad / Mac', sub: 'اشتراك يتحدّث تلقائيًا — اضغط «اشتراك» ثم «إضافة»' };
    var google = { cls: 'google', href: GCAL_SUBSCRIBE, icon: '📆', title: 'تقويم Google (أندرويد والكمبيوتر)', sub: 'يفتح تقويم Google — اضغط «إضافة» وسيظهر في تطبيق التقويم' };
    var outlook = { cls: 'outlook', href: OUTLOOK_SUBSCRIBE, icon: '📧', title: 'Outlook', sub: 'إضافة الرزنامة كاشتراك في Outlook' };
    var order = (isIOS || isMac) ? [apple, google, outlook] : isAndroid ? [google, apple, outlook] : [google, apple, outlook];
    var recommended = (isIOS || isMac || isAndroid) ? order[0] : null;
    var h = '<h2 id="sheetTitle">أضف الرزنامة إلى تقويمك</h2><p class="muted" style="margin:4px 0 6px">اشترك مرة واحدة، وستظهر أي مواعيد جديدة أو تعديلات في تقويم هاتفك تلقائيًا.</p>';
    order.forEach(function (o) {
      h += '<a class="opt' + (o === recommended ? ' rec' : '') + '" href="' + esc(o.href) + '"' + (o.cls === 'apple' ? '' : ' target="_blank" rel="noopener"') + '>' +
        '<span class="oi">' + (o.cls === 'apple' ? '🍎' : o.icon) + '</span><span><b>' + o.title + '</b><small>' + o.sub + '</small></span>' +
        (o === recommended ? '<span class="badge">مُوصى به لجهازك</span>' : '') + '</a>';
    });
    h += '<button type="button" class="opt" data-act="copy-ics"><span class="oi">🔗</span><span><b>نسخ رابط الاشتراك (iCal)</b><small>لأي تطبيق تقويم آخر: «إضافة تقويم من رابط»</small></span></button>';
    h += '<details class="notes"><summary>مساعدة</summary>' +
      '<p><b>آيفون:</b> بعد الضغط سيظهر سؤال «الاشتراك في التقويم؟» ← اشتراك ← إضافة. (أو: الإعدادات ← التقويم ← الحسابات ← إضافة حساب ← آخر ← إضافة تقويم مشترك، والصق الرابط).</p>' +
      '<p><b>أندرويد:</b> افتح الرابط وسجّل الدخول بحساب Google ثم اضغط «إضافة». إن لم تظهر المواعيد في تطبيق التقويم: افتح التطبيق ← الإعدادات ← اختر الرزنامة ← فعّل «المزامنة».</p>' +
      '<p>تحديثات تقويم Google تصل فورًا تقريبًا؛ أما تقويم Apple فيحدّث الاشتراكات دوريًا (يمكن ضبط التكرار من إعدادات الحساب).</p></details>';
    showSheet(h, 'sub', push === false ? null : '#subscribe');
  }

  // ---------------------------------------------------------------- share + QR
  function sharePage() {
    var data = { title: 'رزنامة التوجيه الفني للتربية البدنية – العاصمة', text: 'مواعيد بطولات التربية البدنية – منطقة العاصمة التعليمية 2026–2027', url: SITE_URL };
    if (navigator.share) navigator.share(data).catch(function () {}); else copy(SITE_URL, 'تم نسخ رابط الرزنامة');
  }
  function shareEvent(e) {
    var url = SITE_URL + '#e=' + e.id;
    var when = e.allDay ? fmtDayLong(e.startDay) + (e.multiDay ? ' – ' + fmtDayLong(e.endDay) : '') : fmtDayLong(e.startDay) + ' ' + fmtTime(e.start);
    var text = e.emojis.join('') + ' ' + e.cleanTitle + '\n📅 ' + when + '\n📍 ' + (e.location || 'يحدد لاحقًا');
    if (navigator.share) navigator.share({ title: e.cleanTitle, text: text, url: url }).catch(function () {}); else copy(text + '\n' + url, 'تم نسخ تفاصيل الموعد');
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  var logoImg = new Image(); logoImg.decoding = 'async'; logoImg.src = 'assets/img/logo-mark-600.png';
  function logoReady() { return logoImg.complete && logoImg.naturalWidth > 0; }
  function makeQRCanvas(url) {
    var qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    var n = qr.getModuleCount(), W = 1080, H = 1560, quiet = 4;
    var qrSize = 700, cell = Math.floor(qrSize / (n + quiet * 2)); qrSize = cell * (n + quiet * 2);
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0b2340'); g.addColorStop(.5, '#0b3b36'); g.addColorStop(1, '#0e8a63');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.globalAlpha = .12; x.fillStyle = '#ffb020';
    for (var i = 0; i < W; i += 40) for (var j = 0; j < 300; j += 40) { x.beginPath(); x.arc(i + 20, j + 20, 2.5, 0, 7); x.fill(); }
    x.globalAlpha = 1;
    // logo badge
    var B = 230, bx = (W - B) / 2, by = 56;
    x.save(); x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = 30; x.shadowOffsetY = 10;
    x.fillStyle = '#fff'; roundRect(x, bx, by, B, B, 52); x.fill(); x.restore();
    if (logoReady()) {
      var lp = 22, lw = B - lp * 2, lh = lw * logoImg.naturalHeight / logoImg.naturalWidth;
      if (lh > B - lp * 2) { lh = B - lp * 2; lw = lh * logoImg.naturalWidth / logoImg.naturalHeight; }
      x.drawImage(logoImg, bx + (B - lw) / 2, by + (B - lh) / 2, lw, lh);
    }
    x.direction = 'rtl'; x.textAlign = 'center'; x.fillStyle = '#fff';
    x.font = '800 58px Tajawal, "Noto Kufi Arabic", sans-serif'; x.fillText('رزنامة التربية البدنية', W / 2, by + B + 92);
    x.font = '500 36px Tajawal, "Noto Kufi Arabic", sans-serif'; x.fillStyle = 'rgba(255,255,255,.85)'; x.fillText('منطقة العاصمة التعليمية · الموسم \u20662026–2027\u2069', W / 2, by + B + 150);
    var px = (W - qrSize) / 2, py = by + B + 210;
    x.fillStyle = '#fff'; roundRect(x, px - 30, py - 30, qrSize + 60, qrSize + 60, 48); x.fill();
    var off = quiet * cell, dark = '#0b2340';
    function isFinder(r, cc) { return (r < 7 && cc < 7) || (r < 7 && cc >= n - 7) || (r >= n - 7 && cc < 7); }
    x.fillStyle = dark;
    for (var r = 0; r < n; r++) for (var cc = 0; cc < n; cc++) if (qr.isDark(r, cc) && !isFinder(r, cc)) x.fillRect(px + off + cc * cell, py + off + r * cell, cell, cell);
    [[0, 0], [0, n - 7], [n - 7, 0]].forEach(function (f) {
      var fx = px + off + f[1] * cell, fy = py + off + f[0] * cell;
      x.fillStyle = '#0e8a63'; roundRect(x, fx, fy, 7 * cell, 7 * cell, cell * .6); x.fill();
      x.fillStyle = '#fff'; roundRect(x, fx + cell, fy + cell, 5 * cell, 5 * cell, cell * .42); x.fill();
      x.fillStyle = dark; roundRect(x, fx + 2 * cell, fy + 2 * cell, 3 * cell, 3 * cell, cell * .3); x.fill();
    });
    x.fillStyle = '#fff'; x.font = '700 44px Tajawal, "Noto Kufi Arabic", sans-serif';
    x.fillText('📱 امسح الرمز لفتح الرزنامة', W / 2, py + qrSize + 120);
    x.direction = 'ltr'; x.font = '500 30px Tajawal, sans-serif'; x.fillStyle = 'rgba(255,255,255,.8)';
    x.fillText(url.replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, py + qrSize + 175);
    x.direction = 'rtl'; x.font = '500 28px Tajawal, sans-serif'; x.fillStyle = 'rgba(255,255,255,.65)';
    x.fillText('التوجيه الفني للتربية البدنية – بنين · الإدارة العامة لمنطقة العاصمة التعليمية', W / 2, H - 48);
    return c;
  }
  window.__makeQRCanvas = makeQRCanvas;
  var qrCanvas = null;
  function openQR(push) {
    var h = '<h2 id="sheetTitle">رمز QR للرزنامة</h2><p class="muted" style="margin:4px 0">اعرضه على الشاشة أو اطبعه ليمسحه المعلمون بكاميرا الهاتف.</p>' +
      '<div class="qr-box" id="qrBox"></div>' +
      '<div class="url-box"><span>' + esc(SITE_URL) + '</span><button type="button" class="link-btn" data-act="copy-link">نسخ</button></div>' +
      '<div class="actions"><button type="button" class="btn btn-brand" data-act="qr-dl">تنزيل الصورة</button>' +
      '<button type="button" class="btn btn-soft" data-act="qr-share">مشاركة الصورة</button>' +
      '<button type="button" class="btn btn-soft wide" data-act="share">مشاركة الرابط</button></div>';
    showSheet(h, 'qr', push === false ? null : '#qr');
    var draw = function () { qrCanvas = makeQRCanvas(SITE_URL); var b = $('qrBox'); if (b) { b.innerHTML = ''; b.appendChild(qrCanvas); qrCanvas.setAttribute('role', 'img'); qrCanvas.setAttribute('aria-label', 'رمز QR لرابط الرزنامة'); } };
    var waits = [logoImg.decode ? logoImg.decode().catch(function () {}) : null];
    if (document.fonts && document.fonts.load) waits.push(document.fonts.load('800 58px Tajawal'), document.fonts.load('500 36px Tajawal'), document.fonts.load('700 44px Tajawal'));
    Promise.all(waits).then(draw, draw);
  }
  function qrBlob(cb) { (qrCanvas || makeQRCanvas(SITE_URL)).toBlob(cb, 'image/png'); }
  function qrDownload() {
    qrBlob(function (b) {
      var url = URL.createObjectURL(b), a = document.createElement('a'); a.href = url; a.download = 'pe-capital-calendar-qr.png';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      if (isIOS) toast('إن لم تُحفظ تلقائيًا: اضغط مطولًا على الصورة ثم «حفظ»');
    });
  }
  function qrShare() {
    qrBlob(function (b) {
      var file = new File([b], 'pe-capital-calendar-qr.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: 'رمز QR – رزنامة التربية البدنية', text: SITE_URL }).catch(function () {});
      else { qrDownload(); toast('المشاركة غير مدعومة هنا — تم تنزيل الصورة'); }
    });
  }

  // ---------------------------------------------------------------- events wiring
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target : ev.target.parentNode;
    var b;
    if ((b = t.closest('[data-stage]'))) { state.stage = b.getAttribute('data-stage'); saveFilters(); buildChips(); render(); return; }
    if ((b = t.closest('[data-type]'))) { state.type = b.getAttribute('data-type'); saveFilters(); buildChips(); render(); return; }
    if ((b = t.closest('[data-sport]'))) {
      var s = b.getAttribute('data-sport');
      if (!s) state.sports = []; else { var i = state.sports.indexOf(s); if (i >= 0) state.sports.splice(i, 1); else state.sports.push(s); }
      saveFilters(); buildChips(); render(); return;
    }
    if ((b = t.closest('.card[data-id], .next-card[data-id]'))) { var e = findEvent(b.getAttribute('data-id')); if (e) openEvent(e); return; }
    if ((b = t.closest('[data-day]'))) { state.selDay = +b.getAttribute('data-day'); var p = keyParts(state.selDay); state.month = { y: p.y, m: p.m }; render(); return; }
    if ((b = t.closest('[data-mnav]'))) {
      var d = +b.getAttribute('data-mnav');
      if (d === 0) { var tp = keyParts(todayKey()); state.month = { y: tp.y, m: tp.m }; state.selDay = todayKey(); }
      else { var mm = state.month.m + d; state.month = { y: state.month.y + Math.floor(mm / 12), m: (mm % 12 + 12) % 12 }; state.selDay = null; }
      render(); return;
    }
    if ((b = t.closest('[data-act]'))) {
      var act = b.getAttribute('data-act'), ee = findEvent(b.getAttribute('data-id'));
      if (act === 'ics' && ee) downloadEventICS(ee);
      else if (act === 'share-ev' && ee) shareEvent(ee);
      else if (act === 'copy-ics') copy(ICS_URL, 'تم نسخ رابط الاشتراك');
      else if (act === 'copy-link') copy(SITE_URL, 'تم نسخ الرابط');
      else if (act === 'qr-dl') qrDownload();
      else if (act === 'qr-share') qrShare();
      else if (act === 'share') sharePage();
      return;
    }
    if (t.closest('#togglePast')) { state.showPast = !state.showPast; render(); return; }
    if (t.closest('#clearFilters')) { state.stage = ''; state.type = ''; state.sports = []; state.q = ''; $('q').value = ''; $('qClear').hidden = true; saveFilters(); buildChips(); render(); return; }
    if (t.closest('#retry')) { refresh(true); return; }
  });
  $('tabList').onclick = function () { state.view = 'list'; try { localStorage.setItem(LS.view, 'list'); } catch (e) {} render(); };
  $('tabMonth').onclick = function () { state.view = 'month'; try { localStorage.setItem(LS.view, 'month'); } catch (e) {} render(); };
  var qTimer;
  $('q').addEventListener('input', function () {
    clearTimeout(qTimer); var v = this.value; $('qClear').hidden = !v;
    qTimer = setTimeout(function () { state.q = v; render(); }, 150);
  });
  $('qClear').onclick = function () { $('q').value = ''; state.q = ''; this.hidden = true; render(); $('q').focus(); };
  $('btnSubscribe').onclick = function () { openSubscribe(); };
  $('btnShare').onclick = sharePage;
  $('btnQR').onclick = function () { openQR(); };
  $('btnRefresh').onclick = function () { refresh(true); };
  $('sheetClose').onclick = closeSheet;
  $('backdrop').onclick = closeSheet;
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });
  $('gcalLink').href = GCAL_VIEW;

  // auto refresh
  setInterval(function () { if (document.visibilityState !== 'hidden') refresh(); }, AUTO_REFRESH_MS);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && Date.now() - state.lastAttempt > 60000) refresh(); });
  window.addEventListener('online', function () { refresh(); });
  setInterval(tick, 1000);

  // ---------------------------------------------------------------- boot
  try {
    var cached = JSON.parse(localStorage.getItem(LS.data) || 'null');
    if (cached && cached.text) apply(cached.text, 'cache', cached.via, cached.at);
  } catch (e) {}
  if (!state.events.length) render();
  refresh();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
