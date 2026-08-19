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
#: 본문 글자 크기의 이 비율보다 작으면 첨자 후보다(실측 본문 10.5 · 지수 6.0).
SCRIPT_SIZE = 0.78
#: 첨자를 붙일 줄을 찾을 때의 세로 허용치.
SCRIPT_HOST_DY = 12.0
#: 교재가 정답을 찍는 표시. 풀이 줄 **오른쪽 끝**에 붙어 있어 y 로 묶으면 본문과 한 줄이 된다.
#: 여기서 줄을 끊어야 `book_solution_map` 이 풀이와 답을 가를 수 있다(실측 `답 ×` 가 본문에 붙었다).
ANSWER_TOKEN = "답"
#: 교재가 괄호로 그리는 글자. LaTeX 의 «묶음»과 뜻이 달라 여기서 바꾼다.
BOOK_BRACE = {"{": "(", "}": ")"}
#: **내가 끼워 넣은** 중괄호의 글꼴 이름. 교재의 괄호 글자와 헷갈리면
#: 첨자의 닫는 중괄호가 `)` 로 바뀐다(실측 `^{101)`).
SYNTH = "<synth>"


#: 근호 표식만 담은 글꼴. 이름에 이게 들어가면 그 글자는 **숫자가 아니라 근호**다.
#: ⚠️ 실측 3-1 정답책 `316` 은 «삼백십육»이 아니라 $3\\sqrt{6}$ 이다. 가운데 `1` 이
#:    `EHRoot-Plain` 글꼴이다. 글꼴을 안 보면 **그럴듯한 숫자**가 되어 나가고,
#:    그건 □ 보다 나쁘다 — 틀린 줄 아무도 모른다(답 `41120` = $4\\sqrt{10}$).
ROOT_FONT = "Root"
#: 여는 갈고리(√)의 폭. 실측 4.56~5.30. 중간 덧줄은 0.00, 마감은 1.16 이다.
HOOK_MIN_W = 3.0
#: 작은 근호를 닫는 마감 글자의 최소 폭.
CAP_MIN_W = 0.5
#: 큰 근호(`!%…^`·`Á°…¤`)를 닫는 자리 — 표식 뒤에 이런 글자가 오면 닫힌 것으로 본다.
BIG_END = set("=<>,)　 \t")


@dataclass
class Tok:
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    #: 이 낱말의 **글자 크기**(가장 큰 것). 첨자 판정에 쓴다.
    size: float = 0.0
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


def _on_bar(run: list, bars: list) -> bool:
    """이 글자 덩어리가 **분수선에 얹혀 있나**(분자) 또는 매달려 있나(분모)."""
    x0 = min(c[2][0] for c in run)
    x1 = max(c[2][2] for c in run)
    y0 = min(c[2][1] for c in run)
    y1 = max(c[2][3] for c in run)
    for b in bars:
        if b.x0 - 1 <= x0 and x1 <= b.x1 + 1 and -BAR_EDGE_MAX <= b.y - y1 <= BAR_EDGE_MAX:
            return True
        if b.x0 - 1 <= x0 and x1 <= b.x1 + 1 and -BAR_EDGE_MAX <= y0 - b.y <= BAR_EDGE_MAX:
            return True
    return False


