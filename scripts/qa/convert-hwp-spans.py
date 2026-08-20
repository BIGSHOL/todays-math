# -*- coding: utf-8 -*-
"""`$…$` 안의 **HWP 수식 스크립트를 LaTeX 로** 바꾼다 — 입력/출력은 JSON 파일.

    python scripts/qa/convert-hwp-spans.py 들어온것.json 나갈것.json
    python scripts/qa/convert-hwp-spans.py --probe          # 정본 구멍 재확인

들어온것: `[{"id": "...", "text": "…$LEFT ( x RIGHT )$…"}, …]`
나갈것  : `[{"id": "...", "text": "…$\\left( x\\right)$…", "spans": n}, …]`

## 왜 파이썬인가

변환 정본이 `testchanger/core/hwpeq_to_latex.py` 다. **변환기는 새로 만들지 않는다** —
이 저장소가 `build-hwp-latex.py` 에서 이미 그 규율을 세웠다. 판정(잔재가 남았나 ·
붉게 나가나)과 DB 쓰기는 TS 쪽(`repair-solution-hwp.ts`)이 한다.

## 🔴 정본에도 구멍이 있다 — 실제 토큰을 넣어 확인했다 (`--probe` 로 재확인)

| 넣은 것 | 정본이 낸 것 | 왜 나쁜가 |
| --- | --- | --- |
| `overline {AB}` | `\\frac{}{line}AB` | **선분이 분수가 된다.** 에러 없음 |
| `UNDEROVER _{0}^{2}` | 그대로 | 날 글자 |
| `RIGHTARROW`·`rightarrow`·`leftarrow` | 그대로 붙어서 | 날 글자 |

`overline` 은 **정본 어휘에 없다**(`hwp-vocab.json` 은 `underline` 만 안다).
그래서 앞단 `hwpeq_unglue._RIGHT` 가 `over` 를 떼어 `over line` 으로 만들고,
그 `over` 가 분수 키워드로 먹힌다. 여기서는 그런 조각을 **변환 전에 감춰 두고**
끝난 뒤 되돌린다 — 정본을 고치지 않으면서 구멍만 막는다.

⚠️ 감출 때 쓰는 열쇠는 **사적 사용 영역(U+E100~)** 글자다. 어떤 어휘에도 없으므로,
   정본이 열쇠를 삼켜 버리면 결과에 그대로 남고 **부르는 쪽 잔재 검사가 잡는다.**
   조용히 사라지지 않는 것이 요점이다.
"""
import json
import pathlib
import re
import sys

sys.path.append(str(pathlib.Path(__file__).parent))
from tc_paths import testchanger_dir  # noqa: E402

TC = testchanger_dir()
sys.path.insert(0, str(TC))
from core.hwpeq_to_latex import hwpeq_to_latex  # noqa: E402
from hwpeq_unglue import postfix_latex, unglue  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SPAN = re.compile(r"[$]([^$]*)[$]")

#: (이름, 정규식, 되돌리는 함수). 정규식에 그룹이 있으면 그 값이 `g` 로 온다.
_HOLES = [
    (
        "overline",
        re.compile(r"(?<![A-Za-z\\])(?:overline|OVERLINE)\s*\{([^{}]*)\}"),
        lambda g: "\\overline{%s}" % g.strip(),
    ),
    (
        "underline",
        re.compile(r"(?<![A-Za-z\\])(?:underline|UNDERLINE)\s*\{([^{}]*)\}"),
        lambda g: "\\underline{%s}" % g.strip(),
    ),
    (
        "rightarrow",
        re.compile(r"(?<![A-Za-z\\])(?:RIGHTARROW|Rightarrow|rightarrow)(?![A-Za-z])"),
        lambda g: "\\rightarrow ",
    ),
    (
        "leftarrow",
        re.compile(r"(?<![A-Za-z\\])(?:LEFTARROW|Leftarrow|leftarrow)(?![A-Za-z])"),
        lambda g: "\\leftarrow ",
    ),
    (
        # 위·아래 첨자를 한꺼번에 다는 HWP 표시. LaTeX 는 `_{}^{}` 만으로 충분하다.
        "underover",
        re.compile(r"(?<![A-Za-z\\])UNDEROVER(?![A-Za-z])"),
        lambda g: "",
    ),
    (
        # 🔴 **소문자** `rarrow` 는 →다. 정본 어휘는 「대문자=겹화살표」 규약인데
        #    (`RARROW→\\Rightarrow` · `LARROW→\\Leftarrow` · `uparrow→\\uparrow`)
        #    소문자 `rarrow` 항목이 **없어서** 대문자로 떨어져 ⇒ 가 된다.
        #    실측 `lim _{n rarrow INF }` → `\\lim _{n\\Rightarrow \\infty }` —
        #    극한 아래첨자에 ⇒ 가 설 수 없으니 그 자체가 반증이다.
        "to",
        re.compile(r"(?<![A-Za-z\\])rarrow(?![A-Za-z])"),
        lambda g: "\\to ",
    ),
    (
        "larrow",
        re.compile(r"(?<![A-Za-z\\])larrow(?![A-Za-z])"),
        lambda g: "\\leftarrow ",
    ),
]

