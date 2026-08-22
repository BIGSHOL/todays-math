# -*- coding: utf-8 -*-
"""그래프 전수를 **그려서** 재는 자 — 눈금 줄 수와 「제일 높은 것이 축 위로 떴는가」.

    python scripts/qa/measure-elem-charts.py <charts.json> <출력 json>

`charts.json` 은 `scripts/qa/probe-elem-charts.ts` 가 낸 **장 단위** 전수다.

## 참이 어디서 오는가

- 눈금 값은 **그려진 SVG 의 눈금 글자**에서 읽는다. `_y_step` 을 다시 부르지 않는다 —
  판정의 참이 제품 상수에서 오면 제품이 틀릴수록 좋은 점수가 나온다
  (2026-08-18 「지표의 «참»이 제품 상수에서 나오면 성적이 오른다」).
- 데이터 최댓값은 **스펙**에서 온다. 그건 입력이라 그릴 쪽이 못 바꾼다.
- 그래서 「떴다」 = `max(values) > 맨 위 눈금 값` 이 된다. 반증 가능한 형태다.

## 픽셀 동일

SVG 문자열을 통째로 남긴다. 고치기 전후를 맞대면 「무엇이 몇 장 바뀌었나」가
추정이 아니라 **대조**가 된다(2026-08-18 「분모를 먼저 검산하라」).
"""

from __future__ import annotations

import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "figure"))
sys.path.insert(0, os.path.join(os.path.dirname(ROOT), "vendor", "figure-engine"))

from elementary import render_elementary  # noqa: E402

# 세로축 눈금 글자 — 14pt · 오른쪽 정렬. 단위 라벨(13pt)·막대 숫자(16pt·가운데)와 갈린다.
TICK_RE = re.compile(
    r'<text[^>]*font-size="14"[^>]*text-anchor="end"[^>]*>(-?[\d.]+)</text>'
)
# 눈금 줄 수 상한 — 이 자는 «몇 줄인가»만 세고 판정은 부르는 쪽이 한다.
CAP = 9


def measure(spec: dict) -> dict:
    svg = render_elementary(spec)
    ticks = [float(t) for t in TICK_RE.findall(svg)]
    data_max = max((float(v["value"]) for v in spec["values"]), default=0.0)
    top_tick = max(ticks) if ticks else 0.0
    return {
        "svg": svg,
        "ticks": len(ticks),
        "topTick": top_tick,
        "dataMax": data_max,
        "floating": data_max > top_tick + 1e-9,
        "overDense": len(ticks) > CAP,
    }


def main() -> None:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    src, out = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as fh:
        rows = json.load(fh)

    result = []
    floating = over = charts = 0
    for row in rows:
        m = measure(row["spec"])
        m["where"] = row["where"]
        m["hits"] = row["hits"]
        m["spec"] = row["spec"]
        result.append(m)
        charts += row["hits"]
        if m["floating"]:
            floating += row["hits"]
        if m["overDense"]:
            over += row["hits"]

    with open(out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False)

    print(f"스펙 {len(rows)}가지 · 장 {charts}장")
    print(f"  제일 높은 것이 맨 위 눈금선 위로 뜸 : {floating}장 ({floating / charts:.1%})")
    print(f"  눈금이 {CAP}줄 초과              : {over}장 ({over / charts:.1%})")
    both = sum(row["hits"] for m, row in zip(result, rows) if m["floating"] and m["overDense"])
    print(f"  둘 다 해당                      : {both}장")
    # 눈금을 하나도 못 읽었으면 자가 눈먼 것이다 — 0 을 «깨끗하다»로 읽으면 안 된다.
    blind = sum(1 for m in result if m["ticks"] == 0)
    if blind:
        raise SystemExit(f"눈금 글자를 한 줄도 못 읽은 스펙 {blind}가지 — 자가 눈멀었습니다")


if __name__ == "__main__":
    main()
