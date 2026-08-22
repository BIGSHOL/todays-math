# -*- coding: utf-8 -*-
"""초등 교재 그림 — FigureSpec v2 에 없는 상자·수 모형·수 카드.

버전은 `elem-1`. 기하 작도(각·원·치수선)는 여기 넣지 않는다 — 그건 엔진 A.
허용 종류 밖·모르는 키는 예외. 빈 SVG 로 통과시키지 않는다.

같은 그림이 두 번 나오면 좌표 일회성으로 맞추지 말고 kind 를 추가한다 (D-61, 09 §2.1).
재발 금지: 사다리꼴 두 대각선, FigureSpec labels 로 가/나, 표 viewBox 키우기,
피자 오림, 치수 손 곡선, 점격자 진한 점선, 원기둥 전개도 떠 있는 원, 원뿔 삼각형+타원 — 09 §4-6~4-13.
"""
from __future__ import annotations

import math
import re
from html import escape
from typing import Any, Mapping

INK = "#111111"
PAPER = "#ffffff"
FAINT = "#f4f4f2"
# 점격자 바탕선. 교재 모눈은 연한 청색 — #7aa0c4·1.05px 는 발문 대비 진했다.
GRID = "#c8d7e4"
GRID_SW = 0.7
# 표 viewBox 를 이보다 키우면 화면에서 숫자가 본문보다 작아진다 (09 §4-8).
TABLE_VIEWBOX_MAX = 240.0
# 치수 점선이 도형에서 벌어지는 거리. 한 값만 쓴다 — 도형마다 다르면 같은 시험지에서
# 삼각형 치수는 붙어 있고 직육면체 치수만 붕 뜬다 (09 §4-16).
DIM_OFF = 12.0
# 그린 것과 viewBox 사이 최소 여유. 획 굵기 절반 + 반올림.
FIT_PAD = 2.0
KIND_FIELDS: dict[str, frozenset[str]] = {
    "numberCards": frozenset({"cards"}),
    "placeValue": frozenset({"hundreds", "tens", "ones"}),
    "base10": frozenset({"rows"}),
    "opBox": frozenset({"input", "op"}),
    "sumBox": frozenset({"left", "right"}),
    "opTree": frozenset({"start", "ops"}),
    "boxChain": frozenset({"start", "steps"}),
    "columnOp": frozenset({"top", "op", "bottom"}),
    "numberLine": frozenset({"max"}),
    "clocks": frozenset({"items"}),
    "table": frozenset({"headers", "rows"}),
    "tape": frozenset({"length", "label"}),
    "dotGrid": frozenset({"rows", "cols"}),
    "boxedList": frozenset({"items"}),
    "pills": frozenset({"items"}),
    "geoLine": frozenset(),
    "anglePick": frozenset(),
    "timeAdd": frozenset({"start", "add"}),
    "pointGrid": frozenset({"cols", "rows", "dots"}),
    "divideTriangle": frozenset({"n"}),
    "fracPie": frozenset({"n", "filled"}),
    "triRow": frozenset({"n", "filled"}),
    "trapFour": frozenset({"filled"}),
    "namedShapes": frozenset({"items"}),
}
OPTIONAL: dict[str, frozenset[str]] = {
    "base10": frozenset({"equation"}),
    "opBox": frozenset({"output"}),
    "columnOp": frozenset({"result", "highlight"}),
    "numberLine": frozenset({"min", "step", "hops", "barTo", "tick", "blanks"}),
    "tape": frozenset({"unit", "segments"}),
    "boxedList": frozenset({"marks"}),
    "pointGrid": frozenset({"lines", "square"}),
    "fracPie": frozenset({"start", "fill"}),
    "triRow": frozenset({"fill"}),
    "trapFour": frozenset({"fill"}),
}


def validate_elementary(spec: Mapping[str, Any]) -> str:
    """스펙을 검증하고 kind 를 돌려준다. **검증은 한 벌뿐이다.**

    `chartPair` 는 안쪽 그래프를 «좁게» 그려야 해서 렌더 함수를 직접 부르는데,
    그때도 이 검증을 그대로 탄다 — 안 그러면 짝 안에서만 오타 키가 통과한다.
    """
    if not isinstance(spec, Mapping):
        raise ValueError("초등 스펙이 객체가 아닙니다")
    if spec.get("version") != "elem-1":
        raise ValueError("초등 스펙 version 은 elem-1 이어야 합니다")
    kind = spec.get("kind")
    if not isinstance(kind, str) or kind not in KIND_FIELDS:
        raise ValueError(f"모르는 초등 그림 종류입니다: {kind}")
    allowed = {"version", "kind"} | KIND_FIELDS[kind] | OPTIONAL.get(kind, frozenset())
    extra = set(spec) - allowed
    if extra:
        raise ValueError(f"허용되지 않은 키: {', '.join(sorted(str(k) for k in extra))}")
    missing = KIND_FIELDS[kind] - set(spec)
    if missing:
        raise ValueError(f"빠진 키: {', '.join(sorted(missing))}")
    return kind


def render_elementary(spec: Mapping[str, Any]) -> str:
    return _RENDER[validate_elementary(spec)](spec)


def _svg(w: float, h: float, body: str) -> str:
    """viewBox 는 **그린 것을 모두 담는다** (09 §4-14).

    kind 마다 여백을 손으로 맞추면 도형이 조금만 달라져도 같은 결함이 다시 난다 —
    오각기둥 전개도에서 위·아래 꼭짓점이 잘려 나갔다(원장님 2026-08-22). 문항마다
    좌표를 고치지 말고(D-61) 여기 한 곳에서 맞춘다: 몸통의 경계 상자를 재서
    음수 쪽으로 나가면 **내용을 밀고**, 모자라면 viewBox 를 **넓힌다**.

    ⚠️ `<g transform>` 로 못 민다 — `sanitize_svg` 가 `transform` 을 막는다.
       그래서 좌표 숫자를 직접 옮긴다. 모르는 그리기 태그나 상대 경로 명령이 오면
       **조용히 지나가지 않고 예외**를 낸다(못 옮긴 것이 잘려도 아무도 모른다).
    """
    box = _body_bbox(body)
    if box is not None:
        minx, miny, maxx, maxy = box
        dx = max(0.0, FIT_PAD - minx)
        dy = max(0.0, FIT_PAD - miny)
        if dx or dy:
            body = _shift_body(body, dx, dy)
        w = max(w + dx, maxx + dx + FIT_PAD)
        h = max(h + dy, maxy + dy + FIT_PAD)
    return _svg_raw(w, h, body)


def _svg_raw(w: float, h: float, body: str) -> str:
    return (
        f'<svg viewBox="0 0 {_n(w)} {_n(h)}" xmlns="http://www.w3.org/2000/svg">'
        f"{body}</svg>"
    )


_NUM = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"
_TAG_RE = re.compile(r"<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+=\"[^\"]*\")*)\s*/?>")
_ATTR_RE = re.compile(r"([\w:-]+)=\"([^\"]*)\"")
_PATH_TOKEN_RE = re.compile(rf"[A-Za-z]|{_NUM}")
_NUM_PAIR_RE = re.compile(rf"({_NUM})[ ,]+({_NUM})")
# 좌표를 갖는 태그. `text` 는 **닻점만** 센다 — 글꼴 폭은 여기서 알 수 없다.
# 라벨은 measured() 가 스스로 바깥으로 밀고, kind 가 그만큼 여백을 잡는다.
_GEOM_TAGS = frozenset({"rect", "circle", "ellipse", "line", "polygon", "polyline", "path", "text"})
_IGNORED_TAGS = frozenset({"svg", "g", "defs", "title", "desc", "tspan"})
# 절대 명령만 쓴다. 상대(소문자)는 안 만들고, 오면 예외로 드러낸다.
_PATH_ARGC = {"M": 2, "L": 2, "T": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "A": 7, "Z": 0}


def _body_bbox(body: str) -> tuple[float, float, float, float] | None:
    pts: list[tuple[float, float]] = []
    for tag, attrs in _iter_tags(body):
        pts.extend(_tag_points(tag, attrs))
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def _iter_tags(body: str):
    for m in _TAG_RE.finditer(body):
        tag = m.group(1)
        if tag in _IGNORED_TAGS:
            continue
        if tag not in _GEOM_TAGS:
            raise ValueError(f"경계 상자를 잴 수 없는 태그입니다: {tag}")
        yield tag, dict(_ATTR_RE.findall(m.group(2)))


def _f(attrs: Mapping[str, str], key: str, default: float = 0.0) -> float:
    raw = attrs.get(key)
    return default if raw is None else float(raw)


