# -*- coding: utf-8 -*-
"""RPM 교재 글꼴의 «글자 → 뜻» 을 **참에서 푼다.** 표를 손으로 적지 않기 위한 도구.

    python scripts/qa/solve-rpm-glyphs.py            # 분수 분자 · 윗첨자 둘 다
    python scripts/qa/solve-rpm-glyphs.py --context µ 5   # 그 글자가 쓰인 자리를 눈으로

입력: `scripts/qa/reports/rpm-solution-pairs.jsonl` (원문 ↔ 우리 LaTeX 대응쌍)

## 왜 이 도구가 있나

`rpm_book_latex.py` 의 표를 **손으로 적었더니 여덟 자리가 틀렸다**(2026-08-19 실측).
`Ú` 를 ⁴ 로, `Ý` 를 ⁵ 로, `¥` 를 6 으로 적어 두고도 아무도 몰랐다 — 손으로 적은 표는
그 표에 없는 것도, 그 표가 틀린 것도 구조적으로 못 본다(CLAUDE.md 2026-08-18).

푸는 방법은 **대응쌍**이다. 원문 `;1¢0¼0;` 과 참 `\\frac{40}{100}` 을 맞대면
분모(평문 숫자 `100`)로 자리가 잡히고, 분자 글자열 `¢¼` 와 참의 분자 `40` 이 **같은
길이**일 때 한 글자씩 대응이 나온다. 윗첨자도 같다 — `3Ûâ` 과 `3^{20}`.

**표결이 갈리면 안 쓴다.** 짝이 틀리면 표가 그쪽으로 끌려간다.

## 이 도구가 못 보는 것

대응쌍에 없는 글자는 여기서도 안 나온다. 그래서 `score-rpm-latex.py --residue` 를
같이 봐야 한다 — 그건 «무엇이 잔재인지 미리 정하지 않는」 발견기다. 둘이 짝이다.
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PAIRS = pathlib.Path("scripts/qa/reports/rpm-solution-pairs.jsonl")
#: 분수 약물 — `;…;` · `:…:` 둘 다.
BODY = re.compile(r"[;:]([^;:\s]{1,12})[;:]")
TRUE_FRAC = re.compile(r"\\d?frac\{([^{}]{1,12})\}\{([^{}]{1,12})\}")
#: 윗첨자로 «의심되는» 덩어리 — 무엇이 윗첨자인지 미리 정하지 않는다.
SUP = re.compile(r"([0-9A-Za-z\)\}])[\u2006\u2009\u200a]?([^\x00-\x7f가-힣\s]{1,3})(?![^\x00-\x7f])")
TRUE_POW = re.compile(r"([0-9A-Za-z\)\}])\^\{(\d{1,3})\}")
#: 이만큼 표가 모이고 이 비율 이상 한쪽이면 쓴다.
MIN_VOTES, MIN_SHARE = 4, 0.75


def rows() -> list[dict]:
    return [json.loads(l) for l in PAIRS.read_text(encoding="utf-8").splitlines() if l.strip()]


def solve_fraction(rs: list[dict]) -> dict[str, collections.Counter]:
    vote: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for r in rs:
        fr = TRUE_FRAC.findall(r["latex"])
        if not fr:
            continue
        for body in BODY.findall(r["raw"]):
            den = "".join(c for c in body if c.isdigit())
            num = [c for c in body if not c.isdigit()]
            if not den or not num:
                continue
            cands = sorted({(n, d) for n, d in fr if d == den and len(n) == len(num) and n.isdigit()})
            if len(cands) != 1:
                continue
            for c, digit in zip(num, cands[0][0]):
                vote[c][digit] += 1
    return vote


def solve_super(rs: list[dict]) -> dict[str, collections.Counter]:
    vote: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for r in rs:
        pw = TRUE_POW.findall(r["latex"])
        if not pw:
            continue
        for base, glyphs in SUP.findall(r["raw"]):
            cands = sorted({(b, e) for b, e in pw if b == base and len(e) == len(glyphs)})
            if len(cands) != 1:
                continue
            for g, d in zip(glyphs, cands[0][1]):
                vote[g][d] += 1
    return vote


def report(title: str, vote: dict[str, collections.Counter]) -> None:
    print(f"\n■ {title}")
    print("   글자          표결                      씀?")
    for c, cnt in sorted(vote.items(), key=lambda kv: -sum(kv[1].values())):
        tot = sum(cnt.values())
        top = cnt.most_common()
        use = tot >= MIN_VOTES and top[0][1] / tot >= MIN_SHARE
        line = "  ".join(f"{d}:{n}" for d, n in top)
        print(f"   {c!r:8} U+{ord(c):04X}  {line:26} {'→ ' + top[0][0] if use else '— 표결이 갈린다'}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--context", nargs=2, metavar=("글자", "개수"),
                    help="그 글자가 쓰인 자리를 원문·참과 나란히 본다")
    a = ap.parse_args()
    rs = rows()
    if a.context:
        ch, n = a.context[0], int(a.context[1])
        shown = 0
        for r in rs:
            i = r["raw"].find(ch)
            if i < 0:
                continue
            print(f"\n─ {r['book'][7:10]} #{r['q']}")
            print(f"  원문 …{r['raw'][max(0, i - 45):i + 45]}…")
            print(f"  참   …{' '.join(r['latex'].split())[:170]}…")
            shown += 1
            if shown >= n:
                break
        return
    print(f"대응쌍 {len(rs)}")
    report("분수 분자 자리 (약물 `;…;` 안)", solve_fraction(rs))
    report("윗첨자 자리 (밑 뒤)", solve_super(rs))


if __name__ == "__main__":
    main()
