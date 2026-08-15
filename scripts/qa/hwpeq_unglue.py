# -*- coding: utf-8 -*-
"""HWP 수식 스크립트를 `hwpeq_to_latex` 에 넣기 **전에** 손보는 전처리.

testchanger 는 읽기 전용이므로(tracks/README §3) 변환기 자체는 고치지 않는다.
대신 변환기의 토크나이저가 제대로 끊을 수 있는 모양으로 입력을 맞춰 준다.

## 1. 붙어 버린 구조 키워드

발견(2026-08-16, 트랙 D-3 표본 눈검증): `1over5x+1over7y=1over35` 처럼 `over` 가
숫자에 붙어 있는 원본이 있다. `hwpeq_to_latex` 의 토크나이저는 단어를
``[A-Za-z][A-Za-z0-9]*`` 로 읽으므로 `over5x` 를 **한 낱말로 삼켜** 변환하지 않고
그대로 흘려보낸다. 결과는 지면에 `1over5x` 라는 날 문자열이다.

⚠️ 이게 위험한 이유: KaTeX 는 `1over5x` 를 **에러로 보지 않는다**. 그냥 글자로
그린다. 그래서 "렌더 실패율" 로는 안 잡힌다 — 실제로 실패율은 0.1% 로 멀쩡했고
표본을 눈으로 보고서야 드러났다(10-handoff §8.5 "동어반복 측정을 조심할 것").

의미는 바뀌지 않는다 — `1 over 5x` 는 `hwpeq_to_latex` 의 `group()` 이 원자
하나(`5`)만 분모로 집으므로 `\\frac{1}{5}x` 가 되어 원본 의도(x/5)와 같다.

## 2. `of` 짝이 없는 `root` 는 그냥 √ 다

`3root3` 은 3√3 이다. 실측 254건 전부 같은 span 안에 `of` 가 없었고
(`6pi +3root3`, `2root5 }over3`), `latex_to_hwpeq` 도 *"sqrt/root 키워드가 앞
글자에 붙으면 literal 이 된다"* 고 적어 두었다. 그런데 `hwpeq_to_latex` 의 `root`
분기는 `root {n} of {x}` 를 전제해 `of` 가 없으면 **뒤 토큰을 근호 안으로 끌고
들어간다**(`15root2+5` → `15\\sqrt[2]{+}5` — 수식이 조용히 틀린다).
그래서 `of` 가 없는 span 에서는 `root` 를 `sqrt` 로 바꿔 넘긴다.

## 3. `RM`/`IT` 가 삼킨 기호

`RMANGLE DAC` 은 `\\mathrm{ANGLE}DAC` 로 나가 지면에 "ANGLE DAC" 라는 날 글자가
찍힌다. 기호로 확실히 되돌아가는 `ANGLE`·`TRIANGLE` 만 뗀다 — `LEFT`·`pile` 은
뒤따르는 구분자를 `\\mathrm{}` 안으로 끌고 들어가 오히려 깨진다.

## 실측 효과 (문항 14,878 · 수식 span 149,008)

    적용 전   잔재 span 1.98% · 잔재 문항 8.06%
    적용 후   잔재 span 0.08% · 잔재 문항 0.5%      ← 아래 `_leftover.py` 로 잰다
"""
import re

# 구조 키워드. HWP 원본은 대소문자를 섞어 쓴다(`1over5` · `3SQRT2OVER4` · `BARAB`).
# `triangle` 을 `angle` 보다 앞에 두는 건 취향이 아니라 안전장치다 — `TRIANGLE` 안의
# `ANGLE` 은 앞이 글자라 lookbehind 가 막지만, 순서까지 맞춰 두면 읽는 사람이 헷갈리지 않는다.
_KW = (
    "over|atop|sqrt|root|bar|triangle|angle"
    "|OVER|ATOP|SQRT|ROOT|BAR|TRIANGLE|ANGLE"
)

# 앞 글자에 붙은 것: `xover2` → `x over2`.
# 앞에 백슬래시가 오면 LaTeX 명령(`\overline`)이므로 절대 건드리지 않는다.
_LEFT = re.compile(r"(?<![\\A-Za-z])([A-Za-z])(" + _KW + r")")
# 뒤 글자·숫자에 붙은 것: `over5x` → `over 5x`.
_RIGHT = re.compile(r"(?<![\\A-Za-z])(" + _KW + r")(?=[A-Za-z0-9])")
# `root {3} of {2}` 의 `of` 만. `roof` 같은 낱말을 쪼개지 않도록 숫자·중괄호 사이로 한정.
_OF = re.compile(r"(?<=[0-9}])of(?=[0-9{])")
_HAS_OF = re.compile(r"(?<![A-Za-z])of(?![A-Za-z])")
_ROOT = re.compile(r"(?<![\\A-Za-z])(root|ROOT)(?![A-Za-z])")
_RMIT = re.compile(
    r"(?<![\\A-Za-z])(RM|IT)(TRIANGLE|ANGLE|BAR|triangle|angle|bar)(?![a-z])"
)

# `hwpeq_to_latex` 의 역매핑에 없어 그대로 새어 나오는 HWP 키워드.
# 실측 잔재(수식 span 159,545 기준): BOX 374 · DIVIDE 189 · != 87 · == 58 · <= 7.
# 변환 **뒤** 산출 LaTeX 에 적용한다. 앞에 백슬래시가 붙은 것(정상 명령)은 건드리지 않는다.
_POST = [
    (re.compile(r"(?<![\\A-Za-z])(?:BOX|box)(?![A-Za-z])"), r"\\square "),
    (re.compile(r"(?<![\\A-Za-z])DIVIDE(?![A-Za-z])"), r"\\div "),
    (re.compile(r"(?<![\\A-Za-z])ANGL(?![A-Za-z])"), r"\\angle "),
    (re.compile(r"!="), r"\\neq "),
    (re.compile(r"<="), r"\\leq "),
    (re.compile(r">="), r"\\geq "),
    (re.compile(r"(?<![<>!=])==(?![=])"), "="),
]


def postfix_latex(latex: str) -> str:
    """변환기가 못 되돌린 잔여 HWP 키워드를 LaTeX 로 마저 옮긴다."""
    if not latex:
        return latex
    out = latex
    for pat, rep in _POST:
        out = pat.sub(rep, out)
    return re.sub(r"[ \t]{2,}", " ", out)


def unglue(script: str) -> str:
    """구조 키워드 앞뒤에 공백을 넣는다. 이미 떨어져 있으면 아무 일도 안 한다."""
    if not script:
        return script
    out = _RMIT.sub(lambda m: m.group(1) + " " + m.group(2) + " ", script)
    prev = None
    # `aoverbovercc` 처럼 연쇄로 붙은 것이 있어 변화가 없을 때까지 돌린다.
    for _ in range(6):
        if out == prev:
            break
        prev = out
        out = _LEFT.sub(lambda m: m.group(1) + " " + m.group(2), out)
        out = _RIGHT.sub(lambda m: m.group(1) + " ", out)
    out = _OF.sub(" of ", out)
    # `of` 짝이 없으면 n제곱근이 아니라 제곱근이다 (§2).
    if not _HAS_OF.search(out):
        out = _ROOT.sub("sqrt", out)
    return re.sub(r"[ \t]{2,}", " ", out)
