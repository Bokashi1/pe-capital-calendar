/* ICS parser (RFC 5545 subset) — no dependencies.
 * Handles: line folding (byte-safe), text escapes, TZID / UTC / floating / DATE values,
 * DTEND / DURATION, multi-day, RRULE (DAILY/WEEKLY/MONTHLY/YEARLY + INTERVAL/COUNT/UNTIL/BYDAY/BYMONTHDAY/BYMONTH),
 * EXDATE, RECURRENCE-ID overrides, STATUS:CANCELLED.
 * Times are returned as UTC epoch milliseconds.
 */
(function (root) {
  'use strict';
  var DAY = 86400000;
  var DEFAULT_TZ = 'Asia/Riyadh'; // Kuwait time (UTC+3, no DST)

  // ---- bytes -> unfolded text -------------------------------------------------
  function bytesToText(input) {
    if (typeof input === 'string') return input.replace(/\r?\n[ \t]/g, '');
    var b = input instanceof Uint8Array ? input : new Uint8Array(input);
    var out = new Uint8Array(b.length), j = 0;
    for (var i = 0; i < b.length; i++) {
      // unfold at byte level so a fold that splits a multi-byte UTF-8 char is still repaired
      if (b[i] === 0x0D && b[i + 1] === 0x0A && (b[i + 2] === 0x20 || b[i + 2] === 0x09)) { i += 2; continue; }
      if (b[i] === 0x0A && (b[i + 1] === 0x20 || b[i + 1] === 0x09)) { i += 1; continue; }
      out[j++] = b[i];
    }
    var text = new TextDecoder('utf-8').decode(out.subarray(0, j));
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return text;
  }

  function unescapeText(v) {
    return v.replace(/\\([\\;,nN])/g, function (_, c) { return (c === 'n' || c === 'N') ? '\n' : c; });
  }

  function parseLine(line) {
    // NAME;PARAM=VAL;PARAM="x:y":VALUE  (colon inside quotes is not the separator)
    var inQ = false, sep = -1;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === ':' && !inQ) { sep = i; break; }
    }
    if (sep < 0) return null;
    var head = line.slice(0, sep), value = line.slice(sep + 1);
    var parts = head.match(/(?:[^;"]+|"[^"]*")+/g) || [head];
    var name = parts[0].toUpperCase(), params = {};
    for (var k = 1; k < parts.length; k++) {
      var eq = parts[k].indexOf('=');
      if (eq > 0) params[parts[k].slice(0, eq).toUpperCase()] = parts[k].slice(eq + 1).replace(/^"|"$/g, '');
    }
    return { name: name, params: params, value: value };
  }

  // ---- time zones -------------------------------------------------------------
  var dtfCache = {};
  function tzOffsetMs(utcMs, tz) {
    if (tz === 'UTC' || tz === 'Etc/UTC') return 0;
    if (/^(Asia\/(Riyadh|Kuwait|Baghdad|Qatar|Bahrain|Aden))$/.test(tz)) return 3 * 3600000;
    try {
      var f = dtfCache[tz] || (dtfCache[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      var p = {}; f.formatToParts(new Date(utcMs)).forEach(function (x) { p[x.type] = x.value; });
      var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
      return asUtc - Math.floor(utcMs / 1000) * 1000;
    } catch (e) { return 3 * 3600000; }
  }
  function wallToUtc(wallMs, tz) {
    var off = tzOffsetMs(wallMs, tz);
    var guess = wallMs - off;
    var off2 = tzOffsetMs(guess, tz);
    return off2 === off ? guess : wallMs - off2;
  }

  // Parse a DATE / DATE-TIME property into {utc, wall, tz, date:boolean}
  function parseDT(prop, calTz) {
    if (!prop) return null;
    var v = prop.value.trim(), m;
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(v)) || prop.params.VALUE === 'DATE') {
      m = m || /^(\d{4})(\d{2})(\d{2})/.exec(v);
      var w = Date.UTC(+m[1], +m[2] - 1, +m[3]);
      var tzD = calTz || DEFAULT_TZ;
      return { date: true, wall: w, tz: tzD, utc: wallToUtc(w, tzD) };
    }
    m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
    if (!m) { var d = Date.parse(v); return isNaN(d) ? null : { date: false, wall: d, tz: 'UTC', utc: d }; }
    var wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7]) return { date: false, wall: wall, tz: 'UTC', utc: wall };
    var tz = prop.params.TZID || calTz || DEFAULT_TZ;
    tz = tz.replace(/^\/+/, '');
    return { date: false, wall: wall, tz: tz, utc: wallToUtc(wall, tz) };
  }

  function parseDuration(s) {
    var m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec((s || '').trim());
    if (!m) return 0;
    var ms = ((+m[2] || 0) * 7 + (+m[3] || 0)) * DAY + (+m[4] || 0) * 3600000 + (+m[5] || 0) * 60000 + (+m[6] || 0) * 1000;
    return m[1] === '-' ? -ms : ms;
  }

  // ---- RRULE expansion (in wall-clock time of the event's zone) ----------------
  var WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  function parseRRule(s) {
    var r = {};
    s.split(';').forEach(function (kv) { var p = kv.split('='); if (p.length === 2) r[p[0].toUpperCase()] = p[1]; });
    return r;
  }
  function expandRRule(ev, rr, opts) {
    var freq = rr.FREQ, interval = Math.max(1, +rr.INTERVAL || 1);
    var count = rr.COUNT ? +rr.COUNT : Infinity;
    var until = null;
    if (rr.UNTIL) { var u = parseDT({ value: rr.UNTIL, params: {} }, ev.tz); until = u ? u.utc : null; if (u && u.date) until += DAY - 1; }
    var horizon = opts.horizon;
    var startWall = ev.wallStart, sd = new Date(startWall);
    var timeOfDay = startWall - Math.floor(startWall / DAY) * DAY;
    var startDayNum = Math.floor(startWall / DAY);
    var byday = rr.BYDAY ? rr.BYDAY.split(',').map(function (x) {
      var m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(x.trim()); return m ? { n: m[1] ? +m[1] : 0, wd: WD[m[2]] } : null;
    }).filter(Boolean) : null;
    var bymd = rr.BYMONTHDAY ? rr.BYMONTHDAY.split(',').map(Number) : null;
    var bymonth = rr.BYMONTH ? rr.BYMONTH.split(',').map(Number) : null;
    var wkst = WD[rr.WKST || 'MO'];
    function weekIndex(dayNum) { var wd = (dayNum + 4) % 7; var off = (wd - wkst + 7) % 7; return Math.floor((dayNum - off) / 7); }
    var out = [], n = 0;
    var maxDays = 366 * 4;
    for (var i = 0; i <= maxDays; i++) {
      var dn = startDayNum + i, d = new Date(dn * DAY);
      var y = d.getUTCFullYear(), mo = d.getUTCMonth(), dom = d.getUTCDate(), wd = d.getUTCDay();
      var ok = false;
      var daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
      function bydayMatch(scopeMonth) {
        return byday.some(function (b) {
          if (b.wd !== wd) return false;
          if (!b.n) return true;
          if (!scopeMonth) return true;
          var nth = Math.floor((dom - 1) / 7) + 1, nthFromEnd = -(Math.floor((daysInMonth - dom) / 7) + 1);
          return b.n === nth || b.n === nthFromEnd;
        });
      }
      if (freq === 'DAILY') {
        ok = (i % interval === 0) && (!byday || bydayMatch(false)) && (!bymonth || bymonth.indexOf(mo + 1) >= 0);
      } else if (freq === 'WEEKLY') {
        ok = ((weekIndex(dn) - weekIndex(startDayNum)) % interval === 0) && (byday ? bydayMatch(false) : wd === sd.getUTCDay());
      } else if (freq === 'MONTHLY') {
        var md = (y - sd.getUTCFullYear()) * 12 + (mo - sd.getUTCMonth());
        ok = md % interval === 0 && (bymd ? bymd.some(function (x) { return x === dom || (x < 0 && daysInMonth + x + 1 === dom); })
          : byday ? bydayMatch(true) : dom === sd.getUTCDate());
      } else if (freq === 'YEARLY') {
        var yd = y - sd.getUTCFullYear();
        var monthOk = bymonth ? bymonth.indexOf(mo + 1) >= 0 : mo === sd.getUTCMonth();
        ok = yd % interval === 0 && monthOk && (bymd ? bymd.indexOf(dom) >= 0 : byday ? bydayMatch(true) : dom === sd.getUTCDate());
      } else { break; }
      if (!ok) continue;
      var wall = dn * DAY + timeOfDay;
      var utc = ev.allDayDate ? wallToUtc(dn * DAY, ev.tz) : wallToUtc(wall, ev.tz);
      if (until !== null && utc > until) break;
      if (utc > horizon) break;
      n++;
      out.push(utc);
      if (n >= count) break;
    }
    return out;
  }

  // ---- main parse --------------------------------------------------------------
  function parseICS(input, options) {
    var opts = options || {};
    var text = bytesToText(input);
    var lines = text.split(/\r?\n/);
    var cal = { name: '', desc: '', tz: '', events: [] };
    var stack = [], cur = null, raw = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i]; if (!ln) continue;
      var p = parseLine(ln); if (!p) continue;
      if (p.name === 'BEGIN') { stack.push(p.value.toUpperCase()); if (p.value.toUpperCase() === 'VEVENT') cur = { props: {}, multi: {} }; continue; }
      if (p.name === 'END') { var t = stack.pop(); if (t === 'VEVENT' && cur) { raw.push(cur); cur = null; } continue; }
      var top = stack[stack.length - 1];
      if (top === 'VCALENDAR') {
        if (p.name === 'X-WR-CALNAME') cal.name = unescapeText(p.value).trim();
        else if (p.name === 'X-WR-CALDESC') cal.desc = unescapeText(p.value).trim();
        else if (p.name === 'X-WR-TIMEZONE') cal.tz = p.value.trim();
      } else if (top === 'VEVENT' && cur) {
        if (p.name === 'EXDATE' || p.name === 'RDATE') (cur.multi[p.name] = cur.multi[p.name] || []).push(p);
        else cur.props[p.name] = p;
      }
    }
    var calTz = cal.tz || DEFAULT_TZ;
    var horizon = opts.horizon || (Date.now() + 3 * 366 * DAY);
    var overrides = {}, masters = [];
    raw.forEach(function (r) {
      if (r.props['RECURRENCE-ID']) {
        var rid = parseDT(r.props['RECURRENCE-ID'], calTz);
        if (rid) overrides[(r.props.UID ? r.props.UID.value : '') + '|' + rid.utc] = r;
      } else masters.push(r);
    });

    function build(r, startUtc, endUtc, isDate) {
      var P = r.props;
      function tv(n) { return P[n] ? unescapeText(P[n].value).trim() : ''; }
      return {
        uid: tv('UID'), summary: tv('SUMMARY'), description: tv('DESCRIPTION'), location: tv('LOCATION'),
        url: tv('URL'), status: (tv('STATUS') || '').toUpperCase(),
        start: startUtc, end: endUtc, dateOnly: !!isDate,
        lastModified: P['LAST-MODIFIED'] ? (parseDT(P['LAST-MODIFIED'], 'UTC') || {}).utc : null
      };
    }
    function span(r) {
      var s = parseDT(r.props.DTSTART, calTz); if (!s) return null;
      var e = parseDT(r.props.DTEND, calTz), dur;
      if (e) dur = e.utc - s.utc;
      else if (r.props.DURATION) dur = parseDuration(r.props.DURATION.value);
      else dur = s.date ? DAY : 0;
      if (dur < 0) dur = 0;
      return { s: s, dur: dur };
    }

    masters.forEach(function (r) {
      var sp = span(r); if (!sp) return;
      var uid = r.props.UID ? r.props.UID.value : '';
      var starts = [sp.s.utc];
      if (r.props.RRULE) {
        var info = { wallStart: sp.s.wall, tz: sp.s.tz === 'UTC' ? calTz : sp.s.tz, allDayDate: sp.s.date };
        if (sp.s.tz === 'UTC') info.wallStart = sp.s.utc + tzOffsetMs(sp.s.utc, calTz);
        var rr = parseRRule(r.props.RRULE.value);
        starts = expandRRule(info, rr, { horizon: horizon });
        if (!starts.length || starts[0] !== sp.s.utc) {
          starts.unshift(sp.s.utc); // DTSTART is always the first instance (and counts toward COUNT)
          if (rr.COUNT && starts.length > +rr.COUNT) starts.length = +rr.COUNT;
        }
      }
      (r.multi.RDATE || []).forEach(function (p) {
        p.value.split(',').forEach(function (v) { var d = parseDT({ value: v, params: p.params }, calTz); if (d) starts.push(d.utc); });
      });
      var ex = {};
      (r.multi.EXDATE || []).forEach(function (p) {
        p.value.split(',').forEach(function (v) { var d = parseDT({ value: v, params: p.params }, calTz); if (d) ex[d.utc] = 1; });
      });
      var seen = {};
      starts.forEach(function (st) {
        if (ex[st] || seen[st]) return; seen[st] = 1;
        var ov = overrides[uid + '|' + st];
        var ev;
        if (ov) { var osp = span(ov); if (!osp) return; ev = build(ov, osp.s.utc, osp.s.utc + osp.dur, osp.s.date); delete overrides[uid + '|' + st]; }
        else ev = build(r, st, st + sp.dur, sp.s.date);
        ev.recurring = !!r.props.RRULE;
        ev.instanceKey = uid + '|' + st;
        if (ev.status !== 'CANCELLED') cal.events.push(ev);
      });
    });
    // orphan overrides (master missing)
    Object.keys(overrides).forEach(function (k) {
      var ov = overrides[k], osp = span(ov); if (!osp) return;
      var ev = build(ov, osp.s.utc, osp.s.utc + osp.dur, osp.s.date); ev.instanceKey = k;
      if (ev.status !== 'CANCELLED') cal.events.push(ev);
    });
    cal.events.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return cal;
  }

  var api = { parseICS: parseICS, bytesToText: bytesToText, tzOffsetMs: tzOffsetMs, DAY: DAY };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ICS = api;
})(this);