def _fold_scripts(chars: list, sizes: list[float], bars: list, base: float, carry=None) -> list:
    """**작고 올라간(내려간) 글자**를 `^{…}`·`_{…}` 로 세운다.

    학생용 책은 지수를 글자가 아니라 **크기와 높이**로 나타낸다 — 같은 글꼴
    `EHsang-Italic` 을 6.0pt 로 올려 찍는다(본문은 10.5pt). 그걸 못 보면
    `-x^{101}` 이 `-x101` 로 나가 **읽히는 오답**이 된다(실측 1-1 #685).

    ⚠️ 글자 크기만 보면 안 된다 — 그림 라벨도 작다. **바로 앞 글자에 붙어 있고
       높이가 다를 때만** 첨자로 본다.
    ⚠️ 그리고 **분수의 분자도 작고 올라가 있다.** 그것까지 첨자로 접으면
       `rac{5}{AC}` 가 `rac{^{5)}{AC}` 가 된다(실측 3-2 #55). 그래서
       분수선이 바로 밑(또는 위)에 있는 글자는 건드리지 않는다 — 선이 가른다.
    """
    if not chars or len(sizes) != len(chars):
        return chars
    out: list = []
    # ⚠️ 지수는 **앞 줄 끝**에 붙어 오기도 한다 — PyMuPDF 는 올라간 조각을 다른 줄로
    #    떼어 놓는다(실측 1-1 #685: `-x` 한 줄, `101-(-y)` 다음 줄). 그래서 앞 줄의
    #    마지막 글자와 그 크기를 물려받아야 첫 글자도 첨자로 볼 수 있다.
    i = 0
    while i < len(chars):
        # ⚠️ 기준은 **쪽의 본문 크기**(최빈값)다. 줄 안에서 앞 글자를 기준으로 삼으면
        #    지수가 줄 첫머리에 오는 경우(PyMuPDF 가 떼어 놓는다)를 못 본다.
        if (i == 0 and not carry) or sizes[i] > base * SCRIPT_SIZE or chars[i][0].isspace():
            out.append(chars[i])
            i += 1
            continue
        j = i
        while (
            j < len(chars)
            and sizes[j] <= base * SCRIPT_SIZE
            and not chars[j][0].isspace()
        ):
            j += 1
        run = chars[i:j]
        prev = chars[i - 1] if i else carry[0]
        if not run:
            out.append(chars[i])
            i += 1
            continue
        gap = run[0][2][0] - prev[2][2]  # ⚠️ 상자는 (x0, y0, x1, y1) — x1 은 2번이다
        dy = ((run[0][2][1] + run[0][2][3]) / 2) - ((prev[2][1] + prev[2][3]) / 2)
        # ⚠️ 간격은 **양쪽으로** 봐야 한다. 새 줄이 왼쪽 여백에서 시작하면 간격이
        #    크게 음수가 되어 「가깝다」로 통과해 버린다.
        if not (-1.0 <= gap <= SCRIPT_GAP) or abs(dy) < SCRIPT_SHIFT or _on_bar(run, bars):
            out.extend(run)
            i = j
            continue
        out.append(("^{" if dy < 0 else "_{", SYNTH, run[0][2]))
        out.extend(run)
        out.append(("}", SYNTH, run[-1][2]))
        i = j
    return out


def _body_size(page: pymupdf.Page) -> float:
    """이 쪽의 **본문 글자 크기**(최빈값). 첨자 판정의 기준이다."""
    import collections

    c: collections.Counter = collections.Counter()
    for blk in page.get_text("rawdict").get("blocks", []):
        for line in blk.get("lines", []):
            for sp in line.get("spans", []):
                c[round(float(sp.get("size", 0)), 1)] += len(sp.get("chars", []))
    return c.most_common(1)[0][0] if c else 0.0


