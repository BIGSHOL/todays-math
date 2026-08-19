# -*- coding: utf-8 -*-
"""RPM 교재 PDF 에서 `source_coords` 좌표대로 문항 그림을 오려낸다. **LLM 토큰 0.**

계획: `scripts/qa/reports/rpm-crop-plan.json`
      (`npx tsx scripts/qa/recover-rpm-figures-from-pdf.ts` 가 만든다)
산출: `public/figures/rpm/<externalId>/0.png`
      `scripts/qa/reports/rpm-crop-result.json`

사용: python scripts/figure/crop-rpm-from-pdf.py [--dpi 200] [--limit N]

## 좌표계

sumaek 의 `questions.source_coords` 는 `{"x0","y0","x1","y1","page"}` 이고
**PDF 포인트 좌표 · 좌상단 원점**이다(PyMuPDF 기본과 같다). 그래서 `fitz.Rect` 에
그대로 넣는다. `page` 는 1부터다 — PyMuPDF 인덱스는 0부터라 1을 뺀다.

## 지키는 것

- 원본 이미지를 그대로 뽑지 않고 **영역을 렌더**한다. 교재는 도형이 벡터로 그려져 있어
  xref 추출이 획 단위로 쪼개진다(실측: 기출 2065-4 가 15조각). 영역 렌더는 한 장이다.
- 좌표가 페이지 밖이거나 넓이가 0이면 **오려내지 않는다.** 엉뚱한 자리를 오리면
  그림 없음보다 나쁘다.
- 이미 있는 파일은 건너뛴다(멱등). 중단 후 다시 돌리면 이어 달린다.
- 실패는 결과 파일에 이유와 함께 남긴다 — 숫자만 줄어드는 침묵을 만들지 않는다.
"""
import argparse
import importlib.util
import json
import pathlib
import re
import sys
from difflib import SequenceMatcher

import fitz

# `map-figures.py` 의 그림 검출을 그대로 쓴다 — 이미지 블록 + 벡터 획 군집.
# 검출 규칙을 여기 다시 쓰면 두 곳이 갈라지고, 갈라지면 같이 눈이 먼다.
_HERE = pathlib.Path(__file__).parent
_spec = importlib.util.spec_from_file_location("mapfig", _HERE / "map-figures.py")
mapfig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mapfig)

PLAN = pathlib.Path("scripts/qa/reports/rpm-crop-plan.json")
RESULT = pathlib.Path("scripts/qa/reports/rpm-crop-result.json")
# 원본이 대개 118dpi 라 200 이면 충분히 선명하고 파일도 작다(기출 추출기와 같은 값).
DEFAULT_DPI = 200
# 여백 — 좌표가 획에 딱 붙어 있으면 선이 잘려 보인다.
PAD = 2.0
# 그림에 딸린 라벨을 되찾을 때 허용하는 간격(pt). 본문 줄높이가 약 12pt 라
# 이보다 크게 잡으면 발문 마지막 줄이 딸려 온다(실측 간격 9.3pt).
LABEL_GAP = 4.0
# **라벨 모양의 짧은 글자**만 이만큼까지 더 본다. 직선 이름 `l`·`m` 이 화살촉에서
# 4.5pt 떨어져 통째로 빠졌다(실측 2-2 p57 `l∥m`). 간격을 통째로 넓히면 남의 글자까지
# 들어와 오히려 11건이 검사에 걸려 버려졌다 — 그래서 **넓히는 대신 대상을 좁힌다.**
SIDE_GAP = 8.0
#: 라벨 모양 — 한글이 없고 이보다 짧은 낱말(`l` `m` `A` `16 cm`). 문장은 여기 안 걸린다.
LABEL_TOKEN_MAX = 6
#: **눈금자**를 되찾을 때 보는 거리(pt). 상자그림·좌표평면의 눈금 숫자는 그림에서
#: 10pt 넘게 떨어져 있어 라벨 규칙(4pt)으로는 안 닿는다. 실측 3-2 p104 상자그림 4건이
#: 눈금(`0 2 4 6 8 10(회)`) 없이 오려졌다 — **최솟값을 묻는 문항인데 눈금이 없다.**
#: ⚠️ 그 그림의 눈금선 자체는 **쪽 배경 이미지 안**이라 획으로 안 잡힌다. 그래서
#: 「획이 있나」가 아니라 **숫자가 줄지어 있나**로 찾는다.
AXIS_GAP = 15.0
#: 눈금 한 줄로 보려면 숫자가 이만큼은 있어야 하고, 그림 폭의 이만큼은 덮어야 한다.
AXIS_MIN_TICKS = 3
AXIS_COVER = 0.5
#: 눈금은 고르게 놓인다 — 가장 넓은 간격이 가장 좁은 간격의 이 배를 넘으면 눈금이 아니다.
AXIS_EVEN = 2.5
NUMERIC = re.compile(r"^[0-9]+$")
_HANGUL = re.compile(r"[가-힣]")


