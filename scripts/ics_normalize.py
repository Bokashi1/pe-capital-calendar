#!/usr/bin/env python3
"""Canonical form of a Google Calendar ICS, used to detect REAL changes.

Google re-serializes the public feed on every download: VEVENT order changes and
DTSTAMP is set to the download time. Neither is an edit. This script:
  * unfolds lines, normalizes line endings
  * drops volatile properties (DTSTAMP)
  * sorts VEVENT blocks by UID + RECURRENCE-ID (+ DTSTART as tie-breaker)
Usage: ics_normalize.py FILE            -> prints sha256 of canonical form
       ics_normalize.py --dump FILE     -> prints canonical text
"""
import hashlib, re, sys

VOLATILE = {"DTSTAMP"}

def canonical(raw: bytes) -> str:
    text = raw.decode("utf-8", "replace").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n[ \t]", "", text)            # unfold
    lines = [l for l in text.split("\n") if l.strip()]
    header, events, cur, depth = [], [], None, 0
    for l in lines:
        name = re.split(r"[;:]", l, maxsplit=1)[0].upper()
        if l.upper() == "BEGIN:VEVENT":
            cur = [l]; continue
        if cur is not None:
            if name in VOLATILE and depth == 0:
                continue
            if l.upper().startswith("BEGIN:"): depth += 1
            if l.upper().startswith("END:") and l.upper() != "END:VEVENT": depth -= 1
            cur.append(l)
            if l.upper() == "END:VEVENT":
                events.append(cur); cur = None; depth = 0
            continue
        if name in VOLATILE:
            continue
        header.append(l)

    def key(ev):
        def prop(n):
            for l in ev:
                if re.split(r"[;:]", l, maxsplit=1)[0].upper() == n:
                    return l.split(":", 1)[1] if ":" in l else ""
            return ""
        return (prop("UID"), prop("RECURRENCE-ID"), prop("DTSTART"))
    events.sort(key=key)
    body = [l for l in header if l.upper() != "END:VCALENDAR"]
    for ev in events:
        body.extend(ev)
    body.append("END:VCALENDAR")
    return "\n".join(body) + "\n"

if __name__ == "__main__":
    args = sys.argv[1:]
    dump = args and args[0] == "--dump"
    if dump: args = args[1:]
    c = canonical(open(args[0], "rb").read())
    print(c if dump else hashlib.sha256(c.encode()).hexdigest(), end="" if dump else "\n")
