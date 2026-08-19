# -*- coding: utf-8 -*-
"""RPM 정답책 PDF 원문 → LaTeX. **매핑은 한 곳(여기)에만 둔다.**

    python scripts/qa/rpm_book_latex.py     # 자체 검사 (근거 문항으로 못 박은 것)

쓰는 쪽: `score-rpm-latex.py`(채점) · `compare-rpm-square.py` · 적재 스크립트.

## 왜 필요한가

정답책 PDF 의 수식은 출판사 전용 글꼴로 인코딩돼 있다 — `'3`=√3 · `Û`=² · `Ó`=위선
· `;2!;`=½ · `ù`=°. 그대로 저장하면 화면에서 깨진다.

## 표를 **손으로 적지 않는다** — 참에서 푼다

2026-08-19 실측: 손으로 적었던 표가 다섯 자리 중 **다섯 자리 틀렸다.**

| | 손으로 적은 것 | 참에서 푼 것 | 근거 |
|---|---|---|---|
| `Ú` | ⁴ | **¹** | 2-1 #250 `3Ú`=3` |
| `Ý` | ⁵ | **⁴** | 2-1 #250 `3Ý`=81` |
| `Þ` | ⁶ | **⁵** | 2-1 #250 `3Þ`=243` · 1-1 #41 `243=3Þ`` |
| `¤` | 4 | **6** | `;1¦0°0;`=75/100 계열 표결 15:0 |
| `¥` | 6 | **8** | 2-1 #534 `:¥3¼:`=80/3 |
| `ª` | ≠ | **≡** | 2-2 #724 `sAEHªsBFE` = s AEH≡s BFE |
| `¾` | → | **≥** | 2-1 #397 `-;3A;¾-;3B;` = $-\\frac a3\\ge-\\frac b3$ |
| `Õ` | ∠ | **위선 이음** | 1-2 #491 `BÕAÓ=BCÓ` = $\\overline{BA}=\\overline{BC}$ |

푸는 도구는 `solve-rpm-glyphs.py` 다 — 원문 `;1¢0¼0;` 과 참 `\\frac{40}{100}` 을 맞대면
분모(평문 숫자)로 자리가 잡히고 분자 글자열과 참의 분자가 **같은 길이**일 때 한 글자씩
대응이 나온다. 표결이 갈리면 안 쓴다. 표를 고칠 일이 생기면 **손으로 고치지 말고
그 도구를 돌려라.** 대응쌍에 없는 글자는 `score-rpm-latex.py --residue` 가 잡는다.

**같은 글자가 자리마다 다른 뜻이다.** `µ` 는 뒤에 오면 지수 `m`, 앞에 서면 호(弧)다.
`Ú` 는 밑 뒤에 오면 지수 1, 홀로 서면 풀이 단계 표시 ❶ 다. `Á`·`ª`·`°` 는 약물 안에서
숫자고 밖에서는 기호다. 그래서 **낱글자 치환표 하나로는 안 된다** — 자리를 봐야 한다.

## 분수 약물의 모양

`;2!;` = ½. 규칙은 **자릿수를 번갈아** 쓰는 것이다 — 숫자는 분모, 나머지 글자는 분자.
`;1£0;` 이면 분모 `10`, 분자 `3` → 3/10. 구획 문자는 `;…;` · `;;…;;` · `:…:` 셋이다
(`;;Á2¦;;`=17/2 · `:Á8£:`=13/8 — 실측).
"""
from __future__ import annotations

import re

#: 분자 자리 글자 → 숫자. 두 벌이다(자판 글꼴 · 라틴 글꼴). 참에서 푼 것만 적는다.
NUMERATOR = {
    "!": "1", "@": "2", "#": "3", "$": "4", "%": "5",
    "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
    "Á": "1", "ª": "2", "£": "3", "¢": "4", "°": "5",
    "¤": "6", "¦": "7", "¥": "8", "»": "9", "¼": "0",
}

