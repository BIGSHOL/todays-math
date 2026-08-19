# -*- coding: utf-8 -*-
"""`\\square`(□) 로 무너진 RPM 행을 **정답책 원문과 나란히** 놓는다. 판단은 사람이 한다.

    python scripts/qa/compare-rpm-square.py --list 8    # 표본을 나란히
    python scripts/qa/compare-rpm-square.py --emit      # 대조표 파일로

입력: `scripts/qa/reports/rpm-square-rows.json` (□ 가 든 행 — DB 에서 뽑는다)
출력: `scripts/qa/reports/rpm-square-compare.json`

## 왜 자동으로 안 바꾸나

둘 다 성한 데가 있고 둘 다 무너진 데가 있다.

| | 우리 DB | 정답책 원문(변환본) |
|---|---|---|
| 쌓인 분수 | **살아 있다** (`\\frac{9}{\\overline{AC}}`) | 납작해진다 (`9 9 AC`) |
| 기호 | **□ 로 무너진 자리 3,107개** | 살아 있다 |

그러니 「어느 쪽이 낫다」는 행마다 다르다. 자동으로 갈아 끼우면 분수를 잃는 쪽으로
517행이 한꺼번에 기운다. 그래서 **나란히 놓고 원장님이 정한다** — 이 도구는 그 자리를
만들 뿐 아무것도 쓰지 않는다.

## 고를 때 볼 것 하나

□ 개수와 «분수가 있나»를 같이 찍는다. □ 가 많고 분수가 없는 행은 원문 쪽이 확실히 낫고,
□ 가 한둘인데 분수가 많은 행은 지금이 낫다. 그 둘 사이가 판단이 필요한 자리다.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = pathlib.Path(__file__).parent
ROWS = pathlib.Path("scripts/qa/reports/rpm-square-rows.json")
ORIGIN = pathlib.Path("scripts/qa/reports/rpm-origin.json")
OUT = pathlib.Path("scripts/qa/reports/rpm-square-compare.json")
SRC = pathlib.Path(".rpm-src")
FRAC = re.compile(r"\\frac|\\dfrac")


def load(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, HERE / path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", type=int, default=0)
    ap.add_argument("--emit", action="store_true")
    a = ap.parse_args()

    auditsol = load("auditsol", "audit-rpm-solutions.py")
    rpmlatex = load("rpmlatex", "rpm_book_latex.py")

    rows = json.loads(ROWS.read_text(encoding="utf-8"))["목록"]
    origin = {
        o["problemId"]: o
        for o in json.loads(ORIGIN.read_text(encoding="utf-8"))["목록"]
        if o.get("problemId")
    }

    books: dict[str, dict[int, tuple[str, str]]] = {}
    pairs: list[dict] = []
    tally: dict[str, int] = {}

    def bump(k: str) -> None:
        tally[k] = tally.get(k, 0) + 1

    for r in rows:
        o = origin.get(r["id"])
        if not o or not o.get("book") or not o.get("printedNumber"):
            bump("출처가 없다")
            continue
        book = o["book"]
        pdf = SRC / book.replace("학생용", "정답")
        if not pdf.exists():
            bump("정답책이 없다")
            continue
        if book not in books:
            books[book] = auditsol.book_solution_map(pdf)
            print(f"  {book} 색인 {len(books[book])}", flush=True)
        q = int(re.sub(r"\D", "", o["printedNumber"]) or 0)
        got = books[book].get(q)
        if not got or not got[0].strip():
            bump("정답책에 풀이가 없다")
            continue
        pairs.append(
            {
                "id": r["id"],
                "book": book,
                "q": q,
                "□": r["sq"],
                "분수": len(FRAC.findall(r["solution"] or "")),
                "지금": r["solution"],
                "원문": rpmlatex.to_latex(got[0]),
            }
        )

    pairs.sort(key=lambda p: -(p["□"]["solution"]))
    print(f"\n□ 가 든 행 {len(rows)} · 정답책과 나란히 놓을 수 있는 것 {len(pairs)}")
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"  건너뜀: {k} {v}")

    for p in pairs[: a.list]:
        print(f"\n═══ {p['book'][7:10]} #{p['q']}  □ {p['□']}  분수 {p['분수']}개")
        print(f"  지금 {(p['지금'] or '')[:160]}")
        print(f"  원문 {p['원문'][:160]}")

    if a.emit:
        OUT.write_text(json.dumps({"집계": tally, "대조": pairs}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\n→ {OUT}")


if __name__ == "__main__":
    main()