def _tag_points(tag: str, attrs: Mapping[str, str]) -> list[tuple[float, float]]:
    if tag == "rect":
        x, y = _f(attrs, "x"), _f(attrs, "y")
        return [(x, y), (x + _f(attrs, "width"), y + _f(attrs, "height"))]
    if tag in ("circle", "ellipse"):
        cx, cy = _f(attrs, "cx"), _f(attrs, "cy")
        rx = _f(attrs, "r") or _f(attrs, "rx")
        ry = _f(attrs, "r") or _f(attrs, "ry")
        return [(cx - rx, cy - ry), (cx + rx, cy + ry)]
    if tag == "line":
        return [
            (_f(attrs, "x1"), _f(attrs, "y1")),
            (_f(attrs, "x2"), _f(attrs, "y2")),
        ]
    if tag in ("polygon", "polyline"):
        return [
            (float(a), float(b)) for a, b in _NUM_PAIR_RE.findall(attrs.get("points", ""))
        ]
    if tag == "path":
        return _path_points(attrs.get("d", ""))
    return [(_f(attrs, "x"), _f(attrs, "y"))]


def _bezier_extrema(p0: float, ctrl: list[float], p1: float) -> list[float]:
    """한 축의 베지에 극값 — 제어점을 그대로 담으면 measured() 곡선이 실제보다
    두 배 부풀어 쓸데없는 여백이 생긴다(제어점은 곡선이 닿지 않는 자리다)."""
    out = [p0, p1]
    if len(ctrl) == 1:
        den = p0 - 2 * ctrl[0] + p1
        ts = [] if abs(den) < 1e-12 else [(p0 - ctrl[0]) / den]
        for t in ts:
            if 0 < t < 1:
                out.append((1 - t) ** 2 * p0 + 2 * (1 - t) * t * ctrl[0] + t * t * p1)
        return out
    c0, c1 = ctrl
    a = -p0 + 3 * c0 - 3 * c1 + p1
    b = 2 * (p0 - 2 * c0 + c1)
    c = c0 - p0
    roots: list[float] = []
    if abs(a) < 1e-12:
        if abs(b) > 1e-12:
            roots.append(-c / b)
    else:
        disc = b * b - 4 * a * c
        if disc >= 0:
            sq = math.sqrt(disc)
            roots += [(-b + sq) / (2 * a), (-b - sq) / (2 * a)]
    for t in roots:
        if 0 < t < 1:
            out.append(
                (1 - t) ** 3 * p0
                + 3 * (1 - t) ** 2 * t * c0
                + 3 * (1 - t) * t * t * c1
                + t**3 * p1
            )
    return out


def _arc_points(
    p0: tuple[float, float], rx: float, ry: float, large: float, sweep: float, p1: tuple[float, float]
) -> list[tuple[float, float]]:
    """호의 극값. 우리는 회전 없는 **정원** 호만 그린다 — 그 경우만 정확히 풀고,
    그 밖은 반지름만큼 넉넉히 잡는다(넘치는 쪽이 잘리는 쪽보다 낫다)."""
    if abs(rx - ry) > 1e-9 or rx <= 0:
        return [
            (p0[0] - rx, p0[1] - ry),
            (p0[0] + rx, p0[1] + ry),
            (p1[0] - rx, p1[1] - ry),
            (p1[0] + rx, p1[1] + ry),
        ]
    mx, my = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    dx, dy = (p1[0] - p0[0]) / 2, (p1[1] - p0[1]) / 2
    d2 = dx * dx + dy * dy
    hh = max(0.0, rx * rx - d2)
    k = math.sqrt(hh / d2) if d2 > 0 else 0.0
    # SVG 끝점→중심 변환: c' = ±(y', −x'), x'y' 는 (p0−p1)/2 다. (p1−p0) 로 잡으면
    # 부호가 통째로 뒤집혀 중심이 반대편에 앉는다 — 분수 원 viewBox 가 112 → 264 가 됐다.
    sign = 1.0 if (large != sweep) else -1.0
    cx, cy = mx - sign * k * dy, my + sign * k * dx
    a0 = math.atan2(p0[1] - cy, p0[0] - cx)
    a1 = math.atan2(p1[1] - cy, p1[0] - cx)
    if sweep:
        while a1 < a0:
            a1 += 2 * math.pi
    else:
        while a1 > a0:
            a1 -= 2 * math.pi
    out = [p0, p1]
    for q in range(-4, 9):
        ang = q * math.pi / 2
        if min(a0, a1) - 1e-9 <= ang <= max(a0, a1) + 1e-9:
            out.append((cx + rx * math.cos(ang), cy + rx * math.sin(ang)))
    return out


def _path_points(d: str) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    cur = (0.0, 0.0)
    for cmd, args in _walk_path(d):
        if cmd == "Z":
            continue
        if cmd == "H":
            cur = (args[0], cur[1])
            out.append(cur)
        elif cmd == "V":
            cur = (cur[0], args[0])
            out.append(cur)
        elif cmd in ("M", "L", "T"):
            for i in range(0, len(args), 2):
                cur = (args[i], args[i + 1])
                out.append(cur)
        elif cmd in ("Q", "S", "C"):
            cx_ctrl = [args[0]] if cmd != "C" else [args[0], args[2]]
            cy_ctrl = [args[1]] if cmd != "C" else [args[1], args[3]]
            end = (args[2], args[3]) if cmd != "C" else (args[4], args[5])
            # 축마다 따로 극값을 낸다 — 상자는 x·y 를 독립으로 합치므로 짝은 상관없다.
            xs = _bezier_extrema(cur[0], cx_ctrl, end[0])
            ys = _bezier_extrema(cur[1], cy_ctrl, end[1])
            out += [(x, cur[1]) for x in xs] + [(cur[0], y) for y in ys]
            cur = end
        elif cmd == "A":
            end = (args[5], args[6])
            out += _arc_points(cur, args[0], args[1], args[3], args[4], end)
            cur = end
    return out


def _walk_path(d: str):
    tokens = _PATH_TOKEN_RE.findall(d)
    i = 0
    cmd = ""
    while i < len(tokens):
        tok = tokens[i]
        if tok.isalpha():
            cmd = tok
            i += 1
            if cmd not in _PATH_ARGC:
                raise ValueError(f"모르는 경로 명령입니다: {cmd}")
        if not cmd:
            raise ValueError("경로가 명령 없이 시작합니다")
        argc = _PATH_ARGC[cmd]
        if argc == 0:
            yield cmd, []
            continue
        args = [float(t) for t in tokens[i : i + argc]]
        if len(args) < argc:
            raise ValueError(f"경로 명령 {cmd} 의 인자가 모자랍니다")
        i += argc
        yield cmd, args
        if cmd == "M":
            cmd = "L"


def _shift_body(body: str, dx: float, dy: float) -> str:
    def repl(m: re.Match[str]) -> str:
        tag = m.group(1)
        if tag in _IGNORED_TAGS:
            return m.group(0)
        if tag not in _GEOM_TAGS:
            raise ValueError(f"옮길 수 없는 태그입니다: {tag}")
        attrs = m.group(2)

        def one(a: re.Match[str]) -> str:
            key, val = a.group(1), a.group(2)
            if key in ("x", "x1", "x2", "cx"):
                return f'{key}="{_n(float(val) + dx)}"'
            if key in ("y", "y1", "y2", "cy"):
                return f'{key}="{_n(float(val) + dy)}"'
            if key == "points":
                moved = _NUM_PAIR_RE.sub(
                    lambda p: f"{_n(float(p.group(1)) + dx)},{_n(float(p.group(2)) + dy)}", val
                )
                return f'{key}="{moved}"'
            if key == "d":
                return f'{key}="{_shift_path(val, dx, dy)}"'
            return a.group(0)

        return m.group(0).replace(attrs, _ATTR_RE.sub(one, attrs), 1) if attrs else m.group(0)

    return _TAG_RE.sub(repl, body)


def _shift_path(d: str, dx: float, dy: float) -> str:
    out: list[str] = []
    for cmd, args in _walk_path(d):
        moved: list[float] = []
        if cmd == "H":
            moved = [args[0] + dx]
        elif cmd == "V":
            moved = [args[0] + dy]
        elif cmd == "A":
            moved = args[:5] + [args[5] + dx, args[6] + dy]
        else:
            moved = [a + (dx if i % 2 == 0 else dy) for i, a in enumerate(args)]
        out.append(cmd + " " + " ".join(_n(v) for v in moved) if moved else cmd)
    return " ".join(out)


def _n(v: float) -> str:
    return f"{v:.2f}".rstrip("0").rstrip(".")


def _esc(v: Any) -> str:
    return escape(str(v), quote=True)


def _rect(
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    rx: float = 0,
    fill: str = PAPER,
    stroke: str = INK,
    sw: float = 1.3,
    dash: str | None = None,
) -> str:
    d = f' stroke-dasharray="{_esc(dash)}"' if dash else ""
    return (
        f'<rect x="{_n(x)}" y="{_n(y)}" width="{_n(w)}" height="{_n(h)}" '
        f'rx="{_n(rx)}" fill="{fill}" stroke="{stroke}" stroke-width="{_n(sw)}"{d}/>'
    )


