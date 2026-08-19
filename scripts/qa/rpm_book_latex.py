# -*- coding: utf-8 -*-
"""RPM 정답책 PDF 원문 → LaTeX. **매핑은 한 곳(여기)에만 둔다.**

쓰는 쪽: `scripts/qa/score-rpm-latex.py`(채점) · 앞으로의 적재 스크립트.

## 왜 필요한가

정답책 PDF 의 수식은 출판사 전용 글꼴로 인코딩돼 있다 — `'3`=√3 · `Û`=² · `Ó`=위선
· `;2!;`=½ · `ù`=°. 그대로 저장하면 화면에서 깨진다.

그리고 **우리 DB 의 기존 LaTeX 도 성한 게 아니다.** `\\square` 자리표시자가
본문 233행 · 해설 305행 · 정답 97행에 박혀 있다(실측). 지면에 □ 로 나간다.
원문은 오히려 충실하다 — 그러니 이 변환기는 «빠진 것을 채우는」 도구이자
«깨진 것을 되살리는」 도구다.

## 규칙을 손으로 쓰되, **채점은 원문 밖에서** 한다

매핑 자체는 사람이 적을 수밖에 없다(글꼴 표가 없다). 대신 성적은
`score-rpm-latex.py` 가 **깨지지 않은 기존 LaTeX 해설**과 대 보고 매긴다 —
참이 변환기 안에서 오면 안 된다.

## 분수 약물의 모양

`;2!;` = ½. 규칙은 **자릿수를 번갈아** 쓰는 것이다 — 숫자는 분모, Shift+숫자는 분자.
`;1£0;` 이면 분모 `10`, 분자 `3`(£ = Shift+3) → 3/10. 그래서 목록이 아니라
**자판 배열**로 되돌린다. 목록으로 적으면 그 목록에 없는 분수는 구조적으로 못 본다.
"""
from __future__ import annotations

import re

#: Shift+숫자 → 숫자. 자판 배열이지 낱말 목록이 아니다.
SHIFTED = {"!": "1", "@": "2", "#": "3", "$": "4", "%": "5",
           "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
           "£": "3", "¤": "4", "¥": "6"}

#: 낱글자 매핑. 빈도순 census(`census-rpm-glyphs.py`)에서 나온 것만 적는다.
CHARS = {
    "Û": "^{2}", "Ü": "^{3}", "Ú": "^{4}", "Ý": "^{5}", "Þ": "^{6}",
    "ù": "\\degree", "Ñ": "\\pm", "_": "\\times", "Ö": "\\div",
    "É": "\\leq", "Á": "\\geq", "ª": "\\neq", "»": "\\cdots",
    "±": "\\sim", "°": "\\circ", "¾": "\\to", "Õ": "\\angle",
    "": "\\parallel", "‌": "", "\x03": " ", "\x08": " ",
    "：": ":", "　": " ",
}

#: 조판용 제어 문자 — 뜻이 없다. 남겨 두면 잔재 집계가 이것들로 가득 찬다(실측 546자).
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


#: 삼각형·닮음 기호. 한컴은 `s` 를 △ 로, `~` 를 ∽ 로 쓴다 — **대문자 이름이 뒤따를 때만**.
TRIANGLE = re.compile(r"\bs(?=[A-Z]{3}\b)")
#: `ABÓ` → `\overline{AB}`. 뒤에 붙는 글자라 앞의 대문자 덩어리를 집는다.
OVERLINE = re.compile(r"([A-Z]{2,3})Ó")
#: `ABê` 류(직선) — 위선과 같은 자리에 오는 다른 기호.
LINE_MARK = re.compile(r"([A-Z]{2,3})ê")
#: 분수 `;…;` — 숫자와 Shift+숫자가 섞여 있다.
FRAC = re.compile(r";([^;\s]{1,10});")
#: 근호. `'¶13`(두 자리) · `'1`0`(백틱 끼움) · `'3`(한 자리) 순으로 좁게 먼저 본다.
ROOT_PILCROW = re.compile(r"'¶(\d+)")
ROOT_TICK = re.compile(r"'(\d)`(\d)")
ROOT_ONE = re.compile(r"'\s?(\d+|[a-zA-Z])")
#: `"Ã…Û`" 꼴의 씌운 근호 — 여는 `Ã` 부터 백틱까지.
ROOT_BIG = re.compile(r'["¿¹]+Ã?([^`]+)`')


def _frac(m: re.Match[str]) -> str:
    body = m.group(1)
    den, num = [], []
    for ch in body:
        if ch in SHIFTED:
            num.append(SHIFTED[ch])
        elif ch.isdigit() or ch.isalpha():
            den.append(ch)
    if not den or not num:
        return m.group(0)
    return "\\frac{" + "".join(num) + "}{" + "".join(den) + "}"


def to_latex(raw: str) -> str:
    """정답책 원문 한 토막을 LaTeX 로 옮긴다."""
    s = raw
    s = ROOT_BIG.sub(lambda m: "\\sqrt{" + m.group(1) + "}", s)
    s = ROOT_PILCROW.sub(lambda m: "\\sqrt{" + m.group(1) + "}", s)
    s = ROOT_TICK.sub(lambda m: "\\sqrt{" + m.group(1) + m.group(2) + "}", s)
    s = FRAC.sub(_frac, s)
    s = ROOT_ONE.sub(lambda m: "\\sqrt{" + m.group(1) + "}", s)
    s = OVERLINE.sub(lambda m: "\\overline{" + m.group(1) + "}", s)
    s = LINE_MARK.sub(lambda m: "\\overleftrightarrow{" + m.group(1) + "}", s)
    s = TRIANGLE.sub("\\\\triangle ", s)
    for a, b in CHARS.items():
        s = s.replace(a, b)
    s = CONTROL.sub(" ", s)
    s = s.replace("`", " ")
    return re.sub(r"[ \t]{2,}", " ", s).strip()
