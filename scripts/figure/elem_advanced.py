# -*- coding: utf-8 -*-
"""초등 후반 그림 — 그래프·입체·쌓기나무·이동·대칭.

elementary.render_elementary 이 KIND 를 합친다. 같은 그림이 두 번이면 여기 kind (D-61).
기하 작도(치수선만)는 엔진 A. 조작형(자·컴퍼스·그리세요)은 그리지 않는다.
"""
from __future__ import annotations

import math
from typing import Any, Mapping

from elementary import (
    DIM_OFF,
    GRID,
    GRID_SW,
    INK,
    PAPER,
    TABLE_VIEWBOX_MAX,
    _arrow_right,
    _esc,
    _length_mark,
    _n,
    _rect,
    _svg,
    _text,
)

FILL = "#e2b48a"
FAINT = "#f4efe6"
FACE_TOP = "#f2e6d4"
FACE_FRONT = "#e4d3b8"
FACE_SIDE = "#d4c09e"
CHART = ("#c5d6c2", "#d7c2e4", "#e2b48a", "#c5d4e8", "#e8d4a8", "#d4c0b0")
# 겨냥도 숨은 모서리. 실선과 눈에 띄게 갈려야 면·모서리를 셀 수 있다 (09 §4-14).
HIDDEN_DASH = "5 4"
# 둥근 입체(원기둥·원뿔·**구**) 타원의 납작한 정도(ry/rx).
# 사방(45°) 투영은 타원이 기울어 「타원기둥」처럼 보인다 — 깊이축을 화면 위(90°)로
# 세우면 축에 나란한 타원이 되고 depth_ratio 가 곧 ry/rx 가 된다 (09 §4-15).
#
# **0.15 — 원장님 확정 2026-08-22**: 「강력하게 조여. 절대 초등과정에서 원기둥 원뿔
# 구에서 타원이 그려지지 않도록」. 0.30·0.20·0.15·0.12 를 셋 다 렌더해 견주고 고르셨다
# (`scripts/qa/shot-round-ratio.py` 로 다시 낼 수 있다). 0.12 는 납작한 원기둥이
# 직사각형처럼 보이고 구 적도가 거의 직선이 된다 — 그게 하한이다 (09 §4-20-d).
#
# ⚠️ **셋이 이 한 숫자를 쓴다.** 예전에는 구만 날 리터럴 `0.32` 라 상수를 조여도
#    구는 안 따라왔다 — 게다가 셋 중 **가장 뚱뚱한 것**이 안 고쳐지고 남았다
#    (2026-08-18 「배선이 한쪽만 되면 그쪽 지표만 좋아진다」).
ROUND_RATIO = 0.15
ROUND_DEG = 90.0

# 세로 눈금 걸음 사다리 — `1·2·5` 를 열 배씩. 초등에서 「한 칸이 몇인가」를 암산할 수
# 있는 것은 이 셋뿐이다(3칸·7칸은 눈금을 세게 만든다).
NICE_STEPS: tuple[int, ...] = tuple(m * 10**k for k in range(5) for m in (1, 2, 5))
# 0 을 포함한 세로 눈금 줄 수 상한.
#
# ⚠️ **9 는 「읽기 좋은 수」가 아니라 「지금 규칙이 내는 최대」다.** `y_max = 8` 은
#    걸음 1로 0~8 아홉 줄을 낸다 — 상한을 8로 두면 그 장들이 같이 바뀐다. 상한은
#    **결함(눈금 과밀)만 걸러야** 하고 멀쩡한 장을 건드리면 안 된다. 실측: 이 값을
#    8로 낮추면 **지금 결함이 없는 장 829장**(2,400장 중)이 같이 바뀌고, 7이면
#    1,123장이 바뀐다. 9에서는 0장이다 — 그래서 9다.
#    (잰 자: `scripts/qa/measure-elem-charts.py`, 씨앗 400 · 그래프 2,400장)
MAX_Y_TICKS = 9


