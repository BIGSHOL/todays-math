# -*- coding: utf-8 -*-
"""RPM 교재 PDF 한 쪽을 **좌표째로** 읽어 줄을 만든다. 쌓인 분수를 되살린다.

쓰는 쪽: `audit-rpm-solutions.py`(정답책 색인) · 그 색인을 쓰는 모든 도구.

## 왜 필요한가 — 「납작해진 분수」

PDF 텍스트 레이어는 쌓인 분수를 **두 줄로** 담는다. 분수선은 글자가 아니라 **선**이라
텍스트에 안 남는다. 그래서 줄 단위로 읽으면 `cos C= 5 3 이므로` 처럼 나온다 —
원래는 `cos C = 5/AC = √5/3` 이다. 분자와 분모가 뒤섞이고 무엇이 무엇의 분모인지
영영 알 수 없게 된다. 실측: 대응쌍 2,020 중 **227건**이 우리 LaTeX 에는 분수가 있는데
원문에는 분수 표시(`;…;`)가 없다 — 전부 이 부류다.

**선은 벡터로 남아 있다.** `get_drawings()` 로 꺼내 분자·분모를 되찾으면 된다.

## 분수선을 무엇으로 가리나 — 길이가 아니라 **채움비**

같은 굵기(0.3)의 가로선에 세 부류가 섞여 있다(실측, 3-2 정답 57쪽):

| | 길이 | 무엇 |
|---|---:|---|
| 분수선 | 8~90 | `AH` 위 `BH` 아래 |
| 채점 기준표 괘선 | 172.4 | `채점` 위 `AH의` 아래 |
| 좌표축 | 55~61 | `a` 위 `O` 아래 |

길이로는 못 가른다 — 진짜 분수선에 86.8 짜리가 있고 좌표축이 55.4 다.
**가르는 성질은 「선이 제 내용만큼만 길다」**는 것이다. 분수선은 분자·분모 중
넓은 쪽에 맞춰 그어진다(채움비 0.5~1.0). 좌표축 위의 `a` 는 선의 8% 다.

표는 채움비로 안 갈린다(칸 글이 길다). 그건 **세로 괘선이 가로지른다**는 것으로 가른다
— 좌표축도 같이 걸린다(y축이 x축을 가로지른다). 분수선을 가로지르는 세로선은 없다.

## 되살린 것이 맞는지 **원문 밖에서** 잰다

`score-rpm-latex.py` 가 우리 DB 의 **성한** LaTeX 해설과 대 본다. 이 파일이 만든 값을
이 파일이 채점하지 않는다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import pymupdf

#: 가로·세로로 인정하는 기울기. 0.6pt 넘게 기울면 선분이 아니라 도형이다.
FLAT = 0.6
#: 분수선일 수 있는 획 굵기. 굵은 선은 표 괘선·도형이다(실측 0.75·0.8·1.25).
BAR_STROKE_MAX = 0.5
#: 분수선 길이 범위. 너무 짧으면 도형 부스러기, 너무 길면 지면 괘선이다.
BAR_LEN_MIN, BAR_LEN_MAX = 3.0, 220.0
#: 낱말이 선 안에 이만큼 들어와야 그 선의 분자·분모다.
CONTAIN_MIN = 0.8
#: **채움비** — 분자·분모 중 넓은 쪽이 선 길이의 이만큼은 돼야 분수선이다.
#: ⚠️ 이게 가르는 성질이다. 실측 한 자리/한 자리 분수가 0.53, 좌표축이 0.08.
BAR_FILL_MIN = 0.30
#: 분자·분모를 찾아 올라갈 수 있는 세로 거리(중심 기준).
BAR_REACH = 22.0
#: 세로 괘선이 가로선의 끝에서 이만큼 안이면 «표»로 본다.
GRID_TOUCH = 1.5
#: 분자 **위에 또 한 줄**이 선 안에 통째로 들어오면 분수가 아니라 «세로셈»이다.
#: ⚠️ 소인수분해 최소공배수 셈은 가로줄 하나에 위 세 줄·아래 한 줄이라 분수와
#:    생김새가 같다(가운데 정렬·양옆 여백까지). 실측 1-1 #159 가
#:    `\frac{24=2^3×3}{(최소공배수)=…}` 이 됐다. 길이·정렬·채움비로는 못 가른다.
#:    가르는 성질은 **글줄은 분수선보다 넓다**는 것이다 — 분수 위의 글줄은 선 밖으로
#:    삐져나가고, 세로셈의 윗줄들은 선 안에 나란히 들어온다.
BLOCK_REACH = 20.0
#: 같은 줄로 묶는 세로 허용치 — 분자가 여러 낱말일 때 쓴다.
ROW_TOL = 4.0
#: 줄을 묶는 세로 허용치.
LINE_TOL = 5.0
#: 분자·분모의 **가장자리**가 선에서 이만큼 안쪽이어야 한다.
#: ⚠️ 이게 없으면 **밑줄**이 분수선이 된다 — 밑줄 위 낱말이 분자, 다음 줄이 분모가 된다.
#:    채움비로는 못 가른다(밑줄은 낱말 폭에 딱 맞아 채움비가 1.0 이다).
#:    실측 글줄 사이는 5.7pt 이고 진짜 분모는 0.3pt 다.
BAR_EDGE_MAX = 4.5
#: 낱말 사이 이만큼보다 좁으면 붙여 쓴다(원문에 공백이 없던 자리).
GLUE_GAP = 1.2
#: 첨자로 보고 붙일 수 있는 최대 간격과, 첨자라고 볼 최소 높이 차이.
SCRIPT_GAP = 3.0
SCRIPT_SHIFT = 1.5
#: 교재가 정답을 찍는 표시. 풀이 줄 **오른쪽 끝**에 붙어 있어 y 로 묶으면 본문과 한 줄이 된다.
#: 여기서 줄을 끊어야 `book_solution_map` 이 풀이와 답을 가를 수 있다(실측 `답 ×` 가 본문에 붙었다).
ANSWER_TOKEN = "답"


@dataclass
class Tok:
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    dead: bool = False
    #: 줄을 묶을 때 쓸 «보이는 중심». 접은 분수는 상자가 두 줄에 걸쳐 있어
    #: 상자 중심이 아니라 **분수선 자리**가 글줄 높이다.
    cyo: float | None = None

    @property
    def cy(self) -> float:
        return self.cyo if self.cyo is not None else (self.y0 + self.y1) / 2

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2


@dataclass
class Seg:
    x0: float
    x1: float
    y0: float
    y1: float
    stroke: float | None

    @property
    def y(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def length(self) -> float:
        return self.x1 - self.x0


def _segments(page: pymupdf.Page) -> tuple[list[Seg], list[Seg]]:
    """가로선·세로선을 뽑는다. 채운 얇은 사각형도 선으로 본다."""
    hor: list[Seg] = []
    ver: list[Seg] = []
    for d in page.get_drawings():
        sw = d.get("width")
        sw = float(sw) if isinstance(sw, (int, float)) else None
        for it in d["items"]:
            if it[0] == "l":
                p, q = it[1], it[2]
                if abs(p.y - q.y) <= FLAT and abs(p.x - q.x) > FLAT:
                    hor.append(Seg(min(p.x, q.x), max(p.x, q.x), min(p.y, q.y), max(p.y, q.y), sw))
                elif abs(p.x - q.x) <= FLAT and abs(p.y - q.y) > FLAT:
                    ver.append(Seg(min(p.x, q.x), max(p.x, q.x), min(p.y, q.y), max(p.y, q.y), sw))
            elif it[0] == "re":
                r = it[1]
                if r.height <= 1.2 and r.width > FLAT:
                    hor.append(Seg(r.x0, r.x1, r.y0, r.y1, sw))
                elif r.width <= 1.2 and r.height > FLAT:
                    ver.append(Seg(r.x0, r.x1, r.y0, r.y1, sw))
                else:  # 테두리 있는 상자 — 네 변을 모두 괘선으로 센다
                    hor.append(Seg(r.x0, r.x1, r.y0, r.y0, sw))
                    hor.append(Seg(r.x0, r.x1, r.y1, r.y1, sw))
                    ver.append(Seg(r.x0, r.x0, r.y0, r.y1, sw))
                    ver.append(Seg(r.x1, r.x1, r.y0, r.y1, sw))
    return hor, ver


def _gridded(bar: Seg, ver: list[Seg]) -> bool:
    """세로 괘선이 이 가로선에 **닿거나 가로지르나**. 표·좌표축이 여기 걸린다.

    ⚠️ **끝점에 «닿는» 것까지 봐야 한다.** 처음엔 «가로지르는» 것만 봤는데,
       교재의 표는 괘선을 **칸마다 끊어** 긋는다 — 가로 괘선이 칸 폭에서 끝나고
       세로 괘선이 바로 그 끝점에 선다. 그러면 가로지르는 세로선이 하나도 없어
       칸 하나하나가 「분자/분모」로 읽힌다. 실측 3-1 #826 채점 기준표가
       `\frac{\frac{\frac{단계}{1}}{2}}{3}` 이 됐고, **그 옆 풀이 두 줄이 통째로
       사라졌다**(분모로 먹혔다). 표는 못 읽는 데서 그치지 않고 본문을 지운다.
    """
    for v in ver:
        vx = (v.x0 + v.x1) / 2
        if bar.x0 - GRID_TOUCH <= vx <= bar.x1 + GRID_TOUCH and v.y0 - 1.0 <= bar.y <= v.y1 + 1.0:
            return True
    return False


def _row(toks: list[Tok], bar: Seg, above: bool) -> list[Tok]:
    """선 바로 위(또는 아래) 한 줄. **선 안에 들어온 낱말만** 본다."""
    near: list[Tok] = []
    for t in toks:
        if t.dead:
            continue
        ov = min(t.x1, bar.x1) - max(t.x0, bar.x0)
        if ov <= 0 or ov / max(t.x1 - t.x0, 0.1) < CONTAIN_MIN:
            continue
        d = bar.y - t.cy if above else t.cy - bar.y
        if 0 < d <= BAR_REACH:
            near.append(t)
    if not near:
        return []
    anchor = min(near, key=lambda t: abs(bar.y - t.cy))
    row = [t for t in near if abs(t.cy - anchor.cy) <= ROW_TOL]
    edge = (bar.y - max(t.y1 for t in row)) if above else (min(t.y0 for t in row) - bar.y)
    return row if edge <= BAR_EDGE_MAX else []


def _stacked_above(toks: list[Tok], bar: Seg, up: list[Tok]) -> bool:
    """분자 위의 **줄 전체**가 선 안에 들어오나 — 들어오면 세로셈이다.

    ⚠️ 낱말 하나로 재면 안 된다. 글줄에는 선 안에 쏙 들어가는 짧은 낱말이 늘 있다
       (실측: 낱말로 재니 멀쩡한 분수 19개가 같이 죽었다). **줄 전체의 폭**으로 재야
       「글줄은 분수선보다 넓다」가 성립한다.
    """
    top = min(t.y0 for t in up)
    # ⚠️ **선과 가로로 겹치는 것만** 본다. 지면이 두 단이라 그냥 y 로 고르면
    #    옆 단의 줄이 «윗줄»로 잡혀 판정이 통째로 뒤집힌다(실측 1-1 #159: 오른쪽 단의
    #    `∴ a+b+c=…` 이 뽑혀 「선 밖」이 되어 세로셈이 분수로 통과했다).
    prev = [
        t for t in toks
        if not t.dead and t not in up
        and 0 < top - t.cy <= BLOCK_REACH
        and min(t.x1, bar.x1) - max(t.x0, bar.x0) > 0
    ]
    if not prev:
        return False
    anchor = max(prev, key=lambda t: t.cy)
    row = [t for t in prev if abs(t.cy - anchor.cy) <= ROW_TOL]
    return min(t.x0 for t in row) >= bar.x0 - 2.0 and max(t.x1 for t in row) <= bar.x1 + 2.0


def _join(toks: list[Tok]) -> str:
    """낱말을 한 줄로 잇는다. 좁으면 붙이고 넓으면 띄운다.

    ⚠️ **올라가거나 내려간 낱말은 붙인다.** 윗첨자·아래첨자는 따로 조판돼 앞 낱말과
       사이가 벌어지는데, 여기서 띄어 버리면 글자열만 보는 변환기가 그것을 첨자로
       못 읽는다 — 실측 `EHÓ`+`Û` 가 `\\overline{EH} ❷` 가 됐다(`\\overline{EH}^{2}`
       이어야 한다. 137자리). 어느 높이에 있었나는 **여기에만** 남아 있다.
    """
    toks = sorted(toks, key=lambda t: t.x0)
    out = ""
    prev: Tok | None = None
    for t in toks:
        if prev is not None:
            gap = t.x0 - prev.x1
            script = gap < SCRIPT_GAP and abs(t.y1 - prev.y1) >= SCRIPT_SHIFT
            out += "" if gap < GLUE_GAP or script else " "
        out += t.text
        prev = t
    return out


def _fold_fractions(toks: list[Tok], hor: list[Seg], ver: list[Seg]) -> list[Tok]:
    """분수선을 찾아 `분자/분모` 한 덩어리로 접는다. 짧은 선부터 — 안쪽 분수가 먼저다."""
    bars = [
        s for s in hor
        if BAR_LEN_MIN <= s.length <= BAR_LEN_MAX
        and (s.stroke is None or s.stroke <= BAR_STROKE_MAX)
        and not _gridded(s, ver)
    ]
    bars.sort(key=lambda s: s.length)
    made: list[Tok] = []
    for bar in bars:
        pool = toks + made
        up = _row(pool, bar, above=True)
        dn = _row(pool, bar, above=False)
        if not up or not dn:
            continue
        if _stacked_above(pool, bar, up):
            continue  # 세로셈 — 분수가 아니다
        wide = max(
            max(t.x1 for t in up) - min(t.x0 for t in up),
            max(t.x1 for t in dn) - min(t.x0 for t in dn),
        )
        if wide / bar.length < BAR_FILL_MIN:
            continue  # 선이 제 내용보다 훨씬 길다 — 좌표축·괘선이다
        for t in up + dn:
            t.dead = True
        made.append(
            Tok(
                x0=min([bar.x0] + [t.x0 for t in up + dn]),
                y0=min(t.y0 for t in up),
                x1=max([bar.x1] + [t.x1 for t in up + dn]),
                y1=max(t.y1 for t in dn),
                text="\\frac{" + _join(up) + "}{" + _join(dn) + "}",
                cyo=bar.y,
            )
        )
    return [t for t in toks + made if not t.dead]


def _split_answer(line: list[Tok]) -> list[list[Tok]]:
    """`답` 표시 앞에서 줄을 끊는다 — 교재는 풀이 오른쪽 끝에 답을 찍는다."""
    line = sorted(line, key=lambda t: t.x0)
    cut = [i for i, t in enumerate(line) if i > 0 and t.text == ANSWER_TOKEN]
    if not cut:
        return [line]
    out, prev = [], 0
    for i in cut:
        out.append(line[prev:i])
        prev = i
    out.append(line[prev:])
    return [g for g in out if g]


def page_lines(page: pymupdf.Page, columns: int = 2) -> list[tuple[int, float, float, str]]:
    """한 쪽을 (단, y, x, 글) 줄 목록으로.

    ⚠️ **단을 먼저 가르고 줄을 묶는다.** 순서가 뒤바뀌면 왼쪽 단과 오른쪽 단의
       같은 높이 줄이 한 줄로 이어 붙는다.
    """
    toks = [Tok(w[0], w[1], w[2], w[3], w[4]) for w in page.get_text("words") if w[4].strip()]
    hor, ver = _segments(page)
    toks = _fold_fractions(toks, hor, ver)

    mid = page.rect.width / 2
    out: list[tuple[int, float, float, str]] = []
    groups = {0: [], 1: []} if columns == 2 else {0: []}
    for t in toks:
        groups[1 if (columns == 2 and t.x0 >= mid) else 0].append(t)
    for col, items in groups.items():
        items.sort(key=lambda t: (t.cy, t.x0))
        lines: list[list[Tok]] = []
        for t in items:
            if lines and abs(t.cy - (sum(u.cy for u in lines[-1]) / len(lines[-1]))) <= LINE_TOL:
                lines[-1].append(t)
            else:
                lines.append([t])
        for ln in lines:
          for seg in _split_answer(ln):
            txt = _join(seg)
            if txt.strip():
                # ⚠️ 줄의 y 는 **보이는 중심**의 평균이다. 상자 위끝(`y0`)을 쓰면
                #    분수가 든 줄이 분자 높이로 올라가 **줄 차례가 뒤바뀐다**.
                out.append((col, sum(t.cy for t in seg) / len(seg), min(t.x0 for t in seg), txt))
    out.sort(key=lambda r: (r[0], r[1], r[2]))
    return out