def _text(
    x: float,
    y: float,
    t: Any,
    *,
    size: float = 14,
    anchor: str = "middle",
    weight: str = "700",
) -> str:
    return (
        f'<text x="{_n(x)}" y="{_n(y)}" fill="{INK}" font-size="{_n(size)}" '
        f'font-family="Batang, serif" font-weight="{weight}" text-anchor="{anchor}" '
        f'dominant-baseline="middle">{_esc(t)}</text>'
    )


def _arrow_down(x: float, y0: float, y1: float) -> str:
    return (
        f'<line x1="{_n(x)}" y1="{_n(y0)}" x2="{_n(x)}" y2="{_n(y1 - 4)}" '
        f'stroke="{INK}" stroke-width="1.2"/>'
        f'<polygon points="{_n(x - 3.5)},{_n(y1 - 6)} {_n(x + 3.5)},{_n(y1 - 6)} '
        f'{_n(x)},{_n(y1)}" fill="{INK}"/>'
    )


def _arrow_up(x: float, y_from: float, y_to: float) -> str:
    """아래 상자(y_from)에서 위 상자(y_to)로. 꼭짓점 y 가 더 작다."""
    return (
        f'<line x1="{_n(x)}" y1="{_n(y_from)}" x2="{_n(x)}" y2="{_n(y_to + 4)}" '
        f'stroke="{INK}" stroke-width="1.2"/>'
        f'<polygon points="{_n(x - 3.5)},{_n(y_to + 6)} {_n(x + 3.5)},{_n(y_to + 6)} '
        f'{_n(x)},{_n(y_to)}" fill="{INK}"/>'
    )


def _arrow_right(x0: float, x1: float, y: float) -> str:
    return (
        f'<line x1="{_n(x0)}" y1="{_n(y)}" x2="{_n(x1 - 4)}" y2="{_n(y)}" '
        f'stroke="{INK}" stroke-width="1.2"/>'
        f'<polygon points="{_n(x1 - 6)},{_n(y - 3.5)} {_n(x1 - 6)},{_n(y + 3.5)} '
        f'{_n(x1)},{_n(y)}" fill="{INK}"/>'
    )


def _length_mark(
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    label: str,
    *,
    off: float = -10.0,
    fs: float = 11,
    t: float = 0.5,
) -> str:
    """길이 치수 — 도형 엔진 `measured()` 와 같다.

    점선(`6 4`)이 잰 두 점에 닿고, 라벨은 곡선 정점에서 흰 halo 로 배경 처리한다
    (`core.figure_svg.measured` / `dim_label`). 여기서 다시 그리지 않는다.
    t 는 선분 위 위치(0.5=중점). 교차점에 묻히면 밖으로 빼거나 t 를 옮긴다.
    """
    from core.figure_svg import measured

    return measured(x0, y0, x1, y1, off, str(label), fs=fs, t=t)


def _number_cards(spec: Mapping[str, Any]) -> str:
    cards = spec["cards"]
    if not isinstance(cards, list) or not cards:
        raise ValueError("cards 는 비어 있지 않은 배열이어야 합니다")
    w, h, gap = 36, 42, 10
    pad = 4
    total = pad * 2 + len(cards) * w + (len(cards) - 1) * gap
    parts = []
    x = pad
    for c in cards:
        parts.append(_rect(x, pad, w, h, rx=5, sw=1.6))
        parts.append(_text(x + w / 2, pad + h / 2, c, size=18))
        x += w + gap
    return _svg(total, h + pad * 2, "".join(parts))


def _place_value(spec: Mapping[str, Any]) -> str:
    counts = {
        "100": _count(spec["hundreds"]),
        "10": _count(spec["tens"]),
        "1": _count(spec["ones"]),
    }
    cw, ch, gap = 28, 22, 5
    rows = []
    y = 4
    max_w = 0
    for label, n in counts.items():
        x = 4
        row = []
        for _ in range(n):
            row.append(_rect(x, y, cw, ch, rx=3, sw=1.2))
            row.append(_text(x + cw / 2, y + ch / 2, label, size=10))
            x += cw + gap
        max_w = max(max_w, x)
        rows.extend(row)
        y += ch + gap
    return _svg(max(max_w, 40), y, "".join(rows))


def _count(v: Any) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ValueError("개수는 정수여야 합니다")
    n = int(v)
    if n < 0 or n > 20:
        raise ValueError("개수는 0 이상 20 이하여야 합니다")
    return n


def _hundred_grid(x: float, y: float, cell: float = 2.2) -> str:
    s = cell * 10
    parts = [_rect(x, y, s, s, sw=1.1, fill=FAINT)]
    for i in range(11):
        d = i * cell
        parts.append(
            f'<line x1="{_n(x + d)}" y1="{_n(y)}" x2="{_n(x + d)}" y2="{_n(y + s)}" '
            f'stroke="{INK}" stroke-width="0.5"/>'
        )
        parts.append(
            f'<line x1="{_n(x)}" y1="{_n(y + d)}" x2="{_n(x + s)}" y2="{_n(y + d)}" '
            f'stroke="{INK}" stroke-width="0.5"/>'
        )
    return "".join(parts)


def _ten_rod(x: float, y: float, cell: float = 2.2) -> str:
    return _rect(x, y, cell, cell * 10, sw=1.0, fill=FAINT)


def _one(x: float, y: float, cell: float = 2.2) -> str:
    return _rect(x, y, cell, cell, sw=0.9, fill=FAINT)


def _base10(spec: Mapping[str, Any]) -> str:
    rows = spec["rows"]
    if not isinstance(rows, list) or not rows:
        raise ValueError("rows 는 비어 있지 않은 배열이어야 합니다")
    cell = 2.4
    pad = 8
    row_h = cell * 10 + 12
    boxes: list[str] = []
    bits: list[str] = []
    y = pad
    width = 120.0
    for row in rows:
        if not isinstance(row, Mapping):
            raise ValueError("rows 항목은 객체여야 합니다")
        h = _count(row.get("hundreds", 0))
        t = _count(row.get("tens", 0))
        o = _count(row.get("ones", 0))
        x = pad + 10
        gy = y + 6
        for _ in range(h):
            bits.append(_hundred_grid(x, gy, cell))
            x += cell * 10 + 6
        x += 4
        for _ in range(t):
            bits.append(_ten_rod(x, gy, cell))
            x += cell + 4
        x += 6
        for i in range(o):
            bits.append(_one(x, gy + i * (cell + 2), cell))
        width = max(width, x + 18)
        boxes.append(_rect(pad, y, width - pad, row_h, rx=6, sw=1.2, fill=PAPER))
        y += row_h + 8
    # 상자 폭을 최종 width 에 맞춘다 — 행마다 다시 그린다.
    y = pad
    boxes = []
    for _row in rows:
        boxes.append(_rect(pad, y, width - pad, row_h, rx=6, sw=1.2, fill=PAPER))
        y += row_h + 8
    parts = boxes + bits
    eq = spec.get("equation")
    if eq:
        parts.append(_text(width / 2, y + 10, eq, size=14))
        y += 24
    return _svg(width + pad, y + pad, "".join(parts))


def _op_box(spec: Mapping[str, Any]) -> str:
    inp = spec["input"]
    op = spec["op"]
    w, cx = 140, 70
    op_s = str(op)
    # 숫자만 감싼다. 예전 100×36 막대는 발문 대비 쓸데없이 컸다.
    pw = min(64.0, max(48.0, 9.0 * len(op_s) + 20))
    ph = 22.0
    px = cx - pw / 2
    ew, eh = 36.0, 18.0
    parts = [
        _text(cx, 13, inp, size=14),
        _arrow_down(cx, 22, 34),
        _rect(px, 34, pw, ph, rx=ph / 2, fill="#f3e6e4", sw=1.3, stroke="#b45a55"),
        _text(cx, 34 + ph / 2, op, size=14),
        _arrow_down(cx, 34 + ph, 70),
        _rect(cx - ew / 2, 70, ew, eh, rx=3, sw=1.2),
    ]
    return _svg(w, 70 + eh + 8, "".join(parts))


def _sum_box(spec: Mapping[str, Any]) -> str:
    left, right = spec["left"], spec["right"]
    cw, ch = 70, 28
    parts = [
        _rect(2, 2, cw, ch, sw=1.3, fill="#d7e4df"),
        _rect(2 + cw, 2, cw, ch, sw=1.3, fill="#d7e4df"),
        _rect(2, 2 + ch, cw * 2, ch + 6, sw=1.3),
        _text(2 + cw / 2, 2 + ch / 2, left, size=15),
        _text(2 + cw + cw / 2, 2 + ch / 2, right, size=15),
    ]
    return _svg(cw * 2 + 4, ch * 2 + 10, "".join(parts))