def _int(value: Any, name: str, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
        raise ValueError(f"{name} 은 정수여야 합니다")
    n = int(value)
    if n < lo or n > hi:
        raise ValueError(f"{name} 은 {lo} 이상 {hi} 이하여야 합니다")
    return n


def _num(value: Any, name: str, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} 은 수여야 합니다")
    n = float(value)
    if n < lo or n > hi:
        raise ValueError(f"{name} 은 {lo} 이상 {hi} 이하여야 합니다")
    return n


def _poly(pts: list[tuple[float, float]], fill: str, sw: float = 1.3) -> str:
    s = " ".join(f"{_n(x)},{_n(y)}" for x, y in pts)
    return f'<polygon points="{s}" fill="{fill}" stroke="{INK}" stroke-width="{_n(sw)}"/>'


def _line(a: tuple[float, float], b: tuple[float, float], sw: float = 1.3, dash: str | None = None) -> str:
    d = f' stroke-dasharray="{_esc(dash)}"' if dash else ""
    return (
        f'<line x1="{_n(a[0])}" y1="{_n(a[1])}" x2="{_n(b[0])}" y2="{_n(b[1])}" '
        f'stroke="{INK}" stroke-width="{_n(sw)}"{d}/>'
    )


def _polyline(
    pts: list[tuple[float, float]],
    *,
    sw: float = 1.15,
    dash: str | None = None,
) -> str:
    s = " ".join(f"{_n(x)},{_n(y)}" for x, y in pts)
    d = f' stroke-dasharray="{_esc(dash)}"' if dash else ""
    return (
        f'<polyline points="{s}" fill="none" stroke="{INK}" '
        f'stroke-width="{_n(sw)}"{d}/>'
    )


def _frac_bars(spec: Mapping[str, Any]) -> str:
    cols = _int(spec["cols"], "cols", 2, 16)
    rows = _int(spec["rows"], "rows", 1, 8)
    filled_raw = spec["filled"]
    total = cols * rows
    if isinstance(filled_raw, (int, float)) and not isinstance(filled_raw, bool):
        nfill = _int(filled_raw, "filled", 0, total)
        filled = set(range(nfill))
    elif isinstance(filled_raw, list):
        filled = set()
        for item in filled_raw:
            filled.add(_int(item, "filled", 0, total - 1))
    else:
        raise ValueError("filled 는 개수 또는 칸 번호 배열이어야 합니다")
    fill_on = str(spec.get("fill") or FILL)
    pad = 8.0
    box_w = TABLE_VIEWBOX_MAX - pad * 2
    cw = box_w / cols
    ch = 22.0
    gap = 4.0
    parts: list[str] = []
    for r in range(rows):
        for c in range(cols):
            i = r * cols + c
            x = pad + c * cw
            y = pad + r * (ch + gap)
            fill = fill_on if i in filled else FAINT
            parts.append(_rect(x + 0.5, y, cw - 1, ch, sw=1.05, fill=fill))
    h = pad * 2 + rows * ch + (rows - 1) * gap
    return _svg(TABLE_VIEWBOX_MAX, h, "".join(parts))


def _chart_values(raw: Any, name: str) -> list[tuple[str, float]]:
    if not isinstance(raw, list) or not raw:
        raise ValueError(f"{name} 는 비어 있지 않은 배열이어야 합니다")
    if len(raw) > 8:
        raise ValueError(f"{name} 는 8개 이하여야 합니다")
    out: list[tuple[str, float]] = []
    for i, item in enumerate(raw):
        if not isinstance(item, Mapping):
            raise ValueError(f"{name}[{i}] 는 객체여야 합니다")
        out.append((str(item.get("label", "")), _num(item.get("value"), f"{name}[{i}].value", 0, 10000)))
    return out


def _y_step(y_max: float) -> int:
    """세로 눈금 한 칸.

    지금 규칙(`≤8→1` · `≤12→2` · 그 위 `5`)을 **바닥**으로 깔고, 그 걸음이 눈금을
    `MAX_Y_TICKS` 줄보다 많이 만들 때에만 사다리를 올린다 — **넘칠 때만 키운다.**

    ⚠️ 「5~8줄이 읽기 좋다」로 걸음을 다시 고르면 **지금 잘 나오는 장이 같이 바뀐다**
    (`y_max` 15·16·17 은 지금 4줄인데 그 규칙이면 8~9줄이 된다). 결함이 아닌 장을
    바꾸는 것은 수리가 아니라 **다른 그림으로 갈아 끼우는 것**이라, 원장님 확정
    없이는 못 한다(D-07). 그래서 상한만 두고 나머지는 손대지 않는다 (09 §4-23).

    사다리는 `1·2·5` 를 열 배씩 — 그 셋 말고는 「한 칸이 몇인가」가 암산이 안 된다.
    """
    base = 1 if y_max <= 8 else (2 if y_max <= 12 else 5)
    for step in NICE_STEPS:
        if step >= base and _tick_count(y_max, step) <= MAX_Y_TICKS:
            return step
    return NICE_STEPS[-1]


def _tick_count(axis_top: float, step: int) -> int:
    """0 을 포함한 눈금 줄 수 — `_plot_axes` 의 고리가 실제로 그리는 수와 같아야 한다."""
    return int(math.floor(axis_top / step + 1e-9)) + 1


def _axis_top(
    y_max: float, data_max: float, y_step: int | None = None
) -> tuple[float, int]:
    """축 맨 위와 걸음.

    ## `yStep` 이 오면 **그 걸음 그대로 긋는다** (D-70)

    「눈금 한 칸은 몇 명인가」 유형은 발문이 걸음을 말한다. 그 값을 여기서 다시
    고르면 **발문이 그림과 다른 말을 한다** — D-67 이 그 유형을 통째로 뺐던 이유다.
    그래서 `yStep` 이 있으면 사다리를 **안 탄다.** 축을 올려야 하면 걸음은 그대로 두고
    **눈금 수만** 늘린다.

    ⚠️ **그 걸음으로 못 그리면 던진다.** 조용히 사다리로 올리면 발문이 「한 칸 5명」인데
    그림은 10명 간격이 된다 — 에러도 안 나고 학생만 틀린다. TS 가 옳게 정하면 안 밟는
    경로지만, **방어는 침묵이 아니라 던짐이다.**

    ## `yStep` 이 없으면 (기존 그대로)

    **`yMax` 는 「진실」이 아니라 「최소 높이 요청」이다.** 걸음을 아는 쪽은 여기이므로,
    맨 위 눈금선이 데이터보다 낮으면(=제일 높은 점이 눈금 밖으로 뜨면) 여기서 올린다.
    실측으로 꺾은선 `yMax = 최댓값 + 3` 은 최댓값이 5로 나눠 1이 남을 때마다 떴다
    (2,400장 중 214장). 하필 그 점이 「가장 많은 때는 언제인가」의 답이다.

    올리면 걸음이 다시 커질 수 있고, 걸음이 커지면 필요한 높이가 또 달라진다 —
    그래서 **더 안 움직일 때까지** 되풀이한다. 한 번만 돌면 `yMax 44 · 값 44` 가
    45(걸음 10, 맨 위 눈금 40)에서 멈춰 **값 44가 다시 뜬다**(실측: 6,000칸 중 1,119칸).

    `max(...)` 라서 **필요 없으면 아무것도 안 올린다** — 지금 맞게 나오는 장은
    `y_max` 도 걸음도 그대로고, 따라서 픽셀도 그대로다.

    ⚠️ **못 끝나면 조용히 도는 대신 던진다.** 고리가 안 끝나는 것은 걸음이 사다리를
    한 칸씩만 올라간다는 전제가 깨졌다는 뜻이고, 그때 마지막 값을 그냥 돌려주면
    **눈금과 데이터가 어긋난 그림이 조용히 지면으로 나간다.** 입력 전 범위
    (`yMax` 1~10000 × 데이터 5종 = 50,000칸)에서 여기 닿는 조합은 없다.
    """
    top = max(float(y_max), 1.0)
    if y_step is not None:
        # 걸음이 요청한 높이보다 크면 **부르는 쪽이 스스로 어긋난 것**이다 — 「8까지
        # 그려 달라」면서 「한 칸은 100」이라 한 셈. 그대로 그리면 눈금이 0과 100 둘뿐이고
        # 막대가 바닥에 깔린다(231줄과 **반대 방향의 같은 병**). 문턱을 지어낸 게 아니라
        # 부르는 쪽이 준 두 수를 견준 것이다.
        if y_step > y_max:
            raise ValueError(
                f"yStep {y_step} 이 yMax {y_max:g} 보다 큽니다 — 눈금이 데이터를 못 가릅니다"
            )
        need = math.ceil(data_max / y_step - 1e-9) * y_step if data_max > 0 else 0.0
        top = max(top, float(need))
        ticks = _tick_count(top, y_step)
        if ticks > MAX_Y_TICKS:
            raise ValueError(
                f"yStep {y_step} 으로는 눈금이 {ticks}줄이 됩니다 "
                f"({MAX_Y_TICKS}줄 이하여야 합니다. 축 맨 위 {top:g})"
            )
        return top, y_step
    # 사다리 칸을 한 번씩 다 밟아도 끝난다 — 같은 걸음이면 필요 높이가 그대로라
    # 다음 바퀴에서 반드시 돌아간다. +1 은 마지막 확인 한 바퀴.
    for _ in range(len(NICE_STEPS) + 1):
        step = _y_step(top)
        need = math.ceil(data_max / step - 1e-9) * step if data_max > 0 else 0.0
        if need <= top:
            return top, step
        top = float(need)
    raise ValueError(f"축 맨 위가 수렴하지 않습니다 (yMax={y_max}, 값 최댓값={data_max})")


def _y_step_spec(spec: Mapping[str, Any]) -> int | None:
    """스펙이 실어 온 눈금 걸음. 없으면 `None` — 그때만 `_y_step` 이 고른다 (D-70).

    「눈금 한 칸은 몇 명인가」 발문은 **TS 가 정한 걸음**을 말한다. 그 값을 여기서
    다시 고르면 발문과 그림이 갈린다.
    """
    if "yStep" not in spec:
        return None
    return _int(spec["yStep"], "yStep", 1, 10000)


def _unit_label(left: float, top: float, ylab: str) -> str:
    """세로축 단위는 눈금과 같은 열, 맨 위 눈금보다 한 줄 위."""
    if not ylab:
        return ""
    return _text(left - 7, top - 20, ylab, size=13, anchor="end")


# 눈금 숫자 한 자의 폭(그림 단위, 14pt). **실측값이다** — 지면과 같은 렌더러
# (헤드리스 Chromium)에서 `getComputedTextLength()` 로 쟀다:
#   `0`8.62 · `20`17.21 · `500`25.83 · `1000`34.42 → 전부 8.605/자
# Batang bold 는 숫자가 고정폭이라 «자당 폭 × 자릿수» 가 어림이 아니라 정확하다.
# 파이썬에는 글꼴 계측이 없어서 리터럴 말고는 방법이 없다.
# ⚠️ 글꼴을 바꾸면 이 값을 **다시 재야 한다**(`scripts/qa/…` 시안의 measure-text.mjs).
TICK_DIGIT_W = 8.605
# 마지막 눈금 숫자와 단위 라벨 사이 틈. 지면에서 약 1.4mm.
UNIT_GAP = 6.0
# 이웃한 값 눈금 숫자 사이 최소 틈.
TICK_MIN_GAP = 3.0


# 13pt 글자 폭 **상한** — 실측 「바닐라」 39.72/3 = 13.24(한글), 숫자 7.99.
# 라틴·괄호는 숫자보다도 좁아서(「(개)」 23.54 = 한글 13.24 + 괄호 둘 10.3) 8.0 이면 넉넉하다.
# 잘림을 막는 용도라 **상한이면 맞다** — 다만 너무 헐거우면 짝 배치에서 폭을 낭비하므로
# 한글과 나머지를 나눈다(모두 한글로 치면 「(개)」가 39.7 로 16단위 부풀었다).
HANGUL_W_13 = 13.24
ASCII_W_13 = 8.0


def _digits_half(value: int) -> float:
    """눈금 숫자가 가운데 정렬이라 **오른쪽으로 뻗는 만큼**(폭의 절반)."""
    return TICK_DIGIT_W * len(str(int(value))) / 2


def _label_w_max(text: str, size: float = 13.0) -> float:
    """글자 폭 **상한**. 한글은 넓고 나머지는 좁다 — 넘치지 않을 만큼만 넉넉하게."""
    scale = size / 13.0
    return scale * sum(
        HANGUL_W_13 if ord(ch) >= 0x1100 else ASCII_W_13 for ch in text
    )


def _assert_ticks_fit(ticks: list[int], plot_w: float) -> None:
    """가로형 값 눈금이 **옆으로 늘어서므로** 숫자끼리 겹칠 수 있다.

    세로형은 눈금이 위아래로 쌓여 이 결함이 없다 — **방향이 만드는 차이**다.
    실측(커밋 7d3edc42): 값 축 140단위에 세 자리 눈금 9개를 그리면
    「0100200300…」처럼 **읽을 수 없는 덩어리**가 된다. 에러도 안 나고 지면에만 나간다.

    조용히 겹치게 두지 않고 **던진다** — 상한은 우리가 아니라 엔진이 정한다
    (`yStep` 9줄 상한과 같은 무늬, D-70).
    """
    if len(ticks) < 2:
        return
    widest = TICK_DIGIT_W * max(len(str(t)) for t in ticks)
    pitch = plot_w / (len(ticks) - 1)
    if pitch < widest + TICK_MIN_GAP:
        raise ValueError(
            f"값 축 {plot_w:g} 단위에 눈금 {len(ticks)}개를 그리면 숫자가 겹칩니다 "
            f"(간격 {pitch:.1f} · 숫자 폭 {widest:.1f}). 걸음을 키우거나 값을 줄이십시오"
        )


def _tick_values(axis_top: float, step: int) -> list[int]:
    """0부터 `axis_top` 까지 `step` 마다. **방향과 무관하다** — 값 축의 눈금은 하나다.

    가로형·세로형이 각자 눈금을 세면 규칙이 두 벌이 되어 한쪽만 고쳐진다
    (2026-08-18 「같은 규칙을 쓰는 자리가 둘이면 한 숫자를 두 곳이 쓰게 하라」).
    """
    out: list[int] = []
    v = 0
    while v <= axis_top + 1e-6:
        out.append(v)
        v += step
    return out


def _plot_axes(
    left: float,
    top: float,
    plot_w: float,
    plot_h: float,
    axis_top: float,
    step: int,
    horizontal: bool = False,
) -> list[str]:
    """축 두 줄과 **값 축**의 눈금.

    `axis_top` 과 `step` 은 **둘 다 `_axis_top()` 이 낸 것을 그대로** 받는다.
    막대·꺾은선의 배율도 같은 `axis_top` 을 써야 한다 — 안 그러면 눈금과 데이터가
    다른 자로 그려진다(변이 ㉕·㉖).

    ⚠️ **여기서 `_y_step` 을 다시 부르면 안 된다.** 그러면 스펙이 실어 온 `yStep` 이
    조용히 무시되어 「한 칸 5명」 발문 옆에 10명 간격이 그려진다 (D-70).

    `horizontal` 은 **값 축을 어느 화면 축에 눕히는가**만 바꾼다. 눈금 값 자체는
    `_tick_values` 하나가 낸다 — 방향마다 규칙이 갈리지 않는다.
    """
    parts = [
        _line((left, top), (left, top + plot_h)),
        _line((left, top + plot_h), (left + plot_w, top + plot_h)),
    ]
    for v in _tick_values(axis_top, step):
        if horizontal:
            x = left + plot_w * v / axis_top
            # 0 눈금은 세로축과 겹친다.
            if v > 0:
                parts.append(_line((x, top), (x, top + plot_h), sw=0.4, dash="3 3"))
            parts.append(_line((x, top + plot_h), (x, top + plot_h + 4), sw=0.9))
            parts.append(_text(x, top + plot_h + 14, str(v), size=14))
        else:
            y = top + plot_h - plot_h * v / axis_top
            # 0 눈금은 가로축과 겹친다. 흰 외곽선 halo 는 mix-blend-multiply 에서
            # 가장자리가 회색으로 뭉개지므로 쓰지 않는다.
            if v > 0:
                parts.append(_line((left, y), (left + plot_w, y), sw=0.4, dash="3 3"))
            parts.append(_line((left - 4, y), (left, y), sw=0.9))
            parts.append(_text(left - 7, y, str(v), size=14, anchor="end"))
    return parts


def _orient(spec: Mapping[str, Any]) -> bool:
    """가로형인가. 기본은 세로 — **없으면 지금 지면과 완전히 같다.**

    ⚠️ `yMax`·`yStep`·`yLabel` 은 화면의 세로축이 아니라 **값 축**을 가리킨다.
    가로형이면 그 축이 아래로 눕을 뿐 이름은 그대로다. **`valueMax` 로 «개선»하지 마라**
    — 한 가지에 이름이 둘이 되면 축 규칙을 고칠 때 한쪽만 고쳐진다
    (2026-08-18 「같은 규칙을 쓰는 자리가 둘이면 한 숫자를 두 곳이 쓰게 하라」).
    읽는 법: **y = 값 · x = 항목, 화면 방향과 무관.**
    """
    raw = spec.get("orient", "vertical")
    if raw not in ("vertical", "horizontal"):
        raise ValueError('orient 는 "vertical" 또는 "horizontal" 이어야 합니다')
    return raw == "horizontal"


def _chart_title(title: str, cx: float) -> str:
    """그래프 제목 — 값 축 눈금(14)보다 크지 않게, 가운데."""
    return _text(cx, 16, title, size=14) if title else ""


def _bar_chart_h(spec: Mapping[str, Any], values, axis_top: float, step: int) -> str:
    """가로 막대. 항목 라벨이 왼쪽, **값 축이 아래**로 눕는다.

    축 계산(`_axis_top`)은 세로형과 **같은 것을 이미 받아** 온다 — 여기서 다시 정하지
    않는다. 이 함수가 정하는 것은 «어디에 그리는가»뿐이다.
    """
    title = str(spec.get("title", ""))
    left, top, plot_w, plot_h = 60.0, (34.0 if title else 16.0), 140.0, 118.0
    pad_b = 34.0
    n = len(values)
    gap = 8.0
    bh = (plot_h - gap * (n + 1)) / n
    _assert_ticks_fit(_tick_values(axis_top, step), plot_w)
    parts = _plot_axes(left, top, plot_w, plot_h, axis_top, step, horizontal=True)
    for i, (lab, val) in enumerate(values):
        w = 0 if axis_top <= 0 else min(plot_w, plot_w * val / axis_top)
        y = top + gap + i * (bh + gap)
        parts.append(_rect(left, y, w, bh, fill=CHART[i % len(CHART)], sw=1.05))
        num = str(int(val)) if val == int(val) else _n(val)
        # 막대 안쪽이면 격자선과 안 겹친다. 짧은 막대만 바깥 오른쪽에 둔다.
        nx = left + w - 16 if w >= 34 else left + w + 12
        parts.append(_text(nx, y + bh / 2, num, size=16))
        parts.append(_text(left - 7, y + bh / 2, lab, size=13, anchor="end"))
    ylab = str(spec.get("yLabel", ""))
    # 단위 라벨은 **오른쪽 끝**에 오므로 viewBox 를 넘으면 잘린다. `_svg` 의 맞춤은
    # 글자 «닻»만 보고 뻗는 폭은 모르므로 여기서 넉넉히 잡아 준다 — 실측으로 세 자리
    # 눈금에서 2.4단위, 네 자리에서 6.8단위가 잘리고 있었다(닫는 괄호가 사라졌다).
    width = TABLE_VIEWBOX_MAX
    if ylab:
        # 마지막 눈금 숫자 바로 뒤 — 교과서가 「0 20 40 (개)」로 적는 자리다.
        #
        # ⚠️ **마지막 눈금 숫자는 축 끝에 «가운데» 정렬이라 오른쪽으로 절반을 더 뻗는다.**
        # 축 끝 + 6 에 그냥 놓으면 겹친다 — `yStep` 을 실으면 맨 위 눈금이 축 끝에
        # 딱 떨어지는 것이 보통이라 **D-70 유형에서는 거의 항상** 겹쳤다
        # (실측: 2자리 −2.60단위 · 3자리 −6.91단위, 커밋 7d3edc42).
        # 세로형은 단위가 축 **위**(`top-20`)라 이 결함이 없다 — 줄이 다르기 때문이다.
        last = _tick_values(axis_top, step)[-1]
        unit_x = left + plot_w + _digits_half(last) + UNIT_GAP
        parts.append(_text(unit_x, top + plot_h + 14, ylab, size=13, anchor="start"))
        width = max(width, unit_x + _label_w_max(ylab) + 4)
    parts.append(_chart_title(title, left + plot_w / 2))
    return _svg(width, top + plot_h + pad_b, "".join(parts))


def _bar_chart(spec: Mapping[str, Any]) -> str:
    values = _chart_values(spec["values"], "values")
    data_max = max((v for _, v in values), default=0.0)
    y_max = _num(spec.get("yMax", data_max or 1), "yMax", 1, 10000)
    # 축 규칙은 **방향보다 위**에 있다 — 사다리·9줄·yStep·인상·던짐이 한 벌뿐이다.
    axis_top, step = _axis_top(y_max, data_max, _y_step_spec(spec))
    if _orient(spec):
        return _bar_chart_h(spec, values, axis_top, step)
    title = str(spec.get("title", ""))
    # 제목이 있으면 **한 줄 내린다.** 단위 라벨이 `top - 20` 에 앉으므로 그대로 두면
    # 긴 제목과 같은 줄에서 부딪힌다. 제목이 없으면 `top` 은 36 그대로라
    # **지금 지면 2,400장이 한 픽셀도 안 바뀐다.**
    left, top, plot_w, plot_h, pad_b = 46.0, (56.0 if title else 36.0), 186.0, 118.0, 32.0
    n = len(values)
    gap = 8.0
    bw = (plot_w - gap * (n + 1)) / n
    parts = _plot_axes(left, top, plot_w, plot_h, axis_top, step)
    for i, (lab, val) in enumerate(values):
        h = 0 if axis_top <= 0 else min(plot_h, plot_h * val / axis_top)
        x = left + gap + i * (bw + gap)
        y = top + plot_h - h
        parts.append(_rect(x, y, bw, h, fill=CHART[i % len(CHART)], sw=1.05))
        num = str(int(val)) if val == int(val) else _n(val)
        # 막대 안쪽이면 격자선과 안 겹친다. 짧은 막대만 위에 둔다.
        ny = y + 14 if h >= 24 else y - 12
        parts.append(_text(x + bw / 2, ny, num, size=16))
        parts.append(_text(x + bw / 2, top + plot_h + 16, lab, size=13))
    parts.append(_unit_label(left, top, str(spec.get("yLabel", ""))))
    parts.append(_chart_title(title, left + plot_w / 2))
    w = min(TABLE_VIEWBOX_MAX, left + plot_w + 8)
    return _svg(w, top + plot_h + pad_b, "".join(parts))


def _line_chart(spec: Mapping[str, Any]) -> str:
    values = _chart_values(spec["values"], "values")
    data_max = max((v for _, v in values), default=0.0)
    y_max = _num(spec.get("yMax", data_max or 1), "yMax", 1, 10000)
    axis_top, step = _axis_top(y_max, data_max, _y_step_spec(spec))
    left, top, plot_w, plot_h, pad_b = 46.0, 36.0, 186.0, 100.0, 28.0
    n = len(values)
    parts = _plot_axes(left, top, plot_w, plot_h, axis_top, step)
    pts: list[tuple[float, float]] = []
    for i, (lab, val) in enumerate(values):
        x = left + (plot_w * i / max(n - 1, 1))
        y = top + plot_h - (0 if axis_top <= 0 else min(plot_h, plot_h * val / axis_top))
        pts.append((x, y))
        parts.append(_text(x, top + plot_h + 12, lab, size=10))
    for a, b in zip(pts, pts[1:]):
        parts.append(_line(a, b, sw=1.5))
    for x, y in pts:
        parts.append(f'<circle cx="{_n(x)}" cy="{_n(y)}" r="2.4" fill="{INK}"/>')
    parts.append(_unit_label(left, top, str(spec.get("yLabel", ""))))
    w = min(TABLE_VIEWBOX_MAX, left + plot_w + 8)
    return _svg(w, top + plot_h + pad_b, "".join(parts))


def _pictograph(spec: Mapping[str, Any]) -> str:
    unit = _int(spec["unit"], "unit", 1, 100)
    items = spec["items"]
    if not isinstance(items, list) or not items or len(items) > 6:
        raise ValueError("items 는 1~6개여야 합니다")
    # viewBox 폭을 240으로 고정 — 칸 수가 달라도 화면 크기가 안 변한다.
    icon_w, icon_h, pad = 22.0, 24.0, 10.0
    parts: list[str] = [_text(pad, 14, f"□ = {unit}", size=13, anchor="start")]
    y = 32.0
    for i, item in enumerate(items):
        if not isinstance(item, Mapping):
            raise ValueError("items 항목은 객체여야 합니다")
        lab = str(item.get("label", ""))
        count = _int(item.get("count"), f"items[{i}].count", 0, 12)
        parts.append(_text(pad + 28, y + icon_h / 2, lab, size=12, anchor="end"))
        for k in range(count):
            x = pad + 36 + k * (icon_w + 4)
            parts.append(_rect(x, y, icon_w, icon_h, rx=2, fill=CHART[i % len(CHART)], sw=1.0))
        y += icon_h + 8
    return _svg(TABLE_VIEWBOX_MAX, y + pad, "".join(parts))


def _strip_chart(spec: Mapping[str, Any]) -> str:
    segs = spec["segments"]
    if not isinstance(segs, list) or not segs or len(segs) > 8:
        raise ValueError("segments 는 1~8개여야 합니다")
    parsed: list[tuple[str, float]] = []
    total = 0.0
    for i, item in enumerate(segs):
        if not isinstance(item, Mapping):
            raise ValueError("segments 항목은 객체여야 합니다")
        pct = _num(item.get("pct"), f"segments[{i}].pct", 0, 100)
        parsed.append((str(item.get("label", "")), pct))
        total += pct
    if abs(total - 100) > 0.6:
        raise ValueError("segments pct 합은 100이어야 합니다")
    x0, y0, bw, bh = 8.0, 8.0, 224.0, 28.0
    parts = [_rect(x0, y0, bw, bh, sw=1.2)]
    x = x0
    for i, (lab, pct) in enumerate(parsed):
        w = bw * pct / 100.0
        parts.append(_rect(x, y0, w, bh, fill=CHART[i % len(CHART)], sw=0.8))
        if w >= 44:
            parts.append(_text(x + w / 2, y0 + bh / 2, f"{lab} {int(pct)}%", size=9))
        x += w
    y = y0 + bh + 14
    for i, (lab, pct) in enumerate(parsed):
        if bw * pct / 100.0 < 44:
            parts.append(_text(8 + i * 56, y, f"{lab} {int(pct)}%", size=9, anchor="start"))
    return _svg(min(TABLE_VIEWBOX_MAX, 240), y + 10, "".join(parts))


def _pie_chart(spec: Mapping[str, Any]) -> str:
    slices = spec["slices"]
    if not isinstance(slices, list) or not slices or len(slices) > 8:
        raise ValueError("slices 는 1~8개여야 합니다")
    parsed: list[tuple[str, float]] = []
    total = 0.0
    for i, item in enumerate(slices):
        if not isinstance(item, Mapping):
            raise ValueError("slices 항목은 객체여야 합니다")
        pct = _num(item.get("pct"), f"slices[{i}].pct", 0, 100)
        parsed.append((str(item.get("label", "")), pct))
        total += pct
    if abs(total - 100) > 0.6:
        raise ValueError("slices pct 합은 100이어야 합니다")
    r, pad, cx, cy = 44.0, 8.0, 52.0, 52.0
    start = -90.0
    parts: list[str] = []
    for i, (lab, pct) in enumerate(parsed):
        sweep = 360.0 * pct / 100.0
        a0 = math.radians(start)
        a1 = math.radians(start + sweep)
        large = 1 if sweep > 180 else 0
        x0, y0 = cx + r * math.cos(a0), cy + r * math.sin(a0)
        x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
        parts.append(
            f'<path d="M{_n(cx)} {_n(cy)} L{_n(x0)} {_n(y0)} '
            f'A{_n(r)} {_n(r)} 0 {large} 1 {_n(x1)} {_n(y1)} Z" '
            f'fill="{CHART[i % len(CHART)]}" stroke="{INK}" stroke-width="1.05"/>'
        )
        mid = math.radians(start + sweep / 2)
        if pct >= 8:
            parts.append(_text(cx + r * 0.55 * math.cos(mid), cy + r * 0.55 * math.sin(mid), f"{int(pct)}", size=10))
        start += sweep
    ly = pad
    for i, (lab, pct) in enumerate(parsed):
        lx = pad * 2 + r * 2 + 8
        parts.append(_rect(lx, ly, 10, 10, fill=CHART[i % len(CHART)], sw=0.8))
        parts.append(_text(lx + 14, ly + 6, f"{lab} {int(pct)}%", size=10, anchor="start"))
        ly += 14
    return _svg(min(TABLE_VIEWBOX_MAX, 240), max(pad * 2 + r * 2, ly + 4), "".join(parts))


def _protractor(spec: Mapping[str, Any]) -> str:
    deg = _num(spec["deg"], "deg", 1, 179)
    cx, cy, r = 110.0, 88.0, 72.0
    parts = [
        f'<path d="M{_n(cx - r)} {_n(cy)} A{_n(r)} {_n(r)} 0 0 1 {_n(cx + r)} {_n(cy)}" '
        f'fill="{FAINT}" stroke="{INK}" stroke-width="1.4"/>',
        _line((cx - r, cy), (cx + r, cy), sw=1.2),
    ]
    for d in range(0, 181, 10):
        a = math.radians(180 - d)
        inner = r - (8 if d % 30 == 0 else 4)
        x0, y0 = cx + r * math.cos(a), cy - r * math.sin(a)
        x1, y1 = cx + inner * math.cos(a), cy - inner * math.sin(a)
        parts.append(_line((x0, y0), (x1, y1), sw=0.9))
        if d % 30 == 0:
            tx, ty = cx + (r + 11) * math.cos(a), cy - (r + 11) * math.sin(a)
            parts.append(_text(tx, ty, str(d), size=9))
    a = math.radians(180 - deg)
    parts.append(_line((cx, cy), (cx + r * math.cos(0), cy), sw=1.5))
    parts.append(_line((cx, cy), (cx + r * math.cos(a), cy - r * math.sin(a)), sw=1.5))
    parts.append(f'<circle cx="{_n(cx)}" cy="{_n(cy)}" r="2.2" fill="{INK}"/>')
    return _svg(220, 110, "".join(parts))


def _transform_cells(cells: list[tuple[int, int]], op: str, n: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for c, r in cells:
        if op == "rot90":
            out.append((n - 1 - r, c))
        elif op == "rot180":
            out.append((n - 1 - c, n - 1 - r))
        elif op == "rot270":
            out.append((r, n - 1 - c))
        elif op == "flipH":
            out.append((n - 1 - c, r))
        elif op == "flipV":
            out.append((c, n - 1 - r))
        else:
            raise ValueError("op 은 rot90·rot180·rot270·flipH·flipV 여야 합니다")
    return out


def _draw_cell_grid(ox: float, oy: float, n: int, cells: set[tuple[int, int]], size: float) -> str:
    parts = []
    for r in range(n):
        for c in range(n):
            x, y = ox + c * size, oy + r * size
            fill = FILL if (c, r) in cells else PAPER
            parts.append(_rect(x, y, size, size, fill=fill, sw=0.9, stroke=INK))
    return "".join(parts)


def _group_dots(spec: Mapping[str, Any]) -> str:
    """똑같이 나누기 — 묶음 수 × 묶음당 개수. viewBox 240 고정."""
    groups = _int(spec["groups"], "groups", 2, 10)
    each = _int(spec["each"], "each", 1, 12)
    fills = ("#c4a574", "#7eb89a", "#8f9fd4", "#d4a0c8", "#e0a87a", "#c9b56a")
    w, h = TABLE_VIEWBOX_MAX, 150.0
    cols_g = min(groups, 5)
    rows_g = (groups + cols_g - 1) // cols_g
    slot_w = w / cols_g
    slot_h = h / rows_g
    dot_r = 4.2
    parts: list[str] = []
    for g in range(groups):
        gc, gr = g % cols_g, g // cols_g
        ox = gc * slot_w + 6
        oy = gr * slot_h + 6
        bw, bh = slot_w - 12, slot_h - 10
        fill = fills[g % len(fills)]
        parts.append(_rect(ox, oy, bw, bh, rx=6, fill=FAINT, sw=1.05, stroke="#c8c4bc"))
        inner_cols = 1 if bh >= bw else min(each, 3)
        inner_rows = (each + inner_cols - 1) // inner_cols
        gap_x = bw / (inner_cols + 1)
        gap_y = bh / (inner_rows + 1)
        for k in range(each):
            ic, ir = k % inner_cols, k // inner_cols
            cx = ox + gap_x * (ic + 1)
            cy = oy + gap_y * (ir + 1)
            parts.append(
                f'<circle cx="{_n(cx)}" cy="{_n(cy)}" r="{_n(dot_r)}" fill="{fill}" '
                f'stroke="{INK}" stroke-width="0.8"/>'
            )
    return _svg(w, h, "".join(parts))


def _rotate_flip(spec: Mapping[str, Any]) -> str:
    n = _int(spec.get("n", 4), "n", 3, 6)
    op = str(spec["op"])
    raw = spec["cells"]
    if not isinstance(raw, list) or not raw:
        raise ValueError("cells 는 비어 있지 않은 배열이어야 합니다")
    cells: list[tuple[int, int]] = []
    for i, item in enumerate(raw):
        if not isinstance(item, list) or len(item) != 2:
            raise ValueError("cells 항목은 [열, 행] 이어야 합니다")
        cells.append((_int(item[0], f"cells[{i}][0]", 0, n - 1), _int(item[1], f"cells[{i}][1]", 0, n - 1)))
    after = _transform_cells(cells, op, n)
    size, pad = 16.0, 8.0
    g = n * size
    parts = [_draw_cell_grid(pad, pad, n, set(cells), size)]
    parts.append(_arrow_right(pad + g + 4, pad + g + 28, pad + g / 2))
    parts.append(_draw_cell_grid(pad + g + 36, pad, n, set(after), size))
    w = pad * 2 + g * 2 + 36
    return _svg(min(w, 240), pad * 2 + g, "".join(parts))


_MOTIF_PTS: dict[str, list[tuple[float, float]]] = {
    "kite": [(0.50, 0.08), (0.88, 0.42), (0.50, 0.92), (0.12, 0.42)],
    "eqTri": [(0.50, 0.10), (0.90, 0.88), (0.10, 0.88)],
    "isoTrap": [(0.30, 0.18), (0.70, 0.18), (0.90, 0.86), (0.10, 0.86)],
    "arrow": [
        (0.50, 0.08),
        (0.88, 0.40),
        (0.68, 0.40),
        (0.68, 0.90),
        (0.32, 0.90),
        (0.32, 0.40),
        (0.12, 0.40),
    ],
    "house": [(0.18, 0.90), (0.18, 0.48), (0.50, 0.12), (0.82, 0.48), (0.82, 0.90)],
    "rhombus": [(0.50, 0.10), (0.88, 0.50), (0.50, 0.90), (0.12, 0.50)],
    "heart": [
        (0.50, 0.88),
        (0.14, 0.50),
        (0.14, 0.32),
        (0.28, 0.16),
        (0.50, 0.32),
        (0.72, 0.16),
        (0.86, 0.32),
        (0.86, 0.50),
    ],
    "para": [(0.28, 0.18), (0.90, 0.18), (0.72, 0.84), (0.10, 0.84)],
    "hourglass": [(0.28, 0.12), (0.72, 0.12), (0.58, 0.50), (0.72, 0.88), (0.28, 0.88), (0.42, 0.50)],
    "z": [
        (0.18, 0.18),
        (0.82, 0.18),
        (0.82, 0.32),
        (0.40, 0.68),
        (0.82, 0.68),
        (0.82, 0.82),
        (0.18, 0.82),
        (0.18, 0.68),
        (0.60, 0.32),
        (0.18, 0.32),
    ],
}

_MOTIF_FILL = {
    "kite": "#e2b48a",
    "eqTri": "#c5d6c2",
    "isoTrap": "#c5d4e8",
    "arrow": "#d7c2e4",
    "house": "#e8d4a8",
    "rhombus": "#d4c0b0",
    "heart": "#e4c2c8",
    "para": "#c5d6c2",
    "hourglass": "#d7c2e4",
    "z": "#c5d4e8",
    "hex": "#e2b48a",
}


def _hex_pts() -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for i in range(6):
        a = math.radians(-90 + 60 * i)
        pts.append((0.5 + 0.38 * math.cos(a), 0.5 + 0.38 * math.sin(a)))
    return pts


def _symmetry_marks(axis: str, pad: float, g: float) -> str:
    if axis == "v":
        x = pad + g / 2
        return _line((x, pad - 2), (x, pad + g + 2), sw=1.2, dash="5 4")
    if axis == "h":
        y = pad + g / 2
        return _line((pad - 2, y), (pad + g + 2, y), sw=1.2, dash="5 4")
    cx, cy = pad + g / 2, pad + g / 2
    return f'<circle cx="{_n(cx)}" cy="{_n(cy)}" r="2.6" fill="{INK}"/>'


def _symmetry_motif(axis: str, motif: str) -> str:
    if motif == "hex":
        unit = _hex_pts()
    elif motif in _MOTIF_PTS:
        unit = _MOTIF_PTS[motif]
    else:
        raise ValueError(f"모르는 대칭 모양입니다: {motif}")
    pad, g = 12.0, 120.0
    swap = axis == "h"
    pts = []
    for x, y in unit:
        if swap:
            x, y = y, x
        pts.append((pad + x * g, pad + y * g))
    fill = _MOTIF_FILL.get(motif, FILL)
    parts = [_poly(pts, fill, 1.4), _symmetry_marks(axis, pad, g)]
    return _svg(pad * 2 + g, pad * 2 + g, "".join(parts))


def _symmetry(spec: Mapping[str, Any]) -> str:
    axis = str(spec["axis"])
    if axis not in {"v", "h", "point"}:
        raise ValueError("axis 는 v·h·point 여야 합니다")
    motif = str(spec.get("motif") or "")
    if motif:
        return _symmetry_motif(axis, motif)
    n = _int(spec.get("n", 5), "n", 3, 8)
    raw = spec.get("cells")
    if not isinstance(raw, list) or not raw:
        raise ValueError("cells 또는 motif 가 필요합니다")
    cells: list[tuple[int, int]] = []
    for i, item in enumerate(raw):
        if not isinstance(item, list) or len(item) != 2:
            raise ValueError("cells 항목은 [열, 행] 이어야 합니다")
        cells.append((_int(item[0], f"cells[{i}][0]", 0, n - 1), _int(item[1], f"cells[{i}][1]", 0, n - 1)))
    size, pad = 16.0, 10.0
    g = n * size
    parts = [_draw_cell_grid(pad, pad, n, set(cells), size), _symmetry_marks(axis, pad, g)]
    return _svg(pad * 2 + g, pad * 2 + g, "".join(parts))


def _parse_voxels(spec: Mapping[str, Any]) -> list[tuple[int, int, int]]:
    raw = spec["voxels"]
    if not isinstance(raw, list) or not raw:
        raise ValueError("voxels 는 비어 있지 않은 배열이어야 합니다")
    if len(raw) > 48:
        raise ValueError("voxels 는 48개 이하여야 합니다")
    out: list[tuple[int, int, int]] = []
    seen: set[tuple[int, int, int]] = set()
    for i, item in enumerate(raw):
        if not isinstance(item, list) or len(item) != 3:
            raise ValueError("voxels 항목은 [x, y, z] 이어야 합니다")
        v = (
            _int(item[0], f"voxels[{i}][0]", 0, 6),
            _int(item[1], f"voxels[{i}][1]", 0, 6),
            _int(item[2], f"voxels[{i}][2]", 0, 6),
        )
        if v in seen:
            raise ValueError("같은 칸의 쌓기나무가 두 번 있습니다")
        seen.add(v)
        out.append(v)
    return out


def _iso_cube(view: Any, x: int, y: int, z: int, occ: set[tuple[int, int, int]]) -> str:
    def p(dx: float, dy: float, dz: float) -> tuple[float, float]:
        return view((x + dx, y + dy, z + dz))

    parts = []
    if (x, y, z + 1) not in occ:
        parts.append(_poly([p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)], FACE_TOP, 1.05))
    if (x + 1, y, z) not in occ:
        parts.append(_poly([p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)], FACE_SIDE, 1.05))
    if (x, y - 1, z) not in occ:
        parts.append(_poly([p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)], FACE_FRONT, 1.05))
    return "".join(parts)