#: 아래첨자 — **같은 라틴 글꼴을 쓴다.** 작은 숫자 글꼴 하나가 분자와 아래첨자에 함께
#: 쓰이기 때문이다(실측 2-2 #950 `(xÁ, yª)` = $(x_1, y_2)$ · 2-2 #749 `SÁ+Sª`).
#: 홑글자 변수 뒤에 올 때만 아래첨자다 — `sAFE»sABC` 의 `»` 는 닮음이다.
SUBSCRIPT = "Áª£¢°¤¦¥»¼"

#: 윗첨자 글자 → 숫자·문자. **밑 뒤에 올 때만** 지수다.
SUPER = {
    "Ú": "1", "Û": "2", "Ü": "3", "Ý": "4", "Þ": "5",
    "ß": "6", "à": "7", "¡": "8", "á": "9", "â": "0",
    "µ": "m", "μ": "m", "Ç": "n", "Ñ": "-",
}
#: 홀로 선 윗첨자 글자는 **풀이 단계 표시**다(❶❷…). 실측 2-2 #858 `Ú 4인 경우:`.
#: ⚠️ 다섯까지만 둔다. 홀로 선 것의 실측 분포가 ❶33·❷31·❸6 이고 ❹~❽ 는 **하나도 없는데**
#:    `á`(9) 만 26개다 — 그건 단계가 아니라 **연립방정식 큰 괄호**의 윗조각이다
#:    (2-1 #751 `하면 á x+y=45 {`). 표를 열까지 채우면 그 26개가 «❾» 로 나간다.
STEP_MARK = {"Ú": "❶", "Û": "❷", "Ü": "❸", "Ý": "❹", "Þ": "❺"}

#: 자리를 안 타는 낱글자.
CHARS = {
    "ù": "\\degree", "_": "\\times", "Ö": "\\div",
    "É": "\\leq", "¾": "\\geq", "ª": "\\equiv", "Ñ": "\\pm",
    "»": "\\backsim", "±": "\\sim", "": "\\parallel", "": "\\square",
    "‌": "", "\x03": " ", "\x08": " ", "：": ":", "　": " ",
}

#: 조판용 제어 문자 — 뜻이 없다. 남겨 두면 잔재 집계가 이것들로 가득 찬다(실측 546자).
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")

