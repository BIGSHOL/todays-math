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
# ⚠️ 접두는 **대소문자를 가리지 않는다.** testchanger 는 `v.upper().startswith("RM")` 로
# 보므로 원본에 `rmbarAD` 처럼 소문자로 적혀 있어도 `\mathrm{barAD}` 를 내놓는다 —
# 그러면 `bar` 가 오버라인이 아니라 글자로 지면에 나간다(실측 문항의 2.68%).
_RMIT = re.compile(
    r"(?<![\\A-Za-z])([Rr][Mm]|[Ii][Tt])(TRIANGLE|ANGLE|BAR|triangle|angle|bar)(?![a-z])"
)

# `hwpeq_to_latex` 의 역매핑에 없어 그대로 새어 나오는 HWP 키워드.
# 실측 잔재(수식 span 159,545 기준): BOX 374 · DIVIDE 189 · != 87 · == 58 · <= 7.
# 변환 **뒤** 산출 LaTeX 에 적용한다. 앞에 백슬래시가 붙은 것(정상 명령)은 건드리지 않는다.
#
# ⚠️ **DIVIDE 계열의 lookaround 를 다시 좁히지 말 것** (2026-08-17 실측).
#    원래 `(?<![\\A-Za-z])DIVIDE(?![A-Za-z])` 였다. 그런데 HWP 원본의 실제 모양은
#    `xDIVIDE(-6)` · `aDIVIDEbDIVIDEc` · `4DIVIDEunder` 처럼 **양옆이 영문자**다.
#    그래서 이 규칙은 "정확히 고쳐야 할 자리에서만" 안 걸렸고, 지면에 `aDIVIDEb` 가
#    날 글자로 나갔다(DB 전수 82행 · 원장님 스크린샷). 같은 이유로 성적표였던
#    `measure-hwp-latex-residue.py` 도 `DIV` 패턴이 뒤의 `I` 에 막혀 0을 가리켰다.
#    영문자 lookaround 는 **정상 LaTeX 명령을 지키는 장치가 아니다** — 그건
#    백슬래시 lookbehind 가 한다. 대문자 HWP 키워드는 영어 낱말일 리가 없다.
#
# ⚠️ **여기와 `renderPostfixRules.ts` 는 같은 어휘를 봐야 한다** (2026-08-18).
#    2026-08-17 까지 이 목록에 `<=`·`>=` 는 있는데 짧은꼴 `le`·`ge` 규칙이 **아예
#    없었다.** 세는 쪽(`measure-hwp-latex-residue.py`)도 같은 낱말을 안 세고 있어
#    둘이 같이 눈이 멀었고, 지면에 `xle-7`·`age2` 가 그대로 나갔다(원장님 스크린샷).
#    새 잔재를 찾으면 **양쪽에 같이** 넣어라. 어휘 정본은 `hwp-vocab.json` 이다.
_POST = [
    (re.compile(r"(?<![\\A-Za-z])(?:BOX|box)(?![A-Za-z])"), r"\\square "),
    (re.compile(r"(?<!\\)DIVIDE"), r"\\div "),
    (re.compile(r"(?<!\\)divide"), r"\\div "),
    (re.compile(r"(?<!\\)TIMES"), r"\\times "),
    # 소문자 `times` — 대문자만 보다가 `2^2 times 3times5^3` 을 놓쳤다.
    # 앞뒤가 영문자면 낱말의 일부일 수 있어 그때만 비켜 간다.
    (re.compile(r"(?<![\\A-Za-z])times(?![A-Za-z])"), r"\\times "),
    (re.compile(r"(?<![\\A-Za-z])ANGL(?![A-Za-z])"), r"\\angle "),
    # `\overarc` 는 정본 ACCENT_MAP 의 `arch` 역매핑 결과인데 **KaTeX 에 없는 명령**이라
    # 지면에 붉은 날 글자로 나간다. 뜻이 같은 KaTeX 표기로 바꿔 둔다.
    (re.compile(r"\\overarc(?=\s*\{)"), r"\\overset{\\frown}"),
    # HWP `vert` — 정본이 왕복 정합성 때문에 일부러 안 되돌린다. 지면에는 이탤릭
    # "vert" 로 찍힌다. 소문자 `vert` 를 품은 LaTeX 명령은 `\vert`·`\lvert`·`\rvert`
    # 셋뿐이라 그것만 피한다(앞뒤 영문자 금지는 걸면 안 된다 — 절댓값은 붙는다).
    (re.compile(r"(?<!\\)(?<!\\[lr])vert"), r"\\vert "),
    # 섭씨·화씨.
    (re.compile(r"(?<![\\A-Za-z])CENTIGRADE(?![A-Za-z])"), r"^\\circ\\mathrm{C}"),
    (re.compile(r"(?<![\\A-Za-z])FAHRENHEIT(?![A-Za-z])"), r"^\\circ\\mathrm{F}"),
    # `RM`/`IT` 가 구분자를 삼킨 잔여분 — `\mathit{LEFT}(t,~t\right)` 처럼 짝 없는
    # `\right` 를 남겨 KaTeX 를 깨뜨린다.
    (re.compile(r"\\mathit\{LEFT\}"), r"\\left"),
    (re.compile(r"\\mathit\{RIGHT\}"), r"\\right"),
    (re.compile(r"\\mathit\{ANGLE([A-Za-z]*)\}"), r"\\angle \1"),
    (re.compile(r"!="), r"\\neq "),
    (re.compile(r"<="), r"\\leq "),
    (re.compile(r">="), r"\\geq "),
    # 정본 이름 그대로 새어 나온 부등호. **짧은꼴 `le`/`ge` 규칙보다 먼저** 둔다 —
    # 순서를 바꾸면 `leq` 가 `\leq q` 가 된다.
    (re.compile(r"(?<![\\A-Za-z])(?:LEQ|leq)"), r"\\leq "),
    (re.compile(r"(?<![\\A-Za-z])(?:GEQ|geq)"), r"\\geq "),
    (re.compile(r"(?<![\\A-Za-z])(?:NEQ|neq)"), r"\\neq "),
    (re.compile(r"(?<![<>!=])==(?![=])"), "="),
]