def _label_shaped(txt: str) -> bool:
    t = txt.strip()
    return 0 < len(t) <= LABEL_TOKEN_MAX and not _HANGUL.search(t)


def _touches(band, t, txt: str = "") -> bool:
    vgap = max(band.y0 - t.y1, t.y0 - band.y1, 0)
    hgap = max(band.x0 - t.x1, t.x0 - band.x1, 0)
    if vgap <= LABEL_GAP and hgap <= LABEL_GAP:
        return True
    if not _label_shaped(txt):
        return False
    # 한 축이 겹쳐 **나란히** 있는 라벨만 멀리까지 본다.
    return (vgap == 0 and hgap <= SIDE_GAP) or (hgap == 0 and vgap <= SIDE_GAP)
# 조각이 이만큼(pt) 넘게 떨어져 있으면 다른 덩어리로 본다. 그림 조각 사이 간격보다는
# 크고, 쪽 장식과 그림 사이(실측 39pt)보다는 작아야 한다.
CLUSTER_GAP = 12
# 으뜸 덩어리에서 이만큼(pt) 넘게 떨어진 덩어리는 그림이 아니라 쪽 장식으로 본다.
# 한 그림의 조각 사이(액자 3장 등)보다는 크고, 장식까지의 거리(실측 39·90pt)보다는 작아야 한다.
MAX_RUN_GAP = 30
#: 오려낸 칸 안에 DB 발문이 이만큼(글자) 이어져 들어오면 **그림이 아니라 문항을 오린 것**이다.
#: 2026-08-18 리뷰가 잡은 부류이고, 관문을 통과한 뒤에도 남아 있었다(실측 #34: 발문 전량).
STEM_INTRUSION_CHARS = 10
#: 오려낸 칸이 **다른 문항의 좌표 상자**를 이만큼 덮으면 옆 문항 그림이 딸려 온 것이다.
#: (실측 #29: 정오각형 문항 칸에 앞 문항의 정사각형 배열이 통째로 들어왔다.)
NEIGHBOR_OVERLAP = 0.2
#: 오려낸 칸의 **한 줄**에 한글이 이만큼 있으면 그림 라벨이 아니라 «문장»이다.
#: 「내 발문이 들어왔나」만 보면 옆 문항 발문·소문항 꼬리는 구조적으로 안 보인다.
SENTENCE_KO = 12
#: 시험지 **자신의 서식**. 선택지 번호는 그림에 있을 수 없다 — 낱말 목록이 아니라 지면 문법이다.
#: 실측: 「③ 7√3」 이 딸려 온 1건, 선택지가 그림인 문항 2건이 이 검사에 걸린다.
EXAM_SYNTAX = re.compile(r"[①-⑤]")
#: **사람이 보고 뺀 것.** 자동 검사가 다 잡지는 못한다 — 이유를 적어 둔다.
REVIEWED_OUT = {
    "019fd1db-46f3-75f0-8e0e-fd4781b53354":
        "「보기」 글상자만 잡힌다 — 발문이 가리키는 사각형 ABCD 가 칸 밖이다",
}
#: 계획이 「그림이 아니다」로 짚어 준 자리(번호 배지·발문)가 칸에 이만큼 들어오면 버린다.
#: 글자 획 하나가 보이기 시작하는 크기다 — 비율이 아니라 **크기**로 잰다.
INTRUSION_W, INTRUSION_H = 2.0, 4.0
#: 칸 경계에 걸친 요소는 **절반 이상이 안쪽일 때만** 삼킨다 — 그 아래는 남의 것이다.
CROSS_KEEP = 0.4
#: 그림이 `source_coords` 밖으로 나가는 것을 이만큼(pt)까지 허용한다.
#: `source_coords` 는 **발문 기준**이라 그림 전체를 감싸지 않는다 — 실측으로 정사각뿔
#: 꼭대기가 28pt 위로, 원뿔 밑면 치수선이 48pt 오른쪽으로 나가 있었다.
#: 그렇다고 무제한으로 두면 두 문항에 걸친 이미지가 옆 문항까지 끌고 온다 —
#: 그쪽은 **발문 침입 검사**와 **옆 문항 상자 검사**가 막는다.
BOX_BLEED = 60.0
#: 한 줄의 글자가 DB 본문에 이만큼 이어서 들어 있으면 **발문 줄**이다 — 그림 라벨이 아니다.
#: 라벨(`A` `16 cm` `x-y=a`)은 본문에 안 나오고, 발문 줄은 통째로 나온다.
STEM_LINE_CHARS_SPAN = 3
#: 라벨 되찾기를 몇 번 되풀이하나. 위 라벨이 들어와 띠가 커져야 옆 라벨이 닿는다.
LABEL_ROUNDS = 4

KEEP_KO = re.compile(r"[가-힣0-9]+")


