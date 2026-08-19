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

# ── 원문자 목록은 **한 곳**에서 온다 ──────────────────────────────────────────
# `scripts/qa/circled-glyphs.json` 은 `src/lib/math/circledNumber.ts` 에서 생성된다
# (`npx tsx scripts/qa/emit-circled-glyphs.ts`). 손으로 나열하면 세는 쪽과 고치는
# 쪽이 같이 눈이 먼다 — 실제로 `➀`(U+2780) 계열 43행을 아무도 못 보고 있었다.
#
# 이 파일이 목록을 **읽는 유일한 자리**다. `crop-pdf-by-stem.py` 는 이 모듈을 이미
# 통째로 import 하므로 `croprpm.CIRCLED_ANSWER` 를 쓴다 — 로더가 두 벌이 되면
# 한쪽만 고쳐도 아무도 모른다.
CIRCLED_ANSWER = json.loads(
    (pathlib.Path(__file__).resolve().parent.parent / "qa" / "circled-glyphs.json")
    .read_text(encoding="utf-8")
)["정답판독_전체글자"]


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


def span_rect(sp, tight: bool = False) -> fitz.Rect:
    """조각(span)의 상자. `tight` 면 **보이는 글자에 바짝 조인다.**

    PDF 조각 상자는 꼬리 공백·안 보이는 제어 글자까지 담는다. 실측 1-2 p66 의
    발문 마지막 조각은 `'에서 \x08'` 이라 상자가 489.4 까지 가는데, 그 자리에는
    이미 **그림 꼭짓점 `B`**(488.8~)가 서 있다. 조이지 않고 자를 자리를 고르면
    그 `B` 를 반으로 자른 것으로 보고, 자를 자리가 **그림 라벨을 타고** 그림
    한가운데(518.9)까지 밀려간다. 실제로 그렇게 밀렸다.

    ⚠️ **조이는 것은 「본문이 말하는 자리」 폴백에서만 쓴다.** 완비 검사·라벨
       되찾기의 기존 경로는 조이지 않은 상자로 이미 값을 치르고 자리를 잡았다 —
       거기까지 바꾸면 회수해 둔 것들의 좌표가 흔들린다(md5 로 검산한다).
       대신 폴백 안에서는 **자르는 쪽과 검사하는 쪽이 같은 자를** 쓴다.
    """
    if not tight:
        return fitz.Rect(*sp["bbox"])
    chars = sp.get("chars", [])
    # **제어 코드가 늘 «안 보이는 것»은 아니다.** 둘을 갈라야 한다.
    #
    # · 글자가 든 조각의 **꼬리에 붙은** 제어 코드 — 지면에 아무것도 안 그린다.
    #   실측 1-2 p66 발문 마지막 조각이 `'에서 '` 이고 그 `` 이 상자를 3.5pt
    #   늘려, 바로 옆 꼭짓점 `B` 를 반으로 가르는 자리에 벽이 서게 만들었다.
    # · **조각이 통째로 제어 코드뿐**이면 그건 글꼴이 그렇게 인코딩한 **진짜 글자**다.
    #   RPM 수식 글꼴(`EHsang-Plain-KSCms-UHC-H`)은 숫자 `2` 를 `` 으로 적는다.
    #   그것을 «안 보인다»고 버렸더니 치수 `2 cm` 의 숫자가 벽 밖으로 나가고,
    #   그 칸이 그대로 오려져 **숫자가 반쯤 잘린 그림**이 나왔다(육안으로 잡았다).
    inked = any(
        c.get("c", "").strip() and c["c"].isprintable() for c in chars
    )
    out: fitz.Rect | None = None
    for c in chars:
        ch = c.get("c", "")
        if not ch or ch.isspace():
            continue
        if inked and not ch.isprintable():
            continue
        cr = fitz.Rect(*c["bbox"])
        if cr.is_empty:
            continue
        out = cr if out is None else (out | cr)
    return out if out is not None else fitz.Rect()


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
#: ⚠️ 이 관문은 **버리는** 규칙이다 — 넓히면 회수가 줄 뿐 **늘지 않는다.** 그래서
#:    ①~⑤ 에서 90자로 넓히기 전에 세어 봤다(D-20): 관문까지 온 칸 RPM 4 · 기출 5,
#:    그중 ①~⑤ **밖** 글자가 나온 칸은 **0개**. 오늘 자료에서는 무손실이고, 넓힌 값은
#:    「못 가르면 버리는 쪽」(2026-08-18 교훈)으로 앞으로 올 교재를 막는 몫이다.
EXAM_SYNTAX = re.compile(f"[{re.escape(CIRCLED_ANSWER)}]")
#: **사람이 보고 뺀 것.** 자동 검사가 다 잡지는 못한다 — 이유를 적어 둔다.
REVIEWED_OUT = {
    "019fd1db-46f3-75f0-8e0e-fd4781b53354":
        "「보기」 글상자만 잡힌다 — 발문이 가리키는 사각형 ABCD 가 칸 밖이다",
    # 2026-08-19 넓힘 폴백 18건 육안 검수. **본문 밖 근거로 잘린 것을 알았다** —
    # 발문이 「8개의 공장」이고 정답이 28 = C(8,2) 인데 오려진 칸에는 공장이 5개뿐이고
    # 왼쪽 아래가 잘렸다. 잘린 그림은 지면에서 티가 안 난다(2026-08-18 교훈).
    #
    # ⚠️ 왜 자동으로 안 걸리나: `figure_rect` 에는 「칸 경계를 가로지르는 것이 있으면
    # 넓히고, 못 삼키면 오려내지 않는다」는 불변식이 있는데, **이미지는 `min_overlap`
    # (12pt) 보다 적게 겹치면 후보에서 아예 빠진다.** 후보가 아니면 «가로질렀다»고
    # 셀 수도 없다. 이 공장 아이콘들은 작은 이미지 조각 여럿이라 그 구멍에 그대로 빠진다.
    # 고치려면 결과에 **칸 좌표를 남기고** 그 좌표로 이미지 잘림을 따로 재야 한다.
    "019fd1d7-fe94-778d-9c5e-3739ec3aa6d7":
        "공장 8개 중 5개만 오려졌고 왼쪽 아래가 잘렸다 — 정답 28=C(8,2) 가 8개를 요구한다",
}
#: 계획이 「그림이 아니다」로 짚어 준 자리(번호 배지·발문)가 칸에 이만큼 들어오면 버린다.
#: 글자 획 하나가 보이기 시작하는 크기다 — 비율이 아니라 **크기**로 잰다.
INTRUSION_W, INTRUSION_H = 2.0, 4.0
#: **「오른쪽 그림」 폴백** — 두 단 배치라 `source_coords` 가 글자 열만 덮는 문항이 있다.
#: 실측(2026-08-19): 「문항 안에서 그림을 못 찾았다」 47건은 **전부 상자 안에 획이 있다**
#: (획 0개인 문항 0건). 못 찾은 것이지 없는 것이 아니다. 여섯 칸을 지면에서 떠서 보니
#: 넷은 그림이 상자 안에 그대로 있고, 둘은 「**오른쪽** 그림에서…」인데 상자가 왼쪽
#: 글자 열만 덮고 있었다. 같은 세로 띠를 쪽 오른쪽 끝까지 넓혀 다시 찾으면 2 → 21건이다.
#:
#: ⚠️ **넓힘을 전체에 걸면 안 된다.** 이미 성공한 317건에 같은 넓힘을 대면 좌표가
#: 달라지는 것 94 · 아예 못 찾게 되는 것 36 — **130건이 망가진다.** 그래서 이것은
#: 「보통 상자로 못 찾았을 때만」 도는 **폴백**이다. 성공한 문항은 이 길에 들어오지도
#: 못하므로 손실이 구조적으로 0이다(md5 로 검산한다).
#:
#: ⛔ 곁가지로 `thin_pt`(두께 0인 곧은 선 살리기)도 재 봤는데 **47건 중 0건을 얻고**
#: 이미 회수한 52건의 좌표를 망친다(상자가 글자 열까지 왼쪽으로 벌어진다). 안 쓴다.
WIDEN_RIGHT_MARGIN = 4.0
#: 폴백으로 나온 칸에만 대는 가드 둘. **18건 전량을 눈으로 보고** 나온 것이다.
#:
#: ⑴ RPM 은 **두 단**이다(지면 623.6pt · 한 단 ≈ 311.8pt). 한 문항의 그림이 두 단을
#:    가로지를 수는 없으므로, 넓힌 칸이 한 단보다 넓으면 **옆 단을 삼킨 것**이다.
#:    실측: 나쁜 1건이 336pt 이고 좋은 16건은 최대 104pt — 문턱이 아니라 3배 차이다.
#:    (`019fd1d7-efa9` 는 팔각형 뒤에 옆 문항 `0477` 의 발문과 그림을 통째로 달고 나왔다.
#:     기존 «문장 침입» 가드가 못 잡은 이유는 그것이 **한 줄** 한글을 세는데 단이 좁아
#:     한 줄이 11자였기 때문이다 — `SENTENCE_KO` 는 12다.)
#:
#: ⑵ 칸에 남은 글자가 **문항 번호 하나뿐**이면 그림이 아니라 번호 배지다
#:    (`019fd1d9-9cdf` 는 `0467` 만 오려졌다). 계획이 `avoid` 를 안 준 문항에서 난다.
COLUMN_W = 311.8
BADGE_ONLY = re.compile(r"^\d{3,5}$")
#: ── **「본문이 말하는 자리」 폴백** (2026-08-19) ─────────────────────────
#: 「칸에 발문이 N자 들어왔다」로 떨어진 62건(관문 37 + 무리 25)을 되찾는다.
#: 앞 트랙은 이 부류를 「그림과 발문이 붙어 있어 못 가른다」로 보고 **발문 줄을 흰
#: 사각형으로 덮고 오리기**를 다음 수로 적었는데, 지면을 떠서 보니 **깨끗이 갈린다** —
#: 발문·보기가 한쪽, 그림이 다른 쪽이다. 덮을 필요가 없다.
#:
#: 왜냐면 **책이 스스로 적어 뒀기 때문이다**: 「**오른쪽** 그림에서…」·「**아래** 그림
#: 에서…」. 62건 전량에 이 낱말이 있다(오른쪽 40 · 아래 19 · 다음 3 · 없는 것 0).
#: 문턱을 고르는 게 아니라 **본문을 읽는** 것이다.
#:
#: ⚠️ 낱말은 **축만** 정한다. 어느 쪽인지는 **잉크가** 정한다 — 본문과 독립인 근거다.
#:    다만 낱말과 **반대쪽**(글자가 띠 뒤에만 있는 자리)에서 나온 그림은 다른 배치이므로
#:    버린다. 그래서 이 가드는 «실패할 수 있는» 형태다.
#: ⚠️ **폴백이지 넓힘이 아니다.** 이미 성공한 칸은 여기 들어오지도 못한다 —
#:    손실이 구조적으로 0이고, 오려낸 전 장의 md5 로 검산한다.
STEM_DIRECTION = (
    ("x", "오른쪽", re.compile(r"(?:오른쪽|우측)\s*(?:그림|그래프|표|도형)")),
    ("y", "아래", re.compile(r"(?:아래|다음)\s*(?:그림|그래프|표|도형)")),
)
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
                avoid: list[fitz.Rect] | None = None,
                thin_pt: float = 0.0,
                furniture: set | None = None,
                clip_images: bool = True,
                limit: fitz.Rect | None = None,
                ink_out: list[fitz.Rect] | None = None) -> fitz.Rect | None:
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

    ## `clip_images` — 「삼키지 마라」는 「없는 셈 쳐라」가 아니다 (2026-08-19)

    겹침이 `min_overlap` 에 모자란 이미지는 후보에서 빠지는데, 그러면 **완비 검사가
    «가로질렀다»고 셀 수도 없다.** 칸이 그것을 반으로 잘라도 조용히 통과한다.
    실측 `019fd1d7-fe94`: 공장 8개 그림에서 아래쪽이 겹침 부족으로 빠졌고, 오려낸 칸은
    다섯 개만 담은 채 왼쪽 아래가 잘렸다 — 정답 `28`=C(8,2) 가 8개를 요구해서
    **사람 눈으로만** 드러났다.

    그래서 그런 이미지도 `edges` 에 넣는다(덩어리로는 안 센다). **기본을 켠 이유는
    재 봤기 때문이다**: 이미 성공한 332건 중 좌표가 달라진 것 2건 · **못 찾게 된 것 0건**
    이고, 달라진 둘은 눈으로 보니 **둘 다 개선**이었다(`019fd1d8-bc0e` 는 잘렸던 선반
    오른쪽 기둥이, `019fd1dc-36d2` 는 잘렸던 집이 들어왔다).

    ## `thin_pt` — **곧은 선은 `is_empty` 다** (2026-08-19)

    `fitz.Rect.is_empty` 는 **폭이나 높이 중 하나만 0이어도** 참이다. 축에 나란한
    곧은 선은 정확히 그 모양이라, 첫 가드 `if r.is_empty` 가 **선을 전부 버린다.**

    RPM 그림은 곡선·다각형이라 이게 드러나지 않았다. 기출은 다르다 — 실측
    `3624` 3쪽은 획 99개 중 **97개가 두께 0인 곧은 선**이고, 그 선들이 바로 문항이
    가리키는 **전개도**(표 칸 테두리)다. 「문항 둘레에서 그림을 못 찾았다」로 떨어진
    44행 중 35행이 「상자 안에 획이 아예 없다」였는데, 실제로는 획이 가득했다.

    `thin_pt > 0` 이면 두께 0인 획을 그만큼 부풀려 살린다. **RPM 경로는 0을 그대로
    쓰므로 동작이 한 바이트도 안 바뀐다** — 회수 280건을 다시 흔들지 않기 위해서다.

    ## `furniture` — 선을 살리면 **쪽 장식도 같이 산다**

    단 세로줄(단 사이 구분선)·머리띠 밑줄이 그 부류다. 길이로 자르면 수직선 그림·
    긴 데이터 표가 같이 죽는다(2026-08-16 배너 사건과 같은 자리). 그래서 길이가 아니라
    **여러 쪽에 같은 자리로 되풀이되는가**로 가른다 — 서식이 바뀌어도 걸리고 진짜
    그림은 안 걸린다. `crop-pdf-by-stem.furniture_keys` 가 만든 열쇠 집합을 넘긴다.
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
    # ── `limit` — **넘을 수 없는 벽** (「본문이 말하는 자리」 폴백이 준다) ──
    # 라벨 되찾기·완비 검사의 «삼키기»가 이 밖으로 나가려 하면 **삼키지 않는다.**
    # 그러면 「못 삼키면 오려내지 않는다」 불변식이 그대로 살아, 벽을 가로지르는
    # 요소가 하나라도 있으면 이 함수는 `None` 을 낸다.
    # ⚠️ **`span_rects`(완비 검사가 볼 목록)는 `bleed` 그대로 모은다.** 벽 밖이라고
    #    빼 두면 「삼키지 마라」가 「없는 셈 쳐라」가 되어(2026-08-19 교훈), 벽이
    #    발문을 반으로 잘라도 조용히 통과한다.
    room = (bleed & limit) if limit is not None else bleed

    # ── 발문 줄과 그림 라벨을 가른다 ────────────────────────────────────
    # 줄 단위로 본다. span 단위는 너무 짧아(`의 `, `2`) 본문 어디에나 있고,
    # 블록 단위는 너무 길어(폭 236pt) 라벨을 통째로 삼킨다.
    label_rects: list[fitz.Rect] = []
    label_text: dict[int, str] = {}
    #: 벽 밖에 남은 «발문이 아닌 글자». 칸에 닿으면 그 문항은 버린다(아래).
    outside: list[tuple[fitz.Rect, str]] = []
    span_rects: list[fitz.Rect] = []
    for b in raw.get("blocks", []):
        if b.get("type") != 0:
            continue
        for ln in b.get("lines", []):
            for sp in ln.get("spans", []):
                sr = span_rect(sp, tight=limit is not None)
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
                # 벽 밖의 글자는 **라벨로 끌어오지 않는다.** 끌어오면 띠가 벽을
                # 넘어 자라고, 그 순간 발문 쪽으로 되돌아간다.
                # 다만 **없는 셈 치지도 않는다** — 발문이 아닌 글자(그림 라벨 모양)가
                # 벽 밖에 남아 칸에 닿아 있으면, 그건 **못 가른 것**이다. 아래에서 본다.
                if limit is not None and not room.contains(sr):
                    outside.append((sr, "".join(
                        c["c"] for c in sp.get("chars", []) if "c" in c)))
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
    # **덩어리로는 안 세지만 «자르지 마라»에는 넣는 이미지.** 겹침이 모자라 후보에서
    # 빠진 것들이다 — 이 파일이 span 에 대해 이미 적은 문장이 여기도 그대로다:
    # 「삼키지 마라」는 **「없는 셈 쳐라」가 아니다.** 후보가 아니면 완비 검사가
    # «가로질렀다»고 셀 수도 없어서, 칸이 그것을 반으로 잘라도 조용히 통과한다.
    # 실측(2026-08-19 `019fd1d7-fe94`): 공장 8개가 늘어선 그림에서 아래쪽 넷이
    # 겹침 부족으로 빠졌고, 오려낸 칸은 다섯 개만 담은 채 왼쪽 아래가 잘렸다.
    # 정답 `28`=C(8,2) 가 8개를 요구해서 **사람 눈으로만** 드러났다.
    near_images: list[fitz.Rect] = []

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
            # 덩어리로는 안 세되 **자르지는 못하게** 남긴다(위 주석). 상자에서 아주
            # 먼 것은 남의 것이므로 `bleed` 에 걸친 것만 본다.
            if not inter.is_empty and not (r & bleed).is_empty:
                near_images.append(r)
            continue
        core.append(r & room)
        core_raw.append(r)

    for d in page.get_drawings():
        r = fitz.Rect(d["rect"])
        if r.is_infinite:
            continue
        if r.is_empty:
            # 두께 0인 곧은 선 — 부풀려 살린다(`thin_pt`). 0 이면 예전 그대로 버린다.
            if thin_pt <= 0 or (r.x1 - r.x0 <= 0 and r.y1 - r.y0 <= 0):
                continue
            r = fitz.Rect(r.x0 - thin_pt, r.y0 - thin_pt,
                          r.x1 + thin_pt, r.y1 + thin_pt)
        if is_page_furniture(r):
            continue
        if furniture is not None:
            k = tuple(int(round(v / 3)) for v in (d["rect"][0], d["rect"][1],
                                                  d["rect"][2], d["rect"][3]))
            if k in furniture:
                continue
        if (r & box).is_empty or is_inside_text(r):
            continue
        core.append(r & room)
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
    #: 라벨을 들이기 **전**의 잉크 덩어리. 벽 밖 검사가 이것을 기준으로 본다 —
    #: 자른 자리는 늘 글자 끝에 **바짝** 붙어 있어서, 라벨까지 들인 `out` 으로 재면
    #: 벽 바로 밖의 발문 조각이 늘 «닿았다»가 된다.
    ink = fitz.Rect(out)
    # 「본문이 말하는 자리」 폴백이 이 잉크를 받아 벽을 세운다. 그림을 찾는 규칙을
    # 거기 다시 쓰면 두 곳이 갈라지고, 갈라지면 같이 눈이 먼다.
    if ink_out is not None:
        ink_out.append(fitz.Rect(ink))

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
    edges = span_rects + core_raw + (near_images if clip_images else [])
    for _ in range(LABEL_ROUNDS):
        grew = False
        for t in edges:
            if out.contains(t) or (t & out).is_empty:
                continue
            merged = out | t
            if not room.contains(merged):
                continue
            out = merged
            grew = True
        if not grew:
            break
    for t in edges:
        if not out.contains(t) and not (t & out).is_empty:
            return None

    # ── 벽 밖에 **그림 재료가 남았나** ──────────────────────────────────
    # 벽은 발문을 막으려고 세운 것이지 그림을 자르려고 세운 것이 아니다. 발문이 아닌
    # 글자(꼭짓점 이름·치수)가 벽 밖에 남아 칸에 **닿아** 있으면, 그건 「가르지 못한
    # 자리」다 — 그대로 오리면 라벨 없는 그림이 조용히 나간다. **버린다.**
    # (공백뿐인 조각은 지면에 안 보이므로 세지 않는다.)
    for t, txt in outside:
        if not txt.strip():
            continue
        if _touches(ink, t, txt):
            return None
        # **눈금 숫자는 라벨 간격으로 안 닿는다.** 상자그림·좌표평면의 눈금은 그림에서
        # 10pt 넘게 떨어져 있어 위 검사를 통과해 버린다. 그런데 그것이 벽 밖에 남은
        # 채로 오려내면 **눈금 없는 상자그림**이 나간다 — 「35개 이하」를 묻는 문항인데
        # 눈을 대 볼 자가 없다(실측 3-2 p109 `0627`, 육안으로 잡았다).
        # 안에서 눈금을 되찾는 규칙(`AXIS_GAP`)과 **같은 거리**를 쓴다.
        if NUMERIC.match(txt.strip()) and max(
            ink.y0 - t.y1, t.y0 - ink.y1, ink.x0 - t.x1, t.x0 - ink.x1, 0
        ) <= AXIS_GAP:
            return None

    # 쪽 밖으로는 못 나간다. 발문 상자로는 자르지 않는다(bleed 참조).
    out = out & page.rect
    # 너무 작으면 그림이 아니라 잡티다(밑줄 한 토막·점 하나).
    if out.is_empty or out.width < 30 or out.height < 20:
        return None
    return out


