# -*- coding: utf-8 -*-
"""변환기의 성적을 **원문 밖에서** 매긴다.

    python scripts/qa/score-rpm-latex.py            # 점수
    python scripts/qa/score-rpm-latex.py --worst 8  # 가장 안 맞는 것부터 본다
    python scripts/qa/score-rpm-latex.py --residue  # 남은 원문 부스러기를 빈도순으로

입력: `scripts/qa/reports/rpm-solution-pairs.jsonl`

## 참은 어디서 오나

우리 DB 의 기존 LaTeX 해설이다. 단 **`\\square` 가 든 것은 참이 아니다** —
그건 옛 변환기가 실패한 자리라, 그걸 정답이라 두면 변환기가 **실패를 흉내 내야**
점수가 오른다. 그래서 채점에서 뺀다(CLAUDE.md 2026-08-18 「지표의 참이 제품에서 오면」).

## 점수만 보면 안 된다 — **잔재를 따로 센다**

렌더가 실패하지 않는 오답이 있다. `1over5x` 처럼 «성공적으로 렌더되는 잘못된 표기»는
유사도로 안 잡힌다. 그래서 변환 뒤에도 남은 **원문 전용 글자**를 빈도순으로 따로 센다
— 무엇이 잔재인지 미리 정하지 않는 발견기다(CLAUDE.md 2026-08-16·18).
"""
from __future__ import annotations

import argparse
import collections
import importlib.util
import json
import pathlib
import re
import statistics
import sys
from difflib import SequenceMatcher

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PAIRS = pathlib.Path("scripts/qa/reports/rpm-solution-pairs.jsonl")
_spec = importlib.util.spec_from_file_location(
    "rpmlatex", pathlib.Path(__file__).parent / "rpm_book_latex.py"
)
rpmlatex = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rpmlatex)

#: 견줄 때 지우는 것 — 달러·중괄호·공백은 표기 취향이라 점수를 흐린다.
NOISE = re.compile(r"[\s${}\\]+")
#: 원문 전용 글자 — 아스키도 한글도 아니고, 수학에 흔한 기호도 아니다.
KEEPABLE = re.compile(r"[\x20-\x7e가-힣∠△∽≤≥≠±×÷√…∴°⑴-⑿①-⑳㉠-㉪ㄱ-ㅎ→∼]")


def norm(s: str) -> str:
    return NOISE.sub("", s)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--worst", type=int, default=0)
    ap.add_argument("--residue", action="store_true")
    a = ap.parse_args()

    rows = [json.loads(l) for l in PAIRS.read_text(encoding="utf-8").splitlines() if l.strip()]
    clean = [r for r in rows if "\\square" not in r["latex"]]
    print(f"대응쌍 {len(rows)} · 채점에 쓸 것(‘\\square’ 없는 것) {len(clean)}")

    scored = []
    residue: collections.Counter[str] = collections.Counter()
    for r in clean:
        got = rpmlatex.to_latex(r["raw"])
        sim = SequenceMatcher(None, norm(got), norm(r["latex"])).ratio()
        scored.append((sim, r, got))
        for ch in got:
            if not KEEPABLE.match(ch) and not ch.isspace():
                residue[ch] += 1

    sims = sorted(s for s, _, _ in scored)
    base = sorted(
        SequenceMatcher(None, norm(r["raw"]), norm(r["latex"])).ratio() for r in clean
    )
    print(f"\n변환 뒤 유사도  중앙 {statistics.median(sims):.3f} · 하위10% {sims[len(sims)//10]:.3f}")
    print(f"변환 전(원문)   중앙 {statistics.median(base):.3f} · 하위10% {base[len(base)//10]:.3f}")
    print(f"→ 중앙값 {statistics.median(sims) - statistics.median(base):+.3f}")

    if residue:
        tot = sum(residue.values())
        print(f"\n■ 변환 뒤에도 남은 원문 글자 {len(residue)}종 · {tot}자")
        for ch, n in residue.most_common(25):
            print(f"   {n:6d}  {ch!r}  U+{ord(ch):04X}")

    if a.worst:
        scored.sort(key=lambda t: t[0])
        for sim, r, got in scored[: a.worst]:
            print(f"\n--- {r['book'][7:10]} #{r['q']} 점수 {sim:.2f}")
            print(f"  원문 {r['raw'][:150]}")
            print(f"  변환 {got[:150]}")
            print(f"  정답 {r['latex'][:150]}")


if __name__ == "__main__":
    main()