def _cell_center_text(cx: float, cy: float, t: Any, size: float = 13) -> str:
    """칸 한가운데. Batang 은 middle 이 시각 중앙보다 위라 central 을 쓴다."""
    return (
        f'<text x="{_n(cx)}" y="{_n(cy)}" fill="{INK}" font-size="{_n(size)}" '
        f'font-family="Batang, serif" font-weight="700" text-anchor="middle" '
        f'dominant-baseline="central">{_esc(t)}</text>'
    )


def _ortho_grid(voxels: list[tuple[int, int, int]], which: str, ox: float, oy: float) -> tuple[str, float, float]:
    xs = [v[0] for v in voxels]
    ys = [v[1] for v in voxels]
    zs = [v[2] for v in voxels]
    cell = 24.0
    title_h = 18.0
    title = {"top": "위", "front": "앞", "side": "옆"}[which]
    gy = oy + title_h
    parts: list[str] = []
    if which == "top":
        w, h = max(xs) + 1, max(ys) + 1
        height: dict[tuple[int, int], int] = {}
        for x, y, z in voxels:
            height[(x, y)] = max(height.get((x, y), 0), z + 1)
        parts.append(_text(ox + w * cell / 2, oy + 8, title, size=13))
        for y in range(h):
            for x in range(w):
                rx, ry = ox + x * cell, gy + (h - 1 - y) * cell
                fill = FILL if (x, y) in height else PAPER
                parts.append(_rect(rx, ry, cell, cell, fill=fill, sw=1.0))
                if (x, y) in height:
                    parts.append(_cell_center_text(rx + cell / 2, ry + cell / 2, str(height[(x, y)])))
        return "".join(parts), w * cell, title_h + h * cell
    if which == "front":
        w, h = max(xs) + 1, max(zs) + 1
        occ = {(x, z) for x, _y, z in voxels}
        parts.append(_text(ox + w * cell / 2, oy + 8, title, size=13))
        for z in range(h):
            for x in range(w):
                rx, ry = ox + x * cell, gy + (h - 1 - z) * cell
                fill = FILL if (x, z) in occ else PAPER
                parts.append(_rect(rx, ry, cell, cell, fill=fill, sw=1.0))
        return "".join(parts), w * cell, title_h + h * cell
    w, h = max(ys) + 1, max(zs) + 1
    occ = {(y, z) for _x, y, z in voxels}
    parts.append(_text(ox + w * cell / 2, oy + 8, title, size=13))
    for z in range(h):
        for y in range(w):
            rx, ry = ox + y * cell, gy + (h - 1 - z) * cell
            fill = FILL if (y, z) in occ else PAPER
            parts.append(_rect(rx, ry, cell, cell, fill=fill, sw=1.0))
    return "".join(parts), w * cell, title_h + h * cell