def _op_arch(x0: float, y0: float, x1: float, y1: float) -> str:
    """상자 위 → 타원 아래, 또는 타원 아래 → 상자 위. 끝점에서 수직."""
    dy = abs(y1 - y0) * 0.55
    c1y = y0 + (dy if y1 > y0 else -dy)
    c2y = y1 + (dy if y0 > y1 else -dy)
    return (
        f'<path d="M{_n(x0)} {_n(y0)} C{_n(x0)} {_n(c1y)} {_n(x1)} {_n(c2y)} '
        f'{_n(x1)} {_n(y1)}" fill="none" stroke="{INK}" stroke-width="1.2"/>'
    )


def _op_tree(spec: Mapping[str, Any]) -> str:
    ops = spec["ops"]
    if not isinstance(ops, list) or len(ops) != 2:
        raise ValueError("ops 는 길이 2 배열이어야 합니다")
    start = spec["start"]
    bw, bh, gap, pad = 60, 32, 52, 10
    oval_rx, oval_ry = 32, 15
    n = 3
    box_y = pad + oval_ry * 2 + 30
    xs = [pad + i * (bw + gap) for i in range(n)]
    parts: list[str] = []
    labels = [start, "", ""]
    for i, label in enumerate(labels):
        filled = bool(label)
        parts.append(
            _rect(
                xs[i],
                box_y,
                bw,
                bh,
                rx=5,
                fill="#f3ead4" if filled else PAPER,
                sw=1.3,
            )
        )
        if label:
            parts.append(_text(xs[i] + bw / 2, box_y + bh / 2, label, size=14))
    for i, op in enumerate(ops):
        left = xs[i] + bw / 2
        right = xs[i + 1] + bw / 2
        cx = (left + right) / 2
        cy = pad + oval_ry
        oval_bottom = cy + oval_ry
        parts.append(
            f'<ellipse cx="{_n(cx)}" cy="{_n(cy)}" rx="{_n(oval_rx)}" '
            f'ry="{_n(oval_ry)}" fill="#f3ead4" stroke="{INK}" stroke-width="1.2"/>'
        )
        parts.append(_text(cx, cy, op, size=12))
        parts.append(_op_arch(left, box_y, cx, oval_bottom))
        tip = box_y - 2
        parts.append(_op_arch(cx, oval_bottom, right, tip - 6))
        parts.append(
            f'<polygon points="{_n(right - 3.5)},{_n(tip - 6)} {_n(right + 3.5)},'
            f'{_n(tip - 6)} {_n(right)},{_n(tip)}" fill="{INK}"/>'
        )
    width = pad * 2 + n * bw + (n - 1) * gap
    height = box_y + bh + pad
    return _svg(width, height, "".join(parts))


def _box_chain(spec: Mapping[str, Any]) -> str:
    steps = spec["steps"]
    if not isinstance(steps, list) or not steps:
        raise ValueError("steps 는 비어 있지 않은 배열이어야 합니다")
    start = spec["start"]
    n = len(steps)
    bw, bh = 58, 30
    gap_x, gap_y = 24, 24
    pad = 10

    def xy(col: int, row: int) -> tuple[float, float]:
        return pad + col * (bw + gap_x), pad + (n - row) * (bh + gap_y)

    parts: list[str] = []

    def cell(col: int, row: int, label: str | None) -> None:
        x, y = xy(col, row)
        filled = label is not None
        parts.append(
            _rect(
                x,
                y,
                bw,
                bh,
                rx=5,
                fill="#f3ead4" if filled else PAPER,
                sw=1.3,
            )
        )
        if label:
            parts.append(_text(x + bw / 2, y + bh / 2, label, size=13))

    def right(col: int, row: int) -> None:
        x0, y0 = xy(col, row)
        x1, _ = xy(col + 1, row)
        parts.append(_arrow_right(x0 + bw, x1, y0 + bh / 2))

    def up(col: int, row: int) -> None:
        x0, y_low = xy(col, row)
        _, y_up = xy(col, row + 1)
        parts.append(_arrow_up(x0 + bw / 2, y_low, y_up + bh))

    cell(0, 0, str(start))
    right(0, 0)
    for i, step in enumerate(steps):
        cell(i + 1, i, str(step))
        cell(i + 1, i + 1, None)
        up(i + 1, i)
        if i + 1 < n:
            right(i + 1, i + 1)
    cols = n + 1
    rows = n + 1
    width = pad * 2 + cols * bw + (cols - 1) * gap_x
    height = pad * 2 + rows * bh + (rows - 1) * gap_y
    return _svg(width, height, "".join(parts))


def _column_op(spec: Mapping[str, Any]) -> str:
    top, bottom = str(spec["top"]), str(spec["bottom"])
    op = str(spec["op"])
    result = spec.get("result")
    result_s = None if result is None else str(result)
    hi = spec.get("highlight")
    # 자릿수와 무관하게 같은 viewBox·같은 글자 크기. 칸만 4자리로 고정한다.
    slots = 4
    dw, dh = 18.0, 22.0
    box_pad = 12.0
    x0 = box_pad + 22
    y_top = box_pad + 8
    inner_w = x0 + slots * dw + 10
    inner_h = box_pad * 2 + dh * 3 + 16
    parts = [_rect(6, 6, inner_w - 12, inner_h - 12, rx=6, sw=1.2)]

    def digits(s: str, y: float, key: str) -> None:
        raw = s
        s = s.rjust(slots)
        shift = slots - len(raw)
        for i, ch in enumerate(s):
            if ch == " ":
                continue
            cx = x0 + i * dw + dw / 2
            if hi == f"{key}{i - shift}":
                bs = 15.0
                parts.append(
                    _rect(cx - bs / 2, y - bs / 2, bs, bs, rx=1.5, sw=1.1, stroke="#b45a55")
                )
            parts.append(
                f'<text x="{_n(cx)}" y="{_n(y)}" fill="{INK}" font-size="15" '
                f'font-family="Batang, serif" font-weight="700" text-anchor="middle" '
                f'dominant-baseline="central">{_esc(ch)}</text>'
            )

    digits(top, y_top + 8, "t")
    parts.append(_text(x0 - 12, y_top + dh + 8, op, size=15))
    digits(bottom, y_top + dh + 8, "b")
    y_line = y_top + dh * 2 + 2
    parts.append(
        f'<line x1="{_n(x0 - 16)}" y1="{_n(y_line)}" x2="{_n(x0 + slots * dw)}" '
        f'y2="{_n(y_line)}" stroke="{INK}" stroke-width="1.3"/>'
    )
    if result_s:
        digits(result_s, y_line + 16, "r")
    else:
        parts.append(_rect(x0, y_line + 6, slots * dw, 18, rx=2, sw=1.1))
    return _svg(inner_w, inner_h, "".join(parts))


def _fmt_tick(v: float) -> str:
    if abs(v - round(v)) < 1e-8:
        return str(int(round(v)))
    return f"{v:.4f}".rstrip("0").rstrip(".")


def _number_line(spec: Mapping[str, Any]) -> str:
    lo = float(spec.get("min", 0))
    hi = float(spec["max"])
    step = float(spec.get("step", 5))
    tick = float(spec.get("tick", 1))
    hops = spec.get("hops") or []
    blanks = spec.get("blanks") or []
    if hi <= lo:
        raise ValueError("max 는 min 보다 커야 합니다")
    if tick <= 0 or step <= 0:
        raise ValueError("step·tick 은 양수여야 합니다")
    blank_vals = []
    if not isinstance(blanks, list):
        raise ValueError("blanks 는 배열이어야 합니다")
    for item in blanks:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise ValueError("blanks 항목은 수여야 합니다")
        blank_vals.append(float(item))
    pad, y = 16.0, 48.0
    span = 220.0
    x0 = pad + 8

    def xp(v: float) -> float:
        return x0 + (v - lo) / (hi - lo) * span

    def on_step(v: float) -> bool:
        q = (v - lo) / step
        return abs(q - round(q)) < 1e-6

    def is_blank(v: float) -> bool:
        return any(abs(v - b) < 1e-6 for b in blank_vals)

    parts = [
        f'<line x1="{_n(xp(lo))}" y1="{_n(y)}" x2="{_n(xp(hi))}" y2="{_n(y)}" '
        f'stroke="{INK}" stroke-width="1.4"/>'
    ]
    v = lo
    n_ticks = 0
    while v <= hi + 1e-8:
        x = xp(v)
        parts.append(
            f'<line x1="{_n(x)}" y1="{_n(y - 5)}" x2="{_n(x)}" y2="{_n(y + 5)}" '
            f'stroke="{INK}" stroke-width="1.1"/>'
        )
        if is_blank(v):
            parts.append(_rect(x - 8, y + 10, 16, 14, rx=2, sw=1.05))
        elif on_step(v):
            parts.append(_text(x, y + 16, _fmt_tick(v), size=11, weight="600"))
        n_ticks += 1
        if n_ticks > 40:
            raise ValueError("눈금이 너무 많습니다")
        v += tick
    if isinstance(hops, list):
        for a, b in hops:
            xa, xb = xp(float(a)), xp(float(b))
            mx = (xa + xb) / 2
            parts.append(
                f'<path d="M{_n(xa)} {_n(y - 2)} Q{_n(mx)} {_n(y - 22)} {_n(xb)} {_n(y - 2)}" '
                f'fill="none" stroke="{INK}" stroke-width="1.1" stroke-dasharray="3 2"/>'
            )
    bar_to = spec.get("barTo")
    if bar_to is not None:
        x1 = xp(float(bar_to))
        parts.append(_rect(xp(lo), y - 28, x1 - xp(lo), 12, rx=2, fill="#e8d3a8", sw=1.1))
    return _svg(span + pad * 2 + 16, 78, "".join(parts))