_KEY0 = 0xE100

# ── 붙어 버린 **함수 이름** 떼어내기 ────────────────────────────────────────
#
# `hwpeq_unglue` 는 구조 키워드(over·sqrt·bar…)만 뗀다. 실측으로 남은 잔재의
# 대부분은 **함수 이름이 인자에 붙은 것**이었다 — `sintheta`(41) · `costheta`(33)
# · `loga`(18) · `log2`. 정본은 `sin theta` 는 잘 바꾸고 `sintheta` 는 그냥 흘린다.
#
# 🔴 목록을 손으로 쓰지 않는다. `hwp-vocab.json` 은 **정본에서 뽑은 것**이고
#    세는 쪽(`census-math-tokens.ts`)도 같은 파일을 읽는다. 손으로 적으면
#    세는 쪽과 고치는 쪽이 같이 눈이 먼다(CLAUDE.md 2026-08-18).
#
# 길이 3 이상만 쓴다 — `in`·`of`·`to`·`it` 같은 두 글자는 멀쩡한 낱말을 찢는다.
_VOCAB = json.loads(
    (pathlib.Path(__file__).parent / "hwp-vocab.json").read_text(encoding="utf-8")
)
# 🔴 **네 목록을 다 합친다.** 하나만 쓰면 샌다 — 실측으로 `INF` 는 `reverse` 에만,
#    `RIGHT` 는 `struct` 에만 있었다. `INF` 를 놓치니 `\lim _{n rarrow INF }` 가
#    `\lim _{n\to \in F}` 가 됐다(`in` + `F` 로 찢겼다). 「긴 것부터」만으로는
#    부족하고 **목록이 온전해야** 긴 것이 있다.
#    그래도 정본은 샌다 — `BECAUSE`·`THEREFORE` 는 네 목록 어디에도 없는데
#    변환기는 안다. 그 부류는 손으로 더하지 않고 **잔재 가드가 그 행을 버린다.**
_GLUE_TOKENS = {
    t
    for t in (
        list(_VOCAB["hwpTokens"])
        + list(_VOCAB["reverse"].keys())
        + list(_VOCAB["struct"])
        + list(_VOCAB["gluePrefix"])
        + list(_VOCAB.get("outsideCanon", {}).keys())
    )
    if isinstance(t, str) and len(t) >= 2 and t.isalpha()
}
#: 길이 내림차순 — **긴 것부터** 맞춰야 `TRIANGLE` 이 `TRI ANGLE` 로 찢기지 않는다.
_GLUE_SORTED = sorted(_GLUE_TOKENS, key=len, reverse=True)
#: 대소문자를 가리지 않는다 — 정본은 `RIGHT` 를 `right` 로만 적어 두었다.
_GLUE_LOWER = {t.lower() for t in _GLUE_TOKENS}
_WORD = re.compile(r"[A-Za-z]{2,}")


def _segment(word: str) -> "list[str] | None":
    """낱말 하나를 어휘 조각으로 **덮는다**. 못 덮으면 `None`."""
    pieces: list[str] = []
    i = 0
    lone = 0
    low = word.lower()
    while i < len(word):
        for t in _GLUE_SORTED:
            if low.startswith(t.lower(), i):
                pieces.append(word[i : i + len(t)])  # 원문 대소문자를 지킨다
                i += len(t)
                break
        else:
            pieces.append(word[i])
            lone += 1
            i += 1
    if len(pieces) < 2:
        return None
    # 🔴 어휘 토큰이 하나도 없으면 그냥 변수 이름이다 — 찢지 않는다(`abc`).
    if not any(len(p) >= 2 for p in pieces):
        return None
    # 🔴 **전부 대문자면 기하 라벨과 구분되지 않는다** — 조각 중에 두 글자 이하가
    #    있으면 찢지 않는다. `rm COF` 의 `COF` 가 `C`+`OF` 로 찢겨
    #    `\mathrm{C}OF` 가 나왔다(실측 16자리). 2026-08-18 의 `∠GEF` → `∠\geq F`
    #    와 같은 부류이고, 그때 쓴 규율도 같다 — **키워드 그 자체일 때만 허용.**
    #    `LEFTRIGHT` 처럼 조각이 전부 온전한 키워드면 그대로 가른다.
    #    소문자·섞임은 이 규칙을 안 탄다(`piRIGHT` 는 `\pi \right` 로 갈라야 한다).
    if word.isupper() and any(len(p) < 3 for p in pieces):
        return None
    # 홑글자가 셋 이상이면 낱말을 산산조각 낸 것이다 — 그것도 안 한다.
    if lone > 2:
        return None
    return pieces


