# -*- coding: utf-8 -*-
"""RPM 정답책 PDF 원문에 **무엇이 들어 있는지** 센다. 매핑표를 만들기 전에 먼저 본다.

    python scripts/qa/census-rpm-glyphs.py            # 빈도순 전량
    python scripts/qa/census-rpm-glyphs.py --pairs    # LaTeX 정답과 짝지어 표본을 보여 준다

출력: `scripts/qa/reports/rpm-glyph-census.json`

## 목록을 손으로 쓰면 세는 쪽과 고치는 쪽이 같이 눈이 먼다

무엇이 «변환해야 할 것»인지 미리 정하고 목록을 적으면, 그 목록에 없는 부류는
구조적으로 0이 된다. 성공률이 0을 향해도 아무것도 증명하지 못한다
(CLAUDE.md 2026-08-18 `le`/`ge` 사건).

그래서 **무엇이 잔재인지 정하지 않는 발견기**로 시작한다 — 정답책 원문에서
아스키가 아닌 낱글자와 「한컴 약물」 모양을 **전부** 세어 빈도순으로 늘어놓는다.

## 채점 기준은 우리 DB 에 이미 있다

해설 4,607건이 **제대로 된 LaTeX** 로 들어와 있고, 같은 문항이 정답책에도 있다.
그 둘을 짝지으면 «원문 → LaTeX» 대응쌍이 수천 개 생긴다. 매핑은 거기서 뽑고,
변환기의 성적도 거기서 잰다 — 참이 제품 밖에서 온다.
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import re
import sys

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SRC = pathlib.Path(".rpm-src")
ORIGIN = pathlib.Path("scripts/qa/reports/rpm-origin.json")
OUT = pathlib.Path("scripts/qa/reports/rpm-glyph-census.json")

#: 한컴이 쓰는 약물 모양 — 낱글자가 아니라 **구조**라 따로 센다.
#: 목록이 아니라 «모양»이다: `;`…`;` 사이에 짧은 것이 오면 분수·첨자류다.
HANCOM_BRACE = re.compile(r";[^;\s]{1,8};")
#: 근호는 따옴표로 시작한다 — `'3` `'¶10` `"Ã2Û`+4Û`"` 처럼.
ROOT_LIKE = re.compile(r"['\"][^\s]{1,12}")
ASCII_OK = re.compile(r"[\x20-\x7e가-힣]")


def book_text(pdf: pathlib.Path) -> str:
    doc = pymupdf.open(pdf)
    t = "\n".join(doc[i].get_text("text") for i in range(doc.page_count))
    doc.close()
    return t


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", action="store_true")
    a = ap.parse_args()

    books = sorted(SRC.glob("RPM 중학 *-* 정답.pdf"))
    if not books:
        raise SystemExit(f"정답책이 없다: {SRC}")

    chars: collections.Counter[str] = collections.Counter()
    braces: collections.Counter[str] = collections.Counter()
    roots: collections.Counter[str] = collections.Counter()
    for b in books:
        t = book_text(b)
        for ch in t:
            if not ASCII_OK.match(ch) and not ch.isspace():
                chars[ch] += 1
        braces.update(m.group(0) for m in HANCOM_BRACE.finditer(t))
        roots.update(m.group(0)[:6] for m in ROOT_LIKE.finditer(t))
        print(f"  {b.name} 훑음", flush=True)

    print(f"\n■ 아스키·한글이 아닌 낱글자 {len(chars)}종")
    for ch, n in chars.most_common(40):
        print(f"   {n:7d}  {ch!r}  U+{ord(ch):04X}")
    print(f"\n■ 한컴 약물 `;…;` {len(braces)}종 (상위 20)")
    for s, n in braces.most_common(20):
        print(f"   {n:7d}  {s}")
    print(f"\n■ 근호 꼴 {len(roots)}종 (상위 20)")
    for s, n in roots.most_common(20):
        print(f"   {n:7d}  {s}")

    OUT.write_text(
        json.dumps(
            {
                "낱글자": [{"글자": c, "코드": f"U+{ord(c):04X}", "횟수": n} for c, n in chars.most_common()],
                "한컴약물": [{"꼴": s, "횟수": n} for s, n in braces.most_common(200)],
                "근호꼴": [{"꼴": s, "횟수": n} for s, n in roots.most_common(200)],
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"\n→ {OUT}")


if __name__ == "__main__":
    main()