def _clock_face(cx: float, cy: float, r: float, hour: int, minute: int, second: int | None) -> str:
    parts = [
        f'<circle cx="{_n(cx)}" cy="{_n(cy)}" r="{_n(r)}" fill="{PAPER}" '
        f'stroke="{INK}" stroke-width="2"/>',
        f'<circle cx="{_n(cx)}" cy="{_n(cy)}" r="{_n(r + 4)}" fill="none" '
        f'stroke="#7a9e86" stroke-width="5"/>',
    ]
    for i in range(12):
        ang = math.radians(i * 30 - 90)
        inner, outer = r - 7, r - 2
        parts.append(
            f'<line x1="{_n(cx + inner * math.cos(ang))}" y1="{_n(cy + inner * math.sin(ang))}" '
            f'x2="{_n(cx + outer * math.cos(ang))}" y2="{_n(cy + outer * math.sin(ang))}" '
            f'stroke="{INK}" stroke-width="1.2"/>'
        )
        lab = 12 if i == 0 else i
        lx = cx + (r - 14) * math.cos(ang)
        ly = cy + (r - 14) * math.sin(ang)
        parts.append(_text(lx, ly, lab, size=8, weight="600"))

    def hand(deg: float, length: float, sw: float, color: str) -> str:
        ang = math.radians(deg - 90)
        return (
            f'<line x1="{_n(cx)}" y1="{_n(cy)}" x2="{_n(cx + length * math.cos(ang))}" '
            f'y2="{_n(cy + length * math.sin(ang))}" stroke="{color}" stroke-width="{_n(sw)}" '
            f'stroke-linecap="round"/>'
        )

    h = hour % 12
    m = minute
    parts.append(hand(30 * h + 0.5 * m, r * 0.45, 2.4, INK))
    parts.append(hand(6 * m, r * 0.68, 1.8, INK))
    if second is not None:
        parts.append(hand(6 * second, r * 0.72, 1.0, "#c04545"))
    parts.append(f'<circle cx="{_n(cx)}" cy="{_n(cy)}" r="2.2" fill="{INK}"/>')
    return "".join(parts)


def _clocks(spec: Mapping[str, Any]) -> str:
    items = spec["items"]
    if not isinstance(items, list) or not items:
        raise ValueError("items 는 비어 있지 않은 배열이어야 합니다")
    r, gap, pad = 42.0, 28.0, 12.0
    parts: list[str] = []
    for i, item in enumerate(items):
        if not isinstance(item, Mapping):
            raise ValueError("clocks items 는 객체여야 합니다")
        cx = pad + r + 8 + i * (2 * r + gap + 16)
        cy = pad + r + 22
        lab = item.get("label")
        if lab:
            parts.append(_text(cx, pad + 8, lab, size=11, weight="600"))
        parts.append(
            _clock_face(
                cx,
                cy,
                r,
                int(item["hour"]),
                int(item["minute"]),
                None if item.get("second") is None else int(item["second"]),
            )
        )
        if i + 1 < len(items):
            mx = cx + r + gap / 2 + 4
            parts.append(_text(mx, cy, "→", size=14))
    n = len(items)
    width = pad * 2 + n * (2 * r + 16) + (n - 1) * gap
    return _svg(width, pad + 2 * r + 36, "".join(parts))


def _table(spec: Mapping[str, Any]) -> str:
    headers = spec["headers"]
    rows = spec["rows"]
    if not isinstance(headers, list) or not isinstance(rows, list):
        raise ValueError("headers 와 rows 는 배열이어야 합니다")
    cols = len(headers)
    if cols < 1:
        raise ValueError("headers 는 비어 있지 않아야 합니다")
    pad, rh = 8.0, 24.0
    # 열이 많으면 칸만 줄인다. viewBox 를 키우면 화면에서 숫자가 본문보다 작아진다.
    cw = min(56.0, (TABLE_VIEWBOX_MAX - pad * 2) / cols)
    fs = 13 if cw >= 36 else 12
    parts = [
        _rect(pad, pad, cols * cw, rh, sw=1.2, fill="#d7e0e8"),
    ]
    for i, h in enumerate(headers):
        parts.append(_text(pad + cw * i + cw / 2, pad + rh / 2, h, size=fs))
        if i:
            x = pad + cw * i
            parts.append(
                f'<line x1="{_n(x)}" y1="{_n(pad)}" x2="{_n(x)}" y2="{_n(pad + rh * (1 + len(rows)))}" '
                f'stroke="{INK}" stroke-width="1"/>'
            )
    for r, row in enumerate(rows):
        if not isinstance(row, list) or len(row) != cols:
            raise ValueError("행 칸 수가 머리와 같아야 합니다")
        y = pad + rh * (r + 1)
        parts.append(_rect(pad, y, cols * cw, rh, sw=1.2))
        for i, cell in enumerate(row):
            parts.append(_text(pad + cw * i + cw / 2, y + rh / 2, cell, size=fs, weight="600"))
    return _svg(pad * 2 + cols * cw, pad * 2 + rh * (1 + len(rows)), "".join(parts))


def _tape(spec: Mapping[str, Any]) -> str:
    length = float(spec["length"])
    label = str(spec["label"])
    segs = int(spec.get("segments", 1))
    w, h, pad = 200.0, 18.0, 16.0
    bar_y = 26.0
    parts = [
        _rect(pad, bar_y, w, h, rx=2, fill="#e8d3a8", sw=1.2),
        _length_mark(pad, bar_y, pad + w, bar_y, label),
    ]
    if segs > 1:
        for i in range(1, segs):
            x = pad + w * i / segs
            parts.append(
                f'<line x1="{_n(x)}" y1="{_n(bar_y)}" x2="{_n(x)}" y2="{_n(bar_y + h)}" '
                f'stroke="{INK}" stroke-width="1"/>'
            )
    return _svg(w + pad * 2, bar_y + h + 8, "".join(parts))


def _dot_grid(spec: Mapping[str, Any]) -> str:
    rows, cols = int(spec["rows"]), int(spec["cols"])
    if rows < 1 or cols < 1 or rows > 12 or cols > 12:
        raise ValueError("rows·cols 는 1 이상 12 이하여야 합니다")
    gap, r, pad = 16.0, 5.0, 10.0
    parts = []
    for y in range(rows):
        for x in range(cols):
            cx = pad + r + x * gap
            cy = pad + r + y * gap
            parts.append(
                f'<circle cx="{_n(cx)}" cy="{_n(cy)}" r="{_n(r)}" fill="#c4a574" '
                f'stroke="{INK}" stroke-width="0.8"/>'
            )
    return _svg(pad * 2 + (cols - 1) * gap + r * 2, pad * 2 + (rows - 1) * gap + r * 2, "".join(parts))


def _boxed_list(spec: Mapping[str, Any]) -> str:
    items = spec["items"]
    if not isinstance(items, list) or not items:
        raise ValueError("items 는 비어 있지 않은 배열이어야 합니다")
    marks = spec.get("marks") or [f"{i + 1}" for i in range(len(items))]
    pad, rh, w = 10.0, 22.0, 200.0
    parts = [_rect(pad, pad, w, rh * len(items) + 10, rx=4, sw=1.3)]
    for i, item in enumerate(items):
        y = pad + 8 + i * rh
        label = f"{marks[i]}  {item}".strip() if str(marks[i]).strip() else str(item)
        parts.append(_text(pad + 16, y + 8, label, size=12, anchor="start", weight="600"))
    return _svg(w + pad * 2, rh * len(items) + pad * 2 + 8, "".join(parts))