def stem_direction(text: str) -> tuple[str | None, str | None]:
    """본문이 그림의 자리를 말하는가 — 말한다면 **어느 축**인가.

    둘 다 나오면(「아래 그림 … 오른쪽 그림」) **고르지 않는다.** 짐작해서 가르면
    반대 축으로 잘라 놓고도 조용히 통과할 수 있다 — 판정 불가로 남기고 보고한다.
    """
    hit = [(axis, word) for axis, word, rx in STEM_DIRECTION if rx.search(text)]
    if len(hit) != 1:
        return None, None
    return hit[0]


def span_boxes(raw, region: fitz.Rect,
               stem_key: str) -> list[tuple[fitz.Rect, bool]]:
    """구역에 걸친 **모든** 글자 조각과 「지면 글자인가」 — 판정은 **여기 한 곳뿐**이다.

    셋 중 하나면 지면 글자다.

    ㉠ DB 본문에 들어 있는 조각 — 발문·보기 문장 (`figure_rect` 와 **같은 열쇠**)
    ㉡ 선택지 번호 `①`~ — 시험지 자신의 서식이라 그림에 있을 수 없다
    ㉢ 한글이 든 조각 — 문장은 한글이 있고 그림 라벨(`A` `16 cm` `110°`)은 없다

    ㉠ 만으로는 모자란다: 「① `AC=DF`(윗줄 표기)」 같은 보기는 열쇠가 비어 본문
    대조에 안 걸리는데(한글·숫자가 없다) **분명히 지면 글자**다. 그것을 빼먹으면
    띠가 선택지까지 삼키고, 그러면 선택지 번호 가드가 그 문항을 버린다.

    ⚠️ 한글이 든 그림 라벨(`(회)` `정면`)은 여기서 지면 글자로 잡힌다. 그러면 벽이
       그 앞에서 서고, 벽 밖에 남은 그것이 그림에 닿아 있으면 **오려내지 않는다**.
       못 가르는 것은 **버리는 쪽**으로 둔다 — 잘린 그림은 지면에서 티가 안 난다.

    상자는 **보이는 글자에 바짝 조인다**(`span_rect`). 안 조이면 꼬리 공백·제어
    글자까지 글자로 세어, 벽을 세울 자리가 그림 쪽으로 밀려간다.
    """
    out: list[tuple[fitz.Rect, bool]] = []
    for b in raw.get("blocks", []):
        if b.get("type") != 0:
            continue
        for ln in b.get("lines", []):
            row: list[tuple[fitz.Rect, bool]] = []
            for sp in ln.get("spans", []):
                sr = span_rect(sp, tight=True)
                if sr.is_empty:
                    continue
                txt = "".join(c["c"] for c in sp.get("chars", []) if "c" in c)
                k = content_key(txt)
                is_text = (
                    (len(k) >= STEM_LINE_CHARS_SPAN
                     and longest_common_run(k, stem_key) >= STEM_LINE_CHARS_SPAN)
                    or bool(EXAM_SYNTAX.search(txt))
                    or bool(_HANGUL.search(txt))
                )
                row.append((sr, is_text))
            # **한 줄에 지면 글자가 하나라도 있으면 그 줄은 통째로 지면 글자다.**
            # 발문의 수식 토막(`sABC=`)은 셋 어디에도 안 걸리는데(한글도 숫자도
            # 선택지 번호도 없다) 분명히 발문이다 — 실측 2-2 p58 `0448` 은 그런 줄
            # 둘이 그림 **아래**를 지나가서, 벽이 거기서 안 서고 칸이 발문을 삼켰다.
            # 줄로 보면 그림 라벨이 발문 줄에 얹힌 배치에서 라벨을 잃을 수 있는데,
            # 그때는 그 라벨이 그림에 닿아 있으므로 «벽 밖» 검사가 그 문항을 버린다.
            hit = any(is_text for _, is_text in row)
            for sr, is_text in row:
                if (sr & region).is_empty:
                    continue
                out.append((sr, is_text or hit))
    return out


