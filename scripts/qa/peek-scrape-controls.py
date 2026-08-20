# -*- coding: utf-8 -*-
import json
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

items = json.load(open("scripts/qa/reports/cube-probe/jindo31-items.json", encoding="utf-8"))["items"]
ids = [
    "cube-concept-3-1-p028-q02",
    "cube-concept-3-1-p028-q05",
    "cube-concept-3-1-p028-q04",
    "cube-concept-3-1-p024-q03",
    "cube-concept-3-1-p029-q14",
    "cube-concept-3-1-p149-q04",
]
for oid in ids:
    it = next(x for x in items if x["id"] == oid)
    s = it["content"]
    codes = []
    for ch in s:
        o = ord(ch)
        if o < 32 or o == 0xFF0D or ch in "-−–—－":
            codes.append(f"U+{o:04X}")
    print(oid, "ctrls", codes)
    print(repr(s[:220]))
    print()
