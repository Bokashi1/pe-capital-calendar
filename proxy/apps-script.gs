/**
 * DIRECT data source for the calendar page — reads the calendar straight from the owner's
 * Google account with CalendarApp and returns JSON (CORS-friendly; works with a plain fetch GET).
 *
 * Deploy (once):
 *  1. https://script.google.com → New project → name it "PE Calendar API" → replace Code.gs with this file → Save.
 *  2. Run ▶ "testOutput" once → Review permissions → choose the account that owns/sees the calendar → Allow.
 *  3. Deploy → New deployment → ⚙ Select type: Web app
 *       Description: v1 · Execute as: Me · Who has access: Anyone → Deploy.
 *  4. Copy the Web app URL (https://script.google.com/macros/s/…/exec).
 *     Open it in a browser: you should see JSON with "events".
 *  5. Put that URL in CUSTOM_PROXY in assets/app.js (and bump ?v= in index.html), commit, push.
 * After editing this script later: Deploy → Manage deployments → ✎ → Version: New version → Deploy
 * (the /exec URL stays the same).
 */
var CALENDAR_ID = '149ccba232b830c7557629b747f383272b6576bc8ef69c284663f897ad860b2d@group.calendar.google.com';
var DAYS_BACK = 400, DAYS_AHEAD = 730;
var CACHE_SECONDS = 20; // tiny cache so many simultaneous visitors don't hit the calendar quota

function doGet(e) {
  var out;
  try {
    var cache = CacheService.getScriptCache();
    out = cache.get('payload');
    if (!out) {
      out = JSON.stringify(buildPayload_());
      if (out.length < 95000) cache.put('payload', out, CACHE_SECONDS);
    }
  } catch (err) {
    out = JSON.stringify({ error: String(err && err.message || err) });
  }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

function buildPayload_() {
  var cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) throw new Error('Calendar not found or no access: ' + CALENDAR_ID);
  var tz = cal.getTimeZone() || 'Asia/Riyadh';
  var now = new Date();
  var from = new Date(now.getTime() - DAYS_BACK * 864e5), to = new Date(now.getTime() + DAYS_AHEAD * 864e5);
  var events = cal.getEvents(from, to); // recurring events come back expanded into instances
  var last = 0;
  var list = events.map(function (ev) {
    var allDay = ev.isAllDayEvent();
    var upd = ev.getLastUpdated();
    if (upd && upd.getTime() > last) last = upd.getTime();
    var start, end;
    if (allDay) {
      start = Utilities.formatDate(ev.getAllDayStartDate(), tz, 'yyyy-MM-dd');
      end = Utilities.formatDate(ev.getAllDayEndDate(), tz, 'yyyy-MM-dd'); // exclusive, like ICS DTEND
    } else {
      start = ev.getStartTime().toISOString();
      end = ev.getEndTime().toISOString();
    }
    return {
      id: ev.getId(),
      title: ev.getTitle(),
      description: ev.getDescription(),
      location: ev.getLocation(),
      start: start, end: end, allDay: allDay,
      recurring: ev.isRecurringEvent(),
      lastUpdated: upd ? upd.toISOString() : null
    };
  });
  return {
    calendar: { id: CALENDAR_ID, name: cal.getName(), timeZone: tz },
    generatedAt: now.toISOString(),
    lastUpdated: last ? new Date(last).toISOString() : null,
    count: list.length,
    events: list
  };
}

/** Run this once from the editor to grant permissions and preview the output in the log. */
function testOutput() {
  var p = buildPayload_();
  Logger.log(p.calendar.name + ' — ' + p.count + ' events, last edit ' + p.lastUpdated);
  Logger.log(JSON.stringify(p.events[0], null, 2));
}
