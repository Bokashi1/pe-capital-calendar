/**
 * OPTIONAL always-on CORS proxy for the calendar page (free, runs on your own Google account).
 * Public CORS proxies are sometimes slow or down; this one is reliable.
 *
 * 1) Open https://script.google.com → New project → paste this file.
 * 2) Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy.
 * 3) Copy the Web app URL (https://script.google.com/macros/s/.../exec)
 *    and paste it into CUSTOM_PROXY in assets/app.js, then commit.
 */
var ICS_URL = 'https://calendar.google.com/calendar/ical/149ccba232b830c7557629b747f383272b6576bc8ef69c284663f897ad860b2d%40group.calendar.google.com/public/basic.ics';

function doGet() {
  var res = UrlFetchApp.fetch(ICS_URL, { muteHttpExceptions: true, followRedirects: true });
  return ContentService.createTextOutput(res.getContentText('UTF-8')).setMimeType(ContentService.MimeType.TEXT);
}
