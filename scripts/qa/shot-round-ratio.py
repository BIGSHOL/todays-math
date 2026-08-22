# -*- coding: utf-8 -*-
"""둥근 입체(원기둥·원뿔·구) **밑면 타원 납작한 정도** 시안 산출기.

    python scripts/qa/shot-round-ratio.py <출력디렉터리> [비율...]
    node scripts/figure/render-svg-shots.mjs <출력디렉터리>/jobs.json

원장님이 「**절대 초등과정에서 원기둥 원뿔 구에서 타원이 그려지지 않도록**」이라 하셔서
(2026-08-22) 비율을 고르려고 만든 것이다. **왜 그 값으로 정했는지**를 다음 사람이
되짚으려면 근거 그림을 **다시 낼 수 있어야** 한다 — 그래서 산출물이 아니라
**산출기**를 저장소에 남긴다(team-lead 지적).

비율을 **인자로 받아** 다시 그린다. 모듈 상수(`ROUND_RATIO`)를 읽지 않으므로
저장소 값이 무엇이든 시안은 같다 — 값을 바꿔 보려고 제품 파일을 건드릴 필요가 없다.

⚠️ 구의 적도 타원은 `ROUND_RATIO` 가 아니라 **딴 리터럴**일 수 있다. 여기서는 셋에
   같은 비율을 먹여 나란히 본다 — 배선이 한쪽만 되어 있으면 지면에서 갈린다.
"""
from __future__ import annotations

import glob
import io
import json
import math
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _guard_no_mutation() -> None:
    """변이 하네스가 도는 동안 그리면 **망가뜨린 코드**로 시안을 만들게 된다.

    ⚠️ 이 검사는 **import 보다 먼저** 와야 한다. `main()` 안에 두었더니 모듈 최상단
    `import elem_advanced` 가 먼저 터져 트레이스백만 나왔다 — 사유를 못 알린다.
    가드는 지키려는 것보다 **앞**에 서 있어야 한다.
    """
    marks = glob.glob(os.path.join(REPO, "MUTATION-IN-PROGRESS.*"))
    if marks:
        raise SystemExit(
            "변이 하네스가 도는 중입니다 — 지금 그리면 망가뜨린 코드로 그립니다:\n  "
            + "\n  ".join(os.path.basename(m) for m in marks)
            + "\n표지가 걷히고 조용해진 뒤 다시 돌리십시오."
        )


_guard_no_mutation()

sys.path.insert(0, os.path.join(REPO, "vendor", "figure-engine"))
sys.path.insert(0, os.path.join(REPO, "scripts", "figure"))

import elem_advanced as A  # noqa: E402
import elementary as E  # noqa: E402

DEG = 90.0  # 축에 나란한 타원 (09 §4-15)
# 원장님 확정값 **0.15** 를 가운데 두고 위아래를 같이 낸다 — 「왜 그 값인가」는
# 이웃과 견줘야 보인다. 0.12 는 하한(원기둥이 직사각형처럼·구 적도가 직선).
DEFAULT_RATIOS = [0.30, 0.20, 0.15, 0.12]
# 원장님이 보신 자리는 **납작한 것**(h < 2r). 길쭉한 것도 같이 둔다 — 하한이 거기서 보인다.
SHAPES = [("납작 r2h3", 2, 3), ("아주납작 r5h4", 5, 4), ("길쭉 r2h6", 2, 6)]


def cylinder(r: float, h: float, ratio: float) -> str:
    from core.figure_solid import circle3

    scale = 70.0 / max(2 * r, h)
    bot3 = circle3((0, 0, 0), r, (0, 0, 1), 64)
    top3 = circle3((0, 0, h), r, (0, 0, 1), 64)
    view, w, hh = A._fitted_cabinet(
        bot3 + top3, scale, (40.0, 24.0, 30.0, 24.0), ratio=ratio, deg=DEG
    )
    top = A._round_ring(view, top3)
    bot = A._round_ring(view, bot3)
    i_l = min(range(len(bot)), key=lambda i: bot[i][0])
    i_r = max(range(len(bot)), key=lambda i: bot[i][0])
    near_bot, far_bot = A._split_ring(bot, i_l, i_r)
    near_top, _ = A._split_ring(top, i_l, i_r)
    if near_top[0][0] > near_top[-1][0]:
        near_top = near_top[::-1]
    if near_bot[0][0] < near_bot[-1][0]:
        near_bot = near_bot[::-1]
    tl, bl = top[i_l], bot[i_l]
    return E._svg(w, hh, "".join([
        A._poly(near_top + near_bot, A.FACE_FRONT, 1.15),
        A._polyline(far_bot, sw=1.05, dash=A.HIDDEN_DASH),
        A._poly(top, A.FACE_TOP, 1.15),
        E._length_mark(tl[0], tl[1], bl[0], bl[1], f"{E._n(h)} cm",
                       off=A._off_towards(tl, bl, (-1.0, 0.0), E.DIM_OFF), fs=12),
    ]))


