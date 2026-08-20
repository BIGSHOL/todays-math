# -*- coding: utf-8 -*-
"""RPM 「교과서문제」 지면의 **무리 그림**을 찾아 소문항마다 좌표를 만든다.

    python scripts/figure/plan-rpm-group-figures.py            # 재 보기만
    python scripts/figure/plan-rpm-group-figures.py --emit     # 계획으로 쓴다

입력
  `scripts/qa/reports/rpm-crop-plan.json`        대상(그림 유실 RPM) + 날 좌표
  `scripts/qa/reports/rpm-crop-plan-gated.json`  책별 쪽 오프셋·(dx,dy) — 관문이 잰 값
  `scripts/qa/reports/rpm-question-boxes.json`   같은 쪽 **모든** 문항 상자 + 인쇄번호
  `.rpm-src/<책>.pdf`
산출
  `scripts/qa/reports/rpm-group-crop-plan.json`  (`--emit`) — `crop-rpm-from-pdf.py` 가 먹는 형식
  `scripts/qa/reports/rpm-group-plan-report.json` 사유별 분해(왜 못 했나까지)

## 왜 이 길인가 — 상자 안에 그림이 없다

남은 362행의 `source_coords` 는 폭 중앙값 156pt · **높이 중앙값 30pt** 다. 한 줄이다.
교과서문제 지면은 이렇게 생겼다:

    [0004~0006] 오른쪽 그림과 같은 삼각뿔       ◁ 무리 발문(모든 소문항이 공유)
     에 대하여 다음을 구하시오.                     ▧ 그림 ◁ 여기 있다
    0004  면의 개수     ◁ source_coords 는 이 한 줄만 담는다
    0005  교점의 개수
    0006  교선의 개수

그림은 **어느 소문항의 상자에도 안 들어 있다.** 그래서 관문(상자 글자 ↔ DB 본문)이
0.85 를 못 넘고, 넘겼더라도 오려낼 것이 상자 안에 없다. 판정 불가이지 오답이 아니다
(문서 16 §4.1).

## 무리는 **책이 스스로 적어 둔다**

지면에 `[0004~0006]` 이 인쇄돼 있고 PDF 글자층에 그대로 있다. 무리 범위를 추측하지
않고 **그 표시를 읽는다.** 그 다음 무리가 차지한 띠(머리글 위끝 ~ 다음 머리글 위끝,
가로는 그 단) 안에서 그림 덩어리를 찾는다.

## 한 무리에 그림이 하나가 아닐 수 있다 — 세어서 가른다

`[0009~0011]` 처럼 **소문항마다 그림이 따로**인 무리가 있다(3-2 p12 실측).
띠를 통째로 주면 세 그림이 한 장으로 붙어 셋 다 틀린다. 그래서

  · 덩어리 1개                → 무리가 함께 쓰는 그림. 전원에게 같은 좌표.
  · 덩어리 수 == 소문항 수    → 소문항마다 하나. **세로 차례가 맞을 때만** 짝짓는다.
  · 그 밖(2개인데 3문항 등)   → **판정 불가로 버린다.** 애매하면 안 붙인다.

## 지키는 것

- 이 스크립트는 **좌표만** 만든다. 오려내기·검사는 `crop-rpm-from-pdf.py` 가 한다
  (발문 침입·문장·선택지 번호·옆 문항 침입·완비 검사). 규칙을 여기 다시 쓰면
  두 곳이 갈라지고, 갈라지면 같이 눈이 먼다.
- 못 한 것은 **사유와 함께** 리포트에 남긴다. 숫자만 줄어드는 침묵을 만들지 않는다.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PLAN = pathlib.Path("scripts/qa/reports/rpm-crop-plan.json")
GATED = pathlib.Path("scripts/qa/reports/rpm-crop-plan-gated.json")
BOXES = pathlib.Path("scripts/qa/reports/rpm-question-boxes.json")
CONTENT = pathlib.Path("scripts/qa/reports/rpm-crop-content.json")
OUT = pathlib.Path("scripts/qa/reports/rpm-group-crop-plan.json")
REPORT = pathlib.Path("scripts/qa/reports/rpm-group-plan-report.json")
SRC = pathlib.Path(".rpm-src")

#: 지면의 무리 표시 — `[0004~0006]`. 물결은 `~`(U+007E)·`∼`(U+223C) 둘 다 나온다.
GROUP_RE = re.compile(r"\[\s*(\d{3,4})\s*[~∼〜－-]\s*(\d{3,4})\s*\]")
#: 소단원 머리띠 표시 — `01-1`, `05- 2`. **띠의 아래끝을 여기서 끊는다.**
#: 안 끊으면 다음 소단원의 **초록 머리띠가 그림 덩어리로 잡힌다** — 실측으로
#: `[0014~0017]`(수직선 그림)이 「01-3 두 점 사이의 거리」 머리띠로 오려졌다.
#: 진짜 그림(선 굵기 2.5pt)은 크기 검사에서 떨어지고 장식만 남아, **아무 검사도
#: 안 걸리는 조용한 오답**이 된다.
SECTION_RE = re.compile(r"^\s*\d{2}\s*-\s*\d\s*$")
#: 단(段) 가름 — 같은 쪽의 머리글 x0 가 두 값으로 갈린다. 그 사이 여백.
COLUMN_GAP_PT = 24.0
#: 조각이 이만큼(pt) 넘게 떨어져 있으면 다른 그림이다. `crop-rpm-from-pdf.py` 와 같은 값.
CLUSTER_GAP = 12.0
#: 이보다 작은 조각은 그림이 아니라 잡티(점 하나·밑줄 토막).
MIN_PART_PT = 3.0
#: 덩어리가 이보다 작으면 그림으로 안 본다. **라벨을 되찾은 뒤에** 잰다 —
#: 수직선 그림은 획만 보면 높이가 2.5pt 뿐이라, 먼저 재면 진짜 그림이 떨어지고
#: 머리띠 장식만 남는다(실측 `[0014~0017]`).
MIN_FIG_W, MIN_FIG_H = 24.0, 10.0
#: 그림에 딸린 라벨을 되찾을 때 허용하는 간격(pt). `crop-rpm-from-pdf.py` 와 같은 값 —
#: 두 곳이 갈라지면 계획이 뺀 것을 오려내기가 도로 넣거나 그 반대가 된다.
LABEL_GAP = 4.0
#: 한 축이 겹친(나란한) 라벨은 이만큼까지 본다. `crop-rpm-from-pdf.py` 의 SIDE_GAP 과 같은 값.
SIDE_GAP = 8.0
#: 라벨 모양 — 한글이 없고 이보다 짧은 낱말. 문장은 여기 안 걸린다.
LABEL_TOKEN_MAX = 6
HANGUL = re.compile(r"[가-힣]")
LABEL_ROUNDS = 4
#: 쪽을 이만큼 덮는 요소는 배경·워터마크다.
PAGE_FURNITURE = 0.7
#: 요소가 **글자 한 줄**에 이만큼 잠겨 있으면 그림이 아니라 줄 안의 부속이다
#: (답을 넣는 □, 분수 가로줄). 「문항 상자 안에 있으면 버린다」로 했더니
#: **문항 상자가 제 그림을 담고 있는 배치**(실측 1-2 p121 `0802`)에서 진짜 그림이
#: 통째로 사라졌다 — 그러면 옆 문항 그림이 «무리 공용»으로 잘못 배정된다.
IN_LINE = 0.8
#: 무리 띠의 아래끝을 다음 머리글 바로 위까지 둔다 — 그 사이 여백.
BAND_BOTTOM_PAD = 4.0
#: 소문항마다 그림인 무리에서, 덩어리 세로 중심이 그 소문항 몫 안에 있어야 한다.
ITEM_SPAN_PAD = 12.0
#: 오려내기가 상자 밖으로 자라날 수 있는 거리. `crop-rpm-from-pdf.py` 의 BOX_BLEED 와 같은 값 —
#: 그 안에 있는 발문 낱말은 «삼켜질 수 있는 것»이므로 미리 막아 넘긴다.
BOX_BLEED = 60.0
#: 낱말의 한글+숫자가 DB 본문에 이만큼 이어서 들어 있으면 **발문 조각**이다 —
#: 그림 라벨(`A` `16 cm`)은 본문에 안 나온다. `crop-rpm-from-pdf.py` 와 같은 값·같은 열쇠.
STEM_SPAN_CHARS = 3
#: 문장 부호가 앞 낱말에 이만큼 붙어 있으면 그 문장의 일부다.
PUNCT_GAP = 2.0
KEEP_KO = re.compile(r"[가-힣0-9]+")


def key(text: str) -> str:
    """훼손되지 않는 부분만 남긴다 — 한글과 숫자. 관문·오려내기와 같은 열쇠."""
    return "".join(KEEP_KO.findall(text))


def longest_run(a: str, b: str) -> int:
    """두 문자열의 가장 긴 공통 부분열 길이."""
    if not a or not b:
        return 0
    return SequenceMatcher(None, a, b).find_longest_match(0, len(a), 0, len(b)).size


def load(p: pathlib.Path):
    return json.loads(p.read_text(encoding="utf-8"))


class Page:
    """한 쪽의 글자 줄·그림 조각을 한 번만 읽어 둔다."""

    def __init__(self, page: pymupdf.Page):
        self.page = page
        self.rect = page.rect
        raw = page.get_text("rawdict")
        self.lines: list[tuple[pymupdf.Rect, str]] = []
        #: 낱말(span) 단위. 라벨 되찾기는 **줄이 아니라 span 으로** 본다 —
        #: RPM 은 발문 마지막 줄과 그림이 같은 높이에 있어서, 줄로 삼키면
        #: 「물음에 답하시오.」가 그림에 딸려 온다(실측 2-2 p31 4건).
        self.spans: list[tuple[pymupdf.Rect, str]] = []
        self.parts: list[pymupdf.Rect] = []
        images: list[pymupdf.Rect] = []
        area = self.rect.get_area()
        for b in raw.get("blocks", []):
            r = pymupdf.Rect(*b["bbox"])
            if b.get("type") != 0:
                if not r.is_empty and r.get_area() < area * PAGE_FURNITURE:
                    images.append(r)
                continue
            for ln in b.get("lines", []):
                txt = ""
                # **줄 bbox 는 꼬리 공백까지 담는다.** 그대로 쓰면 번호 배지
                # `0003 ` 의 상자가 옆 글자(꼭짓점 이름 `C`)를 63% 덮어, 배지를 막는
                # 규칙이 **그 라벨을 같이 버린다** — 실측 2-2 p9 에서 꼭짓점 하나가
                # 통째로 잘렸다. 글자 상자만 모아 **바짝 조인 사각형**을 쓴다.
                tight: pymupdf.Rect | None = None
                for sp in ln.get("spans", []):
                    stight: pymupdf.Rect | None = None
                    stxt = ""
                    for c in sp.get("chars", []):
                        ch = c.get("c", "")
                        txt += ch
                        stxt += ch
                        if not ch.strip():
                            continue
                        cr = pymupdf.Rect(*c["bbox"])
                        tight = cr if tight is None else (tight | cr)
                        stight = cr if stight is None else (stight | cr)
                    if stight is not None:
                        self.spans.append((stight, stxt))
                if tight is None:
                    continue
                self.lines.append((tight, txt))
        cands = list(images)
        for d in page.get_drawings():
            r = pymupdf.Rect(d["rect"])
            if r.is_empty or r.is_infinite or r.get_area() >= area * PAGE_FURNITURE:
                continue
            if r.width < MIN_PART_PT and r.height < MIN_PART_PT:
                continue
            cands.append(r)
        self.parts = [r for r in cands if not self._inline(r)]

    def _inline(self, r: pymupdf.Rect) -> bool:
        """**글자 한 줄**에 거의 잠긴 것은 그림이 아니라 줄 안의 부속이다.

        답을 넣는 □(실측 12×13pt)와 분수 가로줄이 여기 걸린다. 줄이 아니라
        **블록**으로 재면 문항 문단 전체가 기준이 되어 그림까지 삼킨다.
        """
        for t, _txt in self.lines:
            inter = r & t
            if not inter.is_empty and inter.get_area() >= r.get_area() * IN_LINE:
                return True
        return False

    def groups(self) -> list[dict]:
        """지면이 인쇄해 둔 `[0004~0006]` 표시를 그대로 읽는다."""
        out = []
        for r, txt in self.lines:
            m = GROUP_RE.search(txt)
            if not m:
                continue
            out.append({"lo": int(m.group(1)), "hi": int(m.group(2)), "rect": r})
        return out

    def sections(self) -> list[pymupdf.Rect]:
        """소단원 머리띠(`01-3`)의 자리. 무리 띠는 여기서 끊긴다."""
        return [r for r, txt in self.lines if SECTION_RE.match(txt)]

    def is_stem_span(self, r: pymupdf.Rect, txt: str, stem_key: str) -> bool:
        """이 낱말이 **발문 조각**인가. 발문은 DB 본문에 있고 그림 라벨은 없다.

        ⚠️ 문장 끝의 마침표는 그 자체로는 본문에 안 걸린다(열쇠가 빈 문자열이다).
        그런데 그것을 라벨로 삼키면 상자가 발문 줄에 걸치고, 오려내기의 완비 검사가
        **그 줄을 통째로** 삼킨다 — 실측 「물음에 답하시오.」 4건이 그렇게 지면에 박혔다.
        그래서 **글자·숫자가 하나도 없는 낱말**은, 같은 줄의 발문 낱말에 붙어 있으면
        발문의 일부로 본다(간격 2pt — 같은 문장 안 낱말 사이는 붙어 있다).
        """
        k = key(txt)
        if len(k) >= STEM_SPAN_CHARS and longest_run(k, stem_key) >= STEM_SPAN_CHARS:
            return True
        if any(ch.isalnum() for ch in txt):
            return False
        for r2, t2 in self.spans:
            if abs(r2.y0 - r.y0) > 3 or r2 is r:
                continue
            k2 = key(t2)
            if len(k2) < STEM_SPAN_CHARS or longest_run(k2, stem_key) < STEM_SPAN_CHARS:
                continue
            if max(r.x0 - r2.x1, r2.x0 - r.x1, 0) <= PUNCT_GAP:
                return True
        return False

    def grow_labels(
        self, box: pymupdf.Rect, badges: list[pymupdf.Rect], stem_key: str = ""
    ) -> pymupdf.Rect:
        """그림 덩어리에 **닿는 글자**(꼭짓점 이름·치수)를 되찾는다.

        획만 보면 수직선 그림은 높이가 2.5pt 뿐이라 크기 검사에서 떨어진다.
        라벨을 붙이고 나서 재야 그림과 잡티가 갈린다.

        **가르는 열쇠는 `crop-rpm-from-pdf.py` 와 같다** — 발문은 DB 본문에 있고
        그림 라벨은 없다. 여기서 그 규칙을 안 쓰면 계획이 발문을 삼킨 상자를 내놓고,
        오려내기의 완비 검사가 그 발문 줄을 **끝까지 삼켜** 지면 글자가 그림에 박힌다
        (실측 「물음에 답하시오.」 4건).
        """
        out = pymupdf.Rect(box)
        blocked = {(s.x0, s.y0, s.x1, s.y1) for s in badges}
        for _ in range(LABEL_ROUNDS):
            grew = False
            for r, txt in self.spans:
                if out.contains(r):
                    continue
                if any(
                    not (r & b).is_empty and (r & b).get_area() >= r.get_area() * 0.8
                    for b in badges
                ) or (r.x0, r.y0, r.x1, r.y1) in blocked:
                    continue
                if self.is_stem_span(r, txt, stem_key):
                    continue
                vgap = max(out.y0 - r.y1, r.y0 - out.y1, 0)
                hgap = max(out.x0 - r.x1, r.x0 - out.x1, 0)
                # 나란히 놓인 **라벨 모양**(한글 없는 짧은 낱말)만 멀리까지 본다.
                t = txt.strip()
                label_shaped = 0 < len(t) <= LABEL_TOKEN_MAX and not HANGUL.search(t)
                aligned = label_shaped and (
                    (vgap == 0 and hgap <= SIDE_GAP)
                    or (hgap == 0 and vgap <= SIDE_GAP)
                )
                if aligned or (vgap <= LABEL_GAP and hgap <= LABEL_GAP):
                    out |= r
                    grew = True
            if not grew:
                break
        return out

    def columns(self) -> list[tuple[float, float]]:
        """단의 좌우 경계. 머리글 x0 가 단의 왼끝이고, 오른끝은 다음 단 왼끝 앞이다."""
        lefts = sorted({round(g["rect"].x0, 1) for g in self.groups()})
        merged: list[float] = []
        for x in lefts:
            if not merged or x - merged[-1] > COLUMN_GAP_PT:
                merged.append(x)
        if not merged:
            return []
        cols = []
        for i, x in enumerate(merged):
            if i + 1 < len(merged):
                right = merged[i + 1] - COLUMN_GAP_PT
            elif len(merged) > 1:
                # 마지막 단의 오른끝은 **앞 단과 폭이 같다**고 본다(쪽 끝까지 잡으면
                # 옆 쪽 여백의 쪽 장식·날개가 딸려 온다).
                right = x + (merged[1] - merged[0] - COLUMN_GAP_PT)
            else:
                right = self.rect.x1
            cols.append((x, right))
        return cols


def clusters(
    parts: list[pymupdf.Rect], axis: str = "y", gap: float = CLUSTER_GAP
) -> list[pymupdf.Rect]:
    """한 축으로 투영해 **떨어진 것끼리** 가른다.

    한 그림의 조각(액자 3장·성냥개비 5단계)은 서로 붙어 있고, 다른 그림은 떨어져 있다.
    축은 **소문항이 어떻게 놓였는지**로 정한다 — 세로로 늘어선 무리는 세로로,
    가로로 나란한 무리는 가로로 갈라야 한다. 두 축을 다 쓰면 여러 조각으로 이뤄진
    한 그림(실측 `[0026]` 의 ∠XOY 와 ∠PQ 두 장)이 쪼개진다.
    """
    if not parts:
        return []
    lo0 = (lambda r: r.y0) if axis == "y" else (lambda r: r.x0)
    hi0 = (lambda r: r.y1) if axis == "y" else (lambda r: r.x1)
    lo = min(lo0(r) for r in parts)
    hi = max(hi0(r) for r in parts)
    n = max(1, int(hi - lo) + 2)
    filled = bytearray(n)
    for r in parts:
        for i in range(max(0, int(lo0(r) - lo)), min(n, int(hi0(r) - lo) + 1)):
            filled[i] = 1
    runs: list[tuple[float, float]] = []
    i = 0
    while i < n:
        if not filled[i]:
            i += 1
            continue
        j = i
        g = 0
        while j + 1 < n:
            if filled[j + 1]:
                g = 0
            else:
                g += 1
                if g > gap:
                    break
            j += 1
        runs.append((lo + i, lo + j - min(g, int(gap))))
        i = j + 1
    out = []
    for run in runs:
        got = [r for r in parts if run[0] <= (lo0(r) + hi0(r)) / 2 <= run[1]]
        if not got:
            continue
        box = got[0]
        for r in got[1:]:
            box |= r
        out.append(box)
    return out


def guard_boxes(
    pg: "Page",
    rect: pymupdf.Rect,
    badges: list[pymupdf.Rect],
    stem_key: str,
) -> tuple[list[list[float]], list[list[float]]]:
    """오려내기에게 넘길 **삼키지 말 것**(`avoid`)과 **들어오면 버릴 것**(`forbid`).

    ⑴ `avoid` — 번호 배지 + 둘레의 발문 낱말. 안 막으면 `crop-rpm-from-pdf.py` 의
       라벨 되찾기가 도로 넣고, 완비 검사가 「상자에 걸친 발문 줄」을 통째로 삼킨다.
    ⑵ `forbid` — 번호 배지 + **한글이 든** 발문 낱말만. ⚠️ 「본문에 있으면 발문」
       규칙은 각도값에서 거꾸로 걸린다 — 추출기가 그림의 `105°` 를 본문에 같이 넣어
       두어서 그림 라벨이 «발문»으로 잡히고, 그것을 버리는 근거로 쓰면 멀쩡한 그림이
       통째로 버려진다(실측 다각형 3건). 버릴 근거는 «지면 문장»이고 문장엔 한글이 있다.

    **한 곳에만 둔다** — 계획을 만드는 자리가 셋(자기 상자·무리·검수 시트)이라
    각자 쓰면 셋이 갈라지고, 갈라지면 같이 눈이 먼다.
    """
    near = pymupdf.Rect(
        rect.x0 - BOX_BLEED, rect.y0 - BOX_BLEED,
        rect.x1 + BOX_BLEED, rect.y1 + BOX_BLEED,
    ) & pg.rect
    avoid = badges + [
        sr
        for sr, stxt in pg.spans
        if not (sr & near).is_empty and pg.is_stem_span(sr, stxt, stem_key)
    ]
    forbid = badges + [
        sr
        for sr, stxt in pg.spans
        if not (sr & near).is_empty
        and HANGUL.search(stxt)
        and pg.is_stem_span(sr, stxt, stem_key)
    ]
    return (
        [[b.x0, b.y0, b.x1, b.y1] for b in avoid],
        [[b.x0, b.y0, b.x1, b.y1] for b in forbid],
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--emit", action="store_true")
    ap.add_argument("--src", default=str(SRC))
    ap.add_argument("--only-book")
    ap.add_argument(
        "--retry-failed",
        help="자기 상자로 오리다 실패한 행도 대상에 넣는다 (crop 결과 JSON 경로)",
    )
    a = ap.parse_args()

    plan = load(PLAN)["목록"]
    gated = load(GATED)
    passed = {r["externalId"] for r in gated["목록"]}
    page_off = {b["책"]: int(b.get("쪽오프셋", 0)) for b in gated["책"] if "쪽오프셋" in b}
    shift = {b["책"]: (float(b.get("dx", 0)), float(b.get("dy", 0))) for b in gated["책"] if "dx" in b}
    boxes_all = load(BOXES)
    content = load(CONTENT) if CONTENT.exists() else {}
    if not content:
        raise SystemExit(
            f"DB 본문이 없다({CONTENT}) — 발문을 못 가른다.\n"
            "먼저 돌려라: npx tsx scripts/qa/dump-rpm-content.ts"
        )

    # 관문을 이미 통과한 행은 기본적으로 손대지 않는다 — 그쪽은 자기 상자로 오린다.
    # 다만 **자기 상자로 오리다 실패한 행**은 여기서 다시 본다. 「문항 안에서 그림을
    # 못 찾았다」는 그림이 상자 밖(무리 띠)에 있다는 뜻일 수 있다.
    retry: set[str] = set()
    if a.retry_failed:
        got = load(pathlib.Path(a.retry_failed))
        retry = {f["externalId"] for f in got.get("실패", [])}
        done = {s["problemId"] for s in got.get("성공", [])}
        print(f"자기 상자로 오리다 실패한 {len(retry)}행을 다시 본다 (성공 {len(done)}행은 제외)")
    targets = [
        r for r in plan if r["externalId"] not in passed or r["externalId"] in retry
    ]
    if a.only_book:
        targets = [r for r in targets if pathlib.Path(r["pdf"]).name == a.only_book]
    print(f"관문 탈락 {len(targets)}행 — 무리 그림을 찾는다")

    by_page: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for r in targets:
        by_page[(pathlib.Path(r["pdf"]).name, int(r["page"]))].append(r)

    emitted: list[dict] = []
    reasons: Counter[str] = Counter()
    detail: list[dict] = []
    docs: dict[str, pymupdf.Document] = {}

    def fail(row: dict, why: str, extra: dict | None = None) -> None:
        reasons[why] += 1
        detail.append({"externalId": row["externalId"], "이유": why, **(extra or {})})

    try:
        for (book, db_page), rows in sorted(by_page.items()):
            pdf = pathlib.Path(a.src) / book
            if not pdf.exists():
                for r in rows:
                    fail(r, "원본 PDF 없음")
                continue
            if book not in page_off:
                for r in rows:
                    fail(r, "책의 쪽 오프셋을 모른다 (관문을 먼저 돌려라)")
                continue
            if book not in docs:
                docs[book] = pymupdf.open(pdf)
            doc = docs[book]
            pi = db_page + page_off[book] - 1
            if not (0 <= pi < doc.page_count):
                for r in rows:
                    fail(r, "쪽 범위 밖")
                continue
            dx, dy = shift.get(book, (0.0, 0.0))
            if dx or dy:
                # 이 계획의 좌표는 지면에서 직접 잰 것이라 (dx,dy) 를 쓸 자리가 없다.
                # 0 이 아닌 책이 들어오면 **가정이 깨진 것**이므로 조용히 넘기지 않는다.
                for r in rows:
                    fail(r, f"책에 좌표 보정이 걸려 있다 (dx={dx} dy={dy})")
                continue
            pg = Page(doc[pi])
            groups = pg.groups()
            cols = pg.columns()
            page_boxes = boxes_all.get(book, {}).get(str(db_page), [])
            printed_of = {b["id"]: b.get("printed") for b in page_boxes}
            #: 이 쪽에 인쇄된 문항 번호 — 라벨 되찾기가 **번호 배지를 삼키지 못하게** 막는다.
            printed_on_page = {
                str(b["printed"]).strip() for b in page_boxes if b.get("printed")
            }

            fig_of = {
                b["id"]: b["figureBoxes"] for b in page_boxes if b.get("figureBoxes")
            }

            for row in rows:
                stem_key = key(content.get(row["problemId"], ""))
                # ── 추출기가 **그림 사각형을 적어 둔** 문항 ──────────────────
                # `source_ref.figureBoxes` 다. 지면 구조를 보고 짐작하는 것보다
                # 강한 근거이므로 있으면 그것을 먼저 쓴다. 여럿이면 «보기가 그림»인
                # 문항이라 이 트랙이 아니다(문서 16 §5) — 손대지 않는다.
                mineboxes = fig_of.get(row["externalId"], [])
                if len(mineboxes) == 1:
                    rect = pymupdf.Rect(*mineboxes[0]) & pg.rect
                    if rect.width < MIN_FIG_W or rect.height < MIN_FIG_H:
                        fail(row, "추출기가 적은 그림 사각형이 너무 작다")
                        continue
                    badges = [
                        r
                        for r, txt in pg.lines
                        if txt.strip() in printed_on_page
                    ]
                    avoid, forbid = guard_boxes(pg, rect, badges, stem_key)
                    emitted.append(
                        {
                            "problemId": row["problemId"],
                            "externalId": row["externalId"],
                            "pdf": row["pdf"],
                            "page": db_page + page_off[book],
                            "rect": [rect.x0, rect.y0, rect.x1, rect.y1],
                            "avoid": avoid,
                            "forbid": forbid,
                            "out": row["out"],
                            "무리": "-",
                            "짝짓기": "추출기기록",
                            "덩어리": 1,
                            "소문항": 1,
                            "pageOff": page_off[book],
                        }
                    )
                    continue

                printed = printed_of.get(row["externalId"])
                if printed is None or not str(printed).strip().isdigit():
                    fail(row, "인쇄번호를 모른다")
                    continue
                num = int(str(printed).strip())
                mine = [g for g in groups if g["lo"] <= num <= g["hi"]]
                if len(mine) != 1:
                    fail(row, "무리 표시를 못 찾았다" if not mine else "무리 표시가 둘 이상")
                    continue
                grp = mine[0]
                col = next(
                    (c for c in cols if c[0] - 1 <= grp["rect"].x0 <= c[1]), None
                )
                if col is None:
                    fail(row, "단을 못 갈랐다")
                    continue

                # 띠 — 머리글 위끝부터 «같은 단 다음 머리글» 바로 위까지.
                # **소단원 머리띠도 끊는 자리다** — 안 끊으면 초록 띠가 그림으로 잡힌다.
                below = [
                    g["rect"].y0
                    for g in groups
                    if col[0] - 1 <= g["rect"].x0 <= col[1] and g["rect"].y0 > grp["rect"].y0
                ] + [
                    s.y0
                    for s in pg.sections()
                    if col[0] - 40 <= s.x0 <= col[1] and s.y0 > grp["rect"].y0
                ]
                band = pymupdf.Rect(
                    col[0],
                    grp["rect"].y0 - 2,
                    col[1],
                    (min(below) - BAND_BOTTOM_PAD) if below else pg.rect.y1,
                ) & pg.rect

                # 무리에 속한 문항 상자 — 세로 차례를 정할 근거.
                members = sorted(
                    (
                        b
                        for b in page_boxes
                        if str(b.get("printed") or "").strip().isdigit()
                        and grp["lo"] <= int(str(b["printed"]).strip()) <= grp["hi"]
                    ),
                    key=lambda b: (b["rect"][1], b["rect"][0]),
                )
                if not members:
                    fail(row, "무리의 문항 상자가 없다")
                    continue

                # ── 띠 안의 잉크 조각·번호 배지 ─────────────────────────
                # **축과 무관한 값이라 축 결정 앞에서 한 번만 잰다.** 격자 배치라
                # 축을 못 정해도 이 둘은 있어야 한다 — 검수 시트가 그것을 보여 준다.
                parts = [
                    r
                    for r in pg.parts
                    if not (r & band).is_empty
                    and (r & band).get_area() >= r.get_area() * 0.5
                ]
                # 라벨을 먼저 되찾고 **그 다음에** 크기를 잰다 (MIN_FIG_H 주석 참조).
                # **문항 번호 배지는 절대 라벨이 아니다** — 실측 `0803` 이 원뿔에
                # 0pt 로 붙어 있어 그대로 오려졌다. 지면이 인쇄한 번호를 근거로 막는다.
                badges = [
                    r
                    for r, txt in pg.lines
                    if txt.strip() in printed_on_page and not (r & band).is_empty
                ]

                def blobs(ax: str) -> list[pymupdf.Rect]:
                    grown = [
                        pg.grow_labels(c, badges, stem_key) & band
                        for c in clusters(parts, ax)
                    ]
                    return [
                        c
                        for c in grown
                        if c.width >= MIN_FIG_W and c.height >= MIN_FIG_H
                    ]

                def geom(ax: str | None) -> dict:
                    """**검수 시트가 볼 것** — 못 가른 무리의 띠·덩어리·소문항 자리.

                    자동으로 못 짝지은 것을 사람이 보고 정할 수 있게, 사유만이 아니라
                    **무엇을 보고 못 정했는지**를 좌표째로 남긴다. 규칙을 시트에 다시
                    쓰지 않기 위한 것이다 — 찾는 쪽은 여기 하나뿐이다.
                    """
                    out = {
                        "책": book,
                        "쪽": db_page + page_off[book],
                        "무리": f"{grp['lo']:04d}~{grp['hi']:04d}",
                        "띠": [band.x0, band.y0, band.x1, band.y1],
                        "소문항": [
                            {
                                "id": m["id"],
                                "인쇄번호": str(m.get("printed") or ""),
                                "상자": list(m["rect"]),
                                "나": m["id"] == row["externalId"],
                            }
                            for m in members
                        ],
                    }
                    for a2 in (["y", "x"] if ax is None else [ax]):
                        out[f"덩어리{a2}"] = [
                            [c.x0, c.y0, c.x1, c.y1] for c in blobs(a2)
                        ]
                    return out

                # **가르는 축은 소문항이 어떻게 놓였는지가 정한다.**
                # 세로로 늘어선 무리는 세로로, 가로로 나란한 무리(실측 1-2 p121
                # `0802/0803`)는 가로로 갈라야 한다. 축을 하나로 고정하면 나란한
                # 두 그림이 한 덩어리가 되어 둘 다 틀린 그림을 받는다.
                # 두 축 다 겹치는 «격자» 배치는 못 가르므로 손대지 않는다.
                yov = any(
                    a["rect"][3] > b["rect"][1] + 4 and b["rect"][3] > a["rect"][1] + 4
                    for i, a in enumerate(members)
                    for b in members[i + 1 :]
                )
                xov = any(
                    a["rect"][2] > b["rect"][0] + 4 and b["rect"][2] > a["rect"][0] + 4
                    for i, a in enumerate(members)
                    for b in members[i + 1 :]
                )
                if len(members) == 1:
                    axis = "y"
                elif yov and xov:
                    fail(
                        row,
                        "소문항이 격자로 놓인 무리 — 한 축으로 못 가른다",
                        geom(None),
                    )
                    continue
                elif yov:
                    axis = "x"
                else:
                    axis = "y"
                # 소문항 차례도 **그 축으로** 다시 세운다 — 나란한 무리를 세로로
                # 정렬하면 몇 pt 차이로 순서가 뒤집힌다.
                members.sort(
                    key=(lambda b: (b["rect"][1], b["rect"][0]))
                    if axis == "y"
                    else (lambda b: (b["rect"][0], b["rect"][1]))
                )

                cl = blobs(axis)
                if not cl:
                    fail(row, "띠 안에서 그림 덩어리를 못 찾았다", geom(axis))
                    continue

                if len(cl) == 1:
                    rect, how = cl[0], "무리공용"
                elif len(cl) == len(members):
                    idx = next(
                        (i for i, m in enumerate(members) if m["id"] == row["externalId"]),
                        None,
                    )
                    if idx is None:
                        fail(row, "무리 안에서 제 자리를 못 찾았다")
                        continue
                    along = (lambda c: c.y0) if axis == "y" else (lambda c: c.x0)
                    cl_sorted = sorted(cl, key=along)
                    mine_rect = pymupdf.Rect(*members[idx]["rect"])
                    c = cl_sorted[idx]
                    # 차례가 맞는지 **확인한다** — 개수가 같다는 것만으로는 짝이 아니다.
                    # 그 소문항의 상자와 같은 줄(또는 같은 칸)에 있어야 한다.
                    lo, hi = (
                        (mine_rect.y0, mine_rect.y1)
                        if axis == "y"
                        else (mine_rect.x0, mine_rect.x1)
                    )
                    mid = (along(c) + (c.y1 if axis == "y" else c.x1)) / 2
                    if not (lo - ITEM_SPAN_PAD - 40 <= mid <= hi + ITEM_SPAN_PAD + 40):
                        fail(
                            row,
                            "덩어리 수는 맞는데 차례가 안 맞는다",
                            {"덩어리": len(cl), "문항": len(members), "축": axis,
                             **geom(axis)},
                        )
                        continue
                    rect, how = c, "소문항별"
                else:
                    fail(
                        row,
                        "덩어리 수와 소문항 수가 다르다",
                        {"덩어리": len(cl), "문항": len(members), "축": axis,
                         **geom(axis)},
                    )
                    continue

                avoid, forbid = guard_boxes(pg, rect, badges, stem_key)
                emitted.append(
                    {
                        "problemId": row["problemId"],
                        "externalId": row["externalId"],
                        "pdf": row["pdf"],
                        "page": db_page + page_off[book],
                        # 좌표는 **PDF 지면에서 직접 잰 것**이라 관문의 (dx,dy) 를 다시
                        # 더하지 않는다. 그 값은 sumaek 좌표를 지면에 맞출 때 쓰는 것이고,
                        # 여기서는 애초에 지면 좌표다. (5권 모두 dx=dy=0 이기도 하다 —
                        # 0 이 아닌 책이 들어오면 이 가정이 틀리므로 멈춘다.)
                        "rect": [rect.x0, rect.y0, rect.x1, rect.y1],
                        # 오려내기가 **다시 삼키지 못하게** 번호 배지 자리를 같이 넘긴다.
                        "avoid": avoid,
                        "forbid": forbid,
                        "out": row["out"],
                        "무리": f"{grp['lo']:04d}~{grp['hi']:04d}",
                        "짝짓기": how,
                        "덩어리": len(cl),
                        "소문항": len(members),
                        "pageOff": page_off[book],
                    }
                )
    finally:
        for d in docs.values():
            d.close()

    print(f"\n── 무리 그림 계획 ── 좌표를 만든 것 {len(emitted)} / {len(targets)}")
    kinds = Counter(e["짝짓기"] for e in emitted)
    for k, v in kinds.most_common():
        print(f"   {k} {v}")
    print("   못 한 사유:")
    for why, n in reasons.most_common():
        print(f"     {n:4d}  {why}")

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps(
            {"대상": len(targets), "좌표생성": len(emitted), "사유": dict(reasons), "상세": detail},
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    if a.emit:
        OUT.write_text(
            json.dumps(
                {
                    "기준": "지면의 [NNNN~MMMM] 무리 표시로 띠를 잡고 그림 덩어리를 찾는다",
                    "문항수": len(emitted),
                    "목록": emitted,
                },
                ensure_ascii=False,
                indent=1,
            ),
            encoding="utf-8",
        )
        print(f"→ {OUT}")
    print(f"→ {REPORT}")


if __name__ == "__main__":
    main()
