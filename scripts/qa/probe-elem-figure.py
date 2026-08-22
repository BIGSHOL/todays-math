# -*- coding: utf-8 -*-
"""초등 그림 kind 를 붙박이 스펙으로 그려 SVG 를 그대로 찍는다 — 변이 시험의 «산출물».

    python scripts/qa/probe-elem-figure.py

변이 하네스(`mutate-elem-figure.sh`)가 ⑵ 「산출물이 바뀌었나」를 이 출력으로 본다.
파일만 비교하면 **동작을 안 바꾸는 변이**를 「가드가 아니다」로 잘못 읽는다
(CLAUDE.md 2026-08-21). 표본에는 걸릴 만한 자리가 다 들어 있어야 한다 —
표본이 그 자리를 안 건드리면 가드를 꺼도 산출물이 그대로다.
"""
from __future__ import annotations

import io
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "vendor", "figure-engine"))
sys.path.insert(0, os.path.join(REPO, "scripts", "figure"))

from elementary import render_elementary  # noqa: E402

SPECS: list[dict] = [
    {"version": "elem-1", "kind": "prism", "sides": n, "h": 3} for n in range(3, 9)
] + [
    {"version": "elem-1", "kind": "prism", "sides": n, "h": 3, "net": True} for n in range(3, 9)
] + [
    {"version": "elem-1", "kind": "pyramid", "sides": n, "h": 3} for n in range(3, 9)
] + [
    {"version": "elem-1", "kind": "cuboid", "w": 8, "d": 2, "h": 4},
    {"version": "elem-1", "kind": "cuboid", "w": 5, "d": 5, "h": 5},
    {"version": "elem-1", "kind": "cylinder", "r": 2, "h": 3},
    {"version": "elem-1", "kind": "cylinder", "r": 3, "h": 8},
    {"version": "elem-1", "kind": "cylinder", "r": 5, "h": 2},
    {"version": "elem-1", "kind": "cone", "r": 2, "h": 4},
    {"version": "elem-1", "kind": "cone", "r": 4, "h": 3},
    {"version": "elem-1", "kind": "netCuboid", "w": 7, "d": 4, "h": 5},
    {"version": "elem-1", "kind": "netCylinder", "r": 2, "h": 5, "pi": 3, "layout": "opp"},
    {"version": "elem-1", "kind": "areaPoly", "shape": "rect", "base": 4, "height": 5},
    {"version": "elem-1", "kind": "areaPoly", "shape": "tri", "base": 8, "height": 5},
    {"version": "elem-1", "kind": "areaPoly", "shape": "para", "base": 7, "height": 4},
    {"version": "elem-1", "kind": "areaPoly", "shape": "trap", "base": 8, "height": 4, "top": 5},
    {"version": "elem-1", "kind": "areaPoly", "shape": "rhombus", "base": 8, "height": 4, "d2": 4},
    # `height` 와 `d2` 를 **다르게** 준다. 같은 값만 넣으면 「세로를 무엇으로 그리나」가
    # 산출물에 안 나타나 그 가드를 변이시켜도 아무 일이 없다 (09 §4-21).
    {"version": "elem-1", "kind": "areaPoly", "shape": "rhombus", "base": 12, "height": 4, "d2": 8},
    # 도형 **전 종류**를 넣는다. 한둘만 넣으면 나머지 도형의 좌표를 망가뜨려도
    # 산출물이 그대로라 변이를 판정할 수 없다 (`isoTri` 에서 실제로 겪었다).
    {
        "version": "elem-1",
        "kind": "namedShapes",
        "items": [
            {"shape": k, "label": k}
            for k in sorted(
                {
                    "square", "rect", "rightTri", "isoTri", "wideTri", "eqTri",
                    "diamond", "tallDiamond", "trap", "para", "irregQuad",
                }
            )
        ],
    },
    {
        "version": "elem-1",
        "kind": "namedShapes",
        "items": [
            {"shape": "eqTri", "label": "다", "marks": True},
            {"shape": "rightTri", "label": "라", "marks": True},
        ],
    },
    # 오타 키 — 지금은 예외다. 가드를 빼면 그려지므로 산출물이 바뀐다.
    # 표본이 그 자리를 안 건드리면 가드를 꺼도 산출물이 그대로라 판정할 수 없다.
    {"version": "elem-1", "kind": "namedShapes", "items": [{"shape": "eqTri", "mark": True}]},
    {"version": "elem-1", "kind": "fracPie", "n": 8, "filled": 3},
    {"version": "elem-1", "kind": "protractor", "deg": 55},
    {"version": "elem-1", "kind": "table", "headers": ["×", "3", "4", "5", "6", "7", "8"],
     "rows": [["4", "12", "16", "20", "24", "28", "32"]]},
    {"version": "elem-1", "kind": "tape", "length": 20, "label": "20cm", "segments": 5},
]


def main() -> None:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    for spec in SPECS:
        name = json.dumps(spec, ensure_ascii=False, sort_keys=True)
        try:
            svg = render_elementary(spec)
        except Exception as exc:  # 변이가 예외를 내면 그것도 «바뀐 산출물»이다
            svg = f"ERROR {type(exc).__name__}: {exc}"
        print(f"### {name}\n{svg}")


if __name__ == "__main__":
    main()
