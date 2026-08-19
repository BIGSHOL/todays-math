# -*- coding: utf-8 -*-
"""문항 번호가 **정말 그 문항의 번호인가**를 학생용 책에서 검산한다.

    python scripts/qa/verify-rpm-number.py --ids <파일>   # id 목록(JSON 배열)
    python scripts/qa/verify-rpm-number.py --plan scripts/qa/reports/rpm-book-fill.json

출력: `scripts/qa/reports/rpm-number-check.json`  {id: {"ok", "sim", "hasNumber"}}

## 왜 필요한가

빈 **정답**을 정답책에서 채우려면 「이 행의 번호가 맞나」를 알아야 하는데, 그 행은
정답도 해설도 비어 있어 **견줄 것이 자기 안에 없다.** 그러면 근거를 밖에서 가져와야
한다 — 우리 `content`(발문)와 **학생용 책 그 쪽의 글**을 대 보고, 그 쪽에 그 번호가
찍혀 있는지 본다. 출처가 다른 두 값이라 어긋나면 번호가 틀린 것이다.
(CLAUDE.md 2026-08-17 「본문과 독립인 근거를 하나 더 요구하라」)

## 번호로 쪽을 찾고, 그 쪽에서 발문을 확인한다 — **순서가 중요하다**

처음엔 「출처가 적은 쪽에서 발문을 찾자」로 했는데 **거꾸로였다.** 교재는 같은 말투를
되풀이하므로(「오른쪽 그림과 같은 직각삼각형 ABC에서 …」) 엉뚱한 쪽에서도 발문
닮음이 0.79 까지 나온다. 실측 3-2 #47 이 그랬다 — 그 쪽에 `0047` 은 없었다.

그래서 **번호로 쪽을 먼저 찾는다.** 학생용 책도 네 자리 번호를 찍는다(`0003`).
그 번호가 있는 쪽에서 발문이 보이면 «이 행의 번호가 이 문항의 번호»가 확인된다.
출처의 쪽 값은 어긋날 수 있으니(책마다 표지 장수가 다르다) 앞뒤로 훑는다.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from difflib import SequenceMatcher

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ORIGIN = pathlib.Path("scripts/qa/reports/rpm-origin.json")
CONTENT = pathlib.Path("scripts/qa/reports/rpm-square-rows.json")
OUT = pathlib.Path("scripts/qa/reports/rpm-number-check.json")
SRC = pathlib.Path(".rpm-src")
KO = re.compile(r"[가-힣]+")
#: 발문이 이 쪽 글 안에서 이만큼은 이어져야 «그 문항이 맞다»고 본다.
MIN_RUN = 0.55
MIN_KEY = 8
#: 출처의 쪽 값에서 앞뒤로 이만큼 훑는다.
PAGE_SWEEP = 8


#: 견줄 열쇠 — 한글**과 숫자**. 수식 위주 발문은 한글이 몇 자뿐이라 한글만으론 못 잰다.
KEY = re.compile(r"[가-힣0-9]+")


def ko(t: str) -> str:
    return "".join(KEY.findall(t or ""))


def longest_run(needle: str, hay: str) -> float:
    """발문이 그 쪽 글에 **얼마나 들어 있나** (0~1).

    ⚠️ «가장 긴 한 토막»으로 재면 안 된다. 우리 발문에는 보기·그림 라벨이 섞여
       들어와 원문과 사이사이가 끊긴다. 이어진 조각을 **모두 더해야** 「이 쪽에
       이 발문이 있다」가 제대로 잡힌다(실측: 한 토막 기준으로는 절반이 떨어졌다).
    """
    if not needle:
        return 0.0
    blocks = SequenceMatcher(None, needle, hay).get_matching_blocks()
    return sum(b.size for b in blocks) / len(needle)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", default="scripts/qa/reports/rpm-book-fill.json")
    ap.add_argument("--list", type=int, default=0)
    a = ap.parse_args()

    plan = json.loads(pathlib.Path(a.plan).read_text(encoding="utf-8"))["목록"]
    want = {p["id"] for p in plan}
    origin = {
        o["problemId"]: o
        for o in json.loads(ORIGIN.read_text(encoding="utf-8"))["목록"]
        if o.get("problemId") in want
    }
    contents = {
        r["id"]: r.get("content")
        for r in json.loads(CONTENT.read_text(encoding="utf-8"))["목록"]
    }
    # 계획 자체가 발문을 들고 있으면 그것도 쓴다(빈 자리 목록 쪽)
    for p in plan:
        if p.get("content"):
            contents.setdefault(p["id"], p["content"])

    docs: dict[str, pymupdf.Document] = {}
    #: 책마다 **쪽 어긋남**이 상수로 있다(표지 장수가 다르다 — 실측 3-2 는 +3).
    #: 한 행씩 「쪽이 딱 맞나」로 보면 그 책 전체가 근거를 잃는다. 그래서 먼저
    #: 어긋남을 **데이터에서 맞춘다**(최빈값).
    offsets: dict[str, int] = {}
    out: dict[str, dict] = {}
    tally: dict[str, int] = {}

    def bump(k: str) -> None:
        tally[k] = tally.get(k, 0) + 1

    def number_pages(o) -> list[int]:
        doc = docs[o["book"]]
        num = re.sub(r"\D", "", o.get("printedNumber") or "")
        pi = int(o["page"]) - 1
        return [
            k for d in range(-PAGE_SWEEP, PAGE_SWEEP + 1)
            if 0 <= (k := pi + d) < doc.page_count
            and any(w[4].strip() == num for w in doc[k].get_text("words"))
        ]

    # ── 1차: 책마다 쪽 어긋남을 맞춘다 ──────────────────────────────
    import collections

    votes: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for pid in sorted(want):
        o = origin.get(pid)
        if not o or not o.get("page"):
            continue
        pdf = SRC / o["book"]
        if not pdf.exists():
            continue
        if o["book"] not in docs:
            docs[o["book"]] = pymupdf.open(pdf)
            print(f"  {o['book']} 열었다", flush=True)
        for k in number_pages(o):
            votes[o["book"]][(k + 1) - int(o["page"])] += 1
    for b, c in votes.items():
        offsets[b] = c.most_common(1)[0][0]
    print("책별 쪽 어긋남:", {b[7:10]: (offsets[b], dict(votes[b].most_common(3))) for b in offsets})

    for pid in sorted(want):
        o = origin.get(pid)
        body = contents.get(pid)
        if not o or not o.get("page"):
            out[pid] = {"ok": False, "why": "출처에 쪽이 없다"}
            bump("출처에 쪽이 없다")
            continue
        pdf = SRC / o["book"]
        if not pdf.exists():
            out[pid] = {"ok": False, "why": "학생용 책이 없다"}
            bump("학생용 책이 없다")
            continue
        if o["book"] not in docs:
            docs[o["book"]] = pymupdf.open(pdf)
            print(f"  {o['book']} 열었다", flush=True)
        doc = docs[o["book"]]
        pi = int(o["page"]) - 1
        if not (0 <= pi < doc.page_count):
            out[pid] = {"ok": False, "why": "쪽 번호가 책 밖이다"}
            bump("쪽 번호가 책 밖이다")
            continue
        num = re.sub(r"\D", "", o.get("printedNumber") or "")
        # 번호가 **홀로 선 낱말**로 찍힌 쪽을 찾는다. 앞뒤로 훑는다.
        found = []
        for d in range(-PAGE_SWEEP, PAGE_SWEEP + 1):
            k = pi + d
            if not (0 <= k < doc.page_count):
                continue
            if any(w[4].strip() == num for w in doc[k].get_text("words")):
                found.append(k)
        if not found:
            out[pid] = {"ok": False, "why": "번호가 책에 안 보인다", "쪽": o["page"], "번호": num}
            bump("번호가 책에 안 보인다")
            continue
        key = ko(body)
        best = max(
            (longest_run(key, ko(doc[k].get_text("text"))), k) for k in found
        ) if key else (0.0, found[0])
        run, at = best
        # 쪽이 딱 맞으면 그것만으로 근거가 된다 — **출처(sumaek 메타)와 PDF 가
        # 서로 다른 출처인데 같은 쪽을 가리킨다.** 발문 닮음이 낮은 것은 대개
        # 우리 `content` 가 깨져 있어서다(실측: 눈으로 본 6건 전부 같은 문항이었다).
        same_page = ((at + 1) - int(o["page"])) == offsets.get(o["book"], 0)
        ok = same_page or run >= MIN_RUN or len(key) < MIN_KEY
        out[pid] = {
            "ok": ok, "책": o["book"], "쪽": o["page"], "번호가있는쪽": at + 1,
            "쪽일치": same_page, "번호": o.get("printedNumber"), "발문닮음": round(run, 3),
        }
        bump("확인됨 (쪽 일치)" if same_page else ("확인됨 (발문 닮음)" if ok else "근거 없음"))

    print(f"\n검산 {len(out)}건")
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"  {v:5d}  {k}")
    shown = 0
    for pid, v in out.items():
        if not v.get("ok") and shown < a.list:
            shown += 1
            print(f"   ✗ {pid[:8]} {v}")
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"→ {OUT}")


if __name__ == "__main__":
    main()