def _root_aware_words(page: pymupdf.Page, bars: list) -> list[Tok]:
    """낱말을 뽑되, **근호 글꼴**을 만나면 그 자리에서 `\\sqrt{…}` 로 세운다.

    근호는 글자가 아니라 **표식**이다. 여는 갈고리(폭 ~5.3)가 근호를 열고, 그 뒤가
    또 표식이면 «큰 근호»(크기 선택자)라 닫는 표식까지 삼킨다. 아니면 «작은 근호»라
    영숫자만 삼키고, 폭 있는 마감 표식이나 영숫자가 아닌 글자에서 닫는다.

    실측으로 맞춘 것:
      · `1125이므로` → $\\sqrt{15}$ 이므로   (가운데 0폭 표식은 덧줄이라 건너뛴다)
      · `-1+186<2`   → $-1+\\sqrt{8}<2$      (폭 1.16 마감이 닫는다)
      · `3166`       → $3\\sqrt{6}$
      · `!%7Û`-4Û`^` → $\\sqrt{7^2-4^2}$     (큰 근호는 연산자도 삼킨다)
    """
    toks: list[Tok] = []
    # ⚠️ 물려받는 자리는 **쪽 전체**다. PyMuPDF 는 올라간 조각을 다른 «덩이»(block)로
    #    떼어 놓기도 한다 — 실측 1-1 #685 는 `-x` 가 blk39, `101` 이 blk40 이었다.
    #    덩이마다 끊으면 그 자리가 영영 안 보인다. 멀리 있는 것은 간격 검사가 막는다.
    carry = None
    import collections

    sizecount: collections.Counter = collections.Counter()
    for blk in page.get_text("rawdict").get("blocks", []):
        for line in blk.get("lines", []):
            for sp in line.get("spans", []):
                sizecount[round(float(sp.get("size", 0)), 1)] += len(sp.get("chars", []))
    page_base = sizecount.most_common(1)[0][0] if sizecount else 0.0
    for blk in page.get_text("rawdict").get("blocks", []):
        for line in blk.get("lines", []):
            chars = [
                (c["c"], sp.get("font", ""), c["bbox"])
                for sp in line.get("spans", [])
                for c in sp.get("chars", [])
            ]
            sizes = [
                float(sp.get("size", 0))
                for sp in line.get("spans", [])
                for _c in sp.get("chars", [])
            ]
            chars = _fold_scripts(chars, sizes, bars, page_base, carry)
            if chars:
                last = next((c for c in reversed(chars) if not c[0].isspace()), None)
                carry = (last, 0.0) if last else carry
            text = ""
            box: list[float] | None = None
            maxsize = max(sizes) if sizes else 0.0
            depth, big = 0, False

            def push(ch: str, bb) -> None:
                nonlocal text, box
                text += ch
                if bb is None:
                    return
                box = list(bb) if box is None else [
                    min(box[0], bb[0]), min(box[1], bb[1]),
                    max(box[2], bb[2]), max(box[3], bb[3]),
                ]

            def flush() -> None:
                nonlocal text, box
                if text.strip() and box is not None:
                    toks.append(Tok(box[0], box[1], box[2], box[3], text, size=maxsize))
                text, box = "", None

            def small_extent(k: int) -> tuple[list, int]:
                """작은 근호가 **어디까지 덮나**. 앞을 내다보고 정한다.

                ⚠️ 덧줄 표식의 개수로는 못 센다. 덧줄은 글자 수가 아니라 **길이**를
                   글꼴 크기로 나눠 가진다(실측 `4`@11.0 하나가 `1.44` 넉 자를 덮고,
                   `2`@8.0 둘이 `10` 두 자를 덮는다). 그래서 «몇 개인가»가 아니라
                   **무엇이 근호 안에 들어갈 수 있나**로 정한다.

                   ㉠ 마감 표식(폭 있는 것)이 나오면 거기까지가 근호다.
                   ㉡ 마감이 없으면 **숫자 뭉치**까지다 — `1120AHÓ` 는 √10·AH 이지
                      √(10AH) 가 아니다.
                """
                got: list = []
                j = k
                while j < len(chars):
                    c2, f2, b2 = chars[j]
                    if ROOT_FONT in f2:
                        if (b2[2] - b2[0]) >= CAP_MIN_W:
                            return got, j + 1  # ㉠ 마감 — 여기까지가 근호다
                        j += 1
                        continue  # 0폭 덧줄 — 글자가 아니다
                    if c2.isascii() and (c2.isalnum() or c2 == "."):
                        got.append((c2, b2))
                        j += 1
                        continue
                    break
                # ㉡ 마감이 없다 — 숫자면 숫자 뭉치까지, 아니면 한 글자만
                if got and got[0][0].isdigit():
                    n = 0
                    while n < len(got) and (got[n][0].isdigit() or got[n][0] == "."):
                        n += 1
                    while n > 1 and got[n - 1][0] == ".":
                        n -= 1
                else:
                    n = 1 if got else 0
                if n == 0:
                    return [], k
                # 잘라 낸 만큼만 되짚어 다음 자리를 찾는다(사이에 낀 덧줄은 건너뛴 채로)
                j, seen = k, 0
                while j < len(chars) and seen < n:
                    c2, f2, b2 = chars[j]
                    if not (ROOT_FONT in f2):
                        seen += 1
                    j += 1
                return got[:n], j

            # 큰 근호는 겹친다(`Á°(2136)Û`…¤` 안에 `2136`=2√3 이 들어 있다). 그래서 쌓는다.
            big_depth = 0

            i = 0
            while i < len(chars):
                ch, font, bb = chars[i]
                if ROOT_FONT in font:
                    w = bb[2] - bb[0]
                    if w >= HOOK_MIN_W:
                        # 여는 갈고리. **글자가 숫자면 작은 근호**다 — 큰 근호는 `!`·`Á`
                        # 같은 다른 글자로 열고 크기 선택자가 뒤따른다(실측 census).
                        if ch.isdigit():
                            body, nxt = small_extent(i + 1)
                            if body:
                                push("\\sqrt{", bb)
                                for c2, b2 in body:
                                    push(c2, b2)
                                push("}", None)
                                i = nxt
                                continue
                        else:
                            push("\\sqrt{", bb)
                            big_depth += 1
                            i += 2 if (i + 1 < len(chars) and ROOT_FONT in chars[i + 1][1]) else 1
                            continue
                    elif big_depth:
                        after = chars[i + 1][0] if i + 1 < len(chars) else ""
                        if after == "" or after in BIG_END or "가" <= after <= "힣":
                            push("}", None)
                            big_depth -= 1
                    i += 1
                    continue
                if ch.isspace():
                    while big_depth:
                        push("}", None)
                        big_depth -= 1
                    flush()
                    i += 1
                    continue
                # ⚠️ 교재의 `{`·`}` 는 **괄호를 그린 글자**다. 그대로 두면 LaTeX 가
                #    «묶음»으로 읽어 화면에서 **괄호가 사라진다** — `÷(-⅔y)²` 이
                #    `÷-⅔y²` 가 된다(실측 1-1 #604·3-1 #192, 통과분의 30%).
                #    여기서 바꿔야 한다. 뒤에서 만드는 중괄호와 섞이면 못 가른다.
                push(ch if font == SYNTH else BOOK_BRACE.get(ch, ch), bb)
                i += 1
            while big_depth:
                push("}", None)
                big_depth -= 1
            flush()
    return toks


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
        piece = t.text
        if prev is not None:
            gap = t.x0 - prev.x1
            script = gap < SCRIPT_GAP and abs(t.y1 - prev.y1) >= SCRIPT_SHIFT
            # **작고 올라간(내려간) 낱말**은 첨자다. 학생용 책은 지수를 글자가 아니라
            # 크기와 높이로 나타내고(본문 10.5 · 지수 6.0), 그 조각을 PyMuPDF 가
            # **다른 줄**로 떼어 놓는다 — 그래서 글자 단위로는 안 보인다.
            if (
                script
                and t.size
                and prev.size
                and t.size <= prev.size * SCRIPT_SIZE
                and t.cyo is None
                and not t.text.startswith(("^", "_", "\\"))
            ):
                piece = ("^{" if t.cy < prev.cy else "_{") + t.text + "}"
            out += "" if gap < GLUE_GAP or script else " "
        out += piece
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