def _unglue_vocab(body: str) -> str:
    """정본 어휘로 붙은 낱말을 뗀다 — `sintheta`→`sin theta` · `piRIGHT`→`pi RIGHT`.

    🔴 정규식으로 «토큰 뒤에 글자가 오면 띄운다» 식으로 하면 안 된다.
       `TRIANGLE` 의 `ANGLE` 이 걸려 `TRI ANGLE` 이 되고, 반대로 `piRIGHT` 의
       `RIGHT` 는 앞이 글자라 lookbehind 에 막혀 **영영 안 갈라진다.**
       그래서 낱말을 통째로 받아 **긴 토큰부터 덮는다.**
    """

    def rep(m: "re.Match[str]") -> str:
        word = m.group(0)
        if word.lower() in _GLUE_LOWER:
            return word  # 이미 온전한 토큰이다(`TRIANGLE`)
        seg = _segment(word)
        return " ".join(seg) if seg else word

    out = _WORD.sub(rep, body)
    # 숫자에 붙은 것(`log2`)은 낱말 규칙이 못 본다 — 토큰 뒤 숫자만 띄운다.
    #
    # 🔴 여기는 **두 글자도 뗀다.** 위 `_segment` 가 두 글자를 안 쓰는 이유는
    #    「낱말 **안**을 가를 때 `in`·`of` 가 멀쩡한 변수 이름을 찢기 때문」이고,
    #    그 이유는 **숫자 앞에서는 성립하지 않는다** — 낱말 경계에서 토큰 바로
    #    뒤가 숫자면 가를 자리가 하나뿐이다. 같은 문턱을 물려받았다가
    #    `ln2`·`ln108` 이 영영 안 갈라졌다(실측 잔재 1위 `ln` 103자리).
    #    분모가 다르면 같은 숫자가 다른 것을 가리킨다(CLAUDE.md 2026-08-17).
    #
    #    전수 실측(본문+해설, 변환 대상 덩어리): 두 글자로 넓혀 새로 걸리는 자리는
    #    `ln` 120 · `of` 3 · `it` 2 · `RM` 2 · `mu` 1 = 128 이고, 이 중 둘은
    #    base64 덩어리가 통째로 `$…$` 안에 든 문항 두 개(별건 결함)다.
    #    나머지는 전부 진짜다(`RM5cm` · `=it4m` · `sqrt4 of4`).
    for t in _GLUE_SORTED:
        if len(t) < 2:
            continue
        out = re.sub(r"(?<![A-Za-z\\])" + re.escape(t) + r"(?=[0-9])", t + " ", out)
    return out


def _convert(body: str) -> str:
    holes: list[tuple[str, str]] = []

    masked = body
    for name, pat, _back in _HOLES:

        def rep(m: "re.Match[str]", name: str = name) -> str:
            key = chr(_KEY0 + len(holes))
            holes.append((name, m.group(1) if m.re.groups else ""))
            return key

        masked = pat.sub(rep, masked)

    out = postfix_latex(hwpeq_to_latex(unglue(_unglue_vocab(masked))))

    for i, (name, g) in enumerate(holes):
        back = next(b for n, _p, b in _HOLES if n == name)
        out = out.replace(chr(_KEY0 + i), back(g))
    return out


def convert(text: str) -> "tuple[str, int]":
    n = 0

    def rep(m: "re.Match[str]") -> str:
        nonlocal n
        n += 1
        return "$" + _convert(m.group(1)) + "$"

    return SPAN.sub(rep, text), n


PROBE = [
    "overline {AB}",
    "rm overline { AH } = it x",
    "UNDEROVER _{0} ^{2}",
    "a RIGHTARROW b",
    "3 leftarrow 4",
    "LEFT ( 3x ^{2} +ax-5 RIGHT )",
    "lim _{n rarrow INF } {{a _{n}} over {n}}",
    "RM BAR {Q_1 H}=root 3",
    "{1} over {2}",
    "cases{ cos x # sin x }",
    # 🔴 붙어 버린 낱말 — 이게 없으면 `_unglue_vocab` 을 꺼도 산출물이 그대로다
    #    (즉 시험이 그 자리를 구조적으로 못 본다).
    "sintheta",
    "piRIGHT )",
    "log2",
    "TRIANGLE ABC",
    # 🔴 대문자 라벨은 안 찢고(`COF`), 숫자 앞은 두 글자도 뗀다(`ln2`).
    #    이 둘이 없으면 두 규칙 중 어느 쪽을 뒤집어도 산출물이 그대로다.
    "rm COF",
    "triangle rm AOF",
    "5 ln2",
    "e ^{ln108} =108",
    "RM5cm ^{2}",
]


def main() -> None:
    if "--probe" in sys.argv:
        for c in PROBE:
            print("%-40s -> %s" % (c, _convert(c)))
        return
    src = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = []
    for row in src:
        try:
            text, n = convert(row["text"])
        except Exception as e:  # noqa: BLE001 — 한 행이 죽어도 나머지는 간다
            out.append({"id": row["id"], "error": repr(e)[:200]})
            continue
        out.append({"id": row["id"], "text": text, "spans": n})
    pathlib.Path(sys.argv[2]).write_text(
        json.dumps(out, ensure_ascii=False), encoding="utf-8"
    )
    print("변환 %d행 (오류 %d)" % (len(out), sum(1 for r in out if "error" in r)))


if __name__ == "__main__":
    main()