def _pills(spec: Mapping[str, Any]) -> str:
    items = spec["items"]
    if not isinstance(items, list) or len(items) < 2:
        raise ValueError("items 는 2개 이상이어야 합니다")
    bw, bh, gap, pad = 88.0, 28.0, 26.0, 10.0
    parts: list[str] = []
    for i, item in enumerate(items):
        x = pad + i * (bw + gap)
        parts.append(_rect(x, pad, bw, bh, rx=6, fill="#e4eee6", sw=1.2))
        parts.append(_text(x + bw / 2, pad + bh / 2, item, size=12))
        if i + 1 < len(items):
            parts.append(_arrow_right(x + bw, x + bw + gap, pad + bh / 2))
    n = len(items)
    return _svg(pad * 2 + n * bw + (n - 1) * gap, pad * 2 + bh, "".join(parts))


def _geo_line(_spec: Mapping[str, Any]) -> str:
    y, x0, x1 = 36.0, 18.0, 200.0
    parts = [
        f'<line x1="{_n(x0)}" y1="{_n(y)}" x2="{_n(x1)}" y2="{_n(y)}" '
        f'stroke="{INK}" stroke-width="1.6"/>',
        f'<polygon points="{_n(x0)},{_n(y)} {_n(x0 + 10)},{_n(y - 4)} {_n(x0 + 10)},{_n(y + 4)}" fill="{INK}"/>',
        f'<polygon points="{_n(x1)},{_n(y)} {_n(x1 - 10)},{_n(y - 4)} {_n(x1 - 10)},{_n(y + 4)}" fill="{INK}"/>',
        f'<circle cx="70" cy="{_n(y)}" r="2.4" fill="{INK}"/>',
        f'<circle cx="148" cy="{_n(y)}" r="2.4" fill="{INK}"/>',
    ]
    return _svg(220, 56, "".join(parts))


def _angle_pick(_spec: Mapping[str, Any]) -> str:
    """원본 50쪽 03: L · 만나지 않는 두 선 · 각 · 곡선."""
    parts: list[str] = []
    # L
    parts += [
        f'<polyline points="16,70 16,30 56,30" fill="none" stroke="{INK}" stroke-width="1.6"/>',
    ]
    # 두 선 (각 아님)
    parts += [
        f'<line x1="78" y1="28" x2="98" y2="70" stroke="{INK}" stroke-width="1.6"/>',
        f'<line x1="108" y1="70" x2="128" y2="28" stroke="{INK}" stroke-width="1.6"/>',
    ]
    # >
    parts += [
        f'<polyline points="150,28 178,50 150,72" fill="none" stroke="{INK}" stroke-width="1.6"/>',
    ]
    # 곡선
    parts.append(
        f'<path d="M200 70 Q214 20 228 70" fill="none" stroke="{INK}" stroke-width="1.6"/>'
    )
    return _svg(244, 88, "".join(parts))


def _time_add(spec: Mapping[str, Any]) -> str:
    start, add = spec["start"], spec["add"]
    if not isinstance(start, Mapping) or not isinstance(add, Mapping):
        raise ValueError("start 와 add 는 객체여야 합니다")

    def cell(v: Any, blank: bool) -> str:
        return "" if blank or v is None else str(v)

    rows = [
        (cell(start.get("h"), False), cell(start.get("m"), False), cell(start.get("s"), False), False),
        (cell(add.get("h"), False), cell(add.get("m"), False), cell(add.get("s"), False), False),
        ("", "", "", True),
    ]
    units = ["시", "분", "초"]
    cw, rh, pad = 48.0, 22.0, 12.0
    parts = [_text(pad + cw * i + cw / 2, 10, u, size=11, weight="600") for i, u in enumerate(units)]
    y0 = 18.0
    for r, (a, b, c, blank) in enumerate(rows):
        y = y0 + r * rh
        vals = [a, b, c]
        if r == 1:
            parts.append(_text(pad - 2, y + rh / 2, "+", size=14, anchor="end"))
        for i, v in enumerate(vals):
            x = pad + i * cw
            if blank:
                parts.append(_rect(x + 6, y + 2, cw - 12, rh - 4, rx=2, sw=1.1))
            else:
                parts.append(_text(x + cw / 2, y + rh / 2, v, size=13))
        if r == 1:
            parts.append(
                f'<line x1="{_n(pad)}" y1="{_n(y + rh)}" x2="{_n(pad + 3 * cw)}" '
                f'y2="{_n(y + rh)}" stroke="{INK}" stroke-width="1.3"/>'
            )
    return _svg(pad * 2 + 3 * cw, y0 + 3 * rh + 8, "".join(parts))


def _grid_xy(c: float, r: float, pad: float, cell: float) -> tuple[float, float]:
    return pad + c * cell, pad + r * cell


def _pair_cr(value: Any, path: str) -> tuple[float, float]:
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError(f"{path} 는 [열, 행] 이어야 합니다")
    if isinstance(value[0], bool) or isinstance(value[1], bool):
        raise ValueError(f"{path} 좌표는 수여야 합니다")
    if not isinstance(value[0], (int, float)) or not isinstance(value[1], (int, float)):
        raise ValueError(f"{path} 좌표는 수여야 합니다")
    return float(value[0]), float(value[1])


def _point_grid(spec: Mapping[str, Any]) -> str:
    cols, rows = int(spec["cols"]), int(spec["rows"])
    if cols < 1 or cols > 10 or rows < 1 or rows > 10:
        raise ValueError("cols·rows 는 1 이상 10 이하여야 합니다")
    dots = spec["dots"]
    if not isinstance(dots, list) or not dots:
        raise ValueError("dots 는 비어 있지 않은 배열이어야 합니다")
    cell, pad = 22.0, 18.0
    parts: list[str] = []
    for i in range(cols + 1):
        x0, y0 = _grid_xy(i, 0, pad, cell)
        x1, y1 = _grid_xy(i, rows, pad, cell)
        parts.append(
            f'<line x1="{_n(x0)}" y1="{_n(y0)}" x2="{_n(x1)}" y2="{_n(y1)}" '
            f'stroke="{GRID}" stroke-width="{_n(GRID_SW)}" stroke-dasharray="4 3"/>'
        )
    for j in range(rows + 1):
        x0, y0 = _grid_xy(0, j, pad, cell)
        x1, y1 = _grid_xy(cols, j, pad, cell)
        parts.append(
            f'<line x1="{_n(x0)}" y1="{_n(y0)}" x2="{_n(x1)}" y2="{_n(y1)}" '
            f'stroke="{GRID}" stroke-width="{_n(GRID_SW)}" stroke-dasharray="4 3"/>'
        )
    for i, line in enumerate(spec.get("lines") or []):
        if not isinstance(line, list) or len(line) != 2:
            raise ValueError("lines 항목은 두 점이어야 합니다")
        c0, r0 = _pair_cr(line[0], f"lines[{i}][0]")
        c1, r1 = _pair_cr(line[1], f"lines[{i}][1]")
        x0, y0 = _grid_xy(c0, r0, pad, cell)
        x1, y1 = _grid_xy(c1, r1, pad, cell)
        parts.append(
            f'<line x1="{_n(x0)}" y1="{_n(y0)}" x2="{_n(x1)}" y2="{_n(y1)}" '
            f'stroke="{INK}" stroke-width="1.6"/>'
        )
    square = spec.get("square")
    if square is not None:
        if not isinstance(square, Mapping):
            raise ValueError("square 는 객체여야 합니다")
        sc, sr = float(square["c"]), float(square["r"])
        dx, dy = float(square["dx"]), float(square["dy"])
        sx = -1.0 if dx < 0 else 1.0
        sy = -1.0 if dy < 0 else 1.0
        x, y = _grid_xy(sc, sr, pad, cell)
        s = 7.0
        parts.append(
            f'<polyline points="{_n(x + s * sx)},{_n(y)} {_n(x + s * sx)},{_n(y + s * sy)} '
            f'{_n(x)},{_n(y + s * sy)}" fill="none" stroke="{INK}" stroke-width="1.2"/>'
        )
    side_off = {
        "up": (0.0, -10.0),
        "down": (0.0, 11.0),
        "left": (-11.0, 0.0),
        "right": (11.0, 0.0),
    }
    for i, dot in enumerate(dots):
        if not isinstance(dot, Mapping):
            raise ValueError("dots 항목은 객체여야 합니다")
        c, r = float(dot["c"]), float(dot["r"])
        label = str(dot["label"])
        x, y = _grid_xy(c, r, pad, cell)
        parts.append(f'<circle cx="{_n(x)}" cy="{_n(y)}" r="2.5" fill="{INK}"/>')
        side = str(dot.get("side") or "up")
        if side not in side_off:
            raise ValueError(f"dots[{i}].side 는 up·down·left·right 여야 합니다")
        ox, oy = side_off[side]
        parts.append(_text(x + ox, y + oy, label, size=11, weight="700"))
    return _svg(pad * 2 + cols * cell, pad * 2 + rows * cell, "".join(parts))


