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
    # 나머지 kind — `_assert_covers_every_kind()` 가 빠진 것을 소리 나게 한다.
    {"version": "elem-1", "kind": "numberCards", "cards": ["2", "9", "4"]},
    {"version": "elem-1", "kind": "placeValue", "hundreds": 3, "tens": 2, "ones": 4},
    {"version": "elem-1", "kind": "base10", "rows": [{"hundreds": 2, "tens": 3, "ones": 4}], "equation": "234"},
    {"version": "elem-1", "kind": "opBox", "input": "845", "op": "−369"},
    {"version": "elem-1", "kind": "sumBox", "left": "143", "right": "532"},
    {"version": "elem-1", "kind": "opTree", "start": "725", "ops": ["-513", "+679"]},
    {"version": "elem-1", "kind": "boxChain", "start": "219", "steps": ["+462", "+138"]},
    {"version": "elem-1", "kind": "columnOp", "top": "126", "op": "+", "bottom": "745", "result": "871", "highlight": "t0"},
    {"version": "elem-1", "kind": "numberLine", "min": 0, "max": 1, "step": 0.1, "tick": 0.1, "blanks": [0.1, 0.3]},
    {"version": "elem-1", "kind": "clocks", "items": [{"hour": 8, "minute": 50, "second": 10, "label": "시작"}, {"hour": 10, "minute": 20, "second": 30, "label": "끝"}]},
    {"version": "elem-1", "kind": "dotGrid", "rows": 3, "cols": 4},
    {"version": "elem-1", "kind": "boxedList", "items": ["사과", "배", "감"]},
    {"version": "elem-1", "kind": "pills", "items": ["아침", "점심", "저녁"]},
    {"version": "elem-1", "kind": "geoLine"},
    {"version": "elem-1", "kind": "anglePick"},
    {"version": "elem-1", "kind": "timeAdd", "start": {"h": 2, "m": 30, "s": 20}, "add": {"h": 1, "m": 20, "s": 15}},
    {"version": "elem-1", "kind": "pointGrid", "cols": 6, "rows": 4, "dots": [{"c": 1, "r": 1, "label": "ㄷ", "side": "up"}, {"c": 2, "r": 3, "label": "ㄱ", "side": "down"}], "lines": [[[2, 3], [4, 3]]], "square": {"c": 2, "r": 3, "dx": 1, "dy": -1}},
    {"version": "elem-1", "kind": "divideTriangle", "n": 4},
    {"version": "elem-1", "kind": "triRow", "n": 5, "filled": 2},
    {"version": "elem-1", "kind": "trapFour", "filled": [0, 1, 3]},
    {"version": "elem-1", "kind": "fracBars", "cols": 5, "rows": 3, "filled": 7},
    {"version": "elem-1", "kind": "groupDots", "groups": 4, "each": 3},
    {"version": "elem-1", "kind": "barChart", "values": [{"label": "가", "value": 4}, {"label": "나", "value": 7}, {"label": "다", "value": 2}], "yLabel": "(명)"},
    {"version": "elem-1", "kind": "lineChart", "values": [{"label": "1월", "value": 4}, {"label": "2월", "value": 9}, {"label": "3월", "value": 6}], "yLabel": "(cm)"},
    # 세로축 — 걸음·축 맨 위 변이가 **산출물을 실제로 바꾸려면** 그 자리를 건드리는
    # 표본이 있어야 한다. 위 두 장은 `yMax` 가 없고 값이 작아 어느 변이도 안 걸린다.
    # ㉠ 지금도 맞게 나오는 장(바뀌면 안 된다) ㉡ 제일 높은 값이 눈금 위로 뜨는 장
    # ㉢ 눈금이 상한을 넘는 장 ㉣ 사다리를 여러 칸 올라가야 하는 장.
    {"version": "elem-1", "kind": "barChart", "yMax": 41, "values": [{"label": "가", "value": 38}, {"label": "나", "value": 21}, {"label": "다", "value": 30}], "yLabel": "(명)"},
    {"version": "elem-1", "kind": "barChart", "yMax": 19, "values": [{"label": "가", "value": 16}, {"label": "나", "value": 7}, {"label": "다", "value": 12}], "yLabel": "(명)"},
    {"version": "elem-1", "kind": "lineChart", "yMax": 49, "values": [{"label": "1월", "value": 46}, {"label": "2월", "value": 21}, {"label": "3월", "value": 33}], "yLabel": "(권)"},
    {"version": "elem-1", "kind": "lineChart", "yMax": 1153, "values": [{"label": "1월", "value": 1150}, {"label": "2월", "value": 400}, {"label": "3월", "value": 880}], "yLabel": "(명)"},
    # ㉤ 축을 올리니 **걸음이 또 커지는** 자리 — 한 번만 돌면 45(걸음 10)에서 멈춰
    #    맨 위 눈금이 40이 되고 값 44가 다시 뜬다. 되풀이해야 50에 닿는다.
    #    이 표본이 없으면 「한 번만 돌기」 변이가 산출물을 안 바꿔 판정이 안 된다.
    {"version": "elem-1", "kind": "lineChart", "yMax": 44, "values": [{"label": "1월", "value": 44}, {"label": "2월", "value": 20}, {"label": "3월", "value": 30}], "yLabel": "(권)"},
    # `yStep` — 「눈금 한 칸은 몇」 (D-70). **3은 사다리(1·2·5×10ⁿ)에 없는 수**라,
    # 간격이 3으로 나오면 스펙 값이 실제로 쓰였다는 증거가 된다(우연히 같을 수 없다).
    {"version": "elem-1", "kind": "barChart", "yMax": 15, "yStep": 3, "values": [{"label": "가", "value": 14}, {"label": "나", "value": 6}, {"label": "다", "value": 9}], "yLabel": "(명)"},
    # 축이 올라가는데(49→50) 걸음은 그대로 두는 자리 — 눈금 수만 는다.
    {"version": "elem-1", "kind": "lineChart", "yMax": 49, "yStep": 10, "values": [{"label": "1월", "value": 46}, {"label": "2월", "value": 21}, {"label": "3월", "value": 33}], "yLabel": "(권)"},
    # **던져야 하는** 자리 — 걸음 1로는 눈금이 42줄이다. 조용히 사다리로 올리면
    # 「한 칸 1명」 발문 옆에 5명 간격이 그려진다. 표본이 없으면 그 변이를 못 잡는다.
    {"version": "elem-1", "kind": "barChart", "yMax": 41, "yStep": 1, "values": [{"label": "가", "value": 38}, {"label": "나", "value": 20}, {"label": "다", "value": 30}], "yLabel": "(명)"},
    # 가로형 — 값 눈금이 **옆으로** 늘어서는 유일한 자리라 글자 겹침이 여기서만 난다.
    # ㉠ 맨 위 눈금이 축 끝에 딱 떨어지는 판(단위 라벨과 겹치던 자리, 2자리)
    {"version": "elem-1", "kind": "barChart", "orient": "horizontal", "yMax": 40, "yStep": 10, "title": "팔린 수", "values": [{"label": "딸기", "value": 40}, {"label": "멜론", "value": 20}, {"label": "바닐라", "value": 30}], "yLabel": "(개)"},
    # ㉡ 세 자리 눈금 — 단위가 viewBox 밖으로 나가 **닫는 괄호가 잘리던** 자리
    {"version": "elem-1", "kind": "barChart", "orient": "horizontal", "yMax": 800, "yStep": 200, "values": [{"label": "딸기", "value": 800}, {"label": "멜론", "value": 500}, {"label": "바닐라", "value": 600}], "yLabel": "(원)"},
    # ㉢ 눈금이 겹칠 수밖에 없는 판 — **던져야** 한다(옛날엔 「0100200300…」 덩어리)
    {"version": "elem-1", "kind": "barChart", "orient": "horizontal", "yMax": 800, "yStep": 100, "values": [{"label": "딸기", "value": 800}, {"label": "멜론", "value": 500}], "yLabel": "(원)"},
    {"version": "elem-1", "kind": "pictograph", "unit": 10, "items": [{"label": "가", "count": 3}, {"label": "나", "count": 5}]},
    {"version": "elem-1", "kind": "stripChart", "segments": [{"label": "가", "pct": 40}, {"label": "나", "pct": 35}, {"label": "다", "pct": 25}]},
    {"version": "elem-1", "kind": "pieChart", "slices": [{"label": "가", "pct": 45}, {"label": "나", "pct": 30}, {"label": "다", "pct": 25}]},
    {"version": "elem-1", "kind": "rotateFlip", "n": 4, "cells": [[0, 0], [1, 0], [1, 1]], "op": "rot90"},
    {"version": "elem-1", "kind": "symmetry", "axis": "v", "n": 5, "cells": [[0, 0], [1, 2], [3, 3]]},
    {"version": "elem-1", "kind": "stackCubes", "voxels": [[0, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], [1, 1, 0]], "views": ["iso", "top", "front", "side"]},
    {"version": "elem-1", "kind": "sphere", "r": 3},
]


