# -*- coding: utf-8 -*-
"""기출 PDF 정본에서 **발문을 실마리로** 그 문항의 그림만 오려 낸다. 토큰 0 · API 0.

    npx tsx scripts/qa/build-pdf-figure-plan.ts        # 선행 — 계획
    python scripts/figure/crop-pdf-by-stem.py          # 드라이런(집계만)
    python scripts/figure/crop-pdf-by-stem.py --write  # public/figures/ 에 기록

입력: `scripts/qa/reports/pdf-figure-plan.json`
출력: `public/figures/<examId>/pdf-q<번호>.png`
      `scripts/qa/reports/pdf-figure-result.json`

## 좌표가 없다 — **글자가 곧 좌표다**

RPM 은 sumaek 이 문항 사각형을 갖고 있지만 기출은 없다. 대신 DB 본문이 있으니
**그 글자가 PDF 어느 쪽 어디에 있는지** 찾으면 그것이 좌표다. 쪽을 고를 때도
「본문과 가장 길게 겹치는 쪽」을 쓴다 — 판이 다르거나 쪽이 밀려도 따라간다.

## 여기 오는 문항은 **이미 한 번 놓친 것들**이다

`map-figures.py` 가 쪽 단위로 그림을 문항에 배정하는데, 이 대상은 그게 놓친 것만
모아 놓은 것이다. 같은 규칙을 다시 돌리면 같은 것을 놓친다. 그래서 판정 규칙은
RPM 쪽(`crop-rpm-from-pdf.py`)에서 쓰는 것을 그대로 가져온다 —
**발문은 DB 본문에 있고 그림 라벨은 없다.** 간격으로는 못 가른다.

## 안 되는 것은 안 한다

- 본문과 겹치는 쪽을 못 찾으면(`MIN_RUN` 미만) 건너뛴다.
- 오려낸 칸에 발문이 이어서 들어오면 버린다.
- 칸 경계를 반으로 자르는 요소가 남으면 버린다.
잘못 붙인 그림은 지면에서 티가 안 나므로, 애매하면 **안 붙이는 쪽**을 고른다.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import re
import sys
from difflib import SequenceMatcher

import fitz

_HERE = pathlib.Path(__file__).parent
_spec = importlib.util.spec_from_file_location("croprpm", _HERE / "crop-rpm-from-pdf.py")
croprpm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(croprpm)

content_key = croprpm.content_key
longest_common_run = croprpm.longest_common_run
figure_rect = croprpm.figure_rect
PAD = croprpm.PAD
STEM_INTRUSION_CHARS = croprpm.STEM_INTRUSION_CHARS
#: 원문자 목록은 `crop-rpm-from-pdf.py` 한 곳에서 온다 (거기 주석 참조).
CIRCLED_ANSWER = croprpm.CIRCLED_ANSWER

PLAN = pathlib.Path("scripts/qa/reports/pdf-figure-plan.json")
RESULT = pathlib.Path("scripts/qa/reports/pdf-figure-result.json")
FIGROOT = pathlib.Path("public/figures")
DPI = 200
#: 쪽을 정하려면 본문과 이만큼은 이어서 겹쳐야 한다. 더 짧으면 우연이다.
MIN_RUN = 20
#: 맞은 조각 중 이만큼(글자) 이상인 것만 발문 조각으로 센다.
MIN_BLOCK = 4
#: 긴 구간에서 세로로 이만큼(pt) 안쪽의 조각만 같은 문항으로 본다.
STEM_SPAN_PT = 130.0
#: 발문 아래로 이만큼(pt)까지 그림을 찾는다. 「다음 그림과 같이」는 아래에 온다.
BELOW_PT = 320.0
#: 발문 위·옆으로 이만큼(pt). 「오른쪽 그림과 같이」는 같은 줄 오른쪽에 온다.
AROUND_PT = 24.0
#: 오려낸 칸 안의 **한 줄**에 한글이 이만큼 있으면 그것은 그림 라벨이 아니라 «문장»이다.
#: ⚠️ 「내 발문이 들어왔나」만 보면 **옆 문항의 발문**은 구조적으로 안 보인다 —
#:    실측 3건(`3535-8`·`4139-8`·`2622-14`)이 다른 문항 발문·선택지를 통째로 담고도
#:    통과했다. 물어야 할 것은 «누구 발문인가»가 아니라 «문장이 들어왔나»다.
#: 진짜 라벨은 짧다 — 실측 최장이 「과학 성적(점)」·「오른쪽 시력」 수준(7~8자).
SENTENCE_KO = 12
#: 시험지 **자신의 서식**. 선택지 번호와 배점 표시는 그림에 있을 수 없다 —
#: 문항 낱말 목록이 아니라 지면 문법이라, 학교가 바뀌어도 그대로다.
#: 짧은 꼬리는 «한 줄 한글 12자» 규칙을 빠져나간다(실측 `2622-14`: 「…의 길이는? [2점]」
#: 이 한글 5자, `2622-16`: 선택지 「② 5√2 ④ 3√2」 는 한글 0자).
#: ⚠️ **숫자로 쓰면 안 된다.** 이 시험지들은 글꼴이 사유 영역으로 인코딩돼 있어
#:    배점의 `2` 가 문자 `2` 가 아니라 `` 로 나온다(실측). 그래서 대괄호와
#:    「점」만 보고 그 사이는 **무엇이든** 받는다 — 글자 종류에 기대지 않는다.
#: ⚠️ 이 관문은 **버리는** 규칙이다 — 넓히면 회수가 줄 뿐 **늘지 않는다.** 그래서
#:    ①~⑤ 에서 90자로 넓히기 전에 세어 봤다(D-20): 관문까지 온 칸 RPM 4 · 기출 5,
#:    그중 ①~⑤ **밖** 글자가 나온 칸은 **0개**. 오늘 자료에서는 무손실이고, 넓힌 값은
#:    「못 가르면 버리는 쪽」(2026-08-18 교훈)으로 앞으로 올 교재를 막는 몫이다.
#: ⚠️ 대괄호 안을 두 번 넓혔다(2026-08-19). 서술형 배점은 `[총 6점, 각 2점]`·
#:    `[5점, 부분 점수 있음]`·`[총점 18점, 각 5점, 2점]` 처럼 길고 **「점」 뒤에도
#:    말이 붙는다.** 좁은 판으로는 **어느 span 에서도** 안 걸려서, 그 조각들이
#:    「그림 라벨」로 남아 칸이 발문 마지막 줄·배점 줄까지 자랐다
#:    (실측 `3635-17`·`4229-24`). 넓히기 전에 무엇을 깎는지 셌다(D-20):
#:    통과한 19행 중 넓혀서 «걸리는» 것은 **실제로 배점 줄을 담고 있던 1행**뿐이고
#:    (그 행은 조이는 사다리 칸에서 다시 통과한다), 지면에 실재하는 표기 12종이 잡힌다.
EXAM_SYNTAX = re.compile(
    f"[{re.escape(CIRCLED_ANSWER)}]" + r"|[\[［][^\]］]{0,24}점[^\]］]{0,12}[\]］]"
)
#: 시험지 **머리띠**(학교·학년·과목·학원 로고) 판정. 낱말 목록으로 거르면 그 목록에
#: 없는 서식은 구조적으로 못 본다. 「쪽 위 + 넓다」로 갈랐더니 **쪽머리에 놓인 진짜
#: 그림 3건이 같이 걸렸다**(3509-14·3627-15·5466-6) — 위치는 가르는 성질이 아니다.
#: 가르는 성질은 **되풀이**다: 머리띠는 여러 쪽에 같은 자리 같은 크기로 나온다.
#: 그림은 한 번만 나온다.
#: ⚠️ **정의는 `crop-rpm-from-pdf.py` 한 곳에 있다.** 여기서 다시 적으면 두 벌이
#:    되고, 두 벌이 되면 한쪽만 고쳐도 아무도 모른다(`CIRCLED_ANSWER` 와 같은 이유).
FURNITURE_MIN_PAGES = croprpm.FURNITURE_MIN_PAGES
FURNITURE_ROUND = croprpm.FURNITURE_ROUND
#: 두께 0인 곧은 선을 이만큼 부풀려 «있는 것»으로 본다. `figure_rect` 의 첫 가드
#: `is_empty` 가 **곧은 선을 전부 버리기** 때문이다 — 실측으로 남은 44행 중 35행이
#: 「획이 아예 없다」로 떨어졌는데 그 쪽에는 획이 99개 있었다(97개가 두께 0).
THIN_STROKE_PT = 0.5
#: 문항 번호 표시(`11.` `12.`). 오려낸 칸이 **다른 문항 번호를 지나** 있으면 그것은
#: 옆 문항의 그림이다 — 이 저장소가 적어 둔 가장 큰 정밀도 한계가 그 부류다
#: (16-figure-recovery-ledger §3.3 「옆 문항 그림이 딸려 온다」).
#: 실측 `4082-11`: 발문은 11번인데 칸이 **12번 상자**를 집었다. 자동 검사 셋(발문 침입·
#: 선택지 표시·문장)이 전부 통과시켰다 — 그 상자 안에는 한글도 선택지 표시도 없기 때문이다.
#: 「누구 발문인가」가 아니라 **「번호를 넘었나」**를 물어야 갈린다.
QNUM = re.compile(r"^\s*(\d{1,2})\s*[.．]\s")
#: 단(段) 구분선으로 보려면 세로선이 쪽 높이의 이만큼은 되어야 하고, 폭은 이만큼 이하여야 한다.
#: **길이만으로 자르면 수직선 그림이 같이 죽는다**(2026-08-16 배너 사건과 같은 자리).
#: 그래서 길이는 «선인가»를 묻는 데만 쓰고, «단 구분선인가»는 **여러 쪽에 같은 x 로
#: 되풀이되는가**로 가른다 — 서식이 그린 것이라 되풀이되고, 그림은 한 번만 나온다.
#: 실측(2026-08-19): 대상 30편 **전부**에서 잡혔다(728pt 판 x=363.4 · 595pt 판 296.7 ·
#: 2-up 841pt 판 210·630). 그리고 실패 16행 중 **8행이 바로 이 선에 걸려** 있었다.
DIVIDER_MIN_H = 0.3
DIVIDER_MAX_W = 2.0
#: 글자가 이만큼(pt) 넓게 비어 있으면 그것도 단 경계다. 2-up(한 장에 두 쪽) 편은
#: 쪽과 쪽 사이에 구분선이 없고 **빈 띠**만 있다(실측 4341: 386~453, 67pt).
COLUMN_GAP_PT = 24.0


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def stem_box(page, stem: str,
             edges: list[float] | None = None,
             min_run: int = MIN_RUN) -> tuple[fitz.Rect, int] | None:
    """이 쪽에서 **이 문항의 발문**이 차지한 영역과 겹친 길이. 못 찾으면 None.

    낱말마다 「본문에 있나」를 묻지 않는다 — 짧은 낱말은 아무 데나 있어서, 그렇게
    하면 조각이 쪽 전체에 흩어지고 상자가 지면만 해진다. 그러면 그림 검출이
    **머리띠**를 집는다(실측 `4105-2`: 조각 88개, 상자 46~795pt, 결국 머리띠를 오렸다).

    대신 쪽의 낱말을 **읽는 순서대로 이어 붙인 한 줄**로 만들고, 본문과 **가장 길게
    이어지는 구간**을 찾아 그 구간의 낱말만 상자로 묶는다. 이어지는 구간이라는 조건이
    「흩어진 우연」을 구조적으로 배제한다.
    """
    words = page.get_text("words")
    keys, spans = [], []
    for w in words:
        k = content_key(w[4] or "")
        if not k:
            continue
        spans.append((len("".join(keys)), len(k), fitz.Rect(w[:4])))
        keys.append(k)
    page_key = "".join(keys)
    if not page_key:
        return None
    sm = SequenceMatcher(None, page_key, stem)
    blocks = [b for b in sm.get_matching_blocks() if b.size >= MIN_BLOCK]
    if not blocks:
        return None
    anchor = max(blocks, key=lambda b: b.size)
    # 쪽을 «번호로 검산»해서 골랐다면 여기서도 같은 문턱을 써야 한다 — 한쪽만
    # 내리면 쪽은 찾고 발문 자리는 못 잡는 자리에서 조용히 멈춘다(실측 3행).
    if anchor.size < min_run:
        return None

    def bbox(lo: int, hi: int) -> fitz.Rect | None:
        box = None
        for start, size, rect in spans:
            if start + size <= lo or start >= hi:
                continue
            box = rect if box is None else (box | rect)
        return box

    core = bbox(anchor.a, anchor.a + anchor.size)
    if core is None:
        return None
    # **발문은 단(段)을 넘지 않는다.** 세로 거리만 보면 옆 단의 같은 높이 글자가
    # 조각으로 들어와 상자가 두 단에 걸친다 — 실측 `4341-19`(2-up 편)은 옆 단
    # 21번 발문 첫 줄이 딸려 와 상자가 33~270pt 로 벌어졌고, 그 바람에 단 구분선
    # (x=210)이 상자 안에 들어와 완비 검사에서 통째로 버려졌다.
    lo, hi = column_band(edges, (core.x0 + core.x1) / 2) if edges else (-1e9, 1e9)
    box = fitz.Rect(core)
    for b in blocks:
        r = bbox(b.a, b.a + b.size)
        if r is None:
            continue
        if r.y1 < core.y0 - STEM_SPAN_PT or r.y0 > core.y1 + STEM_SPAN_PT:
            continue
        if not (lo <= (r.x0 + r.x1) / 2 <= hi):
            continue
        box |= r
    if edges:
        box = box & fitz.Rect(lo, page.rect.y0, hi, page.rect.y1)
    return box, anchor.size


def column_edges(doc) -> dict[int, list[float]]:
    """쪽마다 **단(段) 경계** x 좌표. 「단을 넘지 않는다」는 이 시험지들의 구조다.

    한 문항의 발문도 그림도 한 단 안에 있다. 그런데 발문으로 상자를 잡으면 상자가
    옆 단으로 24pt 삐져나가고(`AROUND_PT`), 그 순간 **옆 단의 물건이 후보가 된다.**
    그러면 완비 검사(「경계를 가로지르는 것이 있으면 오려내지 않는다」)가 옆 단
    구분선·옆 단 보기 상자 테두리에 걸려 **멀쩡한 그림을 통째로 버린다.**
    실측(2026-08-19): 「문항 둘레에서 그림을 못 찾았다」 16행 중 **13행이 완비 검사**
    였고 그중 **11행이 옆 단(또는 단 구분선) 때문**이었다.

    경계는 두 가지 근거로 모은다 — 둘 다 **본문과 독립**이다:

    1. **되풀이되는 긴 세로선** = 서식이 그린 단 구분선. 길이로만 자르면 수직선
       그림이 같이 죽으므로(2026-08-16) 되풀이를 함께 요구한다.
    2. **글자가 `COLUMN_GAP_PT` 넘게 비어 있는 띠**. 2-up 편은 쪽 사이에 선이 없다.
       머리띠·꼬리말은 단을 가로질러 이 빈 띠를 메우므로, **여러 쪽에 같은 자리로
       되풀이되는 글자줄은 빼고** 잰다(그것이 곧 머리띠라는 뜻이다).
    """
    # ── 1. 되풀이되는 긴 세로선 ────────────────────────────────────────
    seen: dict[int, set[int]] = {}
    for i in range(doc.page_count):
        h = doc[i].rect.height
        for d in doc[i].get_drawings():
            r = fitz.Rect(d["rect"])
            if r.is_infinite:
                continue
            if (r.x1 - r.x0) > DIVIDER_MAX_W or (r.y1 - r.y0) < h * DIVIDER_MIN_H:
                continue
            seen.setdefault(int(round((r.x0 + r.x1) / 2 / FURNITURE_ROUND)), set()).add(i)
    divider = sorted(k * FURNITURE_ROUND for k, v in seen.items()
                     if len(v) >= FURNITURE_MIN_PAGES)

    # ── 2. 되풀이되는 글자줄(머리띠·꼬리말)을 뺀 뒤의 빈 띠 ─────────────
    line_pages: dict[tuple[int, int, int, int], set[int]] = {}
    per_page: list[list[fitz.Rect]] = []
    for i in range(doc.page_count):
        rects = []
        for b in doc[i].get_text("dict").get("blocks", []):
            for ln in b.get("lines", []):
                r = fitz.Rect(ln["bbox"])
                if r.is_empty:
                    continue
                rects.append(r)
                k = tuple(int(round(v / FURNITURE_ROUND))
                          for v in (r.x0, r.y0, r.x1, r.y1))
                line_pages.setdefault(k, set()).add(i)
        per_page.append(rects)
    repeated = {k for k, v in line_pages.items() if len(v) >= FURNITURE_MIN_PAGES}

    out: dict[int, list[float]] = {}
    for i, rects in enumerate(per_page):
        page = doc[i]
        w = int(page.rect.width) + 2
        filled = bytearray(w)
        for r in rects:
            k = tuple(int(round(v / FURNITURE_ROUND)) for v in (r.x0, r.y0, r.x1, r.y1))
            if k in repeated:
                continue
            for x in range(max(0, int(r.x0)), min(w, int(r.x1) + 1)):
                filled[x] = 1
        edges = list(divider)
        x = 0
        while x < w:
            if filled[x]:
                x += 1
                continue
            j = x
            while j + 1 < w and not filled[j + 1]:
                j += 1
            # 지면 바깥 여백은 단 경계가 아니다 — 양끝에 닿는 빈 띠는 건너뛴다.
            if j - x >= COLUMN_GAP_PT and x > 0 and j < w - 1:
                edges.append((x + j) / 2)
            x = j + 1
        out[i] = sorted({0.0, page.rect.width, *edges})
    return out


def column_band(edges: list[float], x: float) -> tuple[float, float]:
    """`x` 가 놓인 단의 좌우 끝. **구분선 자신은 단 밖**이므로 조금 안으로 물린다.

    경계를 구분선 «가운데»로 잡으면 그 선이 여전히 상자에 1pt 걸린다 — 그러면
    후보가 되고, 후보가 되면 완비 검사가 「경계를 가로질렀다」로 문항을 버린다.
    실측(2026-08-19): 단 클립을 넣고도 5행이 바로 이 1pt 때문에 그대로 떨어졌다.
    """
    lo = max((e for e in edges if e <= x), default=edges[0])
    hi = min((e for e in edges if e > x), default=edges[-1])
    if hi - lo > 4 * DIVIDER_MAX_W:
        lo, hi = lo + DIVIDER_MAX_W, hi - DIVIDER_MAX_W
    return lo, hi


#: 선택지 표시만 본다 — 배점 `[4점]` 은 **발문 마지막 줄**에 붙어서, 그걸로 바닥을
#: 정하면 발문 상자가 조금만 짧아도 그림이 통째로 잘려 나간다.
CHOICE_MARK = re.compile(f"[{re.escape(CIRCLED_ANSWER)}]")
#: 선택지 **줄**의 모양 — 줄이 원문자로 **시작**한다.
CHOICE_LINE = re.compile(r"^\s*[" + re.escape(CIRCLED_ANSWER) + r"]")
#: 그리고 그 줄은 **발문과 같은 왼쪽 끝**에서 시작한다. 이것이 「그림 안의 ①」과
#: 「진짜 선택지」를 가르는 성질이다 — 문턱이 아니라 **분포**에서 나왔다.
#: 실측(2026-08-19) 대상 31행 전수: 진짜 선택지 줄의 들여쓰기는 **0.0pt 또는 −0.5pt**
#: 뿐이고(두 단 배치의 둘째 열은 +86~160pt 로 뚜렷이 다르다), 그림 안에 적힌 원문자
#: (`5231-2` 피라미드 칸의 ①~⑤)는 **+91.4·+116.3·+141.4pt** 였다. 겹치지 않는다.
#: (발문 상자가 문항 번호 «뒤»에서 시작할 때가 있어 −9pt 쯤 어긋난다. 그래서 20pt.)
CHOICE_LEFT_PT = 20.0
#: 배점 표기만 보는 판. **본문이 ①~⑤ 를 가리키는 문항**에서는 원문자가 지면 문법이
#: 아니라 **그림의 일부**다 — 실측 `5231-2` 「그림에서 위 칸의 식은 … ① ~ ⑤에 들어갈
#: 식을 알맞게 구한 것은?」은 ①~⑤ 가 피라미드 칸 안에 적혀 있다. 그 행에 원문자
#: 규칙을 그대로 대면 「선택지가 들어왔다」로 **그림이 있는데도 버린다**(예외가 지시어를
#: 이기는 자리 — CLAUDE.md 2026-08-18). 가르는 근거는 **본문**이다: 발문이 ①~⑤ 를
#: 말로 지목하면 그 문항의 그림에는 원문자가 있어도 정상이다.
#: 실측으로 대상 31행 중 이 예외에 걸리는 것은 **1행**뿐이다.
SCORE_SYNTAX = re.compile(r"[\[［][^\]］]{0,24}점[^\]］]{0,12}[\]］]")


def choice_floor(page, sb: fitz.Rect, band: tuple[float, float], bottom: float) -> float:
    """발문 아래 **첫 선택지 줄**의 윗선. 이 문항의 그림은 그보다 위에 있다.

    라벨 되찾기는 「본문에 없는 짧은 글자」를 그림에 딸린 것으로 본다. 그런데 기출
    선택지는 **글꼴이 사유 영역**이라 `② ` 처럼 나오고, 열쇠가 비어서
    「본문에 있다」로 걸러지지 않는다. 그래서 띠가 아래로 자라 선택지를 통째로 삼키고,
    뒤 관문이 「칸에 선택지 표시가 들어왔다」로 그 문항을 버린다 — 실측(2026-08-19)
    으로 단 클립 뒤 남은 실패 28행 중 **9행**이 이 부류였다.

    글자를 지우는 대신 **바닥을 정한다.** 시험지에서 선택지는 그림 다음에 온다 —
    낱말 목록이 아니라 지면 문법이라 학교가 바뀌어도 그대로다. 못 가르면 버리는 쪽이
    되므로(잘린 그림은 지면에서 티가 안 난다) 이 규칙은 **깎기만 한다.**
    """
    lo, hi = band
    lines = []
    for b in page.get_text("dict").get("blocks", []):
        for ln in b.get("lines", []):
            r = fitz.Rect(ln["bbox"])
            if r.is_empty or r.x1 <= lo or r.x0 >= hi:   # 같은 단만 본다
                continue
            lines.append((r, "".join(sp.get("text", "") for sp in ln.get("spans", []))))
    mark = None
    for r, txt in lines:
        if r.y0 < sb.y1 or r.y0 >= bottom:
            continue
        # **줄이 원문자로 시작하고, 발문과 같은 왼쪽 끝에서 시작할 때만** 선택지다.
        # 그림 안에 적힌 원문자(`5231-2` 피라미드)는 가운데에 있어 여기 안 걸린다 —
        # 이게 없으면 바닥이 그림 꼭대기에 걸려 그림이 통째로 잘린다.
        if not CHOICE_LINE.match(txt) or abs(r.x0 - sb.x0) > CHOICE_LEFT_PT:
            continue
        if mark is None or r.y0 < mark.y0:
            mark = r
    if mark is None:
        return bottom
    # **선택지 줄의 «윗선» 은 ① 이 있는 줄의 윗선이 아니다.** 선택지 값이 분수면
    # `②` 보다 훨씬 위로 올라간다 — 실측 3행이 그 분수 꼭대기를 칸에 담은 채
    # 「선택지 표시가 들어왔다」로 버려졌다. 그 줄과 **가로로 같은 띠에 있는 줄들**의
    # 가장 윗선까지 올려 잡고, 오려낼 때 붙일 여백(`PAD`)만큼 더 물러선다.
    top, bot = mark.y0, mark.y1
    grew = True
    while grew:                     # **되풀이해서 넓힌다** — 분수는 층이 여럿이다
        grew = False
        for r, _ in lines:
            if r.y1 > top and r.y0 < bot and (r.y0 < top or r.y1 > bot):
                top, bot = min(top, r.y0), max(bot, r.y1)
                grew = True
    return max(sb.y1, top - PAD)


#: 본문이 상해서 `MIN_RUN` 에 못 미칠 때, **문항 번호**라는 본문과 독립인 근거를
#: 하나 더 요구해 쪽을 정한다. 그때 요구하는 최소 겹침. 실측(2026-08-19) 네 행의
#: 겹침이 5·15·18·18 이었고, 번호가 가리키는 쪽과 겹침이 가장 긴 쪽이 **셋에서**
#: 일치했다(5자짜리 `4224-9` 는 어긋나서 그대로 버려진다 — 실제로 그 쪽에 없다).
MIN_RUN_WITH_QNUM = 10
#: 문항 번호 자리로 인정하려면 같은 x 에 이만큼은 되풀이돼야 한다. 한 시험지에는
#: 문항이 20개 안팎이고 단이 둘이므로 한 자리에 최소 대여섯 번은 온다.
QNUM_MIN_REPEAT = 4


def page_has_question_number(doc, pi: int, q: int) -> bool:
    """`pi` 쪽에 **`q` 번 문항 번호**가 있나 — 본문과 **독립인** 근거.

    「본문이 있는 쪽을 못 찾았다」는 본문이 상했다는 뜻이지 쪽이 없다는 뜻이 아니다.
    그렇다고 겹침 문턱만 내리면 **우연히 닮은 쪽**이 걸린다. 그래서 문턱을 내리는
    대신 근거를 하나 더 요구한다 — 지면에 적힌 문항 번호다. 둘이 **같은 쪽을 가리킬
    때만** 그 쪽으로 본다.

    ⚠️ **번호로 쪽을 «고르지» 않는다.** 시험지 묶음에는 해설·답안 쪽이 뒤에 붙어
    같은 번호가 두 번 나온다(실측 4편 전부 그랬다). 고르는 것은 본문 겹침이 하고,
    번호는 그 선택을 **검산**만 한다.

    ⚠️ 번호 자리는 «단 왼쪽 끝」인데 그 왼쪽 끝을 절대 좌표로 재면 안 된다 —
    단 경계로 재면 왼쪽 단이 늘 46pt 들어가 **한 건도 안 걸리고**(그러면 오른쪽 단
    문항만 되는데 그게 안 보인다), 글자 여백으로 재면 꼬리말이 여백을 끌어내려
    멀쩡한 세 행이 떨어진다(실측 20 → 17). **되풀이**로 가른다 — 이 파일이 머리띠·
    단 구분선에 이미 쓰는 성질이다: 문항 번호는 같은 x 에 여러 번 온다.
    """
    at: dict[int, int] = {}
    here: set[int] = set()
    for i in range(doc.page_count):
        for b in doc[i].get_text("dict").get("blocks", []):
            for ln in b.get("lines", []):
                r = fitz.Rect(ln["bbox"])
                m = QNUM.match("".join(sp.get("text", "") for sp in ln.get("spans", [])))
                if not m:
                    continue
                k = int(round(r.x0 / FURNITURE_ROUND))
                at[k] = at.get(k, 0) + 1
                if i == pi and int(m.group(1)) == q:
                    here.add(k)
    return any(at.get(k, 0) >= QNUM_MIN_REPEAT for k in here)


def foreign_choices(page, sb: fitz.Rect, fig: fitz.Rect,
                    band: tuple[float, float]) -> fitz.Rect | None:
    """그림과 발문 **사이**에 있는 앞 문항의 선택지 줄. 없으면 None.

    사다리의 「위까지」 칸은 그림이 발문 **위**에 오는 배치를 위한 것이다(`4235-17`·
    `4229-24`). 그런데 그 칸은 단 꼭대기까지 열려 있어, 앞 문항의 그림을 그대로
    물어 올 수 있다 — 실측(2026-08-19) `3627-15` 는 앞 rung 이 「반으로 잘랐다」로
    떨어지자 **앞 문항 14번의 마방진**을 가져왔다. 살짝 잘린 그림보다 나쁘다.

    거리로 가르지 않는다(실측 2.5·7.1pt 대 142.1pt 로 갈리긴 한다). **구조**로
    묻는다: 시험지에서 선택지는 발문 **다음**에 온다. 그림과 발문 사이에 선택지
    줄이 있으면 그 사이에서 문항이 한 번 끝난 것이고, 그림은 앞 문항의 것이다.
    열쇠는 `choice_floor` 와 **같다** — 줄이 원문자로 시작하고 단 왼쪽 끝에 선다.
    """
    if fig.y1 >= sb.y0:                      # 그림이 발문 아래·겹침 — 해당 없음
        return None
    lo, hi = band
    for b in page.get_text("dict").get("blocks", []):
        for ln in b.get("lines", []):
            r = fitz.Rect(ln["bbox"])
            if r.is_empty or r.x1 <= lo or r.x0 >= hi:
                continue
            if not (fig.y1 <= r.y0 and r.y1 <= sb.y0):
                continue
            txt = "".join(sp.get("text", "") for sp in ln.get("spans", []))
            if CHOICE_LINE.match(txt) and abs(r.x0 - sb.x0) <= CHOICE_LEFT_PT:
                return r
    return None


def bisected(page, rect: fitz.Rect, band: tuple[float, float]) -> fitz.Rect | None:
    """오려낼 칸이 **반으로 자르고 있는** 요소. 없으면 None.

    `figure_rect` 안에도 같은 불변식이 있지만 그것은 «칸을 정하는 동안» 보는 것이고,
    ⑴ 마지막에 붙이는 여백(`PAD`)만큼 칸이 더 커지며 ⑵ 울타리(`bound`) 밖은 아예
    안 본다. 그래서 **지면에 실제로 나가는 사각형**으로 한 번 더 물어야 한다.

    실측(2026-08-19) `4338-19`: 아래 선택지 `④ 304/7` 의 **분자 윗머리**가 칸에 1pt
    들어와 있었다. 기존 관문 넷이 전부 통과시킨다 — 이 시험지들은 숫자가 사유 영역
    글꼴이라 `304` 가 문자로 안 잡히고(발문·배점 검사 무력), 한글도 0자이기 때문이다.
    **글자 종류에 기대지 않고 «잘렸나»만 묻는** 검사가 필요하다.
    """
    lo, hi = band
    raw = page.get_text("rawdict")
    cands: list[fitz.Rect] = []
    for b in raw.get("blocks", []):
        if b.get("type") != 0:
            cands.append(fitz.Rect(*b["bbox"]))
            continue
        for ln in b.get("lines", []):
            for sp in ln.get("spans", []):
                cands.append(fitz.Rect(*sp["bbox"]))
    for d in page.get_drawings():
        r = fitz.Rect(d["rect"])
        if r.is_infinite:
            continue
        # ⚠️ **곧은 선은 폭이나 높이가 0이라 `is_empty` 가 참이다.** 그대로 두면 아래
        #    걸러내기에서 통째로 빠지고, `Rect.__and__` 도 빈 것을 돌려주어 「잘렸다」가
        #    **구조적으로 0**이 된다 — 획 검출기가 같은 자리에서 선을 전부 버렸던 것과
        #    같은 함정이다(CLAUDE.md 2026-08-19). `figure_rect` 가 이미 쓰는 방식대로
        #    부풀려서 **같은 규칙이 두 곳에서 같게 굴게** 한다.
        #    실측 `3627-15`: 상자를 잇는 선(x263.8~283.1, y718.4)이 칸 밖으로 18.4pt
        #    나가 있었는데 관문 여섯이 전부 통과시켰다. 지면에는 끊긴 선이 나간다.
        if r.is_empty:
            if r.x1 - r.x0 <= 0 and r.y1 - r.y0 <= 0:
                continue                       # 점 — 선이 아니다
            r = fitz.Rect(r.x0 - THIN_STROKE_PT, r.y0 - THIN_STROKE_PT,
                          r.x1 + THIN_STROKE_PT, r.y1 + THIN_STROKE_PT)
        cands.append(r)
    for r in cands:
        if r.is_empty or r.is_infinite:
            continue
        # **단을 가로지르는 것은 이 문항의 것이 아니다** — 머리띠·꼬리말이다.
        # (`figure_rect.crosses_column` 과 같은 판정을 써야 한다. 한쪽만 고치면
        #  「후보에선 뺐는데 여기선 잘렸다고 한다」가 되어 회수가 조용히 막힌다.)
        if r.x1 <= lo or r.x0 >= hi or r.x0 < lo - 0.5 or r.x1 > hi + 0.5:
            continue
        if r.get_area() >= page.rect.get_area() * 0.7:   # 쪽 배경
            continue
        if rect.contains(r) or (r & rect).is_empty:
            continue
        return r
    return None


def crossed_question_number(page, sb: fitz.Rect, fig: fitz.Rect, q: int) -> int | None:
    """발문과 오려낸 칸 사이(또는 칸 안)에 **다른 문항 번호**가 있으면 그 번호.

    문항 번호는 단(段)의 왼쪽 끝에서 시작한다. 선택지 번호도 `1.` 꼴일 수 있으므로
    **발문 왼쪽 끝보다 더 왼쪽이거나 같은 줄**만 본다 — 선택지는 들여쓰기가 있다.
    """
    top = min(sb.y1, fig.y0)
    bot = max(fig.y1, sb.y1)
    for b in page.get_text("dict").get("blocks", []):
        for ln in b.get("lines", []):
            r = fitz.Rect(ln["bbox"])
            if r.y1 <= top or r.y0 >= bot:
                continue
            # ⚠️ **같은 단(段)만 본다.** 시험지는 두 단이라, 단을 안 가르면 **옆 단의**
            #    문항 번호가 걸린다 — 실측으로 멀쩡한 `3195-20` 이 옆 단 18번 때문에
            #    버려졌다. 가로로 겹치는 줄만 같은 단이다.
            if r.x1 <= sb.x0 or r.x0 >= sb.x1:
                continue
            if r.x0 > sb.x0 + 2:          # 들여쓴 줄은 문항 번호가 아니다
                continue
            text = "".join(sp.get("text", "") for sp in ln.get("spans", []))
            m = QNUM.match(text)
            if m and int(m.group(1)) != q:
                return int(m.group(1))
    return None


#: 쪽 장식 열쇠 — **정의는 `crop-rpm-from-pdf.py` 에 있다**(위 상수와 같은 이유).
furniture_keys = croprpm.furniture_keys

def pick_page(doc, stem: str) -> tuple[int, int]:
    """본문과 가장 길게 겹치는 쪽. (쪽 index, 겹친 길이)"""
    best = (-1, 0)
    for i in range(doc.page_count):
        run = longest_common_run(content_key(doc[i].get_text("text")), stem)
        if run > best[1]:
            best = (i, run)
    return best


class Cache:
    """한 책을 여러 번 열지 않는다 — 쪽 장식·단 경계는 책 단위로 한 번만 잰다."""

    def __init__(self) -> None:
        self.docs: dict[str, fitz.Document] = {}
        self.furniture: dict[str, set] = {}
        self.columns: dict[str, dict[int, list[float]]] = {}

    def doc(self, pdf: str) -> fitz.Document:
        if pdf not in self.docs:
            self.docs[pdf] = fitz.open(pdf)
        return self.docs[pdf]

    def close(self) -> None:
        for d in self.docs.values():
            d.close()


def locate(cache: Cache, it: dict) -> dict:
    """계획 한 줄에 대해 **쪽·발문 상자·울타리·오려낼 칸**을 정한다.

    ⚠️ **진단기·검수기가 이 함수를 부르게 하라.** 「어디를 오리려 했나」를 옆에서
    다시 구현하면 그 둘이 갈라지고, 갈라지면 같이 눈이 먼다 — 실제로 옛 진단기가
    `thin_pt` 를 모른 채 세어 트랙 브리프의 진단을 틀리게 만들었다(2026-08-19).

    돌려주는 것: `이유` 가 있으면 거기서 멈춘 것이고, 없으면 `칸`(오려낼 사각형)이 있다.
    """
    doc = cache.doc(it["pdf"])
    stem = content_key(it["content"])
    got: dict = {"stem": stem}

    if it["pdf"] not in cache.columns:
        cache.columns[it["pdf"]] = column_edges(doc)

    pi, run = pick_page(doc, stem)
    if pi < 0 or run < MIN_RUN:
        if not (run >= MIN_RUN_WITH_QNUM
                and page_has_question_number(doc, pi, int(it["q"]))):
            return {**got, "이유": f"본문이 있는 쪽을 못 찾았다 (최장 {run}자)"}
        got["번호로검산"] = True
    page = doc[pi]
    got.update(page=page, pi=pi, run=run)
    edges = cache.columns[it["pdf"]][pi]
    got["edges"] = edges

    found = stem_box(page, stem, edges,
                     MIN_RUN_WITH_QNUM if got.get("번호로검산") else MIN_RUN)
    if found is None:
        return {**got, "이유": "쪽 안에서 발문 위치를 못 잡았다"}
    sb, _ = found
    got["sb"] = sb

    # **상자를 단 밖으로 내보내지 않는다.** `AROUND_PT` 가 24pt 라 상자가 옆 단으로
    # 삐져나가고, 그러면 옆 단 구분선·옆 단 보기 상자 테두리가 후보로 들어와
    # 완비 검사가 멀쩡한 그림을 버린다(`column_edges` 주석 참조).
    lo, hi = band = column_band(edges, (sb.x0 + sb.x1) / 2)
    floor = choice_floor(page, sb, (lo, hi), sb.y1 + BELOW_PT)
    bound = fitz.Rect(lo, page.rect.y0, hi, floor) & page.rect
    got.update(band=(lo, hi), floor=floor, bound=bound)

    if it["pdf"] not in cache.furniture:
        cache.furniture[it["pdf"]] = furniture_keys(doc)
    furn = cache.furniture[it["pdf"]]

    # 발문이 ①~⑤ 를 말로 지목하면 그림 안의 원문자는 정상이다(`SCORE_SYNTAX` 주석).
    syntax = SCORE_SYNTAX if CHOICE_MARK.search(it["content"]) else EXAM_SYNTAX

    def verdict(fig: fitz.Rect | None) -> tuple[fitz.Rect | None, str | None]:
        """오려낼 칸과 **관문 판정**. 통과하면 이유가 `None`."""
        if fig is None:
            return None, "문항 둘레에서 그림을 못 찾았다"
        rect = fitz.Rect(fig.x0 - PAD, fig.y0 - PAD, fig.x1 + PAD, fig.y1 + PAD) & page.rect
        txt = page.get_text("text", clip=rect)
        run2 = longest_common_run(content_key(txt), stem)
        if run2 >= STEM_INTRUSION_CHARS:
            return rect, f"칸에 발문이 {run2}자 들어왔다"
        fk = tuple(int(round(v / FURNITURE_ROUND)) for v in (fig.x0, fig.y0, fig.x1, fig.y1))
        if fk in furn:
            return rect, "쪽마다 되풀이되는 쪽 장식이다"
        crossed = crossed_question_number(page, sb, fig, int(it["q"]))
        if crossed is not None:
            return rect, f"칸이 다른 문항 번호({crossed}번)를 넘었다"
        if syntax.search(txt):
            return rect, "칸에 선택지·배점 표시가 들어왔다"
        longest_line = max(
            (sum(1 for ch in ln if "가" <= ch <= "힣") for ln in txt.splitlines()),
            default=0,
        )
        if longest_line >= SENTENCE_KO:
            return rect, f"칸에 문장이 들어왔다 (한 줄 한글 {longest_line}자)"
        cut = bisected(page, rect, band)
        if cut is not None:
            return rect, f"칸이 무언가를 반으로 잘랐다 {tuple(round(v, 1) for v in cut)}"
        alien = foreign_choices(page, sb, fig, band)
        if alien is not None:
            return rect, f"그림과 발문 사이에 앞 문항 선택지가 있다 (y{alien.y0:.0f})"
        return rect, None

    # ── 조이는 규칙은 **폴백으로만** 건다 ────────────────────────────────
    # 「선택지 위에서 끊는다」·「발문에서 물러선다」는 못 찾던 것을 찾게 해 주지만,
    # **이미 잘 나오던 칸을 깎을 수도 있다** — 실측 `2384-6`(줄기와 잎)에서
    # 표 제목 「빵의 판매량 (1|0은 10개)」가 발문에도 있는 낱말이라 물러섬에 잘려
    # 나갔다. 그건 그림의 일부다(그게 없으면 줄기와 잎을 못 읽는다).
    #
    # 그래서 **느슨한 것부터** 대고, 관문을 통과하는 첫 칸을 쓴다. 성공하던 문항은
    # 첫 시도에서 그대로 통과하므로 **손실이 구조적으로 0**이다(2026-08-19
    # `--widen-fallback` 과 같은 꼴). 조인 칸도 같은 관문을 전부 다시 통과해야 한다.
    ladders = [
        # ⚠️ **바닥(선택지 위에서 끊기)은 사다리 칸이 아니라 «항상»이다.** 느슨한 칸을
        #    먼저 두면, 그 칸이 선택지를 담은 채로 관문을 통과해 버리는 자리가 있다 —
        #    실측 `5231-2`(본문이 ①~⑤ 를 지목해 원문자 관문을 끈 행)가 선택지 다섯 줄을
        #    통째로 담고 통과했다. 바닥은 지면 문법이라 «폴백» 으로 둘 것이 아니다.
        ("기본", bound, False, AROUND_PT, False),
        ("발문피하기", bound, True, AROUND_PT, False),
        # **그림이 발문 «위»에 있는 배치.** 실측으로 그런 편이 있다(`4235-17`·
        # `4229-24`: 표가 발문 첫 줄 위에 온다). 위로 얼마나 볼지는 문턱을 만지지
        # 않고 **단의 꼭대기까지** 연다.
        ("위까지", bound, True, None, False),
        # **「오른쪽 그림」 배치.** 발문 줄이 짧아 상자가 글자 폭 + 24pt 에서 끝나는데
        # 그림은 그보다 오른쪽에 있다 — 실측 `4973-4`(삼각형)·`5049-19`(원뿔).
        # RPM 쪽이 `--widen-fallback` 으로 같은 일을 한다. 여기서도 **단 안에서만**
        # 넓힌다(단을 넘으면 옆 문항이 딸려 온다).
        ("단 전체", bound, True, AROUND_PT, True),
        ("단 전체+위까지", bound, True, None, True),
    ]
    first: tuple[fitz.Rect | None, str | None, dict] | None = None
    got["사다리기록"] = rungs = []
    for name, bnd, avoid, up, wide in ladders:
        tr: dict = {}
        top = sb.y0 - up if up is not None else bnd.y0
        x0 = bnd.x0 if wide else sb.x0 - AROUND_PT
        x1 = bnd.x1 if wide else sb.x1 + AROUND_PT
        bx = fitz.Rect(x0, top, x1, bnd.y1) & bnd
        fig = figure_rect(page, bx, stem, min_overlap=4.0,
                          thin_pt=THIN_STROKE_PT, furniture=furn,
                          label_syntax=syntax, bound=bnd,
                          avoid_stem=avoid, trace=tr)
        rect, why = verdict(fig)
        rungs.append(f"{name}: {why or '통과'}")
        if first is None:
            first = (fig, why, tr)
            got.update(box=bx, 진단=tr)
        if why is None:
            got.update(box=bx, fig=fig, 칸=rect, 진단=tr, 사다리=name)
            return got
    fig, why, tr = first  # type: ignore[misc]
    got.update(fig=fig, 진단=tr)
    return {**got, "이유": why}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--limit", type=int)
    # 입력 PDF 가 둘이다(정본 · 한글이 찍은 것). 같은 이름으로 쓰면 뒤엣것이 앞엣것을
    # 덮어써서 **무엇을 눈으로 봤는지** 알 수 없게 된다. 그래서 이름을 가른다.
    ap.add_argument("--plan", default=str(PLAN))
    ap.add_argument("--result", default=str(RESULT))
    ap.add_argument("--prefix", default="pdf", help="산출물 이름 앞머리")
    a = ap.parse_args()

    items = json.loads(pathlib.Path(a.plan).read_text(encoding="utf-8"))["목록"]
    if a.limit:
        items = items[: a.limit]

    cache = Cache()
    ok, fail = [], []
    try:
        for it in items:
            got = locate(cache, it)
            if got.get("이유"):
                row = {"externalId": it["externalId"], "이유": got["이유"]}
                if got.get("사다리기록"):
                    row["사다리"] = got["사다리기록"]
                if got.get("진단"):
                    row["진단"] = got["진단"]
                fail.append(row)
                continue
            page, pi, rect, run = got["page"], got["pi"], got["칸"], got["run"]
            out = FIGROOT / it["e"] / f"{a.prefix}-q{int(it['q']):02d}.png"
            url = f"/figures/{it['e']}/{out.name}"
            if a.write:
                out.parent.mkdir(parents=True, exist_ok=True)
                page.get_pixmap(clip=rect, dpi=DPI).save(str(out))
            ok.append({"id": it["id"], "externalId": it["externalId"], "e": it["e"],
                       "q": it["q"], "page": pi + 1, "run": run,
                       "urls": [url], "publicPath": url})
    finally:
        cache.close()

    RESULT_P = pathlib.Path(a.result)
    RESULT_P.parent.mkdir(parents=True, exist_ok=True)
    RESULT_P.write_text(json.dumps(
        {"기록": a.write, "대상": len(items), "성공수": len(ok), "실패수": len(fail),
         "실패": fail, "계획": ok}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("── PDF 발문 기준 오려내기 ──", "기록함" if a.write else "드라이런")
    print(f"  대상 {len(items)} · 성공 {len(ok)} · 실패 {len(fail)}")
    why: dict[str, int] = {}
    for f in fail:
        why[f["이유"].split("(")[0].strip()] = why.get(f["이유"].split("(")[0].strip(), 0) + 1
    for k, v in sorted(why.items(), key=lambda kv: -kv[1]):
        print(f"     {k} {v}")
    print(f"→ {RESULT_P}")


if __name__ == "__main__":
    main()