def _divide_triangle(spec: Mapping[str, Any]) -> str:
    n = spec["n"]
    if isinstance(n, bool) or not isinstance(n, (int, float)) or int(n) != n:
        raise ValueError("n 은 정수여야 합니다")
    n = int(n)
    if n < 2 or n > 12:
        raise ValueError("n 은 2 이상 12 이하여야 합니다")
    bw, bh = 36.0, 22.0
    parts = [
        _rect(8, 48, bw, bh, rx=6, fill="#f4ead8", sw=1.1, stroke="#c4a574"),
        _text(8 + bw / 2, 48 + bh / 2, n, size=14),
        _arrow_right(8 + bw, 56, 59),
    ]
    ax, ay = 72.0, 18.0
    bx, by = 72.0, 110.0
    cx, cy = 168.0, 110.0
    parts.append(
        f'<polygon points="{_n(ax)},{_n(ay)} {_n(bx)},{_n(by)} {_n(cx)},{_n(cy)}" '
        f'fill="#c5d6c2" stroke="{INK}" stroke-width="1.5"/>'
    )
    mx, my = ax, (ay + by) / 2
    px, py = ax + 48.0, my
    qx, qy = px, by
    parts.append(
        f'<line x1="{_n(mx)}" y1="{_n(my)}" x2="{_n(px)}" y2="{_n(py)}" '
        f'stroke="{INK}" stroke-width="1.15" stroke-dasharray="5 4"/>'
    )
    parts.append(
        f'<line x1="{_n(px)}" y1="{_n(py)}" x2="{_n(qx)}" y2="{_n(qy)}" '
        f'stroke="{INK}" stroke-width="1.15" stroke-dasharray="5 4"/>'
    )
    return _svg(180, 124, "".join(parts))


def _frac_filled(filled: Any, n: int) -> set[int]:
    if isinstance(filled, bool) or (
        not isinstance(filled, (int, float, list))
    ):
        raise ValueError("filled 는 개수 또는 조각 번호 배열이어야 합니다")
    if isinstance(filled, (int, float)):
        if int(filled) != filled:
            raise ValueError("filled 개수는 정수여야 합니다")
        count = int(filled)
        if count < 0 or count > n:
            raise ValueError("filled 개수는 0 이상 n 이하여야 합니다")
        return set(range(count))
    out: set[int] = set()
    for item in filled:
        if isinstance(item, bool) or not isinstance(item, (int, float)) or int(item) != item:
            raise ValueError("filled 조각 번호는 정수여야 합니다")
        idx = int(item)
        if idx < 0 or idx >= n:
            raise ValueError("filled 조각 번호는 0 이상 n 미만이어야 합니다")
        out.add(idx)
    return out


def _frac_pie(spec: Mapping[str, Any]) -> str:
    n = spec["n"]
    if isinstance(n, bool) or not isinstance(n, (int, float)) or int(n) != n:
        raise ValueError("n 은 정수여야 합니다")
    n = int(n)
    if n < 2 or n > 16:
        raise ValueError("n 은 2 이상 16 이하여야 합니다")
    filled = _frac_filled(spec["filled"], n)
    start = float(spec.get("start", -90))
    r, pad = 48.0, 8.0
    cx = cy = pad + r
    step = 360.0 / n
    leftover, eaten = str(spec.get("fill") or "#e2b48a"), "#f4efe6"
    parts: list[str] = []
    for i in range(n):
        a0 = math.radians(start + i * step)
        a1 = math.radians(start + (i + 1) * step)
        x0, y0 = cx + r * math.cos(a0), cy + r * math.sin(a0)
        x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
        fill = leftover if i in filled else eaten
        parts.append(
            f'<path d="M{_n(cx)} {_n(cy)} L{_n(x0)} {_n(y0)} '
            f'A{_n(r)} {_n(r)} 0 0 1 {_n(x1)} {_n(y1)} Z" '
            f'fill="{fill}" stroke="none"/>'
        )
    for i in range(n):
        ang = math.radians(start + i * step)
        x1, y1 = cx + r * math.cos(ang), cy + r * math.sin(ang)
        parts.append(
            f'<line x1="{_n(cx)}" y1="{_n(cy)}" x2="{_n(x1)}" y2="{_n(y1)}" '
            f'stroke="{INK}" stroke-width="1.05" stroke-dasharray="5 4"/>'
        )
    parts.append(
        f'<circle cx="{_n(cx)}" cy="{_n(cy)}" r="{_n(r)}" fill="none" '
        f'stroke="{INK}" stroke-width="1.5"/>'
    )
    size = pad * 2 + r * 2
    return _svg(size, size, "".join(parts))


def _tri_row(spec: Mapping[str, Any]) -> str:
    n = spec["n"]
    if isinstance(n, bool) or not isinstance(n, (int, float)) or int(n) != n:
        raise ValueError("n 은 정수여야 합니다")
    n = int(n)
    if n < 2 or n > 8:
        raise ValueError("n 은 2 이상 8 이하여야 합니다")
    filled = _frac_filled(spec["filled"], n)
    w, h, pad = 32.0, 46.0, 8.0
    lo_y, hi_y = pad + h, pad
    fill_on, fill_off = str(spec.get("fill") or "#d7c2e4"), PAPER
    parts: list[str] = []
    for i in range(n):
        x0 = pad + i * w
        x1 = x0 + w
        xm = (x0 + x1) / 2
        if i % 2 == 0:
            pts = f"{_n(x0)},{_n(lo_y)} {_n(xm)},{_n(hi_y)} {_n(x1)},{_n(lo_y)}"
        else:
            pts = f"{_n(x0)},{_n(hi_y)} {_n(xm)},{_n(lo_y)} {_n(x1)},{_n(hi_y)}"
        fill = fill_on if i in filled else fill_off
        parts.append(
            f'<polygon points="{pts}" fill="{fill}" stroke="{INK}" stroke-width="1.2"/>'
        )
    return _svg(pad * 2 + n * w, pad * 2 + h, "".join(parts))


def _trap_four(spec: Mapping[str, Any]) -> str:
    """이등변사다리꼴 = 합동인 직각삼각형 넷.

    두 대각선으로 나누면 위·아래 삼각형 넓이가 달라 분수에 못 쓴다.
    원본(큐브 3-1 145쪽): 아랫변 3칸·윗변 1칸, 칸 한 변이 높이.
    0 왼쪽 · 1 가운데 위 · 2 가운데 아래 · 3 오른쪽.
    """
    filled = _frac_filled(spec["filled"], 4)
    u, pad = 36.0, 8.0
    y_top, y_bot = pad, pad + u
    bl = (pad, y_bot)
    b1 = (pad + u, y_bot)
    b2 = (pad + 2 * u, y_bot)
    br = (pad + 3 * u, y_bot)
    tl = (pad + u, y_top)
    tr = (pad + 2 * u, y_top)
    tris = ((bl, b1, tl), (tl, b1, tr), (b1, b2, tr), (tr, b2, br))
    fill_on = str(spec.get("fill") or "#d7c2e4")
    parts: list[str] = []

    def _pts(tri: tuple[tuple[float, float], ...]) -> str:
        return " ".join(f"{_n(x)},{_n(y)}" for x, y in tri)

    for i, tri in enumerate(tris):
        fill = fill_on if i in filled else PAPER
        parts.append(f'<polygon points="{_pts(tri)}" fill="{fill}"/>')
    parts.append(
        f'<polygon points="{_pts((bl, tl, tr, br))}" fill="none" '
        f'stroke="{INK}" stroke-width="1.3"/>'
    )
    for a, b in ((tl, b1), (tr, b2), (b1, tr)):
        parts.append(
            f'<line x1="{_n(a[0])}" y1="{_n(a[1])}" x2="{_n(b[0])}" y2="{_n(b[1])}" '
            f'stroke="{INK}" stroke-width="1.15" stroke-dasharray="4 3"/>'
        )
    return _svg(pad * 2 + 3 * u, pad * 2 + u, "".join(parts))


_SHAPE_KINDS = frozenset(
    {
        "square",
        "rect",
        "rightTri",
        "isoTri",
        "wideTri",
        "eqTri",
        "diamond",
        "tallDiamond",
        "trap",
        "para",
        "irregQuad",
    }
)
# 도형 항목의 허용 키. 오타(`mark`)가 조용히 무시되면 「옵션을 껐는데 왜 그대로냐」가 된다.
_SHAPE_ITEM_KEYS = frozenset({"shape", "label", "marks"})
# 이등변삼각형 밑변 (슬롯 한 변 대비). 정삼각형과 **윤곽으로** 갈려야 한다 — 09 §4-19.
ISO_TRI_BASE = 0.58
# 서로 다른 kind 의 윤곽이 이보다 가까우면 「이 중에서 고르시오」가 성립하지 않는다.
# 실측 바닥은 para↔rect 7.92px 이고 결함이던 eqTri↔isoTri 는 3.93px 이었다.
SHAPE_MIN_DISTANCE = 6.0


