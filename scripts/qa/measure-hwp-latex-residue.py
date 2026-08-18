# -*- coding: utf-8 -*-
"""트랙 D-3 — 변환 뒤에도 남은 **HWP 스크립트 잔재**를 센다.

KaTeX 는 `1over5x` 를 에러로 보지 않고 그냥 글자로 그린다. 그래서 렌더 실패율로는
안 잡히고 지면에만 나타난다 — 이 지표가 `hwpeq_unglue.py` 의 유일한 성적표다.

  python scripts/qa/measure-hwp-latex-residue.py
  python scripts/qa/measure-hwp-latex-residue.py <추출물 디렉터리>

추출물(`reports/hwp-latex/*.json`)은 gitignore 대상이라 워크트리를 지우면 사라진다.
저장소 밖 고정 위치에 있다 — `C:/Creative/testautocreator-data/D-HWP/qa-reports/hwp-latex`
(tracks/README "저장소 밖 산출물" 참조). 인자로 그 경로를 주면 된다.

## ⚠️ 이 지표는 두 번 눈이 멀었다 — 둘 다 **손 목록** 때문이다

1. (2026-08-17) `DIV` 를 `(?![A-Za-z])` 로 닫아 두어 `DIVIDE` 는 뒤의 `I` 에 막혀
   영원히 0이었다. "잔재 0.06% 로 줄였다"는 보고가 `aDIVIDEb` 를 통째로 놓쳤다.
2. (2026-08-18) `le`·`ge`·소문자 `times` 가 **목록에 아예 없었다.** 고치는 쪽
   (`hwpeq_unglue.py`)에도 없어 둘이 같이 눈이 멀었고, 지면에 `xle-7`·`age2` 가
   그대로 나갔다(원장님 스크린샷).

그래서 **어휘를 여기서 손으로 적지 않는다.** `hwp-vocab.json`(변환기 정본에서
`build-hwp-vocab.py` 가 추출)을 읽고, 고치는 쪽과 **같은 목록**을 본다.
정본에도 없는 잔재(`le`·`ge`)는 그 파일의 `outsideCanon` 에 실린다.

DB 본문 기준으로 «지면에 실제로 나가는» 것을 세는 것은
`scripts/qa/census-math-tokens.ts` 다 — 그쪽은 목록 없이 렌더로 판정한다.
이 스크립트는 **재추출 산출물**(reports/hwp-latex/*.json)을 재는 쪽이다.
"""
import collections
import json
import pathlib
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

BS = chr(92)
SPAN = re.compile(r"[$]([^$]+)[$]")

# 환경 이름·점 라벨은 **우리가 넣은 것**이라 잔재가 아니다. 안 가리면 `\begin{cases}` 의
# `cases` 가 1위로 올라와(실측 6,919) 지표가 자기 자신을 세게 된다.
PROTECTED = re.compile(
    r"\\(?:begin|end|text|mathrm|mathit|mathbf|mathbb|mathcal|mathfrak|mathsf"
    r"|mathtt|operatorname|mbox|overline|underline|overrightarrow|overleftarrow"
    r"|overleftrightarrow|widehat|widetilde|htmlClass)\s*\{(?:[^{}]|\{[^{}]*\})*\}"
)

VOCAB = json.loads(
    (pathlib.Path(__file__).parent / "hwp-vocab.json").read_text(encoding="utf-8")
)

# 정본 어휘 — 구조 키워드와 HWP 토큰. 두 글자짜리는 변수와 부딪쳐 못 센다.
CANON = sorted(
    {t for t in VOCAB["struct"] + VOCAB["hwpTokens"] if len(t) >= 3},
    key=len,
    reverse=True,
)
# 정본에 없는데 실데이터에 있는 것 (`le`·`ge`).
OUTSIDE = sorted(VOCAB["outsideCanon"])

# 대문자 키워드는 **앞뒤가 영문자여도** 잔재다 — 붙어 있는 것이 이 결함의 본모습이다.
# 소문자 키워드만 영어 낱말의 일부일 수 있어 경계를 요구한다.
def _pattern(kw: str) -> "re.Pattern[str]":
    if kw.isupper():
        return re.compile("(?<!" + BS + BS + ")" + kw)
    return re.compile("(?<![A-Za-z" + BS + BS + "])" + kw + "(?![A-Za-z])")


PATS = {kw: _pattern(kw) for kw in CANON}
# `le`/`ge` 는 덩어리 단위로 세야 한다(`xle2`·`lexle`). 낱말 경계로는 못 센다.
LEGE = re.compile(r"(?<![\\A-Za-z])(?:[A-Za-z]{0,2}(?:le|ge))+[A-Za-z]{0,2}(?![A-Za-z])")
# 붙어버린 구조 키워드 — `1over5x` · `3root3`.
GLUED = re.compile("[A-Za-z0-9](over|atop|sqrt|root)[A-Za-z0-9]")

cnt = collections.Counter()
glued = collections.Counter()
spans = 0
bad = 0
badq = 0
qs_all = 0

SOURCE = pathlib.Path(
    sys.argv[1] if len(sys.argv) > 1 else "scripts/qa/reports/hwp-latex"
)
files = sorted(SOURCE.glob("*.json"))
if not files:
    print("⚠️ 추출물이 없다: %s — 경로를 인자로 넘겨라(위 도움말 참조)." % SOURCE)

for f in files:
    d = json.loads(f.read_text(encoding="utf-8"))
    for q in d.get("questions") or []:
        qs_all += 1
        txt = (q.get("stem") or "") + chr(10) + chr(10).join(q.get("choices") or [])
        qbad = False
        for raw in SPAN.findall(txt):
            spans += 1
            e = PROTECTED.sub(" ", raw)
            hit = False
            for kw, p in PATS.items():
                n = len(p.findall(e))
                if n:
                    cnt[kw] += n
                    hit = True
            for m in LEGE.finditer(e):
                run = m.group(0)
                # 전부 대문자면 기하 라벨일 수 있어 세지 않는다(고치는 쪽과 같은 판정).
                if len(run) > 2 and run == run.upper():
                    continue
                cnt["le/ge"] += 1
                hit = True
            for m in GLUED.finditer(e):
                glued[m.group(1)] += 1
                hit = True
            if hit:
                bad += 1
                qbad = True
        if qbad:
            badq += 1

print("어휘 정본 %d개(3글자+) + 정본 밖 %s" % (len(CANON), OUTSIDE))
print("문항 %d · 수식 span %d" % (qs_all, spans))
print(
    "잔재 span %d (%.2f%%) · 잔재 문항 %d (%.2f%%)"
    % (bad, bad * 100 / max(1, spans), badq, badq * 100 / max(1, qs_all))
)
print("맨 키워드 잔재:", cnt.most_common(15))
print("붙어버린 키워드:", glued.most_common())