def _assert_covers_every_kind() -> None:
    """표본이 **모든 kind** 를 건드리는가.

    이 파일의 목록은 손으로 적은 것이라 샌다 — 새 kind 가 생기면 아무도 안 적어 주고,
    그러면 그 kind 는 변이 시험에서 **구조적으로 0**이 된다(09 §4-22 「손 목록은 샌다」).
    kind 목록은 엔진이 갖고 있으니 여기서 **대조**한다. 손 목록을 없앨 수 없는 자리에서는
    적어도 **빠진 것을 소리 나게** 만든다.
    """
    from elementary import KIND_FIELDS

    seen = {s["kind"] for s in SPECS}
    missing = sorted(set(KIND_FIELDS) - seen)
    if missing:
        raise SystemExit(
            "표본에 빠진 kind 가 있습니다 — 그 kind 는 변이 시험이 못 봅니다: "
            + ", ".join(missing)
        )


def main() -> None:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    _assert_covers_every_kind()
    for spec in SPECS:
        name = json.dumps(spec, ensure_ascii=False, sort_keys=True)
        try:
            svg = render_elementary(spec)
        except Exception as exc:  # 변이가 예외를 내면 그것도 «바뀐 산출물»이다
            svg = f"ERROR {type(exc).__name__}: {exc}"
        print(f"### {name}\n{svg}")


if __name__ == "__main__":
    main()