def _poly_pts(pts: list[tuple[float, float]], sw: float = 1.5) -> str:
    s = " ".join(f"{_n(x)},{_n(y)}" for x, y in pts)
    return f'<polygon points="{s}" fill="none" stroke="{INK}" stroke-width="{_n(sw)}"/>'


def _tick_at(a: tuple[float, float], b: tuple[float, float], length: float = 3.4) -> str:
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    dx, dy = b[0] - a[0], b[1] - a[1]
    hyp = math.hypot(dx, dy) or 1.0
    nx, ny = (-dy / hyp) * length, (dx / hyp) * length
    return (
        f'<line x1="{_n(mx - nx)}" y1="{_n(my - ny)}" x2="{_n(mx + nx)}" y2="{_n(my + ny)}" '
        f'stroke="{INK}" stroke-width="1.2"/>'
    )


def _right_mark(
    corner: tuple[float, float],
    p: tuple[float, float],
    q: tuple[float, float],
    size: float = 7.0,
) -> str:
    def unit(dst: tuple[float, float]) -> tuple[float, float]:
        dx, dy = dst[0] - corner[0], dst[1] - corner[1]
        hyp = math.hypot(dx, dy) or 1.0
        return dx / hyp * size, dy / hyp * size

    ux, uy = unit(p)
    vx, vy = unit(q)
    a = (corner[0] + ux, corner[1] + uy)
    c = (corner[0] + vx, corner[1] + vy)
    b = (corner[0] + ux + vx, corner[1] + uy + vy)
    return (
        f'<polyline points="{_n(a[0])},{_n(a[1])} {_n(b[0])},{_n(b[1])} {_n(c[0])},{_n(c[1])}" '
        f'fill="none" stroke="{INK}" stroke-width="1.15"/>'
    )


def _draw_named_shape(kind: str, ox: float, oy: float, s: float, marks: bool = False) -> str:
    """`marks` 는 **등변 tick·직각 기호**를 그릴지다. 기본은 끈 쪽이다.

    「세 변의 길이가 모두 같은 삼각형의 기호를 쓰시오」인데 가에 tick 이 찍혀 있으면
    문제가 성립하지 않는다(원장님 2026-08-22). 그림이 묻는 것을 답해 주면 안 되므로
    안전한 쪽을 기본값으로 두고, 성질을 **주고** 푸는 문항만 켠다. 도형 자체는 여전히
    정확한 정삼각형·직각삼각형이라 재면 알 수 있다.
    """
    if kind == "square":
        return _rect(ox, oy, s, s, sw=1.5)
    if kind == "rect":
        return _rect(ox + s * 0.18, oy, s * 0.64, s, sw=1.5)
    if kind == "rightTri":
        pts = [(ox, oy + s), (ox, oy), (ox + s, oy + s)]
        mark = _right_mark(pts[0], pts[1], pts[2]) if marks else ""
        return _poly_pts(pts) + mark
    if kind == "isoTri":
        # 밑변을 좁힌다. 밑변 s·높이 s 이면 정삼각형(밑변 s·높이 0.866s)과 윤곽 거리가
        # **3.93px** 뿐이라 tick 없이는 둘을 못 가른다 — 등변 표시를 옵트인으로 돌린
        # 순간(원장님 결함 ⑤) 세 세션이 같은 자리에서 막혔다. 0.58s 로 좁히면 9.45px 가
        # 되어 나머지 짝들(최소 7.92px) 사이에 묻힌다. 변 길이 비 1.12 → 1.80 (09 §4-19).
        half = s * ISO_TRI_BASE / 2
        return _poly_pts([(ox + s / 2 - half, oy + s), (ox + s / 2, oy), (ox + s / 2 + half, oy + s)])
    if kind == "wideTri":
        return _poly_pts([(ox, oy + s), (ox + s / 2, oy + s * 0.42), (ox + s, oy + s)])
    if kind == "eqTri":
        h = s * math.sqrt(3) / 2
        y0 = oy + (s - h) / 2
        pts = [(ox, y0 + h), (ox + s / 2, y0), (ox + s, y0 + h)]
        ticks = "".join(_tick_at(pts[i], pts[(i + 1) % 3]) for i in range(3)) if marks else ""
        return _poly_pts(pts) + ticks
    if kind == "diamond":
        return _poly_pts(
            [(ox + s / 2, oy), (ox + s, oy + s / 2), (ox + s / 2, oy + s), (ox, oy + s / 2)]
        )
    if kind == "tallDiamond":
        return _poly_pts(
            [
                (ox + s / 2, oy),
                (ox + s * 0.72, oy + s / 2),
                (ox + s / 2, oy + s),
                (ox + s * 0.28, oy + s / 2),
            ]
        )
    if kind == "trap":
        return _poly_pts(
            [
                (ox + s * 0.2, oy + s * 0.12),
                (ox + s * 0.8, oy + s * 0.12),
                (ox + s, oy + s),
                (ox, oy + s),
            ]
        )
    if kind == "para":
        return _poly_pts(
            [
                (ox + s * 0.28, oy),
                (ox + s, oy),
                (ox + s * 0.72, oy + s),
                (ox, oy + s),
            ]
        )
    return _poly_pts(
        [
            (ox + s * 0.08, oy + s * 0.22),
            (ox + s * 0.92, oy),
            (ox + s, oy + s * 0.62),
            (ox + s * 0.18, oy + s),
        ]
    )


def _named_shapes(spec: Mapping[str, Any]) -> str:
    """도형 여러 개. 라벨은 항상 각 도형 아래 같은 높이.

    FigureSpec `labels` 는 점 옆에 붙어 y 가 제각각이다 — 쓰지 않는다 (09 §4-7).
    """
    items = spec["items"]
    if not isinstance(items, list) or not items:
        raise ValueError("items 는 비어 있지 않은 배열이어야 합니다")
    if len(items) > 12:
        raise ValueError("items 는 12개 이하여야 합니다")
    slot, size, gap, pad, lab = 58.0, 44.0, 10.0, 8.0, 16.0
    cols = min(3, len(items))
    rows = (len(items) + cols - 1) // cols
    parts: list[str] = []
    for i, item in enumerate(items):
        if not isinstance(item, Mapping):
            raise ValueError("namedShapes items 는 객체여야 합니다")
        extra = set(item) - _SHAPE_ITEM_KEYS
        if extra:
            raise ValueError(f"허용되지 않은 도형 키: {', '.join(sorted(str(k) for k in extra))}")
        kind = str(item.get("shape", ""))
        if kind not in _SHAPE_KINDS:
            raise ValueError(f"모르는 도형입니다: {kind}")
        marks = item.get("marks", False)
        if not isinstance(marks, bool):
            raise ValueError("marks 는 참·거짓이어야 합니다")
        label = str(item.get("label", ""))
        col, row = i % cols, i // cols
        ox = pad + col * (slot + gap)
        oy = pad + row * (slot + lab + gap)
        parts.append(_draw_named_shape(kind, ox + (slot - size) / 2, oy, size, marks))
        if label:
            parts.append(_text(ox + slot / 2, oy + size + 12, label, size=13, weight="700"))
    width = pad * 2 + cols * slot + (cols - 1) * gap
    height = pad * 2 + rows * (slot + lab) + (rows - 1) * gap
    return _svg(width, height, "".join(parts))


_RENDER = {
    "numberCards": _number_cards,
    "placeValue": _place_value,
    "base10": _base10,
    "opBox": _op_box,
    "sumBox": _sum_box,
    "opTree": _op_tree,
    "boxChain": _box_chain,
    "columnOp": _column_op,
    "numberLine": _number_line,
    "clocks": _clocks,
    "table": _table,
    "tape": _tape,
    "dotGrid": _dot_grid,
    "boxedList": _boxed_list,
    "pills": _pills,
    "geoLine": _geo_line,
    "anglePick": _angle_pick,
    "timeAdd": _time_add,
    "pointGrid": _point_grid,
    "divideTriangle": _divide_triangle,
    "fracPie": _frac_pie,
    "triRow": _tri_row,
    "trapFour": _trap_four,
    "namedShapes": _named_shapes,
}

# 후반 학년 kind. 이 파일 아래에서 import 해야 _svg 등이 이미 있다.
from elem_advanced import ADV_FIELDS, ADV_OPTIONAL, ADV_RENDER  # noqa: E402

KIND_FIELDS.update(ADV_FIELDS)
OPTIONAL.update(ADV_OPTIONAL)
_RENDER.update(ADV_RENDER)