def cone(r: float, h: float, ratio: float) -> str:
    from core.figure_solid import circle3

    scale = 70.0 / max(2 * r, h)
    base3 = circle3((0, 0, 0), r, (0, 0, 1), 64)
    apex3 = (0.0, 0.0, h)
    view, w, hh = A._fitted_cabinet(
        base3 + [apex3], scale, (18.0, 20.0, 18.0, 16.0), ratio=ratio, deg=DEG
    )
    apex = view(apex3)
    ring = A._round_ring(view, base3)
    n = len(ring)

    def polar(i: int) -> float:
        return math.atan2(ring[i][1] - apex[1], ring[i][0] - apex[0])

    near, far = A._split_ring(ring, min(range(n), key=polar), max(range(n), key=polar))
    return E._svg(w, hh, "".join([
        A._poly([apex] + near, A.FACE_FRONT, 1.15),
        A._polyline(far, sw=1.05, dash=A.HIDDEN_DASH),
    ]))


def sphere(r: float, ratio: float) -> str:
    cx, cy, pr = 70.0, 60.0, 36.0
    _ = r
    return E._svg(140, 120, "".join([
        f'<circle cx="{E._n(cx)}" cy="{E._n(cy)}" r="{E._n(pr)}" fill="{A.FACE_TOP}" '
        f'stroke="{E.INK}" stroke-width="1.4"/>',
        f'<ellipse cx="{E._n(cx)}" cy="{E._n(cy)}" rx="{E._n(pr)}" ry="{E._n(pr * ratio)}" '
        f'fill="none" stroke="{E.INK}" stroke-width="1.05" stroke-dasharray="5 4"/>',
    ]))


def split(svg: str) -> tuple[float, float, str]:
    head, body = svg.split(">", 1)
    body = body.rsplit("</svg>", 1)[0]
    w, h = (float(v) for v in head.split('viewBox="0 0 ', 1)[1].split('"', 1)[0].split())
    return w, h, body


def beside(items: list[str], gap: float = 30.0) -> str:
    parsed = [split(s) for s in items]
    h = max(p[1] for p in parsed)
    x, body = 0.0, []
    for w, hh, b in parsed:
        body.append(E._shift_body(b, x, (h - hh) / 2))
        x += w + gap
    return E._svg_raw(x - gap, h, "".join(body))


def main() -> None:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    out = sys.argv[1]
    ratios = [float(v) for v in sys.argv[2:]] or DEFAULT_RATIOS
    os.makedirs(out, exist_ok=True)
    jobs: list[dict] = []

    def add(name: str, svg: str, target: float = 1000.0) -> None:
        p = os.path.join(out, f"{name}.svg")
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(svg)
        w, h, _ = split(svg)
        k = max(1.0, min(4.0, target / w))
        jobs.append({"svg": p, "png": os.path.join(out, f"{name}.png"),
                     "w": int(w * k), "h": int(h * k)})
        print(f"ok {name}")

    # ① 도형마다 비율을 훑는다 — 「이 도형이 비율에 따라 어떻게 변하나」
    for label, r_, h_ in SHAPES:
        add(f"원기둥-{label}", beside([cylinder(r_, h_, x) for x in ratios]))
        add(f"원뿔-{label}", beside([cone(r_, h_, x) for x in ratios]))
    add("구", beside([sphere(3, x) for x in ratios]), 800)

    # ② 조합으로 셋을 한 줄에 — 원장님이 고르실 것은 **조합**이다
    for x in ratios:
        add(f"조합-{x:.2f}", beside([
            cylinder(2, 3, x), cylinder(5, 4, x), cone(2, 3, x), sphere(3, x),
        ]))

    with open(os.path.join(out, "jobs.json"), "w", encoding="utf-8") as fh:
        json.dump(jobs, fh, ensure_ascii=False)
    print(f"\n비율 순서(왼→오): {ratios}")
    print(f"PNG: node scripts/figure/render-svg-shots.mjs {out}/jobs.json")


if __name__ == "__main__":
    main()
