#!/usr/bin/env python3
"""Compare a freshly downloaded ICS with data/events.ics using the canonical form
(scripts/ics_normalize.py). Only on a REAL change: replace data/events.ics and write
data/meta.json. Prints 'changed' or 'unchanged'.

meta.json.updatedAt = time of the last real edit:
  newest LAST-MODIFIED in the feed if it moved forward, otherwise (e.g. an event was
  deleted, which leaves no LAST-MODIFIED behind) the detection time.
"""
import datetime as dt, hashlib, json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from ics_normalize import canonical

new_path, old_path, meta_path = sys.argv[1], "data/events.ics", "data/meta.json"
new_raw = open(new_path, "rb").read()
new_c = canonical(new_raw)
old_c = canonical(open(old_path, "rb").read()) if os.path.exists(old_path) else ""
if new_c == old_c:
    print("unchanged"); sys.exit(0)

def max_lm(c):
    v = re.findall(r"^LAST-MODIFIED:(\d{8}T\d{6})Z$", c, re.M)
    return max(v) if v else ""
now = dt.datetime.now(dt.timezone.utc)
lm_new, lm_old = max_lm(new_c), max_lm(old_c)
if lm_new and lm_new > lm_old:
    when = dt.datetime.strptime(lm_new, "%Y%m%dT%H%M%S").replace(tzinfo=dt.timezone.utc)
else:
    when = now
open(old_path, "wb").write(new_raw)
meta = {
    "updatedAt": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
    "detectedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    "events": new_c.count("BEGIN:VEVENT"),
    "sha256": hashlib.sha256(new_c.encode()).hexdigest(),
}
json.dump(meta, open(meta_path, "w"), indent=2); open(meta_path, "a").write("\n")
print("changed")