def page_text_rects(raw, region: fitz.Rect, stem_key: str) -> list[fitz.Rect]:
    """구역의 **지면 글자**만. 판정은 `span_boxes` 한 곳에서 온다."""
    return [r for r, is_text in span_boxes(raw, region, stem_key) if is_text]


def stem_text_bands(page, box: fitz.Rect, stem_key: str, axis: str,
                    raw=None) -> list[fitz.Rect]:
    """본문이 말한 축에서 **지면 글자가 안 차지한 띠**들. 벽을 세우기 전에 자리를 좁힌다.

    왜 이것과 `stem_wall` 이 **둘 다** 필요한가 — 실측으로 서로 다른 자리에서 진다.

    · 띠만 쓰면: 글자가 그림을 **감싸고 흐르는** 배치에서 진다. 마지막 줄이 그림
      아래를 지나 더 멀리 가면, 그 끝에서 자른 선이 그림 한가운데를 지난다
      (실측 2-2 p46 `0234`).
    · 벽만 쓰면: 잉크에 **그림이 아닌 것**이 섞였을 때 진다. 「대표문제」 배지의
      둥근 상자가 그림 9pt 위에 있어 한 덩어리로 붙는다(실측 1-2 p35 `0219`) —
      그러면 잉크가 발문 자리까지 뻗어 「왼쪽에 글자가 없다」가 된다.

    그래서 **띠마다 벽을 세워 보고**, 띠 없이도 한 번 세워 본다. 나온 칸이 서로
    다르면 **어느 것이 그 문항의 그림인지 본문이 말해 주지 않는 것**이므로 버린다.
    """
    raw = page.get_text("rawdict") if raw is None else raw
    texts = page_text_rects(raw, box, stem_key)
    if not texts:
        return []
    lo, hi = (box.x0, box.x1) if axis == "x" else (box.y0, box.y1)
    proj = sorted(
        (max(lo, r.x0 if axis == "x" else r.y0),
         min(hi, r.x1 if axis == "x" else r.y1))
        for r in texts
    )
    free: list[tuple[float, float]] = []
    cur = lo
    for a0, b0 in proj:
        if a0 > cur:
            free.append((cur, a0))
        cur = max(cur, b0)
    if cur < hi:
        free.append((cur, hi))

    out: list[fitz.Rect] = []
    for a0, b0 in free:
        # **본문이 말하는 쪽인가.** 「오른쪽 그림」이면 글자가 이 띠 앞쪽에 있어야 한다.
        if not any((r.x1 if axis == "x" else r.y1) <= a0 + 0.1 for r in texts):
            continue
        strip = (fitz.Rect(a0, page.rect.y0, b0, page.rect.y1) if axis == "x"
                 else fitz.Rect(page.rect.x0, a0, page.rect.x1, b0))
        out.append(strip & page.rect)
    return out


