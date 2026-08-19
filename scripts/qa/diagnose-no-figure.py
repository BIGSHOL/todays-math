# -*- coding: utf-8 -*-
"""「문항 둘레에서 그림을 못 찾았다」가 **무엇 때문인지**를 센다.

    python scripts/figure/crop-pdf-by-stem.py                    # 먼저 돌린다
    python scripts/qa/diagnose-no-figure.py [결과.json]

## ⚠️ 이 파일은 **세지 않는다** — `figure_rect` 가 적어 준 것을 모으기만 한다

옛 판은 「무엇이 버려졌나」를 여기서 **다시 구현**했다. 그래서 갈라졌다 —
`thin_pt`(두께 0인 곧은 선 살리기)를 모르는 채 그 획을 전부 「버려졌다」로 세어
**「상자 안에 획이 아예 없다 10행」**을 보고했는데, 오려내기 쪽은 그 획들을 이미
살리고 있었다(2026-08-19 실측: `5350-13` 은 획 257개가 전부 살아 후보 144개가 됐고,
진짜로 버린 것은 **완비 검사**였다). 그 잘못된 집계가 트랙 브리프의 진단이 됐다.

세는 쪽과 고치는 쪽이 갈라지면 **같이 눈이 먼다**(CLAUDE.md 2026-08-18).
그래서 이제 `figure_rect(..., trace=…)` 가 자기가 버린 자리를 적고, 여기서는
그것을 읽어 늘어놓기만 한다.
"""
from __future__ import annotations

import collections
import json
import pathlib
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

RESULT = pathlib.Path(
    sys.argv[1] if len(sys.argv) > 1 else "scripts/qa/reports/pdf-figure-result.json"
)
OUT = pathlib.Path("scripts/qa/reports/_why-no-figure.json")

fails = [
    f
    for f in json.loads(RESULT.read_text(encoding="utf-8"))["실패"]
    if f.get("진단")
]
if not fails:
    raise SystemExit(
        f"{RESULT} 에 진단이 붙은 실패가 없다.\n"
        "  → python scripts/figure/crop-pdf-by-stem.py 를 먼저 돌려라."
    )

tally: collections.Counter[str] = collections.Counter()
rows = []
for f in fails:
    tr = f["진단"]
    why = next((k for k in tr if k.startswith("버림:")), "버림:알수없음")
    tally[why] += 1
    rows.append({"id": f["externalId"], "판정": why, **tr})

for k, v in tally.most_common():
    print(f"{v:3d}  {k}")
OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"\n상세 {len(rows)}행 → {OUT}")
