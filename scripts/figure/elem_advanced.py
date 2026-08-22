# -*- coding: utf-8 -*-
"""초등 후반 그림 — 그래프·입체·쌓기나무·이동·대칭.

elementary.render_elementary 이 KIND 를 합친다. 같은 그림이 두 번이면 여기 kind (D-61).
기하 작도(치수선만)는 엔진 A. 조작형(자·컴퍼스·그리세요)은 그리지 않는다.
"""
from __future__ import annotations

import math
from typing import Any, Mapping

from elementary import (
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
    if y_max <= 8:
        return 1
    if y_max <= 12:
        return 2
    return 5


def _unit_label(left: float, top: float, ylab: str) -> str:
    """세로축 단위는 눈금과 같은 열, 맨 위 눈금보다 한 줄 위."""
    if not ylab:
        return ""
    return _text(left - 7, top - 20, ylab, size=13, anchor="end")


def _plot_axes(left: float, top: float, plot_w: float, plot_h: float, y_max: float) -> list[str]:
    parts = [
        _line((left, top), (left, top + plot_h)),
        _line((left, top + plot_h), (left + plot_w, top + plot_h)),
    ]
    step = _y_step(y_max)
    v = 0
    while v <= y_max + 1e-6:
        y = top + plot_h - plot_h * v / y_max
        # 0 눈금은 가로축과 겹친다. 흰 외곽선 halo 는 mix-blend-multiply 에서
        # 가장자리가 회색으로 뭉개지므로 쓰지 않는다.
        if v > 0:
            parts.append(_line((left, y), (left + plot_w, y), sw=0.4, dash="3 3"))
        parts.append(_line((left - 4, y), (left, y), sw=0.9))
        parts.append(_text(left - 7, y, str(v), size=14, anchor="end"))
        v += step
    return parts


def _bar_chart(spec: Mapping[str, Any]) -> str:
    values = _chart_values(spec["values"], "values")
    y_max = _num(spec.get("yMax", max(v for _, v in values) or 1), "yMax", 1, 10000)
    left, top, plot_w, plot_h, pad_b = 46.0, 36.0, 186.0, 118.0, 32.0
    n = len(values)
    gap = 8.0
    bw = (plot_w - gap * (n + 1)) / n
    parts = _plot_axes(left, top, plot_w, plot_h, y_max)
    for i, (lab, val) in enumerate(values):
        h = 0 if y_max <= 0 else min(plot_h, plot_h * val / y_max)
        x = left + gap + i * (bw + gap)
        y = top + plot_h - h
        parts.append(_rect(x, y, bw, h, fill=CHART[i % len(CHART)], sw=1.05))
        num = str(int(val)) if val == int(val) else _n(val)
        # 막대 안쪽이면 격자선과 안 겹친다. 짧은 막대만 위에 둔다.
        ny = y + 14 if h >= 24 else y - 12
        parts.append(_text(x + bw / 2, ny, num, size=16))
        parts.append(_text(x + bw / 2, top + plot_h + 16, lab, size=13))
    parts.append(_unit_label(left, top, str(spec.get("yLabel", ""))))
    w = min(TABLE_VIEWBOX_MAX, left + plot_w + 8)
    return _svg(w, top + plot_h + pad_b, "".join(parts))


def _line_chart(spec: Mapping[str, Any]) -> str:
    values = _chart_values(spec["values"], "values")
    y_max = _num(spec.get("yMax", max(v for _, v in values) or 1), "yMax", 1, 10000)
    left, top, plot_w, plot_h, pad_b = 46.0, 36.0, 186.0, 100.0, 28.0
    n = len(values)
    parts = _plot_axes(left, top, plot_w, plot_h, y_max)
    pts: list[tuple[float, float]] = []
    for i, (lab, val) in enumerate(values):
        x = left + (plot_w * i / max(n - 1, 1))
        y = top + plot_h - (0 if y_max <= 0 else min(plot_h, plot_h * val / y_max))
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

    def dim(a: tuple[float, float], b: tuple[float, float], label: str, mag: float) -> None:
        span = math.hypot(b[0] - a[0], b[1] - a[1])
        off = _outward_off(a, b, inside, mag if span >= 28 else mag + 6)
        parts.append(_length_mark(a[0], a[1], b[0], b[1], label, off=off, fs=12))

    dim(p(0, 0, 0), p(w, 0, 0), f"{_n(w)} cm", 18)
    dim(p(0, 0, 0), p(0, 0, h), f"{_n(h)} cm", 18)
    dim(p(w, 0, 0), p(w, d, 0), f"{_n(d)} cm", 18)
    return _svg((maxx - minx) + pad_l + pad_r, (maxy - miny) + pad_t + pad_b, "".join(parts))


def _ngon_xy(n: int, r: float, *, vertex_front: bool = False) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    extra = 0.0 if vertex_front else -math.pi / n
    for i in range(n):
        a = -math.pi / 2 + extra + i * 2 * math.pi / n
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def _fitted_cabinet(
    points: list[tuple[float, float, float]],
    scale: float,
    pad: tuple[float, float, float, float] = (14.0, 14.0, 14.0, 14.0),
):
    from core.figure_solid import View

    probe = View(0.5, 45, scale, (0.0, 0.0))
    pts2 = [probe(p) for p in points]
    minx = min(p[0] for p in pts2)
    maxx = max(p[0] for p in pts2)
    miny = min(p[1] for p in pts2)
    maxy = max(p[1] for p in pts2)
    pl, pt, pr, pb = pad
    view = View(0.5, 45, scale, (pl - minx, pt - miny))
    return view, (maxx - minx) + pl + pr, (maxy - miny) + pt + pb


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
    apothem = ww / (2 * math.tan(math.pi / sides))
    pad_x, pad_t, pad_b = 10.0, apothem + 14.0, apothem + 14.0
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
    from core.figure_solid import cross, sub

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
    hidden: list[str] = []
    faces: list[tuple[float, str]] = []
    for i in range(sides):
        j = (i + 1) % sides
        nrm = cross(sub(bot3[j], bot3[i]), sub(top3[i], bot3[i]))
        depth = (bot3[i][1] + bot3[j][1]) / 2
        if view.is_back_facing(nrm):
            hidden.append(_line(bot[i], bot[j], sw=1.0, dash="5 4"))
            continue
        fill = FACE_FRONT if depth < 0 else FACE_SIDE
        faces.append((depth, _poly([bot[i], bot[j], top[j], top[i]], fill, 1.15)))
    faces.sort(key=lambda t: t[0], reverse=True)
    parts = hidden + [svg for _, svg in faces] + [_poly(top, FACE_TOP, 1.2)]
    return _svg(svg_w, svg_h, "".join(parts))


def _pyramid(spec: Mapping[str, Any]) -> str:
    from core.figure_solid import cross, sub

    sides = _int(spec["sides"], "sides", 3, 8)
    _num(spec["h"], "h", 0.5, 20)
    r, h = 1.0, 1.45
    # 꼭짓점을 카메라 쪽으로 — 앞면 하나를 정면으로 보면 삼각뿔이 납작한 삼각형이 된다.
    xy = _ngon_xy(sides, r, vertex_front=True)
    base3 = [(x, y, 0.0) for x, y in xy]
    apex3 = (0.0, 0.0, h)
    view, svg_w, svg_h = _fitted_cabinet(base3 + [apex3], 50.0, (14.0, 18.0, 14.0, 16.0))
    base = [view(p) for p in base3]
    apex = view(apex3)
    hidden: list[str] = []
    faces: list[tuple[float, str]] = []
    for i in range(sides):
        j = (i + 1) % sides
        nrm = cross(sub(base3[j], base3[i]), sub(apex3, base3[i]))
        depth = (base3[i][1] + base3[j][1]) / 2
        fill = FACE_FRONT if depth < 0 else FACE_SIDE
        faces.append((depth, _poly([base[i], base[j], apex], fill, 1.15)))
        if view.is_back_facing(nrm):
            hidden.append(_line(base[i], base[j], sw=1.0, dash="5 4"))
    faces.sort(key=lambda t: t[0], reverse=True)
    parts = [_poly(base, FACE_TOP, 1.1)] + [svg for _, svg in faces] + hidden
    return _svg(svg_w, svg_h, "".join(parts))


def _cylinder(spec: Mapping[str, Any]) -> str:
    from core.figure_solid import circle3

    r = _num(spec["r"], "r", 0.4, 20)
    h = _num(spec["h"], "h", 0.4, 30)
    scale = 70.0 / max(2 * r, h)
    bot3 = circle3((0, 0, 0), r, (0, 0, 1), 48)
    top3 = circle3((0, 0, h), r, (0, 0, 1), 48)
    view, svg_w, svg_h = _fitted_cabinet(bot3 + top3, scale, (42.0, 26.0, 44.0, 24.0))
    top = [view(p) for p in top3]
    bot = [view(p) for p in bot3]
    tl = min(top, key=lambda p: p[0])
    tr = max(top, key=lambda p: p[0])
    bl = min(bot, key=lambda p: p[0])
    br = max(bot, key=lambda p: p[0])
    c_top = view((0.0, 0.0, h))
    parts = [
        _poly(bot, FACE_SIDE, 1.05),
        _poly([bl, br, tr, tl], FACE_FRONT, 1.15),
        _poly(top, FACE_TOP, 1.15),
    ]
    # 높이: 왼쪽 모선 바깥. 반지름: 윗면 원에서 오른쪽 바깥.
    parts.append(
        _length_mark(tl[0], tl[1], bl[0], bl[1], f"{_n(h)} cm", off=_off_towards(tl, bl, (-1.0, 0.0), 18), fs=12)
    )
    rim = max(top, key=lambda p: p[0])
    parts.append(
        _length_mark(
            c_top[0], c_top[1], rim[0], rim[1], f"{_n(r)} cm",
            off=_off_towards(c_top, rim, (0.0, -1.0), 14),
            fs=12,
        )
    )
    return _svg(svg_w, svg_h, "".join(parts))


def _cone(spec: Mapping[str, Any]) -> str:
    from core.figure_solid import circle3

    r = _num(spec["r"], "r", 0.4, 20)
    h = _num(spec["h"], "h", 0.4, 30)
    scale = 70.0 / max(2 * r, h)
    base3 = circle3((0, 0, 0), r, (0, 0, 1), 64)
    apex3 = (0.0, 0.0, h)
    view, svg_w, svg_h = _fitted_cabinet(base3 + [apex3], scale, (18.0, 20.0, 18.0, 16.0))
    apex = view(apex3)
    ring = [view(p) for p in base3]
    if math.hypot(ring[0][0] - ring[-1][0], ring[0][1] - ring[-1][1]) < 0.05:
        ring = ring[:-1]
    n = len(ring)

    def polar(p: tuple[float, float]) -> float:
        return math.atan2(p[1] - apex[1], p[0] - apex[0])

    i_right = min(range(n), key=lambda i: polar(ring[i]))
    i_left = max(range(n), key=lambda i: polar(ring[i]))

    def walk(i0: int, i1: int) -> list[tuple[float, float]]:
        pts = [ring[i0]]
        i = i0
        for _ in range(n):
            if i == i1:
                return pts
            i = (i + 1) % n
            pts.append(ring[i])
        return pts

    a_rt_lt = walk(i_right, i_left)
    a_lt_rt = walk(i_left, i_right)
    def mid_y(pts: list[tuple[float, float]]) -> float:
        return sum(p[1] for p in pts) / len(pts)
    # 화면 아래(가까운 호)가 보이는 밑면, 위쪽 호는 숨은 선.
    if mid_y(a_rt_lt) >= mid_y(a_lt_rt):
        near, far = a_rt_lt, a_lt_rt
    else:
        near, far = a_lt_rt, a_rt_lt
    parts = [
        _poly([apex] + near, FACE_FRONT, 1.15),
        _polyline(far, sw=1.05, dash="5 4"),
    ]
    return _svg(svg_w, svg_h, "".join(parts))


def _sphere(spec: Mapping[str, Any]) -> str:
    r = _num(spec["r"], "r", 0.4, 20)
    cx, cy, pr = 70.0, 60.0, 36.0
    parts = [
        f'<circle cx="{_n(cx)}" cy="{_n(cy)}" r="{_n(pr)}" fill="{FACE_TOP}" '
        f'stroke="{INK}" stroke-width="1.4"/>',
        f'<ellipse cx="{_n(cx)}" cy="{_n(cy)}" rx="{_n(pr)}" ry="{_n(pr * 0.32)}" '
        f'fill="none" stroke="{INK}" stroke-width="1.05" stroke-dasharray="5 4"/>',
    ]
    parts.append(_text(cx, cy + pr + 12, f"반지름 {_n(r)} cm", size=11))
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
    bw, bh = _area_box(base, height)
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
        parts.append(_line(((pts[0][0] + pts[3][0]) / 2, pts[0][1]), ((pts[0][0] + pts[3][0]) / 2, pts[3][1]), sw=1.05, dash="5 4"))
    elif shape == "rhombus":
        d2 = _num(spec.get("d2", height), "d2", 0.5, 40)
        cx, cy = pad + bw / 2, pad + bh / 2
        pts = [(cx, pad), (pad + bw, cy), (cx, pad + bh), (pad, cy)]
        parts.append(_poly(pts, FAINT, 1.4))
        parts.append(_line(pts[0], pts[2], sw=1.05, dash="5 4"))
        parts.append(_line(pts[1], pts[3], sw=1.05, dash="5 4"))
        # 대각선 치수는 바깥 곡선이 아니라 선 옆에 둔다. 교차점만 피한다.
        extra_r, extra_b = 28.0, 24.0
        parts.append(
            _text(
                pts[3][0] + (pts[1][0] - pts[3][0]) * 0.78,
                cy + 13,
                f"{_n(base)} cm",
                size=12,
            )
        )
        parts.append(
            _text(
                cx + 16,
                pts[0][1] + (pts[2][1] - pts[0][1]) * 0.22,
                f"{_n(d2)} cm",
                size=12,
            )
        )
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
    "barChart": frozenset({"yMax", "yLabel", "xLabel"}),
    "lineChart": frozenset({"yMax", "yLabel"}),
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
