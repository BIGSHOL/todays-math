# -*- coding: utf-8 -*-
"""정답책 원문 ↔ 우리 LaTeX 해설의 **대응쌍**을 만든다. 변환기의 채점표가 된다.

    python scripts/qa/build-rpm-solution-pairs.py
    python scripts/qa/build-rpm-solution-pairs.py --list 5

출력: `scripts/qa/reports/rpm-solution-pairs.jsonl`  `{q, book, raw, latex}`

## 왜 대응쌍인가

변환기의 «참»이 변환기 안에서 오면 안 된다. 우리 DB 에는 **이미 제대로 된 LaTeX** 해설이
4,607건 있고, 같은 문항이 정답책에도 있다. 그 둘을 짝지으면 「이 원문은 이 LaTeX 가
되어야 한다」가 수천 개 생긴다 — 매핑을 거기서 뽑고 성적도 거기서 잰다.

## 짝이 맞는지 **본문 밖에서** 확인한다

번호로 찾은 것만으로는 같은 문항인지 모른다. 그래서 **한글만 남겨** 견준다 —
수식은 표기가 달라 못 견주지만 한글 서술(「따라서」·「이므로」)은 양쪽이 같다.
닮음이 낮으면 쌍에서 뺀다. 틀린 쌍이 섞이면 매핑을 그쪽으로 끌고 간다.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from difflib import SequenceMatcher

sys.path.append(str(pathlib.Path(__file__).parent))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ORIGIN = pathlib.Path("scripts/qa/reports/rpm-origin.json")
SOLUTIONS = pathlib.Path("scripts/qa/reports/rpm-solutions-db.json")
OUT = pathlib.Path("scripts/qa/reports/rpm-solution-pairs.jsonl")
SRC = pathlib.Path(".rpm-src")
KO = re.compile(r"[가-힣]+")
#: 한글 서술이 이만큼은 닮아야 같은 문항으로 본다.
MIN_KO_SIM = 0.55
#: 한글이 이만큼도 없으면 견줄 수가 없다 — 쌍에서 뺀다(수식만인 해설).
MIN_KO_LEN = 8


def ko(text: str) -> str:
    return "".join(KO.findall(text))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", type=int, default=0)
    a = ap.parse_args()

    # 정답책 색인은 감사 도구의 것을 그대로 쓴다 — 규칙이 두 벌이 되면 갈라진다.
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "auditsol", pathlib.Path(__file__).parent / "audit-rpm-solutions.py"
    )
    auditsol = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(auditsol)

    db = json.loads(SOLUTIONS.read_text(encoding="utf-8"))["목록"]
    origin = {
        o["problemId"]: o
        for o in json.loads(ORIGIN.read_text(encoding="utf-8"))["목록"]
        if o.get("problemId")
    }

    books: dict[str, dict[int, tuple[str, str]]] = {}
    kept = 0
    tally: dict[str, int] = {}
    bump = lambda k: tally.__setitem__(k, tally.get(k, 0) + 1)  # noqa: E731
    OUT.parent.mkdir(parents=True, exist_ok=True)
    shown = 0
    with OUT.open("w", encoding="utf-8") as fh:
        for row in db:
            o = origin.get(row["id"])
            if not o or not o.get("book") or not o.get("printedNumber"):
                bump("출처가 없다")
                continue
            book = o["book"]
            sol_pdf = SRC / book.replace("학생용", "정답")
            if not sol_pdf.exists():
                bump("정답책이 없다")
                continue
            if book not in books:
                books[book] = auditsol.book_solution_map(sol_pdf)
                print(f"  {book} 색인 {len(books[book])}", flush=True)
            q = int(re.sub(r"\D", "", o["printedNumber"]) or 0)
            got = books[book].get(q)
            if not got or not got[0].strip():
                bump("정답책에 풀이가 없다")
                continue
            raw = got[0]
            latex = row["solution"]
            ka, kb = ko(raw), ko(latex)
            if len(ka) < MIN_KO_LEN or len(kb) < MIN_KO_LEN:
                bump("견줄 한글이 모자라다")
                continue
            sim = SequenceMatcher(None, ka, kb).ratio()
            if sim < MIN_KO_SIM:
                bump("한글 서술이 안 닮았다 — 다른 문항일 수 있다")
                continue
            fh.write(json.dumps({"q": q, "book": book, "sim": round(sim, 3), "raw": raw, "latex": latex}, ensure_ascii=False) + "\n")
            kept += 1
            if a.list and shown < a.list:
                shown += 1
                print(f"\n--- {book[7:10]} #{q} 닮음 {sim:.2f}\n  원문 {raw[:150]}\n  정답 {latex[:150]}")

    print(f"\n대응쌍 {kept}개 → {OUT}")
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"  건너뜀: {k} {v}")


if __name__ == "__main__":
    main()