#: 삼각형·닮음 기호. 한컴은 `s` 를 △ 로 쓴다 — **대문자 이름이 뒤따를 때만**.
# ⚠️ `\b` 를 쓰면 안 된다 — `sABC와` 처럼 뒤에 한글이 오면 한글도 낱말 글자라
#    경계가 안 생겨 그냥 지나친다(실측 `sACD와`·`sABC에서` 가 안 바뀌었다).
TRIANGLE = re.compile(r"(?<![A-Za-z])s(?=[A-Z]{3}(?![A-Za-z]))")
#: `ABÓ` → `\overline{AB}`. 뒤에 붙는 글자라 앞의 대문자 덩어리를 집는다.
#: 점 이름에 프라임이 붙기도 하고(`HH'Ó`·`AB''Ó`) 폭 맞춤 글자 `Õ` 가 끼기도 한다
#: (`BÕAÓ`·`HÕ'HÓ` — 실측 1-2 #491·2-2 #348). 덩어리로 집고 `Õ` 만 걷어낸다.
OVERLINE = re.compile(r"([A-Z][A-Z'′Õ]{1,4})[ÓÕ](?![A-Za-z])")
FILLER = "Õ"
#: `ABê` 류(직선) · `PD³`(반직선).
LINE_MARK = re.compile(r"([A-Z]{2,3})ê")
RAY_MARK = re.compile(r"([A-Z]{2,3})³")
#: 호(弧). **이름 앞에 서는** 표시다 — 뒤에 서면 지수 `m` 이라 자리로 갈린다.
ARC = re.compile(r"(?<![0-9A-Za-z])[µμ¨]\s?([A-Z]{2,3})")
#: 분수 약물. `;;…;;` 를 먼저 봐야 `;` 하나로 잘리지 않는다.
FRAC_DOUBLE = re.compile(r";;([^;\s]{1,12});;")
FRAC_ONE = re.compile(r";([^;\s]{1,12});")
FRAC_COLON = re.compile(r":([^:\s]{1,12}):")
#: 근호. `'¶13`(두 자리) · `'1`0`(백틱 끼움) · `'3`(한 자리) 순으로 좁게 먼저 본다.
ROOT_PILCROW = re.compile(r"'¶(\d+)")
ROOT_TICK = re.compile(r"'(\d)`(\d)")
ROOT_ONE = re.compile(r"'\s?(\d+|[a-z])")
#: `"Ã…Û`" 꼴의 씌운 근호 — 여는 `Ã` 부터 백틱까지.
# ⚠️ 첫 백틱에서 끊으면 안 된다 — `"Ã1Û`+1Û`` 는 `√(1²+1²)` 인데
#    `√(1²)+1²` 가 된다(실측 `#323`·`#322`). 백틱 뒤에 연산자가 이어지면 계속 삼킨다.
ROOT_BIG = re.compile(r'["¿¹]+Ã?((?:[^`]+`(?=[-+*/]))*[^`]+)`')
#: 윗첨자 **덩어리**. 밑 뒤에 오고, 사이에 낀 백틱(가는 공백)은 삼킨다.
# ⚠️ 한 글자씩 `^{2}` 로 바꾸면 두 자리 지수가 `3^{2}^{0}` 이 된다(실측 `3Ûâ`=3²⁰).
# ⚠️ 위선 뒤의 지수는 **가는 공백**(U+2009)을 끼고 온다 — `EHÓ Û` = $\overline{EH}^2$.
#    실측 110자리 전부가 그렇고, 그 앞 글자는 **전부 `Ó`** 다. 보통 공백(U+0020)은
#    안 된다 — 그건 단계 표시 앞자리다(`-3b+3=4 ❶ -3b+3=-4`, 97자리).
SUPER_RUN = re.compile(
    r"([0-9A-Za-z\)\}\]])[   ]?((?:[ÚÛÜÝÞßàáâ¡µμÇ])[ÚÛÜÝÞßàáâ¡µμÇÑ`]*)"
)
#: 아래첨자 덩어리 — **홑글자 변수 뒤**에만 온다. 앞이 글자면 그건 기호다
#: (`sAFE»sABC` 의 `»` 는 닮음, `sAEHªsBFE` 의 `ª` 는 합동 — 실측 2-2 #552·#724).
SUB_RUN = re.compile(r"(?<![0-9A-Za-z])([A-Za-z])([Áª£¢°¤¦¥»¼])(?![0-9A-Za-z])")
#: 홀로 선 윗첨자 글자 = 단계 표시.
STEP_RUN = re.compile(r"(?<![0-9A-Za-z\)\}\]`])([ÚÛÜÝÞ])(?![ÚÛÜÝÞßàáâ¡])")
#: 낱글자를 명령으로 바꾼 **자리 표시**. 백틱(가는 공백)이 지워지며 명령과 다음 글자가
#: 붙으면 `\diva` 같은 없는 명령이 되어 지면이 통째로 깨진다(실측 2-1 #201 `aá`ÖaÜ``).
#: ⚠️ 이걸 정규식 `(\\[a-zA-Z]+)(?=[A-Za-z])` 로 하면 안 된다 — 되돌이표(backtrack)로
#:    `\times` 가 `\time`+`s` 로 갈라져 **멀쩡한 명령이 쪼개진다**(실측 16개 전멸).
#:    바꾼 자리를 그때 표시해 두는 것만이 «내가 만든 경계»를 안다.
CMD_MARK = "\x01"
#: 아래첨자 밑줄 자리 표시 — 같은 이유다. `_` 는 이 글꼴에서 `\times` 라 바로 못 쓴다.
SUB_MARK = "\x02"
#: 되풀이 말줄임 — `26.666y` = 26.666… · `yy㉠` = ⋯㉠.
ELLIPSIS_DEC = re.compile(r"(\d\.\d+)\s?y")
ELLIPSIS_RUN = re.compile(r"yy")


