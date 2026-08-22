# -*- coding: utf-8 -*-
"""실력 3-1 진도북 쪽이 가리키는 정답 쪽을 모은다. 공유 DB 에 쓰지 않는다.

열쇠는 진도북 지면의 「정답 NN쪽」이다. 정답집 머리의 008~009쪽 과 교차한다.
textlayer.extract() 금지. 한컴 COM 금지.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(r"N:\개인\강아\교재자료\큐브수학 개념") / "큐브수학 실력" / "3-1 큐브실력"
JINDO = ROOT / "큐브수학 실력 3-1_진도북.pdf"
ANSWER = ROOT / "큐브수학실력3-1정답(01~64).pdf"
MATCH = ROOT / "큐브수학 실력 3-1_매칭북.pdf"
OUT = Path("scripts/qa/reports/cube-probe")

EHSANG_DIGIT = {i: str(i - 0x11) for i in range(0x11, 0x1B)}
GLYPH = {
    **EHSANG_DIGIT,
    0x1E: "=",
    0x1F: "<",
    0x1D: ">",
    0x0E: "-",
    0x0C: "+",
    0x0040: "×",
    0x0096: "÷",
}

ANS_HINT = re.compile(r"정답\s*0*(\d{1,2})\s*쪽")
PAGE_RANGE = re.compile(r"(\d{2,3})\s*[~\-～〜]\s*(\d{2,3})\s*쪽")


def decode(s: str) -> str:
    return "".join(GLYPH.get(ord(c), c) for c in s)


def hints_per_page(doc: pymupdf.Document) -> list[dict]:
    rows = []
    for i in range(doc.page_count):
        text = decode(doc[i].get_text() or "")
        nums = sorted({int(n) for n in ANS_HINT.findall(text)})
        rows.append({"page": i + 1, "answerPages": nums, "footer": _footer(text)})
    return rows


def _footer(text: str) -> str:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return " ".join(lines[-2:])[:80] if lines else ""


def propagate_kind(pages: list[dict]) -> None:
    kind = "진도북"
    for p in pages:
        head = p["head"]
        if "매칭북" in head and p["ansPage"] >= 40:
            kind = "매칭북"
        elif "진도북" in head and "정답" in head:
            kind = "진도북"
        p["kind"] = kind


def main() -> None:
    jindo = pymupdf.open(JINDO)
    ans = pymupdf.open(ANSWER)
    match = pymupdf.open(MATCH)

    jindo_hints = hints_per_page(jindo)
    match_hints = hints_per_page(match)

    cited_j = Counter()
    for row in jindo_hints:
        for n in row["answerPages"]:
            cited_j[n] += 1
    cited_m = Counter()
    for row in match_hints:
        for n in row["answerPages"]:
            cited_m[n] += 1

    print("진도북이 가리키는 정답 쪽", sorted(cited_j))
    print("  쪽당 진도북 페이지 수", dict(cited_j))
    print("매칭북이 가리키는 정답 쪽", sorted(cited_m))

    missing_j = [n for n in cited_j if n < 1 or n > ans.page_count]
    print("진도북 힌트가 정답 쪽수를 넘는 것", missing_j)

    # 정답집 머리 범위
    ans_rows = []
    kind = "진도북"
    for i in range(ans.page_count):
        text = decode(ans[i].get_text() or "")
        head = re.sub(r"\s+", " ", text[:220])
        if i >= 39 and "매칭북" in text[:400]:
            kind = "매칭북"
        elif "진도북" in head and "정답" in head:
            kind = "진도북"
        ranges = [(int(a), int(b)) for a, b in PAGE_RANGE.findall(text) if int(a) <= int(b) <= 200]
        ans_rows.append({"ansPage": i + 1, "kind": kind, "ranges": ranges, "head": head[:120]})

    # 교차: 진도북 p → 정답 쪽 힌트 vs 정답집이 그 진도북 쪽을 범위에 넣었나
    overlap = []
    for row in jindo_hints:
        if not row["answerPages"]:
            continue
        jp = row["page"]
        for ap in row["answerPages"]:
            covers = [
                r["ansPage"]
                for r in ans_rows
                if r["kind"] == "진도북"
                and any(lo <= jp <= hi for lo, hi in r["ranges"])
            ]
            overlap.append(
                {
                    "jindoPage": jp,
                    "hintAnsPage": ap,
                    "rangeCovers": covers,
                    "hintInRange": ap in covers or not covers,
                }
            )

    disagree = [x for x in overlap if x["rangeCovers"] and x["hintAnsPage"] not in x["rangeCovers"]]
    print(f"진도북 힌트 있는 쪽 {len(overlap)} · 정답 범위와 어긋남 {len(disagree)}")
    for x in disagree[:12]:
        print("  어긋남", x)

    # 표본 3쌍: 힌트가 있는 진도북 쪽 + 그 정답 쪽
    samples = []
    seen_ans: set[int] = set()
    for row in jindo_hints:
        if len(row["answerPages"]) != 1:
            continue
        ap = row["answerPages"][0]
        if ap in seen_ans:
            continue
        seen_ans.add(ap)
        samples.append((row["page"], ap))
        if len(samples) >= 4:
            break
    # 끝쪽 하나
    for row in reversed(jindo_hints):
        if row["answerPages"] == [39] or (row["answerPages"] and row["page"] >= 150):
            samples.append((row["page"], row["answerPages"][0]))
            break

    clips = []
    for jp, ap in samples:
        for src, pno, tag in (
            (jindo, jp, f"pair2-jindo-p{jp:03d}.png"),
            (ans, ap, f"pair2-ans-p{ap:02d}.png"),
        ):
            if 1 <= pno <= src.page_count:
                pix = src[pno - 1].get_pixmap(matrix=pymupdf.Matrix(1.15, 1.15), alpha=False)
                dest = OUT / tag
                pix.save(str(dest))
                clips.append(dest.name)
    print("clips", clips)

    report = {
        "jindoPages": jindo.page_count,
        "answerPages": ans.page_count,
        "matchPages": match.page_count,
        "jindoCitesAnswerPages": dict(cited_j),
        "matchCitesAnswerPages": dict(cited_m),
        "jindoHintRows": [r for r in jindo_hints if r["answerPages"]],
        "matchHintRows": [r for r in match_hints if r["answerPages"]],
        "disagreeHintVsRange": disagree,
        "answerIndex": ans_rows,
        "rule": "진도북 「정답 N쪽」 = 정답 PDF 쪽 N. 정답 1~40 진도북, 41~64 매칭북.",
    }
    dest = OUT / "skill31-page-pairs.json"
    dest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", dest, "jindo hint pages", len(report["jindoHintRows"]))

    jindo.close()
    ans.close()
    match.close()


if __name__ == "__main__":
    main()
