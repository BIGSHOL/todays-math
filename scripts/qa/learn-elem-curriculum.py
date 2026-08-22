# -*- coding: utf-8 -*-
"""units.ts 초3~초6 대단원 목록. 커리큘럼 SSOT 와 큐브 차례를 맞대기 위함."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SRC = Path("prisma/seed-data/units.ts")
OUT = Path("scripts/qa/reports/cube-probe/elem-curriculum-chapters.json")

text = SRC.read_text(encoding="utf-8")
# grade 블록만. 초3~초6
pat = re.compile(
    r'grade:\s*"(초[3-6])",\s*\n\s*chapter:\s*"([^"]+)",\s*\n\s*section:\s*"([^"]+)"',
    re.M,
)
chapters: dict[str, dict[str, list[str]]] = {}
for m in pat.finditer(text):
    g, ch, sec = m.group(1), m.group(2), m.group(3)
    bucket = chapters.setdefault(g, {})
    bucket.setdefault(ch, [])
    if sec not in bucket[ch]:
        bucket[ch].append(sec)

summary = {
    g: {ch: len(secs) for ch, secs in chs.items()} for g, chs in chapters.items()
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(
    json.dumps({"summary": summary, "chapters": chapters}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)
print(json.dumps(summary, ensure_ascii=False, indent=2))
print("wrote", OUT)