def _frac(m: re.Match[str]) -> str:
    body = m.group(1)
    den, num = [], []
    for ch in body:
        if ch in NUMERATOR:
            num.append(NUMERATOR[ch])
        elif ch.isdigit() or ch.isalpha():
            den.append(ch)
        else:
            return m.group(0)  # 모르는 글자가 섞였으면 손대지 않는다
    if not den or not num:
        return m.group(0)
    return "\\frac{" + "".join(num) + "}{" + "".join(den) + "}"


def _super(m: re.Match[str]) -> str:
    body = "".join(SUPER.get(c, "") for c in m.group(2) if c != "`")
    return m.group(1) + "^{" + body + "}" if body else m.group(0)


def to_latex(raw: str) -> str:
    """정답책 원문 한 토막을 LaTeX 로 옮긴다."""
    s = raw
    s = ROOT_BIG.sub(lambda m: "\\sqrt{" + m.group(1) + "}", s)
    s = ROOT_PILCROW.sub(lambda m: "\\sqrt{" + m.group(1) + "}", s)
    s = ROOT_TICK.sub(lambda m: "\\sqrt{" + m.group(1) + m.group(2) + "}", s)
    s = FRAC_DOUBLE.sub(_frac, s)
    s = FRAC_ONE.sub(_frac, s)
    s = FRAC_COLON.sub(_frac, s)
    s = OVERLINE.sub(lambda m: "\\overline{" + m.group(1).replace(FILLER, "") + "}", s)
    s = ROOT_ONE.sub(lambda m: "\\sqrt{" + m.group(1) + "}", s)
    s = LINE_MARK.sub(lambda m: "\\overleftrightarrow{" + m.group(1) + "}", s)
    s = RAY_MARK.sub(lambda m: "\\overrightarrow{" + m.group(1) + "}", s)
    s = ARC.sub(lambda m: "\\overgroup{" + m.group(1) + "}", s)
    s = TRIANGLE.sub("\\\\triangle ", s)
    s = SUPER_RUN.sub(_super, s)
    # ⚠️ 밑줄을 그대로 쓰면 안 된다 — `_` 는 이 글꼴에서 `\times` 다(CHARS). 나중에 푼다.
    s = SUB_RUN.sub(lambda m: m.group(1) + SUB_MARK + "{" + NUMERATOR[m.group(2)] + "}", s)
    s = STEP_RUN.sub(lambda m: STEP_MARK[m.group(1)], s)
    s = ELLIPSIS_DEC.sub(lambda m: m.group(1) + "\\cdots", s)
    s = ELLIPSIS_RUN.sub("\\\\cdots", s)
    for a, b in CHARS.items():
        s = s.replace(a, b + CMD_MARK if b.startswith("\\") else b)
    # ⚠️ 표시를 **CONTROL 보다 먼저** 푼다. CONTROL 은 제어 문자를 공백으로 바꾸는데
    #    표시도 제어 문자라, 뒤에 두면 붙지 않아야 할 자리까지 전부 벌어진다.
    s = re.sub(CMD_MARK + r"(?=[A-Za-z])", " ", s).replace(CMD_MARK, "")
    s = s.replace(SUB_MARK, "_")
    s = CONTROL.sub(" ", s)
    s = s.replace("`", " ")
    return re.sub(r"[ \t]{2,}", " ", s).strip()


