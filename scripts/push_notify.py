#!/usr/bin/env python3
"""Web push via OneSignal REST API (no dependencies, stdlib only).

  push_notify.py diff OLD.ics NEW.ics   -> notify subscribers about added / changed / removed events
  push_notify.py remind [DAYS]          -> digest of events starting in DAYS days (default 1) from data/events.ics
  push_notify.py send "TITLE" "BODY" [URL]

Env: ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY (GitHub Actions secrets). If either is missing it
exits 0 silently. DRY_RUN=1 prints the payload instead of sending.
Only future events (or ones that started < 12 h ago) trigger messages; past-event cleanups stay silent.
"""
import datetime as dt, json, os, re, sys, urllib.request

SITE = "https://bokashi1.github.io/pe-capital-calendar/"
KW = dt.timezone(dt.timedelta(hours=3))                      # Kuwait, no DST
MAX_SINGLE = 3                                                # more changes than this -> one summary push
DAYS = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]
MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]

def unesc(v): return v.replace("\\n", " ").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\").strip()

def parse_dt(line):
    """line like 'DTSTART;VALUE=DATE:20261028' or 'DTSTART:20261028T053000Z' -> (aware datetime, all_day)."""
    params, val = line.split(":", 1)
    val = val.strip()
    if "VALUE=DATE" in params.upper() or re.fullmatch(r"\d{8}", val):
        d = dt.datetime.strptime(val[:8], "%Y%m%d").replace(tzinfo=KW); return d, True
    d = dt.datetime.strptime(val[:15], "%Y%m%dT%H%M%S")
    d = d.replace(tzinfo=dt.timezone.utc) if val.endswith("Z") else d.replace(tzinfo=KW)  # TZID=Asia/* == UTC+3 here
    d = d.astimezone(KW)
    return d, (d.hour == 0 and d.minute == 0)                 # Google exports all-day as local midnight in UTC

def events(path):
    if not path or not os.path.exists(path): return {}
    text = open(path, "rb").read().decode("utf-8", "replace").replace("\r\n", "\n")
    text = re.sub(r"\n[ \t]", "", text)
    out = {}
    for block in re.findall(r"BEGIN:VEVENT\n(.*?)\nEND:VEVENT", text, re.S):
        p = {}
        for l in block.split("\n"):
            name = re.split(r"[;:]", l, maxsplit=1)[0].upper()
            if name in ("UID", "SUMMARY", "LOCATION", "RECURRENCE-ID", "STATUS") and ":" in l: p[name] = unesc(l.split(":", 1)[1])
            elif name in ("DTSTART", "DTEND") and ":" in l: p[name] = l
        if "DTSTART" not in p or p.get("STATUS", "").upper() == "CANCELLED": continue
        start, allday = parse_dt(p["DTSTART"])
        out[(p.get("UID", ""), p.get("RECURRENCE-ID", ""))] = {
            "title": p.get("SUMMARY", "موعد"), "loc": p.get("LOCATION", ""), "start": start, "allday": allday}
    return out

def when(e):
    d = e["start"]
    s = f"{DAYS[d.weekday()]} {d.day} {MONTHS[d.month - 1]}"
    if not e["allday"]:
        h = d.hour % 12 or 12
        s += f" – {h}:{d.minute:02d} {'ص' if d.hour < 12 else 'م'}"
    return s

def short(t, n=60): return t if len(t) <= n else t[: n - 1] + "…"

def diff(old, new):
    now = dt.datetime.now(KW); soon = lambda e: e["start"] >= now - dt.timedelta(hours=12)
    msgs = []
    for k, e in new.items():
        if k not in old:
            if soon(e): msgs.append(("موعد جديد", f"{short(e['title'])} – {when(e)}" + (f" – {e['loc']}" if e["loc"] else "")))
            continue
        o, changes = old[k], []
        if not (soon(e) or soon(o)): continue
        if (o["start"], o["allday"]) != (e["start"], e["allday"]): changes.append(f"الموعد الجديد: {when(e)}")
        if o["loc"] != e["loc"]: changes.append(f"المكان الجديد: {e['loc'] or 'غير محدد'}")
        if o["title"] != e["title"] and not changes: changes.append(f"الاسم الجديد: {short(e['title'])}")
        if changes: msgs.append(("تعديل موعد", f"{short(e['title'])} – " + " – ".join(changes)))
    for k, o in old.items():
        if k not in new and soon(o):
            msgs.append(("إلغاء موعد", f"أُلغي: {short(o['title'])} ({when(o)})"))
    return msgs

def send(title, body, url=SITE):
    app, key = os.environ.get("ONESIGNAL_APP_ID", "").strip(), os.environ.get("ONESIGNAL_REST_API_KEY", "").strip()
    payload = {"app_id": app, "target_channel": "push", "included_segments": ["Total Subscriptions"],
               "headings": {"en": title, "ar": title}, "contents": {"en": body, "ar": body},
               "url": url}
    if os.environ.get("DRY_RUN"):
        print("DRY_RUN", json.dumps(payload, ensure_ascii=False)); return
    if not app or not key:
        print("push: OneSignal secrets not set — skipped"); return
    req = urllib.request.Request("https://api.onesignal.com/notifications", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Key {key}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: print("push sent:", r.status, r.read()[:200].decode())
    except Exception as ex:                                     # never fail the calendar workflow because of push
        print("push failed (ignored):", ex)

def main(a):
    if a[:1] == ["diff"]:
        msgs = diff(events(a[1]), events(a[2]))
        if not msgs: print("push: no notifiable change"); return
        if len(msgs) <= MAX_SINGLE:
            for t, b in msgs: send(f"📅 {t}", b)
        else:
            send("📅 تحديث الرزنامة", f"تم تحديث {len(msgs)} مواعيد (إضافة/تعديل/إلغاء). اضغط لعرض الرزنامة.")
    elif a[:1] == ["remind"]:
        days = int(a[1]) if len(a) > 1 else 1
        target = (dt.datetime.now(KW) + dt.timedelta(days=days)).date()
        evs = sorted((e for e in events("data/events.ics").values() if e["start"].date() == target), key=lambda e: e["start"])
        if not evs: print("push: nothing to remind"); return
        label = "غدًا" if days == 1 else f"بعد {days} أيام"
        if len(evs) == 1:
            e = evs[0]; send(f"⏰ تذكير: {label}", f"{short(e['title'])} – {when(e)}" + (f" – {e['loc']}" if e["loc"] else ""))
        else:
            send(f"⏰ تذكير: {len(evs)} مواعيد {label}", " • ".join(short(e["title"], 40) for e in evs[:4]) + (" …" if len(evs) > 4 else ""))
    elif a[:1] == ["send"] and len(a) >= 3:
        send(a[1], a[2], a[3] if len(a) > 3 and a[3] else SITE)
    else:
        print(__doc__); sys.exit(2)

if __name__ == "__main__":
    main(sys.argv[1:])
