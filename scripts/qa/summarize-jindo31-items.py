# -*- coding: utf-8 -*-
import json
import sys
from collections import Counter

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

p = json.load(open("scripts/qa/reports/cube-probe/jindo31-items.json", encoding="utf-8"))
items = p["items"]
one = [it for it in items if str(it["number"]).isdigit() and len(str(it["number"])) == 1]
two = [it for it in items if str(it["number"]).isdigit() and len(str(it["number"])) >= 2]
print(f"total={len(items)}  twoDigit={len(two)}  oneDigit={len(one)}")
print("one-digit by genre", Counter(it["genre"] for it in one))
print("two-digit by genre", Counter(it["genre"] for it in two))
for page in (9, 14, 15, 24, 27, 28, 149):
    nums = [it["number"] for it in items if it["page"] == page]
    print(f"p{page}: {nums}")