def content_key(text: str) -> str:
    """관문(`gate-rpm-crop.py`)과 **같은 열쇠** — 한글+숫자만."""
    return "".join(KEEP_KO.findall(text))


def longest_common_run(a: str, b: str) -> int:
    """두 문자열의 가장 긴 공통 부분열 길이. 발문이 통째로 딸려 왔는지 본다."""
    if not a or not b:
        return 0
    return max(
        (m.size for m in [SequenceMatcher(None, a, b).find_longest_match(0, len(a), 0, len(b))]),
        default=0,
    )

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def _largest_run(parts: list[fitz.Rect], axis: str) -> list[fitz.Rect]:
    """한 축으로 투영해 **가장 넓이가 큰 덩어리**만 남긴다.

    문항 사각형 안에 그림 말고 다른 것이 끼어 있을 때가 있다 — 실측 `019fd1d6-f4e6` 은
    쪽 장식 배지(`09`)가 그래프에서 세로로 39pt 떨어져 같이 들어왔다. 그림이 여러 조각인
    경우(성냥개비 5단계, 액자 3장)를 쪼개면 안 되므로 **조각끼리 붙어 있으면 한 덩어리**로
    보고, `CLUSTER_GAP` 이상 떨어진 것만 가른다.

    조각이 수천 개라(실측 7,122) 쌍별 비교는 못 쓴다. 1pt 격자에 칠해 빈 구간을 찾는다.
    """
    if not parts:
        return parts
    lo = min((r.y0 if axis == "y" else r.x0) for r in parts)
    hi = max((r.y1 if axis == "y" else r.x1) for r in parts)
    n = max(1, int(hi - lo) + 2)
    filled = bytearray(n)
    for r in parts:
        a = int((r.y0 if axis == "y" else r.x0) - lo)
        b = int((r.y1 if axis == "y" else r.x1) - lo)
        for i in range(max(0, a), min(n, b + 1)):
            filled[i] = 1

    runs: list[tuple[float, float]] = []
    i = 0
    while i < n:
        if not filled[i]:
            i += 1
            continue
        j = i
        gap = 0
        while j + 1 < n:
            if filled[j + 1]:
                gap = 0
            else:
                gap += 1
                if gap > CLUSTER_GAP:
                    break
            j += 1
        runs.append((lo + i, lo + j - min(gap, CLUSTER_GAP)))
        i = j + 1

    if len(runs) <= 1:
        return parts

    def center(r: fitz.Rect) -> float:
        return (r.y0 + r.y1) / 2 if axis == "y" else (r.x0 + r.x1) / 2

    def area_in(run: tuple[float, float]) -> float:
        return sum(
            max(r.get_area(), 1.0) for r in parts if run[0] <= center(r) <= run[1]
        )

    # **거리로 가른다.** 「가장 큰 덩어리만」으로 했더니 두 줄짜리 그림의 아랫줄을 잃었고
    # (실측 `019fd1d6-871b` 액자 [3장]), 「크기로 남긴다」로 바꿨더니 이번엔 **쪽 장식
    # 동그라미가 으뜸의 65%나 되어** 그대로 남았다(적대적 리뷰 실측 `019fd1da-41ef`).
    # 크기는 장식과 그림을 못 가른다 — 가르는 것은 **떨어진 거리**다.
    # 한 그림의 조각들은 서로 붙어 있고, 쪽 장식은 멀리 있다(실측 39pt · 90pt).
    areas = {run: area_in(run) for run in runs}
    main = max(runs, key=lambda r: areas[r])
    keep = [
        run
        for run in runs
        if max(main[0] - run[1], run[0] - main[1], 0) <= MAX_RUN_GAP
    ]
    return [r for r in parts if any(run[0] <= center(r) <= run[1] for run in keep)]


def largest_cluster(parts: list[fitz.Rect]) -> list[fitz.Rect]:
    """**세로로만** 걸러 낸다 — 쪽 장식처럼 작고 떨어진 것만 버린다.

    가로로도 걸러 봤다가 수직선 그림을 잃었다 — 눈금 점 사이가 30pt씩 벌어져 있어
    점 하나만 남고 크기 검사에서 떨어졌다(실측 `019fd1d5-988a`). 성긴 그림은 가로로
    원래 듬성듬성하다.

    걸러 내려던 쪽 장식은 세로로 39pt 떨어져 있어 **세로만으로 갈린다.**
    과다 절단이 미검출보다 나쁘므로(잘못 오린 그림은 눈에 안 띈다) 여기서 멈춘다.
    """
    return _largest_run(parts, "y")


