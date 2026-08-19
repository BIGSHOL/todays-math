# -*- coding: utf-8 -*-
"""`crop-pdf-by-stem.py` 의 가드를 **합성 지면**으로 시험한다.

    python scripts/qa/test-crop-pdf-by-stem.py

왜 합성 지면인가: 실제 시험지는 N드라이브에 있고 다른 컴퓨터에는 없다. 가드가
「무엇을 보고 가르는가」는 지면의 **구조**(단 구분선·선택지 줄·머리띠)이지 특정
학교의 서식이 아니므로, 그 구조를 만들어서 시험하면 어디서나 돈다.

⚠️ **가드는 망가뜨려 봐야 가드인 줄 안다**(CLAUDE.md 2026-08-18).
   변이 시험은 `scripts/qa/mutate-crop-pdf-by-stem.sh` 에 있다. 지면이 그 가드가
   갈라 주는 자리를 안 만들면 변이가 **초록**으로 남는다 — 그러면 지면을 고쳐라.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys

import fitz

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

_s = importlib.util.spec_from_file_location(
    "crop", pathlib.Path(__file__).resolve().parent.parent / "figure" / "crop-pdf-by-stem.py"
)
crop = importlib.util.module_from_spec(_s)
_s.loader.exec_module(crop)
rpm = crop.croprpm

W, H = 595.0, 842.0
DIV_X = 297.0
LEFT_X = 46.0
RIGHT_X = 306.0
KO = "korea-s"

#: 왼쪽 단의 발문. DB 본문과 **같은 글자**여야 한다 — 그것이 이 파이프라인의 열쇠다.
#: 단 구분선까지 닿도록 길게 둔다 — 짧으면 상자가 구분선에 못 닿아 그 가드를 못 잰다.
STEM = ("다음 그림과 같은 전개도를 접어 정육면체를 만들었을 때 마주 보는 면에 "
        "적힌 두 수가 서로 역수라고 한다 이때 값은?")
CONTENT = STEM + "\n1. 16\n2. 9\n3. 4\n4. 2\n5. 1"

FAILS: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  OK  {name}")
    else:
        FAILS.append(name)
        print(f"  --  {name}  {detail}")


def _furniture(page: fitz.Page) -> None:
    """모든 쪽에 같은 자리로 오는 것 — 단 구분선과 머리띠."""
    page.draw_line((DIV_X, 48), (DIV_X, 800), width=0.4)
    # 머리띠: **단을 가로지르는** 넓은 상자. 진짜 시험지의 학교명 띠와 같은 모양이다.
    page.draw_rect(fitz.Rect(40, 30, 555, 44), width=0.8)


def _net(page: fitz.Page, x0: float, y0: float, w: float = 90.0) -> fitz.Rect:
    """전개도 비슷한 격자 — 두께 0인 곧은 선으로만 그린다(`thin_pt` 가 살려야 한다).

    `w` 는 단 폭에 견준 그림 너비다. 「발문이 칸에 몇 자 들어왔나」는 **칸이 그 줄을
    가로로 얼마나 덮느냐**로 정해진다 — `get_text(clip=…)` 이 글자 단위로 자른다.
    그래서 좁은 그림으로는 그 관문을 잴 수 없다(90pt 로는 8자뿐이었다).
    실데이터 `4338-19` 의 칸은 단 폭의 대부분(150pt/250pt)을 덮는다.
    """
    n = max(2, int(w // 30))
    for i in range(n + 1):
        page.draw_line((x0 + i * (w / n), y0), (x0 + i * (w / n), y0 + 80), width=0)
    for j in range(3):
        page.draw_line((x0, y0 + j * 40), (x0 + w, y0 + j * 40), width=0)
    return fitz.Rect(x0, y0, x0 + w, y0 + 80)


def _filler(page: fitz.Page, base: int) -> None:
    """**문항 번호는 같은 x 에 여러 번 온다** — 판정이 되풀이로 가르므로 지면에도
    그 성질이 있어야 한다(한두 개만 두면 구조가 없는 지면이다)."""
    for j, y in enumerate((360, 420, 480, 540, 600)):
        page.insert_text((LEFT_X, y), f"{base + j}. 채우기 문항.", fontname=KO, fontsize=9)
        page.insert_text((RIGHT_X, y), f"{base + 10 + j}. 채우기 문항.", fontname=KO, fontsize=9)


def build() -> fitz.Document:
    doc = fitz.open()
    for pno in range(2):
        page = doc.new_page(width=W, height=H)
        _furniture(page)
        if pno == 0:
            page.insert_text((LEFT_X, 100), "13. " + STEM[:28], fontname=KO, fontsize=9)
            page.insert_text((LEFT_X, 112), STEM[28:], fontname=KO, fontsize=9)
            # 배점은 **여러 span 으로 쪼개진다** — 진짜 시험지가 그렇다(사유 영역 글꼴).
            page.insert_text((LEFT_X, 124), "[4", fontname="helv", fontsize=9)
            page.insert_text((LEFT_X + 8, 124), "점]", fontname=KO, fontsize=9)
            _net(page, LEFT_X + 40, 130)
            # 선택지 — **단 왼쪽 끝**에서 시작한다. 값이 분수라 **분자가 제 줄로**
            # 따로 잡히고 ① 줄보다 **위로** 올라간다. 바닥은 거기까지 올려 잡아야 한다.
            page.insert_text((LEFT_X + 60, 224), "16", fontname="helv", fontsize=9)
            page.insert_text((LEFT_X, 234), "① 16", fontname=KO, fontsize=9)
            page.insert_text((LEFT_X + 120, 234), "②", fontname=KO, fontsize=9)
            page.insert_text((LEFT_X, 250), "③ 4", fontname=KO, fontsize=9)
            # 오른쪽 단: 남의 문항. 상자 테두리가 왼쪽 단 상자에 스칠 수 있다.
            page.draw_rect(fitz.Rect(RIGHT_X, 120, 545, 200), width=0.8)
            page.insert_text((RIGHT_X, 100), "14. 다른 문항의 발문이다.", fontname=KO, fontsize=9)
        else:
            page.insert_text((LEFT_X, 100), "20. 다른 쪽의 문항.", fontname=KO, fontsize=9)
        _filler(page, 30 + pno * 5)
    return doc


def build_stem_touch() -> tuple[fitz.Document, fitz.Rect, str]:
    """발문 마지막 줄이 그림 라벨과 **세로로 겹치는** 지면 — `avoid_stem` 이 가르는 자리."""
    doc = fitz.open()
    for _ in range(2):
        _furniture(doc.new_page(width=W, height=H))
    page = doc[0]
    page.insert_text((LEFT_X, 100), "17. " + STEM[:28], fontname=KO, fontsize=9)
    page.insert_text((LEFT_X, 148), STEM[28:], fontname=KO, fontsize=9)   # 마지막 줄
    # **발문 마지막 줄에 라틴 짧은 토막**을 둔다. 실데이터 `4338-19` 의 마지막 줄이
    # 그 모양이다 — `PB` `PC` `QB` `QC` 가 사유 영역 글꼴 사이에 섞여 있다. 발문
    # 열쇠(`content_key`)는 한글+숫자만 남기므로 이런 토막은 **본문에 없는 글자**로
    # 보여 라벨로 되찾아지고, 그래서 칸이 발문 줄 높이까지 자란다. 이것이 없으면
    # 칸이 애초에 발문에 안 닿아 `avoid_stem` 이 가를 자리가 생기지 않는다.
    page.insert_text((LEFT_X + 100, 154), "PB", fontname="helv", fontsize=8)
    # 그림은 발문 마지막 줄 **바로 아래**에서 시작한다 — 실데이터 `4338-19` 의 배치다.
    net = _net(page, LEFT_X, 160, w=230.0)
    # 그림 오른쪽에 붙은 치수 라벨 — 발문 마지막 줄과 **세로로 겹친다.**
    # ⚠️ 라벨은 **본문에 없는 글자**여야 한다. 처음엔 `16cm` 이었는데 `16` 이 보기
    #    `1. 16` 에 있어 「본문에 있다」로 걸러졌고, 그래서 칸이 그 높이까지 자라지
    #    않아 **`avoid_stem` 이 가를 자리가 아예 없었다**(off 와 on 이 같은 칸).
    #    가드가 아니라 지면이 문제였다 — 실데이터 `4338-19` 는 발문 마지막 줄이
    #    실제로 칸에 40자 들어온다(그 행은 「발문피하기」 rung 으로만 산다).
    page.insert_text((LEFT_X, 280), "① 16", fontname=KO, fontsize=9)
    _filler(page, 30)
    _filler(doc[1], 50)
    return doc, net, rpm.content_key(CONTENT)


def main() -> None:
    doc = build()
    page = doc[0]
    stem_key = rpm.content_key(CONTENT)
    edges = crop.column_edges(doc)[0]

    print("-- 단(段) 경계 --")
    check("되풀이되는 세로 구분선을 단 경계로 잡는다",
          any(abs(e - DIV_X) <= crop.FURNITURE_ROUND for e in edges), f"edges={edges}")

    got = crop.stem_box(page, stem_key, edges)
    check("발문 상자를 잡는다", got is not None)
    if got is None:
        return _done()
    sb, _ = got
    lo, hi = crop.column_band(edges, (sb.x0 + sb.x1) / 2)
    check("발문이 구분선 가까이까지 온다 (그래야 단 클립을 잴 수 있다)",
          sb.x1 + crop.AROUND_PT > DIV_X, f"sb.x1={sb.x1:.1f}")
    check("단 경계가 구분선 바깥쪽을 물린다 (선 자신은 단 밖이다)",
          hi < DIV_X - 0.3, f"hi={hi}")

    print("\n-- 오려내기 --")
    furn = crop.furniture_keys(doc)
    floor = crop.choice_floor(page, sb, (lo, hi), sb.y1 + crop.BELOW_PT)
    check("바닥을 선택지 줄 위에 놓는다", 200 < floor < 232, f"floor={floor}")
    check("선택지 값의 윗줄까지 올려 잡는다 (분수 꼭대기가 안 남는다)",
          floor <= 216, f"floor={floor}")
    bound = fitz.Rect(lo, page.rect.y0, hi, floor) & page.rect
    box = fitz.Rect(sb.x0 - crop.AROUND_PT, sb.y0 - crop.AROUND_PT,
                    sb.x1 + crop.AROUND_PT, floor) & bound
    tr: dict = {}
    fig = rpm.figure_rect(page, box, stem_key, min_overlap=4.0,
                          thin_pt=crop.THIN_STROKE_PT, furniture=furn,
                          label_syntax=crop.EXAM_SYNTAX, bound=bound,
                          avoid_stem=True, trace=tr)
    check("전개도를 찾는다 (두께 0인 곧은 선을 살린다)", fig is not None, f"진단={tr}")
    if fig is not None:
        check("칸이 전개도를 통째로 담는다",
              fig.x0 <= LEFT_X + 41 and fig.x1 >= LEFT_X + 129
              and fig.y0 <= 131 and fig.y1 >= 209, f"fig={fig}")
        check("칸에 선택지가 안 들어온다", fig.y1 < 220, f"fig={fig}")
        check("칸에 발문·배점이 안 들어온다", fig.y0 > 126, f"fig={fig}")
        check("머리띠(단을 가로지르는 것)는 후보가 아니다",
              tr.get("획:쪽장식", 0) >= 1, f"진단={tr}")
    check("배점 표기가 여러 span 으로 쪼개져 있어도 라벨에서 뺀다",
          tr.get("라벨:지면문법(선택지·배점)", 0) >= 2, f"진단={tr}")

    print("\n-- 단 클립·울타리가 실제로 일하는가 --")
    wide = fitz.Rect(sb.x0 - crop.AROUND_PT, sb.y0 - crop.AROUND_PT, DIV_X + 20, floor) & page.rect
    fig2 = rpm.figure_rect(page, wide, stem_key, min_overlap=4.0,
                           thin_pt=crop.THIN_STROKE_PT, furniture=furn,
                           label_syntax=crop.EXAM_SYNTAX, avoid_stem=True, trace={})
    check("상자가 옆 단으로 넘으면 결과가 달라진다",
          fig is not None and (fig2 is None or fig2 != fig), f"fig2={fig2}")
    # 울타리를 안 주면 bleed 가 선택지 분자까지 뻗어 라벨로 삼킨다.
    fig3 = rpm.figure_rect(page, box, stem_key, min_overlap=4.0,
                           thin_pt=crop.THIN_STROKE_PT, furniture=furn,
                           label_syntax=crop.EXAM_SYNTAX, bound=None,
                           avoid_stem=True, trace={})
    check("울타리를 안 주면 칸이 달라진다 (bound 가 장식이 아니다)",
          fig is not None and (fig3 is None or fig3 != fig), f"fig3={fig3}")

    print("\n-- 발문은 삼키지 말고 피한다 --")
    d3, net3, key3 = build_stem_touch()
    p3 = d3[0]
    e3 = crop.column_edges(d3)[0]
    g3 = crop.stem_box(p3, key3, e3)
    check("발문 상자를 잡는다 (닿는 지면)", g3 is not None)
    if g3 is not None:
        sb3, _ = g3
        lo3, hi3 = crop.column_band(e3, (sb3.x0 + sb3.x1) / 2)
        f3 = crop.choice_floor(p3, sb3, (lo3, hi3), sb3.y1 + crop.BELOW_PT)
        b3 = fitz.Rect(lo3, p3.rect.y0, hi3, f3) & p3.rect
        x3 = fitz.Rect(sb3.x0 - crop.AROUND_PT, sb3.y0 - crop.AROUND_PT,
                       sb3.x1 + crop.AROUND_PT, f3) & b3
        kw = dict(min_overlap=4.0, thin_pt=crop.THIN_STROKE_PT,
                  furniture=crop.furniture_keys(d3), label_syntax=crop.EXAM_SYNTAX, bound=b3)
        on = rpm.figure_rect(p3, x3, key3, avoid_stem=True, **kw)
        off = rpm.figure_rect(p3, x3, key3, avoid_stem=False, **kw)
        # **관문이 실제로 쓰는 잣대로 잰다.** y 좌표로 물으면 「몇 pt 물러섰나」라는
        # 프록시가 되어, 물러서기가 성공했는데도 한두 pt 때문에 빨개진다. 제품이
        # 버릴지 말지를 정하는 것은 「칸에 발문이 몇 자 들어왔나」다.
        def intruded(rc):
            if rc is None:
                return None
            r = fitz.Rect(rc.x0 - crop.PAD, rc.y0 - crop.PAD,
                          rc.x1 + crop.PAD, rc.y1 + crop.PAD) & p3.rect
            return rpm.longest_common_run(crop.content_key(p3.get_text("text", clip=r)), key3)
        i_on, i_off = intruded(on), intruded(off)
        check("피하면 발문이 칸에 안 들어온다",
              on is not None and i_on < crop.STEM_INTRUSION_CHARS, f"on={on} 발문 {i_on}자")
        check("안 피하면 발문이 칸에 들어온다 (가드가 장식이 아니다)",
              off is None or i_off >= crop.STEM_INTRUSION_CHARS, f"off={off} 발문 {i_off}자")

    print("\n-- 칸이 무언가를 반으로 잘랐나 --")
    if fig is not None:
        cut = crop.bisected(page, fitz.Rect(fig.x0, fig.y0, fig.x1, 230), (lo, hi))
        check("선택지 글자를 반쯤 담으면 잡아낸다", cut is not None, f"cut={cut}")
        clean = crop.bisected(page, fitz.Rect(fig.x0 - crop.PAD, fig.y0 - crop.PAD,
                                              fig.x1 + crop.PAD, fig.y1 + crop.PAD), (lo, hi))
        check("멀쩡한 칸은 안 잡는다", clean is None, f"cut={clean}")

    print("\n-- 선택지 줄 판정: 그림 안의 원문자는 선택지가 아니다 --")
    d2 = fitz.open()
    for _ in range(2):
        _furniture(d2.new_page(width=W, height=H))
    p2 = d2[0]
    p2.insert_text((LEFT_X, 100), "13. " + STEM[:28], fontname=KO, fontsize=9)
    p2.insert_text((LEFT_X, 112), STEM[28:], fontname=KO, fontsize=9)
    p2.insert_text((LEFT_X + 100, 150), "①", fontname=KO, fontsize=9)   # 그림 «안»
    # ⚠️ 그림에는 **본문에 없는 글자**가 있어야 한다. 발문 열쇠(`content_key`)는
    #    한글+숫자만 남기므로 원문자는 아무것도 안 남긴다 — 그러면 쪽 글자열이
    #    「발문+보기」로 이어져 `stem_box` 가 **보기 줄까지 삼키고**, 그 아래를 보는
    #    `choice_floor` 는 바닥을 못 찾는다. 실데이터에서는 그림 라벨이 열쇠를
    #    끊어서 이런 일이 없다 — 대상 36행 전수로 **0행**이었다(2026-08-19 실측).
    p2.insert_text((LEFT_X + 120, 150), "7", fontname=KO, fontsize=9)   # 그림 라벨
    p2.insert_text((LEFT_X, 400), "① 16", fontname=KO, fontsize=9)      # 진짜 선택지
    g2 = crop.stem_box(p2, stem_key, crop.column_edges(d2)[0])
    check("합성 쪽에서 발문을 잡는다", g2 is not None)
    if g2 is not None:
        sb2, _ = g2
        f2 = crop.choice_floor(p2, sb2, (lo, hi), sb2.y1 + crop.BELOW_PT)
        check("가운데 놓인 원문자는 바닥이 아니다 (그림 안의 ① 에서 안 끊는다)",
              f2 > 250, f"floor={f2}")
        check("단 왼쪽 끝에서 시작하는 원문자 줄은 바닥이다", f2 < 395, f"floor={f2}")

    print("\n-- 쪽 고르기 검산 (문항 번호) --")
    check("고른 쪽에 그 문항 번호가 있으면 검산 통과",
          crop.page_has_question_number(doc, 0, 13))
    check("다른 쪽에는 그 번호가 없다", not crop.page_has_question_number(doc, 1, 13))
    check("없는 번호는 검산이 안 선다", not crop.page_has_question_number(doc, 0, 99))

    print("\n-- 칸이 «곧은 선» 을 반으로 잘랐나 --")
    # 곧은 선은 폭이나 높이가 0이라 `Rect.is_empty` 가 참이다. 그래서 「잘렸나」를
    # 묻는 검사에서 통째로 빠지고, 지면에는 끊긴 선이 나간다 — 실측 `3627-15`.
    d4 = fitz.open()
    for _ in range(2):
        _furniture(d4.new_page(width=W, height=H))
    p4 = d4[0]
    p4.insert_text((LEFT_X, 100), "21. " + STEM[:28], fontname=KO, fontsize=9)
    p4.draw_rect(fitz.Rect(LEFT_X + 10, 150, LEFT_X + 70, 200), width=0.6)
    p4.draw_line((LEFT_X + 70, 175), (LEFT_X + 130, 175), width=0)   # 두께 0 — 이어 주는 선
    band4 = (2.0, DIV_X - 2)
    tight = fitz.Rect(LEFT_X + 5, 145, LEFT_X + 90, 205)             # 선을 반으로 자른다
    whole = fitz.Rect(LEFT_X + 5, 145, LEFT_X + 140, 205)            # 선을 다 담는다
    check("두께 0인 선을 반으로 자르면 잡아낸다",
          crop.bisected(p4, tight, band4) is not None, f"={crop.bisected(p4, tight, band4)}")
    check("다 담으면 안 잡는다",
          crop.bisected(p4, whole, band4) is None, f"={crop.bisected(p4, whole, band4)}")

    print("\n-- 그림과 발문 사이에 앞 문항 선택지가 있나 --")
    # 사다리의 「위까지」 칸은 단 꼭대기까지 열려 있어 **앞 문항의 그림**을 물어 올 수
    # 있다(실측 `3627-15`: 앞 문항 14번의 마방진). 거리로 가르지 않고 구조로 묻는다.
    p5 = d4[1]
    p5.draw_rect(fitz.Rect(LEFT_X + 10, 120, LEFT_X + 90, 180), width=0.6)   # 앞 문항 그림
    p5.insert_text((LEFT_X, 220), "① 16", fontname=KO, fontsize=9)      # 앞 문항 선택지
    p5.insert_text((LEFT_X, 300), "22. " + STEM[:20], fontname=KO, fontsize=9)
    fig5 = fitz.Rect(LEFT_X + 10, 120, LEFT_X + 90, 180)
    sb5 = fitz.Rect(LEFT_X, 291, LEFT_X + 200, 302)
    check("사이에 선택지 줄이 있으면 남의 그림이다",
          crop.foreign_choices(p5, sb5, fig5, band4) is not None)
    near = fitz.Rect(LEFT_X + 10, 255, LEFT_X + 90, 285)   # 선택지 «아래», 발문 바로 위
    check("선택지가 사이에 없으면 제 그림이다",
          crop.foreign_choices(p5, sb5, near, band4) is None,
          f"={crop.foreign_choices(p5, sb5, near, band4)}")
    check("그림이 발문 아래면 해당 없음",
          crop.foreign_choices(p5, sb5, fitz.Rect(LEFT_X, 320, LEFT_X + 90, 380), band4) is None)
    _done()


def _done() -> None:
    print()
    if FAILS:
        print(f"실패 {len(FAILS)}: " + " · ".join(FAILS))
        raise SystemExit(1)
    print("전부 통과")


if __name__ == "__main__":
    main()