def page_lines(
    page: pymupdf.Page,
    columns: int = 2,
    clip: tuple[float, float, float, float] | None = None,
    drop: list[tuple[float, float, float, float]] | None = None,
) -> list[tuple[int, float, float, str]]:
    """한 쪽을 (단, y, x, 글) 줄 목록으로.

    ⚠️ **단을 먼저 가르고 줄을 묶는다.** 순서가 뒤바뀌면 왼쪽 단과 오른쪽 단의
       같은 높이 줄이 한 줄로 이어 붙는다.
    """
    hor, ver = _segments(page)
    toks = _root_aware_words(page, hor)
    if clip is not None:
        # 칸 하나만 볼 때는 **선도 같이** 걸러야 한다. 칸 밖 분수선이 칸 안 낱말을
        # 분자·분모로 집어 가면 없는 분수가 생긴다.
        x0, y0, x1, y1 = clip
        toks = [t for t in toks if x0 - 2 <= t.cx <= x1 + 2 and y0 - 2 <= t.cy <= y1 + 2]
        hor = [g for g in hor if x0 - 4 <= (g.x0 + g.x1) / 2 <= x1 + 4 and y0 - 6 <= g.y <= y1 + 6]
        ver = [g for g in ver if x0 - 4 <= (g.x0 + g.x1) / 2 <= x1 + 4]
    if drop:
        # ⚠️ **줄을 묶기 전에** 뺀다. 그림 라벨은 본문과 같은 높이에 있어서
        #    나중에 빼려 하면 이미 본문 줄에 붙어 있다(실측 `…같은 사각형ABCD의 D`).
        toks = [
            t for t in toks
            if not any(a <= t.cx <= c and b <= t.cy <= d for a, b, c, d in drop)
        ]
    toks = _fold_fractions(toks, hor, ver)

    mid = page.rect.width / 2
    out: list[tuple[int, float, float, str]] = []
    groups = {0: [], 1: []} if columns == 2 else {0: []}
    for t in toks:
        groups[1 if (columns == 2 and t.x0 >= mid) else 0].append(t)
    for col, items in groups.items():
        items.sort(key=lambda t: (t.cy, t.x0))
        lines: list[list[Tok]] = []
        base = _body_size(page)
        # ⚠️ **작고 올라간 낱말은 나중에 붙인다.** 큰 괄호에 붙는 지수는 본문보다
        #    7pt 넘게 올라가 있어 y 로 묶으면 제 줄을 만들고, 정렬에서 **문장 맨 앞**
        #    으로 간다(실측 1-1 #685 `(…)^2` 의 `2`). 줄을 다 만든 뒤 바로 왼쪽에
        #    붙은 줄을 찾아 넣어야 한다 — 먼저 붙이려 하면 그 줄이 아직 없다.
        small = [t for t in items if base and t.size and t.size <= base * SCRIPT_SIZE]
        for t in items:
            if t in small:
                continue
            if lines and abs(t.cy - (sum(u.cy for u in lines[-1]) / len(lines[-1]))) <= LINE_TOL:
                lines[-1].append(t)
            else:
                lines.append([t])
        for t in small:
            # 붙일 줄은 **가로로도 세로로도** 가까워야 한다. 가로만 보면 단 아래쪽
            # 엉뚱한 줄에 첨자가 날아가 붙는다.
            host = next(
                (
                    ln for ln in lines
                    if any(
                        -1.0 <= t.x0 - u.x1 <= SCRIPT_GAP and abs(t.cy - u.cy) <= SCRIPT_HOST_DY
                        for u in ln
                    )
                ),
                None,
            )
            if host is None:
                host = next(
                    (ln for ln in lines
                     if abs(t.cy - (sum(u.cy for u in ln) / len(ln))) <= LINE_TOL),
                    None,
                )
            if host is not None:
                host.append(t)
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