def _stack_cubes(spec: Mapping[str, Any]) -> str:
    from core.figure_solid import View

    voxels = _parse_voxels(spec)
    views = spec.get("views", ["iso"])
    if isinstance(views, str):
        views = [views]
    if not isinstance(views, list) or not views:
        raise ValueError("views 는 비어 있지 않은 배열이어야 합니다")
    allowed = {"iso", "top", "front", "side"}
    for v in views:
        if v not in allowed:
            raise ValueError("views 는 iso·top·front·side 여야 합니다")
    occ = set(voxels)
    parts: list[str] = []
    pad, gap = 10.0, 18.0
    x_cursor = pad
    height = 40.0
    if "iso" in views:
        scale = 16.0
        probe = View(0.5, 45, scale, (0.0, 0.0))
        corners: list[tuple[float, float]] = []
        for x, y, z in voxels:
            for dx in (0, 1):
                for dy in (0, 1):
                    for dz in (0, 1):
                        corners.append(probe((x + dx, y + dy, z + dz)))
        minx = min(c[0] for c in corners)
        maxx = max(c[0] for c in corners)
        miny = min(c[1] for c in corners)
        maxy = max(c[1] for c in corners)
        view = View(0.5, 45, scale, (x_cursor - minx, pad - miny))
        ordered = sorted(voxels, key=lambda v: (v[1], v[0], v[2]), reverse=True)
        for vx, vy, vz in ordered:
            parts.append(_iso_cube(view, vx, vy, vz, occ))
        x_cursor += (maxx - minx) + gap
        height = max(height, (maxy - miny) + pad)
    for name in ("top", "front", "side"):
        if name not in views:
            continue
        chunk, w, h = _ortho_grid(voxels, name, x_cursor, pad)
        parts.append(chunk)
        x_cursor += w + gap
        height = max(height, h + pad)
    return _svg(x_cursor + pad - gap, height + pad, "".join(parts))