def figure_rect(page, box: fitz.Rect, stem_key: str = "",
                min_overlap: float = 12.0,
                avoid: list[fitz.Rect] | None = None) -> fitz.Rect | None:
    """문항 사각형 **안에서 그림만** 골라 낸다.

    `source_coords` 는 문항 블록 전체(발문 + 그림)다. 그대로 오리면 발문이 지면에
    **두 번** 나온다 — 본문 글자로 한 번, 그림 안에 또 한 번. 실측으로 확인했다.

    ## 열쇠: **그림은 DB 본문에 없는 것**이다

    처음엔 「획 덩어리를 찾고, 거기 붙은 글자를 라벨로 되찾는다」였다. 간격·겹침
    임계값을 다섯 번 고쳤는데 그때마다 다른 것이 깨졌다 — 꼭짓점 이름 `A P D` 를
    넣으면 `16 cm` 가 빠지고, 그걸 넣으면 발문이 딸려 왔다. **간격은 그림과 발문을
    가르는 성질이 아니기 때문**이다(실측: 라벨까지 0.4pt, 발문까지 9.3pt — 겹친다).

    가르는 성질은 따로 있다. **발문은 DB `content` 에 있고 그림 라벨은 없다.**
    `A` `P` `16 cm` `20 cm` 는 본문 어디에도 안 나오고, 「오른쪽 그림과 같은
    직사각형」은 그대로 나온다. 그래서 줄 단위로 본문에 있나 없나를 보고 가른다 —
    본문과 **독립인 근거**가 아니라 본문 **그 자체**를 쓰는 것이고, 이게 가장
    직접적이다(CLAUDE.md 2026-08-18 「판정 근거를 한 컬럼에서만 찾지 말 것」).

    ## 그래도 남는 두 가지

    1. **쪽 전체가 이미지 블록 하나**다(실측 `Rect(0,0,589.5,807.8)`). 쪽을 덮는 것은
       그림이 아니라 배경이다.
    2. **수직선이 「긴 밑줄」로 걸러진다** — 페이지 검출기(`map-figures.py`)는
       `height<2 and width>120` 을 밑줄로 버리는데 수직선 그림의 축이 그 모양이다
       (실측 `019fd1d5-988a`). 그래서 그 규칙은 여기서 안 쓴다.

    하나도 없으면 **오려내지 않는다** — 발문 사진을 붙이느니 안 붙이는 게 낫다.
    """
    page_area = page.rect.get_area()
    raw = page.get_text("rawdict")

    def is_page_furniture(r: fitz.Rect) -> bool:
        """쪽 전체를 덮는 것은 그림이 아니다 — 배경 이미지·쪽 테두리다."""
        return r.get_area() >= page_area * 0.7

    text_blocks = [
        fitz.Rect(*b["bbox"])
        for b in raw.get("blocks", [])
        if b.get("type") == 0 and not fitz.Rect(*b["bbox"]).is_empty
    ]

    def is_inside_text(r: fitz.Rect) -> bool:
        """글자 블록에 거의 잠겨 있으면 수식 부속이다(분수 가로줄·근호 등)."""
        for t in text_blocks:
            inter = r & t
            if not inter.is_empty and inter.get_area() >= r.get_area() * 0.8:
                return True
        return False

    # 그림이 발문 상자를 넘어가는 만큼만 허용하는 테두리.
    # `source_coords` 는 발문 기준이라 그림 전체를 감싸지 않는다 — 실측으로 정사각뿔
    # 꼭대기가 28pt 밖이었다. 그렇다고 무제한이면 두 문항에 걸친 이미지가 옆 문항을 끌고 온다.
    bleed = fitz.Rect(box.x0 - BOX_BLEED, box.y0 - BOX_BLEED,
                      box.x1 + BOX_BLEED, box.y1 + BOX_BLEED) & page.rect

    # ── 발문 줄과 그림 라벨을 가른다 ────────────────────────────────────
    # 줄 단위로 본다. span 단위는 너무 짧아(`의 `, `2`) 본문 어디에나 있고,
    # 블록 단위는 너무 길어(폭 236pt) 라벨을 통째로 삼킨다.
    label_rects: list[fitz.Rect] = []
    label_text: dict[int, str] = {}
    span_rects: list[fitz.Rect] = []
    for b in raw.get("blocks", []):
        if b.get("type") != 0:
            continue
        for ln in b.get("lines", []):
            for sp in ln.get("spans", []):
                sr = fitz.Rect(*sp["bbox"])
                # **`box` 가 아니라 `bleed` 로 거른다.** 라벨은 발문 상자 밖에 있을 때가
                # 많다 — 실측 `019fd1da-460b` 의 `D` `C` 는 상자 오른쪽 5.4pt 밖이라
                # 상자로 거르면 통째로 사라지고, 인쇄물에 꼭짓점 이름이 반만 나온다.
                if sr.is_empty or (sr & bleed).is_empty:
                    continue
                # ⚠️ **완비 검사(`span_rects`)에는 반드시 넣는다.** 「삼키지 마라」는
                #    「없는 셈 쳐라」가 아니다 — 빼 두었더니 칸이 각도값 `100°` 를
                #    반으로 자르고도 조용히 통과했다(실측 사다리꼴 1건).
                span_rects.append(sr)
                # **문항 번호 배지·발문 낱말은 라벨이 아니다.** 계획이 그 자리를
                # 알려 주면 라벨로는 안 본다 — 실측 1-2 p121 의 `0803` 이 원뿔에 0pt 로
                # 붙어 있어 라벨 되찾기가 그대로 삼켰다.
                # 문턱이 낮으면 **배지 옆에 붙은 라벨**까지 같이 막힌다 — 실측으로
                # 꼭짓점 이름 `C` 가 배지 상자에 63% 걸려 통째로 사라졌다.
                if avoid and any(
                    not (sr & av).is_empty
                    and (sr & av).get_area() >= sr.get_area() * 0.8
                    for av in avoid
                ):
                    continue
                k = content_key(
                    "".join(c["c"] for c in sp.get("chars", []) if "c" in c)
                )
                # 본문에 이만큼 이어서 들어 있으면 발문 조각이다.
                # ⚠️ **줄 단위로 보면 안 된다.** RPM 은 발문 첫 줄과 그림 꼭짓점 이름이
                #    같은 줄에 있다(실측 `019fd1da-460b`: `오른쪽 그림과 같은 직사각형`
                #    과 `A P D` 가 한 줄). 줄로 가르면 라벨이 발문에 딸려 통째로 버려진다.
                # 라틴 글자·기호만인 조각은 열쇠가 비어(한글+숫자만 남기므로) 라벨로 남는다 —
                # `A` `P` `x-y=a` 가 그렇고, 이건 본문에 없는 것들이라 옳다.
                if len(k) >= STEM_LINE_CHARS_SPAN and longest_common_run(k, stem_key) >= STEM_LINE_CHARS_SPAN:
                    continue
                label_rects.append(sr)
                label_text[id(sr)] = "".join(
                    c["c"] for c in sp.get("chars", []) if "c" in c
                )

    core: list[fitz.Rect] = []
    # 자르기 **전** 크기도 같이 든다. 잘라 놓은 것만 보면 「칸이 요소를 반으로 잘랐다」를
    # 구조적으로 못 본다 — 이미 잘려 있으니 경계를 «가로지르지» 않는다(실측: 원뿔이
    # 48pt 밖까지 뻗었는데 bleed 30 으로 잘려 있어 완비 검사가 초록이었다).
    core_raw: list[fitz.Rect] = []

    for b in raw.get("blocks", []):
        if b.get("type") == 0:
            continue
        r = fitz.Rect(*b["bbox"])
        if is_page_furniture(r):
            continue
        inter = r & box
        # 겹친 부분이 «그림이라 할 만한 크기»인가를 본다 — 후보가 얼마나 들어왔나가
        # 아니다(한 이미지가 두 문항에 걸치면 비율은 뜻을 잃는다).
        # ⚠️ 상자가 **추정치**일 때는 이 문턱을 낮춰야 한다 — 발문으로 상자를 잡는
        #    `crop-pdf-by-stem.py` 는 그림이 상자 끝에 5pt 만 걸치는 일이 흔하다.
        if inter.is_empty or inter.width < min_overlap or inter.height < min_overlap:
            continue
        core.append(r & bleed)
        core_raw.append(r)

    for d in page.get_drawings():
        r = fitz.Rect(d["rect"])
        if r.is_empty or r.is_infinite or is_page_furniture(r):
            continue
        if (r & box).is_empty or is_inside_text(r):
            continue
        core.append(r & bleed)
        core_raw.append(r)

    if not core:
        return None

    # 획·이미지만으로 먼저 덩어리를 고른다. 라벨은 «어느 덩어리에 붙었나»로 정해지므로
    # 여기서 같이 넣으면 발문 옆 라벨이 덩어리를 옆으로 늘려 버린다.
    core = largest_cluster(core)
    if not core:
        return None
    out = core[0]
    for r in core[1:]:
        out |= r

    # ── 라벨을 되찾는다 — 그림 덩어리에 «닿는» 것만 ──────────────────────
    # 발문 줄은 위에서 이미 뺐으므로, 여기서는 간격을 넉넉히 줘도 발문이 안 들어온다.
    # 되풀이하는 이유: 위 라벨(`A P`)이 들어와 띠가 커져야 옆 라벨(`D` `C`)이 닿는다.
    # 한 번만 하면 `A P` 는 들어오고 `D C` 는 잘린다(실측 `019fd1da-460b`).
    for _ in range(LABEL_ROUNDS):
        band = fitz.Rect(out)
        grew = False
        for t in label_rects:
            if band.contains(t):
                continue
            if _touches(band, t, label_text.get(id(t), "")):
                out |= t
                grew = True
        if not grew:
            break

    # ── 눈금자를 되찾는다 — 줄지어 선 숫자 ──────────────────────────────
    rows: dict[int, list[fitz.Rect]] = {}
    for t in label_rects:
        txt = label_text.get(id(t), "").strip()
        if not NUMERIC.match(txt):
            continue
        if max(out.y0 - t.y1, t.y0 - out.y1, 0) > AXIS_GAP:
            continue
        rows.setdefault(int(round(t.y0 / 3)), []).append(t)
    for row in rows.values():
        if len(row) < AXIS_MIN_TICKS:
            continue
        row = sorted(row, key=lambda t: t.x0)
        vals = [int(label_text[id(t)].strip()) for t in row]
        # **눈금은 왼쪽에서 오른쪽으로 커지고 고르게 놓인다.** 이 조건이 없으면
        # 다각형 그림의 각도값(`50 60 75`)이 눈금으로 잡혀 칸이 엉뚱하게 넓어진다
        # (실측 3건이 그렇게 검사에 걸려 버려졌다).
        if any(b <= a for a, b in zip(vals, vals[1:])):
            continue
        mids = [(t.x0 + t.x1) / 2 for t in row]
        gaps = [b - a for a, b in zip(mids, mids[1:])]
        if min(gaps) <= 0 or max(gaps) / min(gaps) > AXIS_EVEN:
            continue
        band = row[0]
        for t in row[1:]:
            band |= t
        if band.width < out.width * AXIS_COVER or band.x0 > out.x1 or band.x1 < out.x0:
            continue
        out |= band
    # 눈금을 들인 뒤 라벨을 한 번 더 — 눈금 끝에 붙은 단위(`(회)`)를 되찾는다.
    for _ in range(LABEL_ROUNDS):
        band = fitz.Rect(out)
        grew = False
        for t in label_rects:
            if band.contains(t):
                continue
            if _touches(band, t, label_text.get(id(t), "")):
                out |= t
                grew = True
        if not grew:
            break

    # ── 완비 검사 — **아무것도 반으로 자르지 않는다** ────────────────────
    # 지금까지 간격·겹침 임계값을 여섯 번 고쳤고, 고칠 때마다 다른 쪽이 잘렸다
    # (꼭짓점 이름 `D` `C`, 식 꼬리 `=0`, 치수 `16 cm`). 임계값을 더 만지는 대신
    # **불변식**을 둔다: 오려낸 칸의 경계를 가로지르는 요소가 하나라도 있으면
    # 넓혀서 삼키고, `bleed` 안에서 못 삼키면 **오려내지 않는다.**
    # 잘린 그림을 붙이는 것보다 안 붙이는 게 낫다 — 잘린 것은 지면에서 티가 안 난다.
    # **발문 조각까지 포함해서** 본다. 라벨로 분류된 것만 보면, 발문으로 잘못 분류된
    # 그림 라벨이 잘려도 못 잡는다 — 실측 `019fd1da-6321` 의 `3x-2y+12=0` 은 본문에도
    # 같은 식이 있어 발문으로 갈렸고, 그 바람에 꼬리 `0` 이 칸 밖에 남았다.
    # 삼킨 뒤 정말로 발문이 들어왔다면 아래 **발문 침입 검사**가 그 문항을 버린다.
    edges = span_rects + core_raw
    for _ in range(LABEL_ROUNDS):
        grew = False
        for t in edges:
            if out.contains(t) or (t & out).is_empty:
                continue
            merged = out | t
            if not bleed.contains(merged):
                continue
            out = merged
            grew = True
        if not grew:
            break
    for t in edges:
        if not out.contains(t) and not (t & out).is_empty:
            return None

    # 쪽 밖으로는 못 나간다. 발문 상자로는 자르지 않는다(bleed 참조).
    out = out & page.rect
    # 너무 작으면 그림이 아니라 잡티다(밑줄 한 토막·점 하나).
    if out.is_empty or out.width < 30 or out.height < 20:
        return None
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dpi", type=int, default=DEFAULT_DPI)
    ap.add_argument("--limit", type=int)
    # 기본 계획은 **관문을 안 거친 날 좌표**다. 2026-08-18 리뷰가 잡은 14/37 결함은
    # 그 좌표가 책마다 어긋나 있어서였다 — 붙일 것을 오릴 때는 관문이 고른 계획을 쓴다.
    ap.add_argument("--plan", default=str(PLAN),
                    help="좌표 계획 (기본: 날 좌표. 붙일 때는 "
                         "scripts/qa/reports/rpm-crop-plan-gated.json)")
    # ⚠️ 계획을 두 벌(관문 통과분·무리 그림) 돌리는데 결과 파일이 하나면
    #    **뒤에 돌린 것이 앞의 것을 덮는다.** 조용히 사라지므로 낼 곳을 나눌 수 있게 한다.
    ap.add_argument("--out", default=str(RESULT), help="결과 JSON 을 낼 곳")
    ap.add_argument("--content", default="scripts/qa/reports/rpm-crop-content.json",
                    help="DB 본문 — 오려낸 칸에 발문이 딸려 왔는지 보는 근거")
    a = ap.parse_args()

    plan_path = pathlib.Path(a.plan)
    if not plan_path.exists():
        raise SystemExit(
            f"계획이 없다: {plan_path}\n"
            "먼저 돌려라 — npx tsx scripts/qa/recover-rpm-figures-from-pdf.ts"
        )
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    items = plan["목록"][: a.limit] if a.limit else plan["목록"]
    content = {}
    cpath = pathlib.Path(a.content)
    if cpath.exists():
        content = json.loads(cpath.read_text(encoding="utf-8"))
    else:
        print(f"⚠️ 본문 파일이 없다({cpath}) — 발문 침입 검사를 못 한다.")
    # 같은 쪽의 **다른 문항** 상자. 오려낸 칸이 이걸 덮으면 옆 문항 그림이 딸려 온 것이다.
    # 계획 전량을 쓴다 — 이번에 오리는 것만 보면 옆 문항이 목록에 없을 때 눈이 먼다.
    all_boxes = json.loads(PLAN.read_text(encoding="utf-8"))["목록"]
    # ⚠️ 날 계획의 `page` 는 **DB 쪽번호**이고, 관문을 거친 계획의 `page` 는 거기에
    # 책별 **쪽 오프셋**이 더해진 값이다(실측 3-2 는 +3). 그대로 맞대면 3-2 는 키가
    # 어긋나 옆 문항 상자가 **하나도 안 잡히고**, 그러면 이 검사가 조용히 통과한다 —
    # 가드가 없는 것과 같다. 오려낼 계획이 들고 있는 `pageOff` 로 맞춰 준다.
    page_off_of: dict[str, int] = {}
    for it in items:
        off = int(it.get("pageOff", 0) or 0)
        name = pathlib.Path(it["pdf"]).name
        if page_off_of.setdefault(name, off) != off:
            raise SystemExit(f"한 책에 쪽 오프셋이 둘이다: {name}")
    by_page: dict[tuple[str, int], list[dict]] = {}
    for b in all_boxes:
        name = pathlib.Path(b["pdf"]).name
        page = int(b["page"]) + page_off_of.get(name, 0)
        by_page.setdefault((name, page), []).append(b)

    # 원본이 없으면 **그 사실을 먼저 말한다.** 0건 성공을 조용히 보고하지 않는다.
    missing_pdf = sorted(
        {i["pdf"] for i in items if not pathlib.Path(i["pdf"]).exists()}
    )
    if missing_pdf:
        print(f"⛔ 원본 PDF 가 없다 ({len(missing_pdf)}개):")
        for m in missing_pdf:
            print(f"   {m}")
        print("   → 문서 docs/planning/16-figure-recovery-ledger.md §4.1 참조")

    docs: dict[str, fitz.Document] = {}
    ok: list[dict] = []
    fail: list[dict] = []
    skipped = 0

    try:
        for it in items:
            if it["externalId"] in REVIEWED_OUT:
                fail.append({"externalId": it["externalId"],
                             "이유": f"사람이 뺐다 — {REVIEWED_OUT[it['externalId']]}"})
                continue
            out = pathlib.Path(it["out"])
            if out.exists() and out.stat().st_size > 0:
                skipped += 1
                ok.append(
                    {"problemId": it["problemId"], "publicPath": to_public(out)}
                )
                continue

            pdf = it["pdf"]
            if not pathlib.Path(pdf).exists():
                fail.append({"externalId": it["externalId"], "이유": "원본 PDF 없음"})
                continue
            if pdf not in docs:
                docs[pdf] = fitz.open(pdf)
            doc = docs[pdf]

            page_index = int(it["page"]) - 1
            if not (0 <= page_index < doc.page_count):
                fail.append(
                    {"externalId": it["externalId"], "이유": f"쪽 범위 밖 {it['page']}"}
                )
                continue
            page = doc[page_index]

            x0, y0, x1, y1 = (float(v) for v in it["rect"])
            box = fitz.Rect(x0, y0, x1, y1) & page.rect
            if box.is_empty or box.width < 4 or box.height < 4:
                fail.append(
                    {"externalId": it["externalId"], "이유": "좌표가 비었거나 너무 작다"}
                )
                continue

            db_key = content_key(content.get(it["problemId"], ""))
            avoid = [fitz.Rect(*a) for a in it.get("avoid", [])]
            # 「삼키지 말 것」과 「들어오면 버릴 것」은 **다른 목록**이다 — 계획 주석 참조.
            forbid = [fitz.Rect(*a) for a in it.get("forbid", avoid)]
            fig = figure_rect(page, box, db_key, avoid=avoid)
            if fig is None:
                fail.append(
                    {"externalId": it["externalId"], "이유": "문항 안에서 그림을 못 찾았다"}
                )
                continue
            rect = fitz.Rect(
                fig.x0 - PAD, fig.y0 - PAD, fig.x1 + PAD, fig.y1 + PAD
            ) & page.rect
            # 여백(PAD) 때문에 **번호 배지에 새로 닿았다면** 그만큼 물러선다.
            # 그림 자체가 배지에 닿은 것이 아니라 여백이 닿은 것이므로 자를 것도 없다.
            for av in avoid:
                if not (av & fig).is_empty or (av & rect).is_empty:
                    continue
                if av.x1 <= fig.x0:
                    rect.x0 = max(rect.x0, av.x1 + 0.2)
                elif av.x0 >= fig.x1:
                    rect.x1 = min(rect.x1, av.x0 - 0.2)
                elif av.y1 <= fig.y0:
                    rect.y0 = max(rect.y0, av.y1 + 0.2)
                elif av.y0 >= fig.y1:
                    rect.y1 = min(rect.y1, av.y0 - 0.2)

            # ── 관문 뒤에도 남는 두 부류를 여기서 막는다 (2026-08-18 육안 검수) ──
            # ⑴ 발문 침입 — 그림이 아니라 문항을 통째로 오린 것.
            box_key = content_key(page.get_text("text", clip=rect))
            run = longest_common_run(box_key, db_key)
            if run >= STEM_INTRUSION_CHARS:
                fail.append({"externalId": it["externalId"],
                             "이유": f"칸에 발문이 {run}자 들어왔다"})
                continue
            # ⑵ 문장·선택지 침입 — 그림이 아니라 지면을 오린 것이다.
            box_text = page.get_text("text", clip=rect)
            longest_ko = max(
                (sum(1 for ch in ln if "가" <= ch <= "힣") for ln in box_text.splitlines()),
                default=0,
            )
            if longest_ko >= SENTENCE_KO:
                fail.append({"externalId": it["externalId"],
                             "이유": f"칸에 문장이 들어왔다 (한 줄 한글 {longest_ko}자)"})
                continue
            if EXAM_SYNTAX.search(box_text):
                fail.append({"externalId": it["externalId"], "이유": "칸에 선택지 번호가 들어왔다"})
                continue
            # ⑶ 옆 문항 침입 — 다른 문항의 좌표 상자를 덮었다.
            clash = None
            for b in by_page.get((pathlib.Path(pdf).name, int(it["page"])), []):
                if b["problemId"] == it["problemId"]:
                    continue
                other = fitz.Rect(*b["rect"])
                inter = other & rect
                if not inter.is_empty and inter.get_area() > NEIGHBOR_OVERLAP * other.get_area():
                    clash = b["externalId"]
                    break
            if clash is not None:
                fail.append({"externalId": it["externalId"],
                             "이유": f"옆 문항 상자를 덮었다 ({clash[:13]})"})
                continue
            # ⑷ 지면 글자 침입 — 계획이 「여기는 그림이 아니다」로 짚어 준 자리
            #    (문항 번호 배지·발문 낱말)가 칸에 들어왔다면 **버린다.**
            #    막는 것과 세는 것을 같은 근거(계획이 준 `avoid`)로 둔다.
            # ⚠️ **면적 비율로 재면 안 된다.** 네 자리 배지의 마지막 한 글자만
            #    들어와도 비율은 25% 라 통과한다 — 실측으로 초록 `7`·`2` 가 그림 옆에
            #    그대로 찍혔다. 사람 눈에 보이는 것은 비율이 아니라 **글자 조각의 크기**다.
            if any(
                (av & rect).width >= INTRUSION_W and (av & rect).height >= INTRUSION_H
                for av in forbid
                if not (av & rect).is_empty
            ):
                fail.append({"externalId": it["externalId"],
                             "이유": "칸에 지면 글자가 들어왔다 (번호 배지·발문)"})
                continue

            out.parent.mkdir(parents=True, exist_ok=True)
            pix = page.get_pixmap(clip=rect, dpi=a.dpi)
            pix.save(str(out))
            ok.append({"problemId": it["problemId"], "publicPath": to_public(out)})
    finally:
        for d in docs.values():
            d.close()

    result_path = pathlib.Path(a.out)
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(
        json.dumps(
            {
                "대상": len(items),
                "성공수": len(ok),
                "이미있음": skipped,
                "실패수": len(fail),
                "실패": fail,
                "성공": ok,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(
        f"── 오려내기 ── 대상 {len(items)} · 성공 {len(ok)}"
        f"(그중 이미있음 {skipped}) · 실패 {len(fail)}"
    )
    for reason in sorted({f['이유'] for f in fail}):
        n = sum(1 for f in fail if f["이유"] == reason)
        print(f"   실패:{reason} {n}")
    print(f"→ {result_path}")
    if ok and not missing_pdf:
        print(
            "다음: ALLOW_SHARED_IMPORT=1 npx tsx "
            "scripts/qa/recover-rpm-figures-from-pdf.ts --attach"
        )


def to_public(out: pathlib.Path) -> str:
    """`public/figures/rpm/<id>/0.png` → `/figures/rpm/<id>/0.png`"""
    return "/" + out.as_posix().split("public/", 1)[1]


if __name__ == "__main__":
    main()