#: 자체 검사 — **근거 문항을 그대로 못 박는다.** 표를 손으로 고치면 여기가 빨개진다.
EVIDENCE = [
    ("2-1 #250 3의 거듭제곱표", "3Ú`=3, 3Û`=9, 3Ü`=27, 3Ý`=81, 3Þ`=243",
     "3^{1}=3, 3^{2}=9, 3^{3}=27, 3^{4}=81, 3^{5}=243"),
    ("2-1 #250 두 자리 지수", "3Û`â`", "3^{20}"),
    ("2-1 #222 지수 6·7·8", "2ß`_4à`_25¡`", "2^{6}\\times4^{7}\\times25^{8}"),
    ("2-1 #201 지수 뺄셈", "aá`ÖaÜ`=aá`ÑÜ`=aß`", "a^{9}\\div a^{3}=a^{9-3}=a^{6}"),
    ("1-1 #41 지수 5", "243=3Þ`", "243=3^{5}"),
    ("2-2 #164 겹약물", ";;Á2¦;;", "\\frac{17}{2}"),
    ("2-1 #53 쌍점 약물", ":Á8£:", "\\frac{13}{8}"),
    ("2-1 #534 쌍점 약물 80/3", ":¥3¼:", "\\frac{80}{3}"),
    ("2-1 #751 백분율 약물", ";1¦0°0;", "\\frac{75}{100}"),
    ("1-2 #1036 40/100", ";1¢0¼0;", "\\frac{40}{100}"),
    ("2-2 #972 5/10", ";1°0;", "\\frac{5}{10}"),
    ("1-2 #491 위선 이음", "BÕAÓ=BCÓ", "\\overline{BA}=\\overline{BC}"),
    ("2-2 #724 합동", "sAEHªsBFE", "\\triangle AEH\\equiv\\triangle BFE"),
    ("2-1 #397 부등호", "a`É`b", "a \\leq b"),
    ("2-1 #473 부등호", "a¾-8", "a\\geq-8"),
    ("1-2 #582 호", "7:µAD", "7:\\overgroup{AD}"),
    ("3-2 #414 호", "¨ABC에", "\\overgroup{ABC}에"),
    ("2-1 #200 지수 m·n", "aµ``<aÇ`", "a^{m}<a^{n}"),
    ("3-2 #497 반직선", "PD³가", "\\overrightarrow{PD}가"),
    ("1-1 #514 빈칸", "어떤 유리수를  라", "어떤 유리수를 \\square 라"),
    ("2-2 #858 단계 표시", "Ú 4인 경우", "❶ 4인 경우"),
    ("2-1 #534 되풀이", "26.666y", "26.666\\cdots"),
    ("2-2 #950 아래첨자", "(xÁ, yª)", "(x_{1}, y_{2})"),
    ("2-2 #749 아래첨자 합", "SÁ+Sª=sABD", "S_{1}+S_{2}=\\triangle ABD"),
    ("2-2 #552 닮음", "sAFE»sABC", "\\triangle AFE\\backsim\\triangle ABC"),
    ("2-2 #348 프라임 위선", "HÕ'HÓ=ADÓ", "\\overline{H'H}=\\overline{AD}"),
    ("2-2 #780 겹프라임 위선", "AB''Ó의", "\\overline{AB''}의"),
    ("3-2 #53 프라임 위선", "HH'Ó=ADÓ=6", "\\overline{HH'}=\\overline{AD}=6"),
    ("2-2 #724 위선 뒤 지수", "EHÓ Û`=aÛ`+bÛ`", "\\overline{EH}^{2}=a^{2}+b^{2}"),
    ("2-1 #965 단계 표시는 지수가 아니다", "-3b+3=4 Ú -3b+3=-4일", "-3b+3=4 ❶ -3b+3=-4일"),
]

if __name__ == "__main__":  # pragma: no cover
    import sys

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    bad = 0
    for name, raw, want in EVIDENCE:
        got = to_latex(raw)
        ok = " ".join(got.split()) == " ".join(want.split())
        if not ok:
            bad += 1
            print(f"  틀림 {name}\n    원문 {raw}\n    나온 것 {got}\n    있어야 할 것 {want}")
    print(f"근거 {len(EVIDENCE)}개 중 {len(EVIDENCE) - bad}개 통과")
    sys.exit(1 if bad else 0)