# 짧은꼴 `le`/`ge` — **덩어리 단위**로 봐야 해서 단순 치환 목록에 못 넣는다.
#
# HWP 수식편집기는 `le`·`ge` 를 ≤·≥ 로 읽지만 정본 `SYMBOL_MAP` 은 `\le`→`LEQ`
# 한 방향뿐이라 역매핑 키가 `LEQ` 밖에 없다. 그래서 `le` 는 토큰째 흘러나간다.
#
# 두 겹으로 막는다 (DB 전수 표본을 눈으로 보고 정한 경계다):
#   ① 덩어리 전체가 «한두 글자 + le/ge» 로 분해될 것 — `rpile`(r·p·i+le)·`ballet` 차단.
#   ② 전부 대문자면 키워드 그 자체일 때만 — `\angle GEF`·`CGE`·`GECF` 는 기하 라벨이다.
# `renderPostfixRules.ts` 의 같은 이름 규칙과 **판정이 같아야 한다.**
_LEGE_RUN = re.compile(r"(?<![\\A-Za-z])[A-Za-z]{2,}")
_LEGE_DECOMPOSABLE = re.compile(r"^(?:[A-Za-z]{0,2}(?:le|ge))+[A-Za-z]{0,2}$", re.I)
_LEGE_TOKEN = re.compile(r"le|ge", re.I)
# 덩어리 안에 이 낱말이 있으면 부등호가 아니다 (정본 구조 키워드 + 각/삼각형).
_LEGE_BLOCK = ("pile", "left", "right", "angle", "triangle", "eqalign", "arch")

# 인자가 **점 라벨**인 명령 — 여기 안의 글자는 잔재가 아니다.
# `\overline{GE}`(선분 GE)의 `GE` 를 ≥ 로 바꿔 실제로 두 행을 망가뜨린 뒤 넣었다.
# 중괄호 한 겹 중첩까지 본다 — `[^{}]*` 만 쓰면 `\mathrm{\overline{GE}}` 가 샌다.
_PROTECTED = re.compile(
    r"\\(?:text|mathrm|mathit|mathbf|mathbb|mathcal|mathfrak|mathsf|mathtt"
    r"|operatorname|mbox|overline|underline|overrightarrow|overleftarrow"
    r"|overleftrightarrow|widehat|widetilde)\s*\{(?:[^{}]|\{[^{}]*\})*\}"
)
_SENTINEL = ""


def _outside_protected(latex: str, fn) -> str:
    """보호 구간을 잠시 치우고 나머지에만 `fn` 을 적용한다."""
    kept = []

    def hide(m):
        kept.append(m.group(0))
        return _SENTINEL + str(len(kept) - 1) + _SENTINEL

    masked = _PROTECTED.sub(hide, latex)
    out = fn(masked)
    return re.sub(
        _SENTINEL + r"(\d+)" + _SENTINEL, lambda m: kept[int(m.group(1))], out
    )


def _fix_lege(latex: str) -> str:
    def one(m: "re.Match[str]") -> str:
        run = m.group(0)
        if not _LEGE_TOKEN.search(run):
            return run
        if not _LEGE_DECOMPOSABLE.match(run):
            return run
        low = run.lower()
        if any(kw in low for kw in _LEGE_BLOCK):
            return run
        if len(run) > 2 and run == run.upper():
            return run
        return _LEGE_TOKEN.sub(
            lambda k: "\\leq " if k.group(0).lower() == "le" else "\\geq ", run
        )

    return _LEGE_RUN.sub(one, latex)


def postfix_latex(latex: str) -> str:
    """변환기가 못 되돌린 잔여 HWP 키워드를 LaTeX 로 마저 옮긴다."""
    if not latex:
        return latex
    out = latex
    for pat, rep in _POST:
        out = pat.sub(rep, out)
    # 점 라벨 인자를 가린 채로만 짧은꼴 부등호를 옮긴다.
    out = _outside_protected(out, _fix_lege)
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
