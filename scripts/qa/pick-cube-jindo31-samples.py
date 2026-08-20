# -*- coding: utf-8 -*-
import json
import sys
from collections import Counter

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

d = json.load(open("scripts/qa/reports/cube-probe/jindo31-items.json", encoding="utf-8"))
items = [
    it
    for it in d["items"]
    if it["genre"] in ("단원마무리", "평가", "수학익힘")
    and "그리기" not in it["flags"]
    and "선잇기" not in it["flags"]
]
print("pool", len(items))
print("genre", Counter(it["genre"] for it in items))
print("word", sum(1 for it in items if "문장제" in it["flags"]))
print("fig", sum(1 for it in items if "그림필요" in it["flags"]))
print("ctrl", sum(1 for it in items if "제어문자" in it["flags"]))

# Prefer: word problems without figures, then calc without figures
word = [it for it in items if "문장제" in it["flags"] and "그림필요" not in it["flags"]]
calc = [
    it
    for it in items
    if "문장제" not in it["flags"]
    and "그림필요" not in it["flags"]
    and ("계산" in it["content"] or "+" in it["content"] or "−" in it["content"] or "" in it["content"])
]
print("word_nofig", len(word), "calc_nofig", len(calc))

print("\n=== WORD ===")
for it in word[:12]:
    first = " / ".join(ln.strip() for ln in it["content"].splitlines() if ln.strip())[:140]
    print(f"{it['id']} {it['genre']} {it['flags']}\n  {first}\n")

print("=== CALC ===")
for it in calc[:12]:
    first = " / ".join(ln.strip() for ln in it["content"].splitlines() if ln.strip())[:140]
    print(f"{it['id']} {it['genre']} {it['flags']}\n  {first}\n")