def stem_wall(page, box: fitz.Rect, stem_key: str, ink: fitz.Rect, axis: str,
              raw=None, bound: fitz.Rect | None = None) -> fitz.Rect | None:
    """잉크 둘레를 **지면 글자에 닿을 때까지** 넓힌 벽. 못 세우면 `None`.

    ## 왜 한 줄로 자르지 않나

    처음엔 본문이 말한 축으로 상자를 **한 번 잘랐다**(「오른쪽」이면 글자 끝에서
    세로로). 그런데 RPM 은 글자가 그림을 **감싸고 흐른다** — 실측 2-2 p46 `0234` 는
    발문 넉 줄이 그림 왼쪽에 있고 **마지막 줄이 그림 아래를 지나** 더 오른쪽까지 간다.
    그 줄 끝에서 세로로 자르면 자르는 선이 **그림 한가운데**를 지난다. 한 축으로는
    안 갈리는 배치이지 그림이 없는 게 아니다.

    그래서 자를 자리를 «고르지» 않고 **잉크에서 밖으로 자란다**: 네 방향 각각,
    그 방향에서 **처음 만나는 지면 글자** 앞에서 멈춘다. 나란한 글자만 막는다
    (어긋난 글자는 그 방향을 못 막는다) — 그래서 감싸고 흐르는 글자도 제자리에서 멈춘다.

    ## 벽은 글자를 **반으로 가르지 않는다**

    지면 글자의 끝이 곧 빈 자리는 아니다. 그 자리에 다른 조각이 걸쳐 있으면 두 가지다.

    · 걸친 것이 **지면 글자**면 — 벽을 **안으로** 당겨 내보낸다.
      (실측 `019fd1d7-7a78`: 발문 「일 때, ∠」가 450.8 에서 끝나는데 이어지는 수식
       `x` 가 [450.4, 456.7] 이라 450.8 이 그 한가운데다.)
    · 걸친 것이 **그림 재료**면 — 벽을 **밖으로** 밀어 끌어안는다.
      (실측 `019fd1db-748f`: 꼭짓점 `H` 가 그림 위끝보다 8.9pt 위에 있어, 위 벽을
       글자 끝에 딱 세우면 그 이름을 반으로 자른다.)

    밀다가 잉크를 침범하거나 `bleed` 를 벗어나면 **가를 자리가 없는** 배치다 — 버린다.

    ## 본문이 말한 쪽에 글자가 있어야 한다

    「오른쪽 그림」이면 **왼쪽에 글자가 있어서** 왼쪽 벽이 서야 한다. 아무것도 안
    막았다면 그 배치가 아니다 — 낱말이 가리킨 것과 지면이 다르므로 **버린다.**
    """
    raw = page.get_text("rawdict") if raw is None else raw
    bleed = fitz.Rect(box.x0 - BOX_BLEED, box.y0 - BOX_BLEED,
                      box.x1 + BOX_BLEED, box.y1 + BOX_BLEED) & page.rect
    if bound is not None:
        bleed &= bound
        if bleed.is_empty or not bleed.contains(ink):
            return None
    spans = span_boxes(raw, bleed, stem_key)
    texts = [r for r, is_text in spans if is_text]
    side = [r for r in texts if r.y0 < ink.y1 and r.y1 > ink.y0]   # 옆으로 나란한 글자
    over = [r for r in texts if r.x0 < ink.x1 and r.x1 > ink.x0]   # 위아래로 나란한 글자
    wall = [
        max([r.x1 for r in side if r.x1 <= ink.x0], default=bleed.x0),
        max([r.y1 for r in over if r.y1 <= ink.y0], default=bleed.y0),
        min([r.x0 for r in side if r.x0 >= ink.x1], default=bleed.x1),
        min([r.y0 for r in over if r.y0 >= ink.y1], default=bleed.y1),
    ]
    # 미리 자른 자리(`bound`)도 벽이다 — 그 자리 역시 **글자가 정한** 것이다.
    blocked = [wall[i] != v for i, v in enumerate((bleed.x0, bleed.y0, bleed.x1, bleed.y1))]
    if bound is not None:
        for i in range(4):
            blocked[i] = blocked[i] or bound[i] == bleed[i]
    if axis == "x" and not blocked[0]:
        return None
    if axis == "y" and not blocked[1]:
        return None

    inner = (ink.x0, ink.y0, ink.x1, ink.y1)
    outer = (bleed.x0, bleed.y0, bleed.x1, bleed.y1)
    for _ in range(6):
        moved = False
        for i in range(4):
            lo, hi = (0, 2) if i % 2 == 0 else (1, 3)     # 이 가장자리가 사는 축
            po, ph = (1, 3) if i % 2 == 0 else (0, 2)     # 그와 직각인 축
            edge = wall[i]
            # **잉크와 나란한 것만** 본다. 벽 전체 폭으로 보면 그림에서 멀리 떨어진
            # 조각까지 벽을 밀어, 회수가 13 → 10 으로 줄었다(실측). 멀리 있는 것이
            # 칸을 가로지르면 `figure_rect` 의 완비 검사가 그때 버린다.
            cross = [
                (r, is_text) for r, is_text in spans
                if r[lo] < edge - 0.01 and edge + 0.01 < r[hi]
                and r[po] < inner[ph] and r[ph] > inner[po]
            ]
            if not cross:
                continue
            # **안으로만 당긴다.** 밖으로 밀어 끌어안는 길도 재 봤는데, 그림 라벨과
            # 발문 줄이 세로로 겹치는 자리에서 두 요구가 맞부딪쳐 벽이 두 값을
            # 오간다(실측 `019fd1db-748f`: 꼭짓점 `H` 와 머리글 마지막 줄이 1.8pt
            # 겹친다). 그런 배치는 네모 하나로는 못 가르는 것이지, 밀어서 될 일이
            # 아니다. 밖으로 미는 판을 얹으니 회수가 **13 → 9 로 줄었다.**
            #
            # 내보낸 조각이 그림 재료였다면 `figure_rect` 의 «벽 밖 검사»가 잡는다 —
            # 그것이 그림에 닿아 있으면 그 문항을 통째로 버린다.
            edge = (max(r[hi] for r, _ in cross) if i < 2
                    else min(r[lo] for r, _ in cross))
            if i < 2 and not (outer[i] <= edge <= inner[i]):
                return None
            if i >= 2 and not (inner[i] <= edge <= outer[i]):
                return None
            wall[i] = edge
            moved = True
        if not moved:
            break
    else:
        return None                                        # 자리가 안 잡힌다

    out = fitz.Rect(*wall) & bleed
    if out.is_empty or not out.contains(ink):
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
    # 기본은 꺼짐 — 회수 280건을 다시 흔들지 않는다(`thin_pt` 와 같은 이유).
    ap.add_argument("--widen-fallback", action="store_true",
                    help="보통 상자로 **못 찾았을 때만** 띠를 쪽 오른쪽 끝까지 넓혀 다시 찾는다")
    # 기본은 꺼짐 — 켜지 않으면 동작이 한 바이트도 안 바뀐다(md5 로 검산한다).
    ap.add_argument("--stem-split", action="store_true",
                    help="칸에 **발문이 들어왔을 때만** 본문이 말하는 축(「오른쪽 그림」·"
                         "「아래 그림」)으로 상자를 갈라 다시 찾는다")
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
            def attempt(search: fitz.Rect, *, limit=None, widened: bool = False,
                        ink_out=None):
                """상자 하나로 오려내 본다 — `(칸, None)` 또는 `(None, 사유)`.

                검사를 **한 벌만** 둔다. 폴백마다 검사를 새로 쓰면 두 벌이 갈라지고,
                갈라지면 같이 눈이 먼다(이 파일이 여러 번 값을 치른 자리다).
                """
                fig = figure_rect(page, search, db_key, avoid=avoid, limit=limit,
                                  ink_out=ink_out)
                if fig is None:
                    return None, "문항 안에서 그림을 못 찾았다"
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

                # 여백(PAD)이 **글자에 닿으면** 그쪽은 여백을 버린다. 벽에 바짝 붙여
                # 자른 칸이라 2pt 여백이 옆 줄의 머리에 닿는 일이 있다 — 실측
                # `019fd1db-a826` 은 발문 꼬리 「시오」의 윗머리 1.5pt 를 달고 나왔다.
                # (완비 검사는 여백을 **붙이기 전**의 칸을 보므로 이 부류를 못 본다.
                #  검사를 여백 뒤로 옮기면 이미 회수한 것들의 좌표가 흔들리므로,
                #  **벽을 쓰는 길에서만** 여백을 물린다.)
                if limit is not None:
                    for attr, strip in (
                        ("x0", fitz.Rect(rect.x0, rect.y0, fig.x0, rect.y1)),
                        ("y0", fitz.Rect(rect.x0, rect.y0, rect.x1, fig.y0)),
                        ("x1", fitz.Rect(fig.x1, rect.y0, rect.x1, rect.y1)),
                        ("y1", fitz.Rect(rect.x0, fig.y1, rect.x1, rect.y1)),
                    ):
                        if strip.is_empty or not page.get_text("text", clip=strip).strip():
                            continue
                        setattr(rect, attr, getattr(fig, attr))

                # ── 관문 뒤에도 남는 두 부류를 여기서 막는다 (2026-08-18 육안 검수) ──
                # ⑴ 발문 침입 — 그림이 아니라 문항을 통째로 오린 것.
                box_key = content_key(page.get_text("text", clip=rect))
                run = longest_common_run(box_key, db_key)
                if run >= STEM_INTRUSION_CHARS:
                    return None, f"칸에 발문이 {run}자 들어왔다"
                # ⑵ 문장·선택지 침입 — 그림이 아니라 지면을 오린 것이다.
                box_text = page.get_text("text", clip=rect)
                longest_ko = max(
                    (sum(1 for ch in ln if "가" <= ch <= "힣") for ln in box_text.splitlines()),
                    default=0,
                )
                if longest_ko >= SENTENCE_KO:
                    return None, f"칸에 문장이 들어왔다 (한 줄 한글 {longest_ko}자)"
                if EXAM_SYNTAX.search(box_text):
                    return None, "칸에 선택지 번호가 들어왔다"
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
                    return None, f"옆 문항 상자를 덮었다 ({clash[:13]})"
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
                    return None, "칸에 지면 글자가 들어왔다 (번호 배지·발문)"

                # ── 폴백으로 나온 칸에만 대는 가드 (상수 주석 참조) ──
                if widened:
                    if rect.width > COLUMN_W:
                        return None, f"넓힌 칸이 한 단보다 넓다 ({rect.width:.0f}pt)"
                    bare = "".join(page.get_text("text", clip=rect).split())
                    if BADGE_ONLY.match(bare):
                        return None, f"칸에 문항 번호 배지만 있다 ({bare})"
                return rect, None

            # ── ① 계획이 준 상자 그대로 ─────────────────────────────────
            rect, why = attempt(box)
            widened = False
            split_axis: str | None = None
            band_why: list[str] = []
            src = box
            # ── ② 「오른쪽 그림」 넓힘 폴백 — 그림을 **못 찾았을 때만** ──
            if why == "문항 안에서 그림을 못 찾았다" and a.widen_fallback:
                # 같은 세로 띠를 쪽 오른쪽 끝까지 넓혀 한 번 더 본다.
                # **여기 들어오는 것은 이미 실패한 문항뿐**이므로 성공분은 안 흔들린다.
                wide = fitz.Rect(box.x0, box.y0,
                                 page.rect.x1 - WIDEN_RIGHT_MARGIN, box.y1) & page.rect
                if wide.width > box.width + 1:
                    rect, why = attempt(wide, widened=True)
                    widened = rect is not None
                    src = wide
            # ── ③ 「본문이 말하는 자리」 폴백 — **발문이 들어왔을 때만** ──
            #    상수 `STEM_DIRECTION` 주석 참조. 이 길에 들어오는 것도 **이미 실패한
            #    문항뿐**이라 성공분은 안 흔들린다(md5 로 검산한다).
            if rect is None and a.stem_split and why.startswith("칸에 발문이"):
                axis, word = stem_direction(content.get(it["problemId"], ""))
                if axis is None:
                    # **판정 불가를 반드시 찍는다.** 조용히 0이 되면 「본문이 자리를
                    # 말하지 않는 부류」가 있다는 사실 자체가 안 보인다.
                    why += " — 본문이 자리를 말하지 않는다"
                else:
                    src2, wide2 = src, widened
                    if axis == "x":
                        # 「오른쪽 그림」인데 상자가 **글자 열만** 덮은 배치가 있다 —
                        # 실측 `019fd1d8-5d8b` 은 상자 오른쪽 끝(233.0)이 발문 끝
                        # (232.9)과 같고 그림은 그 밖에 있다. 그럴 때는 넓힘 폴백과
                        # **같은 자리**까지 넓혀서 찾는다. 넓힘에 걸린 가드
                        # (한 단보다 넓다 · 번호 배지뿐)를 그대로 쓴다.
                        # ⚠️ 왼쪽 단은 **지면 가운데에서 멈춘다.** 끝까지 넓히면 옆 단
                        #    그림이 딸려 올 수 있다 — 두 단 지면이라 가운데가 경계다.
                        edge = (page.rect.x1 - WIDEN_RIGHT_MARGIN
                                if src.x1 > COLUMN_W else COLUMN_W)
                        if edge > src.x1 + 1:
                            src2 = fitz.Rect(src.x0, src.y0, edge, src.y1) & page.rect
                            wide2 = True
                    got: dict[tuple, fitz.Rect] = {}
                    last = "가를 자리가 없다"
                    for pre in [None, *stem_text_bands(page, src2, db_key, axis)]:
                        ink: list[fitz.Rect] = []
                        attempt(src2, limit=pre, widened=wide2, ink_out=ink)
                        if not ink:
                            continue
                        wall = stem_wall(page, src2, db_key, ink[0], axis, bound=pre)
                        if wall is None:
                            continue
                        r2, w2 = attempt(src2, limit=wall, widened=wide2)
                        band_why.append(
                            f"[{wall.x0:.0f},{wall.y0:.0f},{wall.x1:.0f},{wall.y1:.0f}] "
                            + (w2 or "성공")
                        )
                        if r2 is None:
                            last = w2
                            continue
                        got[tuple(round(v, 1) for v in r2)] = r2
                    if len(got) == 1:
                        rect, why, split_axis = next(iter(got.values())), None, word
                    elif got:
                        # 「수가 맞는다」를 「짝이 맞는다」로 읽지 않는다. 길이 서로
                        # **다른 칸**을 가리키면 어느 것이 이 문항의 그림인지
                        # 본문이 말해 주지 않는다 — 버린다.
                        why += f" — 본문방향({word})으로 갈랐더니 칸이 {len(got)}개다"
                    else:
                        why += f" — 본문방향({word})으로 갈라도 {last}"

            if rect is None:
                rec_fail = {"externalId": it["externalId"], "이유": why}
                if band_why:
                    rec_fail["띠"] = band_why
                fail.append(rec_fail)
                continue

            out.parent.mkdir(parents=True, exist_ok=True)
            pix = page.get_pixmap(clip=rect, dpi=a.dpi)
            pix.save(str(out))
            rec = {"problemId": it["problemId"], "publicPath": to_public(out)}
            if widened:
                # 폴백으로 나온 것은 **따로 표시한다** — 육안 검수에서 이것부터 본다.
                rec["넓힘폴백"] = True
            if split_axis:
                rec["본문방향"] = split_axis
            ok.append(rec)
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