def _outward_off(
    a: tuple[float, float],
    b: tuple[float, float],
    inside: tuple[float, float],
    mag: float,
) -> float:
    """치수 곡선을 입체 바깥으로. +off 는 선분 법선 방향."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / length, dx / length
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    if nx * (mx - inside[0]) + ny * (my - inside[1]) >= 0:
        return mag
    return -mag


def _off_towards(
    a: tuple[float, float],
    b: tuple[float, float],
    want: tuple[float, float],
    mag: float,
) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / length, dx / length
    if nx * want[0] + ny * want[1] >= 0:
        return mag
    return -mag


def _cuboid(spec: Mapping[str, Any]) -> str:
    from core.figure_solid import View

    w = _num(spec["w"], "w", 0.5, 40)
    d = _num(spec["d"], "d", 0.5, 40)
    h = _num(spec["h"], "h", 0.5, 40)
    mx = max(w, d, h)
    scale = 56.0 / mx
    # cabinet 45° 에서 깊이 모서리 투영 길이는 0.5·scale·d. 너무 짧으면 치수를 못 붙인다.
    depth_px = 0.5 * scale * d
    if depth_px < 24.0:
        scale *= 24.0 / depth_px
    probe = View(0.5, 45, scale, (0.0, 0.0))
    corners0 = [probe((x, y, z)) for x in (0, w) for y in (0, d) for z in (0, h)]
    minx = min(c[0] for c in corners0)
    maxx = max(c[0] for c in corners0)
    miny = min(c[1] for c in corners0)
    maxy = max(c[1] for c in corners0)
    # 가로=앞 아래, 높이=앞 왼쪽, 세로=밑면 오른쪽 뒤. 위-오른쪽 짧은 모서리는 쓰지 않는다.
    pad_l, pad_t, pad_r, pad_b = 40.0, 22.0, 52.0, 44.0
    view = View(0.5, 45, scale, (pad_l - minx, pad_t - miny))

    def p(x: float, y: float, z: float) -> tuple[float, float]:
        return view((x, y, z))

    inside = p(w / 2, d / 2, h / 2)
    parts = [
        _poly([p(0, 0, 0), p(w, 0, 0), p(w, 0, h), p(0, 0, h)], FACE_FRONT),
        _poly([p(w, 0, 0), p(w, d, 0), p(w, d, h), p(w, 0, h)], FACE_SIDE),
        _poly([p(0, 0, h), p(w, 0, h), p(w, d, h), p(0, d, h)], FACE_TOP),
    ]
    # 각기둥·각뿔과 같은 기준: 안 보이는 모서리는 점선이다 (09 §4-14).
    verts3 = [(x, y, z) for x in (0.0, w) for y in (0.0, d) for z in (0.0, h)]

    def vi(x: float, y: float, z: float) -> int:
        return verts3.index((x, y, z))

    faces_idx = [
        [vi(0, 0, 0), vi(w, 0, 0), vi(w, 0, h), vi(0, 0, h)],
        [vi(0, d, 0), vi(w, d, 0), vi(w, d, h), vi(0, d, h)],
        [vi(0, 0, 0), vi(0, d, 0), vi(0, d, h), vi(0, 0, h)],
        [vi(w, 0, 0), vi(w, d, 0), vi(w, d, h), vi(w, 0, h)],
        [vi(0, 0, 0), vi(w, 0, 0), vi(w, d, 0), vi(0, d, 0)],
        [vi(0, 0, h), vi(w, 0, h), vi(w, d, h), vi(0, d, h)],
    ]
    parts += _hidden_lines(view, verts3, faces_idx)

    def dim(a: tuple[float, float], b: tuple[float, float], label: str) -> None:
        span = math.hypot(b[0] - a[0], b[1] - a[1])
        off = _outward_off(a, b, inside, DIM_OFF if span >= 28 else DIM_OFF + 6)
        parts.append(_length_mark(a[0], a[1], b[0], b[1], label, off=off, fs=12))

    dim(p(0, 0, 0), p(w, 0, 0), f"{_n(w)} cm")
    dim(p(0, 0, 0), p(0, 0, h), f"{_n(h)} cm")
    dim(p(w, 0, 0), p(w, d, 0), f"{_n(d)} cm")
    return _svg((maxx - minx) + pad_l + pad_r, (maxy - miny) + pad_t + pad_b, "".join(parts))


# 서로 다른 꼭짓점의 **화면 x** 가 이보다 가까우면 세로 모서리가 겹쳐 보인다(반지름 1 기준).
# 오각기둥에서 앞왼쪽·뒤왼쪽 모서리가 0.03 차이라 숨은 점선이 실선에 딱 붙었다.
NGON_MIN_GAP = 0.18
# 각뿔에는 세로 모서리가 없다 — 밑면 꼭짓점이 화면 x 로 가까워도 높이가 달라 읽힌다.
# 여기서 x 를 세게 잡으면 정작 겹치는 **모선**을 갈라 줄 각이 남지 않는다.
NGON_MIN_GAP_APEX = 0.08
# 각뿔 모선은 꼭대기에서 부챗살로 퍼진다 — 겹침을 가르는 것은 x 가 아니라 **극각**이다.
# 칠각뿔에서 v2·v3 극각이 1.1° 차이라 숨은 모선이 실선 모선 위에 겹쳐 그려졌다.
# ⚠️ 이 값은 **닿을 수 있는 값**이어야 한다. 부챗살은 실루엣 쪽에서 반드시 몰리므로
#    각형 수가 커지면 아무리 돌려도 못 넘는다(팔각뿔 최선 3.1°). 못 넘으면 최선을 쓴다 —
#    「닿을 수 없는 목표」를 두면 조용히 0°(=안 돌림)로 되돌아간다(CLAUDE.md 2026-08-18).
NGON_MIN_APEX_DEG = 4.0


def _screen_xy(angle: float, ratio: float, deg: float) -> tuple[float, float]:
    """사방투영에서 밑면 위 한 점의 **화면 좌표**(반지름 1, 배율 1, y 는 위가 +).

    깊이 y 가 화면 x 와 화면 y 양쪽에 섞여 들어온다.
    """
    a = math.radians(deg)
    return (
        math.cos(angle) + ratio * math.cos(a) * math.sin(angle),
        ratio * math.sin(a) * math.sin(angle),
    )


def _spread_gaps(
    angles: list[float], ratio: float, deg: float, apex_h: float | None
) -> tuple[float, float]:
    """(가장 가까운 두 꼭짓점의 화면 x 차이, 가장 가까운 두 모선의 극각 차이)."""
    pts = [_screen_xy(a, ratio, deg) for a in angles]
    us = sorted(p[0] for p in pts)
    x_gap = min(b - a for a, b in zip(us, us[1:]))
    if apex_h is None:
        return x_gap, math.inf
    polar = sorted(math.atan2(apex_h - p[1], p[0]) for p in pts)
    return x_gap, min(b - a for a, b in zip(polar, polar[1:]))


def _spread_rotation(
    n: int, base: float, ratio: float, deg: float, apex_h: float | None
) -> float:
    """꼭짓점이 화면에서 겹치지 않을 만큼만 밑면을 돌리는 **추가 각**.

    교과서 배치(옆면 하나가 정면 / 꼭짓점이 정면)를 그대로 두고, 겹칠 때만 필요한
    만큼만 돌린다 — 그래서 **가장 조금 도는** 각부터 본다. 각형 수마다 각도를 손으로
    맞추면 다음 각형에서 또 겹친다 (D-61).

    가로 간격이 먼저다(밑면 윤곽이 무너지면 도형 자체가 안 읽힌다). 그 안에서
    극각 문턱을 넘는 첫 각을 쓰고, 못 넘으면 **가장 나은 각**을 쓴다.
    """
    step = 2 * math.pi / n
    period = 2 * math.pi / n
    min_gap = NGON_MIN_GAP_APEX if apex_h is not None else NGON_MIN_GAP
    best_d, best_gap = 0.0, -1.0
    for k in range(0, 1441):
        for sign in (1.0, -1.0):
            d = sign * math.radians(k * 0.25)
            if abs(d) > period:
                continue
            x_gap, apex_gap = _spread_gaps(
                [base + d + i * step for i in range(n)], ratio, deg, apex_h
            )
            if x_gap < min_gap:
                continue
            if apex_gap >= math.radians(NGON_MIN_APEX_DEG):
                return d
            if apex_gap > best_gap:
                best_d, best_gap = d, apex_gap
            if k == 0:
                break
    return best_d


def _ngon_xy(
    n: int,
    r: float,
    *,
    vertex_front: bool = False,
    ratio: float = 0.5,
    deg: float = 45.0,
    apex_h: float | None = None,
) -> list[tuple[float, float]]:
    base = -math.pi / 2 + (0.0 if vertex_front else -math.pi / n)
    base += _spread_rotation(n, base, ratio, deg, apex_h)
    return [
        (r * math.cos(base + i * 2 * math.pi / n), r * math.sin(base + i * 2 * math.pi / n))
        for i in range(n)
    ]


def _fitted_cabinet(
    points: list[tuple[float, float, float]],
    scale: float,
    pad: tuple[float, float, float, float] = (14.0, 14.0, 14.0, 14.0),
    *,
    ratio: float = 0.5,
    deg: float = 45.0,
):
    from core.figure_solid import View

    probe = View(ratio, deg, scale, (0.0, 0.0))
    pts2 = [probe(p) for p in points]
    minx = min(p[0] for p in pts2)
    maxx = max(p[0] for p in pts2)
    miny = min(p[1] for p in pts2)
    maxy = max(p[1] for p in pts2)
    pl, pt, pr, pb = pad
    view = View(ratio, deg, scale, (pl - minx, pt - miny))
    return view, (maxx - minx) + pl + pr, (maxy - miny) + pt + pb


def _hidden_edges(
    view: Any,
    verts3: list[tuple[float, float, float]],
    faces: list[list[int]],
) -> list[tuple[int, int]]:
    """볼록 입체에서 **숨은 모서리** — 양쪽 면이 둘 다 뒤를 보는 모서리다.

    09 §4-4 는 「관찰자 반대편 꼭짓점에 닿는 모서리」라고 적었는데 그건 직육면체에만
    맞다. 오각기둥·육각뿔에서는 뒤 꼭짓점이 둘 이상이라 손으로 고른 목록이 샌다
    (원장님 2026-08-22: 각기둥이 막힌 덩어리, 각뿔 모선 점선 없음). 면 두 장으로
    판정하면 각형 수와 무관하게 맞는다.

    면의 감김 방향은 믿지 않는다 — 무게중심에서 바깥쪽으로 법선을 돌려세운다.
    감김이 틀리면 숨은 모서리가 통째로 뒤집히는데 그건 화면에서 티가 잘 안 난다.
    """
    from core.figure_solid import cross, dot, sub

    n = len(verts3)
    cen = tuple(sum(p[i] for p in verts3) / n for i in range(3))
    back: list[bool] = []
    for f in faces:
        nrm = cross(sub(verts3[f[1]], verts3[f[0]]), sub(verts3[f[2]], verts3[f[0]]))
        if dot(nrm, sub(verts3[f[0]], cen)) < 0:
            nrm = (-nrm[0], -nrm[1], -nrm[2])
        back.append(view.is_back_facing(nrm))
    seen: dict[tuple[int, int], list[bool]] = {}
    for fi, f in enumerate(faces):
        for i, a in enumerate(f):
            b = f[(i + 1) % len(f)]
            seen.setdefault((min(a, b), max(a, b)), []).append(back[fi])
    return sorted(e for e, flags in seen.items() if len(flags) == 2 and all(flags))


def _hidden_lines(
    view: Any,
    verts3: list[tuple[float, float, float]],
    faces: list[list[int]],
) -> list[str]:
    pts = [view(p) for p in verts3]
    return [
        _line(pts[a], pts[b], sw=1.0, dash=HIDDEN_DASH)
        for a, b in _hidden_edges(view, verts3, faces)
    ]


def _ngon_on_edge(
    n: int,
    ax: float,
    ay: float,
    bx: float,
    by: float,
    prefer: str,
) -> list[tuple[float, float]]:
    side = math.hypot(bx - ax, by - ay) or 1.0
    chosen: list[tuple[float, float]] = []
    for sign in (-1.0, 1.0):
        ang = math.atan2(by - ay, bx - ax)
        pts: list[tuple[float, float]] = [(ax, ay), (bx, by)]
        x, y = bx, by
        for _ in range(n - 2):
            ang += sign * 2 * math.pi / n
            x += side * math.cos(ang)
            y += side * math.sin(ang)
            pts.append((x, y))
        cy = sum(p[1] for p in pts) / n
        ey = (ay + by) / 2
        if (prefer == "min" and cy < ey) or (prefer == "max" and cy > ey):
            return pts
        chosen = pts
    return chosen


def _net_prism(sides: int) -> str:
    ww, hh = 22.0, 38.0
    # 밑면 각형이 옆면 위·아래로 얼마나 솟는지 손으로 셈하지 않는다 — 변 수가 바뀌면
    # 그 셈이 어긋나 꼭짓점이 잘렸다(내접원 반지름을 썼는데 정오각형은 그보다 높다).
    # `_svg` 가 그린 것을 다 담게 viewBox 를 맞춘다 (09 §4-14).
    pad_x, pad_t, pad_b = 10.0, 10.0, 10.0
    ox, oy = pad_x, pad_t
    parts: list[str] = []
    for i in range(sides):
        fill = FACE_FRONT if i % 2 == 0 else FACE_SIDE
        parts.append(_rect(ox + i * ww, oy, ww, hh, fill=fill, sw=1.15))
    parts.append(_poly(_ngon_on_edge(sides, ox, oy, ox + ww, oy, "min"), FACE_TOP, 1.15))
    parts.append(
        _poly(_ngon_on_edge(sides, ox, oy + hh, ox + ww, oy + hh, "max"), FACE_TOP, 1.15)
    )
    return _svg(pad_x * 2 + sides * ww, pad_t + hh + pad_b, "".join(parts))


def _prism(spec: Mapping[str, Any]) -> str:
    sides = _int(spec["sides"], "sides", 3, 8)
    _num(spec["h"], "h", 0.5, 20)
    if spec.get("net"):
        return _net_prism(sides)
    r, h = 1.0, 1.5
    xy = _ngon_xy(sides, r)
    bot3 = [(x, y, 0.0) for x, y in xy]
    top3 = [(x, y, h) for x, y in xy]
    view, svg_w, svg_h = _fitted_cabinet(bot3 + top3, 48.0)
    bot = [view(p) for p in bot3]
    top = [view(p) for p in top3]
    verts3 = bot3 + top3
    # 밑면 · 윗면 · 옆면 n 장. 감김은 `_hidden_edges` 가 무게중심으로 바로잡는다.
    faces_idx = [list(range(sides)), [sides + i for i in range(sides)]]
    for i in range(sides):
        j = (i + 1) % sides
        faces_idx.append([i, j, sides + j, sides + i])
    faces: list[tuple[float, str]] = []
    for i in range(sides):
        j = (i + 1) % sides
        depth = (bot3[i][1] + bot3[j][1]) / 2
        fill = FACE_FRONT if depth < 0 else FACE_SIDE
        faces.append((depth, _poly([bot[i], bot[j], top[j], top[i]], fill, 1.15)))
    faces.sort(key=lambda t: t[0], reverse=True)
    # 숨은 모서리는 **맨 위에** 그린다. 면 아래에 깔면 칠에 덮여 겨냥도가 막힌
    # 덩어리가 된다 — 그러면 면·모서리를 셀 수 없다(원장님 2026-08-22).
    parts = (
        [svg for _, svg in faces]
        + [_poly(top, FACE_TOP, 1.2)]
        + _hidden_lines(view, verts3, faces_idx)
    )
    return _svg(svg_w, svg_h, "".join(parts))


def _pyramid(spec: Mapping[str, Any]) -> str:
    sides = _int(spec["sides"], "sides", 3, 8)
    _num(spec["h"], "h", 0.5, 20)
    r, h = 1.0, 1.45
    # 꼭짓점을 카메라 쪽으로 — 앞면 하나를 정면으로 보면 삼각뿔이 납작한 삼각형이 된다.
    # `apex_h` 를 주면 모선끼리 겹치지 않는 각까지 같이 본다.
    xy = _ngon_xy(sides, r, vertex_front=True, apex_h=h)
    base3 = [(x, y, 0.0) for x, y in xy]
    apex3 = (0.0, 0.0, h)
    view, svg_w, svg_h = _fitted_cabinet(base3 + [apex3], 50.0, (14.0, 18.0, 14.0, 16.0))
    base = [view(p) for p in base3]
    apex = view(apex3)
    verts3 = base3 + [apex3]
    # 밑면 + 옆면 n 장. 밑면 모서리만 보고 숨김을 정하면 **모선**(꼭대기→뒤 꼭짓점)이
    # 실선으로 남는다 — 원장님이 「모선 점선이 없음」이라 하신 자리다.
    faces_idx = [list(range(sides))] + [
        [i, (i + 1) % sides, sides] for i in range(sides)
    ]
    faces: list[tuple[float, str]] = []
    for i in range(sides):
        j = (i + 1) % sides
        depth = (base3[i][1] + base3[j][1]) / 2
        fill = FACE_FRONT if depth < 0 else FACE_SIDE
        faces.append((depth, _poly([base[i], base[j], apex], fill, 1.15)))
    faces.sort(key=lambda t: t[0], reverse=True)
    parts = (
        [_poly(base, FACE_TOP, 1.1)]
        + [svg for _, svg in faces]
        + _hidden_lines(view, verts3, faces_idx)
    )
    return _svg(svg_w, svg_h, "".join(parts))


def _split_ring(
    ring: list[tuple[float, float]], i0: int, i1: int
) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
    """고리를 두 점에서 잘라 (가까운 호, 먼 호). 화면 아래쪽이 가까운 호다."""
    n = len(ring)

    def walk(a: int, b: int) -> list[tuple[float, float]]:
        pts = [ring[a]]
        i = a
        for _ in range(n):
            if i == b:
                return pts
            i = (i + 1) % n
            pts.append(ring[i])
        return pts

    one, two = walk(i0, i1), walk(i1, i0)

    def mid_y(pts: list[tuple[float, float]]) -> float:
        return sum(p[1] for p in pts) / len(pts)

    return (one, two) if mid_y(one) >= mid_y(two) else (two, one)


def _round_ring(view: Any, pts3: list[tuple[float, float, float]]) -> list[tuple[float, float]]:
    ring = [view(p) for p in pts3]
    if math.hypot(ring[0][0] - ring[-1][0], ring[0][1] - ring[-1][1]) < 0.05:
        ring = ring[:-1]
    return ring


def _cylinder(spec: Mapping[str, Any]) -> str:
    from core.figure_solid import circle3

    r = _num(spec["r"], "r", 0.4, 20)
    h = _num(spec["h"], "h", 0.4, 30)
    scale = 70.0 / max(2 * r, h)
    bot3 = circle3((0, 0, 0), r, (0, 0, 1), 64)
    top3 = circle3((0, 0, h), r, (0, 0, 1), 64)
    view, svg_w, svg_h = _fitted_cabinet(
        bot3 + top3, scale, (40.0, 24.0, 30.0, 24.0), ratio=ROUND_RATIO, deg=ROUND_DEG
    )
    top = _round_ring(view, top3)
    bot = _round_ring(view, bot3)
    # 축에 나란한 타원이라 좌·우 끝이 곧 모선이 닿는 자리다.
    i_l = min(range(len(bot)), key=lambda i: bot[i][0])
    i_r = max(range(len(bot)), key=lambda i: bot[i][0])
    near_bot, far_bot = _split_ring(bot, i_l, i_r)
    near_top, _far_top = _split_ring(top, i_l, i_r)
    if near_top[0][0] > near_top[-1][0]:
        near_top = near_top[::-1]
    if near_bot[0][0] < near_bot[-1][0]:
        near_bot = near_bot[::-1]
    # 옆면은 곧은 사다리꼴이 아니다 — 위·아래 앞쪽 호를 그대로 잇는다.
    # 예전처럼 네 점 사각형으로 덮으면 밑면 타원을 가로지르는 실선이 남는다.
    parts = [
        _poly(near_top + near_bot, FACE_FRONT, 1.15),
        _polyline(far_bot, sw=1.05, dash=HIDDEN_DASH),
        _poly(top, FACE_TOP, 1.15),
    ]
    tl, bl = top[i_l], bot[i_l]
    c_top = view((0.0, 0.0, h))
    rim = top[i_r]
    # 높이는 왼쪽 모선 바깥, 반지름은 윗면 안 — 둘 다 measured() 하나로 (09 §2.1).
    parts.append(
        _length_mark(
            tl[0], tl[1], bl[0], bl[1], f"{_n(h)} cm",
            off=_off_towards(tl, bl, (-1.0, 0.0), DIM_OFF), fs=12,
        )
    )
    # 반지름은 **안 적는다** (원장님 확정 2026-08-22): 「문제에 굳이 있는데 라벨로
    # 이중표기해서 너저분해질 필요가 없을듯」. 값을 쓰는 갈래의 발문이
    # 「밑면의 반지름이 $2$ cm 인 원기둥의 밑면의 지름은?」이라 **발문이 이미 말한다.**
    #
    # 높이는 **남긴다** — 어느 발문도 높이를 말하지 않아 이중표기가 아니다.
    # 둘 다 빼면 설명 없는 점선만 남는다(§4-20 사다리꼴과 같은 자리).
    #
    # 중심 점도 같이 뺐다. 반지름 라벨이 없으면 그 점은 **설명 없는 표시**다.
    #
    # ⚠️ 이러면 「그린 r:h 가 스펙과 맞는가」를 지면에서 아무도 안 본다.
    #    끄는 게 아니라 옮긴다 — 시험이 SVG 에서 직접 잰다 (09 §4-20-a).
    _ = rim
    return _svg(svg_w, svg_h, "".join(parts))


def _cone(spec: Mapping[str, Any]) -> str:
    from core.figure_solid import circle3

    r = _num(spec["r"], "r", 0.4, 20)
    h = _num(spec["h"], "h", 0.4, 30)
    scale = 70.0 / max(2 * r, h)
    base3 = circle3((0, 0, 0), r, (0, 0, 1), 64)
    apex3 = (0.0, 0.0, h)
    view, svg_w, svg_h = _fitted_cabinet(
        base3 + [apex3], scale, (18.0, 20.0, 18.0, 16.0), ratio=ROUND_RATIO, deg=ROUND_DEG
    )
    apex = view(apex3)
    ring = _round_ring(view, base3)
    n = len(ring)

    def polar(p: tuple[float, float]) -> float:
        return math.atan2(p[1] - apex[1], p[0] - apex[0])

    # 꼭대기에서 타원에 그은 두 접선이 모선이다. 좌·우 끝점이 아니다 (09 §4-13).
    i_right = min(range(n), key=lambda i: polar(ring[i]))
    i_left = max(range(n), key=lambda i: polar(ring[i]))
    near, far = _split_ring(ring, i_right, i_left)
    parts = [
        _poly([apex] + near, FACE_FRONT, 1.15),
        _polyline(far, sw=1.05, dash=HIDDEN_DASH),
    ]
    return _svg(svg_w, svg_h, "".join(parts))


def _sphere(spec: Mapping[str, Any]) -> str:
    r = _num(spec["r"], "r", 0.4, 20)
    cx, cy, pr = 70.0, 60.0, 36.0
    parts = [
        f'<circle cx="{_n(cx)}" cy="{_n(cy)}" r="{_n(pr)}" fill="{FACE_TOP}" '
        f'stroke="{INK}" stroke-width="1.4"/>',
        # 적도도 **같은 상수**를 쓴다. 예전엔 여기만 날 리터럴 `0.32` 라
        # `ROUND_RATIO` 를 조여도 구는 안 따라왔다 (09 §4-20-d).
        f'<ellipse cx="{_n(cx)}" cy="{_n(cy)}" rx="{_n(pr)}" ry="{_n(pr * ROUND_RATIO)}" '
        f'fill="none" stroke="{INK}" stroke-width="1.05" stroke-dasharray="5 4"/>',
    ]
    # 반지름은 **안 적는다** (원장님 확정 2026-08-22, 이중표기). 값을 쓰는 갈래의 발문이
    # 「반지름이 $3$ cm 인 구의 지름은?」이라 발문이 이미 말한다. 나머지 갈래는 아예
    # 수를 안 쓰는 개념 문항이라(「구를 잘라도 잘린 면은?」) 라벨이 할 일이 없다.
    #
    # 이걸로 §4-16 위반도 같이 사라진다 — 여기가 저장소에서 **유일한 날 텍스트 치수**였다.
    # halo 로 바꿔 남기는 선택지도 있었지만, 이중표기라 뺀다.
    #
    # ⚠️ `pr` 은 리터럴 36 이라 **그림이 `r` 을 한 톨도 안 담는다**(r=1 과 r=20 이 같은 원).
    #    지금 구 문항은 길이를 그림에서 읽지 않으니 성립하지만, 「그림을 보고 반지름을
    #    구하시오」가 생기면 그 순간 못 쓴다. 시험이 그 사실을 **적어 두고 있다.**
    _ = r
    return _svg(140, 120, "".join(parts))


def _net_cuboid(spec: Mapping[str, Any]) -> str:
    w = _num(spec["w"], "w", 0.5, 20)
    d = _num(spec["d"], "d", 0.5, 20)
    h = _num(spec["h"], "h", 0.5, 20)
    extra_l, extra_t, extra_r, extra_b = 32.0, 16.0, 16.0, 32.0
    span_w = d + w + d
    span_h = d + h + d + h
    u = min(22.0, (208.0 - extra_l - extra_r) / span_w, (200.0 - extra_t - extra_b) / span_h)
    ww, dd, hh = w * u, d * u, h * u
    #     [top]
    # [L][front][R]
    #     [bot]
    #     [back]
    ox, oy = extra_l + dd, extra_t
    parts = [
        _rect(ox, oy, ww, dd, fill=FACE_TOP, sw=1.15),
        _rect(ox - dd, oy + dd, dd, hh, fill=FACE_SIDE, sw=1.15),
        _rect(ox, oy + dd, ww, hh, fill=FACE_FRONT, sw=1.15),
        _rect(ox + ww, oy + dd, dd, hh, fill=FACE_SIDE, sw=1.15),
        _rect(ox, oy + dd + hh, ww, dd, fill=FACE_TOP, sw=1.15),
        _rect(ox, oy + dd + hh + dd, ww, hh, fill=FACE_FRONT, sw=1.15),
    ]
    # 면 안 곱셈(7×4)은 치수가 아니다. 직육면체만 변 밖에 cm.
    if not (w == d == h):
        back_y = oy + dd + hh + dd + hh
        parts.append(_length_mark(ox, back_y, ox + ww, back_y, f"{_n(w)} cm", off=12, fs=11))
        parts.append(_length_mark(ox, oy, ox, oy + dd, f"{_n(d)} cm", off=12, fs=11))
        parts.append(
            _length_mark(ox - dd, oy + dd, ox - dd, oy + dd + hh, f"{_n(h)} cm", off=12, fs=11)
        )
    width = extra_l + dd + ww + dd + extra_r
    height = extra_t + dd + hh + dd + hh + extra_b
    return _svg(width, height, "".join(parts))


# 원기둥 전개도: 원은 옆면 직사각형의 긴 변(둘레)에만 접한다.
# 짧은 변(높이)에 붙이면 접을 수 없는 그림이 된다. t 는 긴 변 위 접점 비율.
_NET_CYL_LAYOUTS: dict[str, tuple[tuple[str, float], tuple[str, float]]] = {
    "opp": (("top", 0.28), ("bot", 0.72)),
    "oppFlip": (("top", 0.72), ("bot", 0.28)),
    "oppMid": (("top", 0.5), ("bot", 0.5)),
    "sameTop": (("top", 0.25), ("top", 0.75)),
    "sameBot": (("bot", 0.25), ("bot", 0.75)),
    "ends": (("top", 0.22), ("bot", 0.78)),
}


def _net_cylinder(spec: Mapping[str, Any]) -> str:
    r = _num(spec["r"], "r", 0.4, 20)
    h = _num(spec["h"], "h", 0.4, 30)
    pi = _num(spec.get("pi", 3), "pi", 3, 3.15)
    raw = spec.get("layout", "opp")
    name = str(raw)
    if name not in _NET_CYL_LAYOUTS:
        raise ValueError(f"layout 은 {', '.join(_NET_CYL_LAYOUTS)} 중 하나여야 합니다")
    circ = 2 * r * pi
    u = 70.0 / max(circ, h, r * 2)
    rw, rh, cr = circ * u, h * u, r * u
    circles: list[tuple[float, float]] = []
    for side, t in _NET_CYL_LAYOUTS[name]:
        cx = t * rw
        cy = -cr if side == "top" else rh + cr
        circles.append((cx, cy))
    pad = 8.0
    xs = [0.0, rw] + [c[0] - cr for c in circles] + [c[0] + cr for c in circles]
    ys = [0.0, rh] + [c[1] - cr for c in circles] + [c[1] + cr for c in circles]
    minx, miny = min(xs), min(ys)
    ox, oy = pad - minx, pad - miny
    parts = [_rect(ox, oy, rw, rh, fill=FACE_FRONT, sw=1.15)]
    for cx, cy in circles:
        parts.append(
            f'<circle cx="{_n(ox + cx)}" cy="{_n(oy + cy)}" r="{_n(cr)}" fill="{FACE_TOP}" '
            f'stroke="{INK}" stroke-width="1.15"/>'
        )
    return _svg(max(xs) - minx + pad * 2, max(ys) - miny + pad * 2, "".join(parts))


def _area_box(base: float, height: float) -> tuple[float, float]:
    """cm 비율을 유지한다. 고정 140×70 이면 4×5와 9×8이 같은 직사각형이 된다."""
    px = 14.0
    max_w, max_h = 152.0, 110.0
    bw, bh = base * px, height * px
    scale = min(1.0, max_w / bw, max_h / bh)
    return bw * scale, bh * scale


def _area_poly(spec: Mapping[str, Any]) -> str:
    shape = str(spec["shape"])
    base = _num(spec["base"], "base", 0.5, 40)
    height = _num(spec["height"], "height", 0.5, 40)
    pad = 16.0
    # 마름모의 세로 길이는 **적히는 값**(`d2`)이다. 세로 자리에 `height` 를 쓰면
    # `d2` 를 따로 준 순간 그림과 라벨이 어긋난다 — 「4」 길이로 그려 놓고 「8 cm」로
    # 적는다. 지금 부르는 쪽은 늘 `height == d2` 라 안 드러날 뿐이다(09 §4-20).
    vertical = _num(spec.get("d2", height), "d2", 0.5, 40) if shape == "rhombus" else height
    bw, bh = _area_box(base, vertical)
    extra_r, extra_b = 24.0, 18.0
    parts: list[str] = []
    if shape == "rect":
        parts.append(_rect(pad, pad, bw, bh, fill=FAINT, sw=1.4))
        parts.append(_length_mark(pad, pad + bh, pad + bw, pad + bh, f"{_n(base)} cm", off=12))
        parts.append(_length_mark(pad + bw, pad, pad + bw, pad + bh, f"{_n(height)} cm", off=-12))
    elif shape == "tri":
        pts = [(pad, pad + bh), (pad + bw, pad + bh), (pad + bw * 0.45, pad)]
        parts.append(_poly(pts, FAINT, 1.4))
        parts.append(_length_mark(pts[0][0], pts[0][1], pts[1][0], pts[1][1], f"{_n(base)} cm", off=12))
        parts.append(_line((pts[2][0], pts[2][1]), (pts[2][0], pts[0][1]), sw=1.05, dash="5 4"))
        parts.append(_length_mark(pts[2][0], pts[2][1], pts[2][0], pts[0][1], f"{_n(height)} cm", off=-12))
    elif shape == "para":
        skew = min(bw * 0.22, bh * 0.4)
        pts = [(pad + skew, pad), (pad + bw, pad), (pad + bw - skew, pad + bh), (pad, pad + bh)]
        parts.append(_poly(pts, FAINT, 1.4))
        parts.append(_length_mark(pts[3][0], pts[3][1], pts[2][0], pts[2][1], f"{_n(base)} cm", off=12))
        parts.append(_line((pts[0][0], pts[0][1]), (pts[0][0], pts[3][1]), sw=1.05, dash="5 4"))
        parts.append(_length_mark(pts[0][0], pts[0][1], pts[0][0], pts[3][1], f"{_n(height)} cm", off=-12))
    elif shape == "trap":
        top = _num(spec.get("top", base * 0.5), "top", 0.5, 40)
        tw = bw * (top / base)
        ox = pad + (bw - tw) / 2
        pts = [(ox, pad), (ox + tw, pad), (pad + bw, pad + bh), (pad, pad + bh)]
        parts.append(_poly(pts, FAINT, 1.4))
        parts.append(_length_mark(pts[3][0], pts[3][1], pts[2][0], pts[2][1], f"{_n(base)} cm", off=12))
        parts.append(_length_mark(pts[0][0], pts[0][1], pts[1][0], pts[1][1], f"{_n(top)} cm", off=-10))
        # 높이는 **윗변 왼쪽 끝에서 수직으로** 내린다. 예전에는 윗변·아랫변 왼쪽 끝의
        # 가운데 x 에 그어 윗절반이 빗변 **바깥**으로 삐져나왔다 — 값을 안 적어 두어
        # 아무도 못 봤을 뿐이다. 삼각형·평행사변형과 같은 자리(꼭짓점에서 수직)로 맞춘다.
        hx = pts[0][0]
        parts.append(_line((hx, pts[0][1]), (hx, pts[3][1]), sw=1.05, dash="5 4"))
        # 높이 점선에 **값을 적는다.** 삼각형·평행사변형은 적는데 사다리꼴만 안 적어
        # 지면에 「설명 없는 점선」이 남았다(2026-08-22). 발문이 높이를 말해 주더라도
        # 이유 없는 선은 원장님 ⑭「어디를 가리키는지 모르겠다」와 같은 부류다.
        parts.append(
            _length_mark(hx, pts[0][1], hx, pts[3][1], f"{_n(height)} cm", off=-12)
        )
    elif shape == "rhombus":
        d2 = vertical
        cx, cy = pad + bw / 2, pad + bh / 2
        pts = [(cx, pad), (pad + bw, cy), (cx, pad + bh), (pad, cy)]
        parts.append(_poly(pts, FAINT, 1.4))
        # 마름모는 **라벨을 안 적는다** (원장님 확정 2026-08-22):
        # 「충분히 도형 크기가 크지 않으면 그냥 문제에 적어두고 내부에는 라벨 표기 안 하는
        #  걸로 하자. 표기하니까 오히려 너저분해지는듯」. 네 안(대각선 자체가 치수선 /
        # 삼각형처럼 아래로 / 둘 다 바깥 / 둘 다 안쪽)을 다 그려 본 뒤 나온 결정이다.
        #
        # 대각선 점선은 **남긴다** — 넓이 규칙(d1×d2÷2)이 그 선에서 보인다. 뺀 것은 라벨뿐.
        # 길이는 발문이 말한다(「두 대각선의 길이가 18 cm, 6 cm인」).
        #
        # ⚠️ 이러면 §4-20 의 「값이 곧 조명」이 지면에서 꺼진다. **끄는 게 아니라 옮겼다** —
        #    「그린 가로:세로가 스펙의 d1:d2 와 맞는가」를 시험이 직접 잰다(09 §4-20).
        #    그 시험이 없으면 마름모는 오늘부터 아무도 안 보는 그림이 된다.
        extra_r, extra_b = 0.0, 0.0
        parts.append(_line(pts[0], pts[2], sw=1.05, dash="5 4"))
        parts.append(_line(pts[1], pts[3], sw=1.05, dash="5 4"))
    else:
        raise ValueError("shape 는 rect·tri·para·trap·rhombus 여야 합니다")
    return _svg(bw + pad * 2 + extra_r, bh + pad * 2 + extra_b, "".join(parts))


ADV_FIELDS: dict[str, frozenset[str]] = {
    "fracBars": frozenset({"cols", "rows", "filled"}),
    "groupDots": frozenset({"groups", "each"}),
    "barChart": frozenset({"values"}),
    "lineChart": frozenset({"values"}),
    "pictograph": frozenset({"unit", "items"}),
    "stripChart": frozenset({"segments"}),
    "pieChart": frozenset({"slices"}),
    "protractor": frozenset({"deg"}),
    "rotateFlip": frozenset({"cells", "op"}),
    "symmetry": frozenset({"axis"}),
    "stackCubes": frozenset({"voxels"}),
    "cuboid": frozenset({"w", "d", "h"}),
    "prism": frozenset({"sides", "h"}),
    "pyramid": frozenset({"sides", "h"}),
    "cylinder": frozenset({"r", "h"}),
    "cone": frozenset({"r", "h"}),
    "sphere": frozenset({"r"}),
    "netCuboid": frozenset({"w", "d", "h"}),
    "netCylinder": frozenset({"r", "h"}),
    "areaPoly": frozenset({"shape", "base", "height"}),
}
ADV_OPTIONAL: dict[str, frozenset[str]] = {
    "fracBars": frozenset({"fill"}),
    # `yStep` — 「눈금 한 칸은 몇」 발문이 말하는 걸음. 있으면 **그대로 긋는다** (D-70).
    # `orient` — "vertical"(기본) / "horizontal". 값 축을 어느 화면 축에 눕히는가만 바꾼다.
    "barChart": frozenset({"yMax", "yStep", "yLabel", "xLabel", "orient", "title"}),
    "lineChart": frozenset({"yMax", "yStep", "yLabel", "title"}),
    "stripChart": frozenset(),
    "pieChart": frozenset(),
    "rotateFlip": frozenset({"n"}),
    "symmetry": frozenset({"n", "cells", "motif"}),
    "stackCubes": frozenset({"views"}),
    "netCylinder": frozenset({"pi", "layout"}),
    "areaPoly": frozenset({"top", "d2"}),
    "cylinder": frozenset(),
    "prism": frozenset({"net"}),
}
ADV_RENDER = {
    "fracBars": _frac_bars,
    "groupDots": _group_dots,
    "barChart": _bar_chart,
    "lineChart": _line_chart,
    "pictograph": _pictograph,
    "stripChart": _strip_chart,
    "pieChart": _pie_chart,
    "protractor": _protractor,
    "rotateFlip": _rotate_flip,
    "symmetry": _symmetry,
    "stackCubes": _stack_cubes,
    "cuboid": _cuboid,
    "prism": _prism,
    "pyramid": _pyramid,
    "cylinder": _cylinder,
    "cone": _cone,
    "sphere": _sphere,
    "netCuboid": _net_cuboid,
    "netCylinder": _net_cylinder,
    "areaPoly": _area_poly,
}
