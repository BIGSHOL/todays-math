# -*- coding: utf-8 -*-
"""실력 3-1 진도북·매칭북 ↔ 정답 흰 상자. 공유 DB 에 쓰지 않는다.

textlayer.extract() · 한컴 COM 금지.
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
RANGE = re.compile(r"(\d{2,3})\s*[~\-～〜]\s*(\d{2,3})\s*쪽")
SECTION = re.compile(
    r"(개념\s*완성하기|실력\s*다지기|단원\s*마무리|서술형|수학\s*익힘|단원\s*평가|기본\s*유형)"
)
ITEM_HEAD_2 = re.compile(r"(?m)^(\d{2})\s+")
ITEM_HEAD_1 = re.compile(r"(?m)^(\d{1,2})\s+")

# 육안 확인한 불변식. 깨지면 짝이 무너진 것.
PROBES = [
    ("진도북", 8, 1, 1, "320, 270, 590"),
    ("진도북", 9, 4, 1, "367"),
    ("진도북", 15, 19, 2, "954"),
    ("진도북", 12, 7, 2, "785+569=1354"),
    ("매칭북", 58, 1, 63, "센티미터"),
    ("매칭북", 58, 2, 63, "60"),
]


def decode(s: str) -> str:
    return "".join(GLYPH.get(ord(c), c) for c in s)


def tidy_column(s: str) -> str:
    """세로셈 숫자 나열을 a+b=c 로. 계산이 맞을 때만."""
    if "+" not in s and "−" not in s and "-" not in s:
        return s
    if not re.fullmatch(r"[\d\s+\-−]+", s.strip()):
        return s
    op = "+" if "+" in s else "-"
    left, right = re.split(r"[+\-−]", s, maxsplit=1)
    ld = re.findall(r"\d", left)
    rd = re.findall(r"\d", right)
    if len(ld) < 3 or len(rd) < 4:
        return s
    while len(ld) > 3 and ld[0] == "1":
        ld = ld[1:]
    a = int("".join(ld))
    for res_len in (len(ld) + 1, len(ld), 4, 3):
        if len(rd) <= res_len:
            continue
        c = int("".join(rd[-res_len:]))
        b = int("".join(rd[:-res_len]))
        if op == "+" and a + b == c and b > 9:
            return f"{a}+{b}={c}"
        if op == "-" and a - b == c and b > 9:
            return f"{a}-{b}={c}"
    return s


def white_boxes(page: pymupdf.Page) -> list[pymupdf.Rect]:
    found: list[pymupdf.Rect] = []
    for d in page.get_drawings():
        fill = d.get("fill")
        r = d.get("rect")
        if not fill or r is None:
            continue
        if tuple(round(x, 3) for x in fill) != (1.0, 1.0, 1.0):
            continue
        if r.width < 150 or r.height < 80:
            continue
        found.append(r)
    found.sort(key=lambda r: (round(r.y0, 0), round(r.x0, 0)))
    return found


def parse_items(text: str) -> tuple[list[dict], bool]:
    stripped = text.lstrip()
    two = bool(re.match(r"\d{2}\s", stripped))
    if two:
        # 매칭북은 `01 … 02 60` 이 한 줄. 01~32 만 문항 번호.
        heads = [
            m
            for m in re.finditer(r"(?<!\d)(\d{2})\s+", text)
            if 1 <= int(m.group(1)) <= 32
        ]
    else:
        heads = list(ITEM_HEAD_1.finditer(text))
    raw: list[dict] = []
    for i, m in enumerate(heads):
        n = int(m.group(1))
        start = m.end()
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        body = re.sub(r"\s+", " ", text[start:end].strip())
        if re.match(r"^[가-힣]{2,12}$", body) and n <= 6:
            continue
        if body in {"단 원", "단원"}:
            continue
        raw.append({"n": n, "answer": tidy_column(body)})
    glued: list[dict] = []
    for it in raw:
        m = re.search(r"\s+(\d{1,2})\s+(\S.*)$", it["answer"])
        if m and int(m.group(1)) == it["n"] + 1:
            glued.append({"n": it["n"], "answer": tidy_column(it["answer"][: m.start()].strip())})
            glued.append({"n": int(m.group(1)), "answer": tidy_column(m.group(2).strip())})
        else:
            glued.append(it)
    if not two:
        return glued, False
    # 실력다지기: 번호는 1씩 증가. 점프는 세로셈·시각이 문항으로 읽힌 것.
    seq: list[dict] = []
    expect: int | None = None
    for it in glued:
        if expect is None:
            seq.append(it)
            expect = it["n"] + 1
            continue
        if it["n"] == expect:
            seq.append(it)
            expect += 1
        elif seq:
            seq[-1]["answer"] = (seq[-1]["answer"] + " " + str(it["n"]) + " " + it["answer"]).strip()
            seq[-1]["answer"] = tidy_column(seq[-1]["answer"])
    return seq, True


def box_record(page: pymupdf.Page, rect: pymupdf.Rect, ans_page: int) -> dict | None:
    text = decode(page.get_text(clip=rect) or "")
    compact = re.sub(r"\s+", "", text)
    rng = RANGE.search(text)
    sec = SECTION.search(compact) or SECTION.search(text)
    items, two = parse_items(text)
    lo = hi = None
    if rng:
        lo, hi = int(rng.group(1)), int(rng.group(2))
    if not rng and not items:
        return None
    return {
        "answerPage": ans_page,
        "section": re.sub(r"\s+", "", sec.group(1)) if sec else None,
        "jindoFrom": lo,
        "jindoTo": hi,
        "twoDigit": two,
        "items": items,
        "preview": re.sub(r"\s+", " ", text)[:160],
    }


def collect_boxes(ans: pymupdf.Document, lo: int, hi: int) -> list[dict]:
    boxes: list[dict] = []
    for i in range(lo - 1, min(hi, ans.page_count)):
        page = ans[i]
        for rect in white_boxes(page):
            rec = box_record(page, rect, i + 1)
            if rec is None:
                continue
            if rec["jindoFrom"] is None:
                # 직전 같은 번호 체계 상자만. 예전에 끝난 실력다지기 18 다음에
                # 다른 단원 19를 붙이면 22~27쪽이 단원 3에 다시 붙는다.
                prev = next(
                    (b for b in reversed(boxes) if b["twoDigit"] == rec["twoDigit"] and b["items"]),
                    None,
                )
                if (
                    prev is None
                    or not rec["items"]
                    or rec["items"][0]["n"] != prev["items"][-1]["n"] + 1
                ):
                    continue
                rec["section"] = rec["section"] or prev["section"]
                rec["jindoFrom"] = prev["jindoFrom"]
                rec["jindoTo"] = prev["jindoTo"]
            boxes.append(rec)
    return boxes


def spread_hints(doc: pymupdf.Document, *, skip_front: int) -> dict[int, int]:
    hint: dict[int, int] = {}
    for i in range(doc.page_count):
        text = decode(doc[i].get_text() or "")
        nums = [int(n) for n in ANS_HINT.findall(text)]
        if len(nums) != 1:
            continue
        pno = i + 1
        if pno <= skip_front:
            continue
        hint[pno] = nums[0]
        if pno % 2 == 1 and pno - 1 > skip_front and (pno - 1) not in hint:
            hint[pno - 1] = nums[0]
    return hint


def badge_check(boxes: list[dict], hints: dict[int, int]) -> list[dict]:
    bad = []
    for b in boxes:
        if b["jindoFrom"] is None:
            continue
        for jp in range(b["jindoFrom"], b["jindoTo"] + 1):
            h = hints.get(jp)
            if h is None:
                continue
            if abs(h - b["answerPage"]) > 1:
                bad.append(
                    {
                        "srcPage": jp,
                        "boxAnsPage": b["answerPage"],
                        "badgeAnsPage": h,
                    }
                )
    return bad


def to_pairs(boxes: list[dict], book: str) -> list[dict]:
    out = []
    for b in boxes:
        pages = []
        if b["jindoFrom"] is not None:
            pages = list(range(b["jindoFrom"], b["jindoTo"] + 1))
        out.append(
            {
                "book": book,
                "srcPages": pages,
                "answerPage": b["answerPage"],
                "section": b["section"],
                "items": [{"n": it["n"], "answer": it["answer"]} for it in b["items"]],
            }
        )
    return out


def find_answer(pairs: list[dict], *, src_page: int, n: int, ans_page: int, book: str) -> str | None:
    key = "진도북" if "진도북" in book else "매칭북"
    for pair in pairs:
        if pair["answerPage"] != ans_page:
            continue
        if key not in pair["book"]:
            continue
        if pair["srcPages"] and src_page not in pair["srcPages"]:
            continue
        for it in pair["items"]:
            if it["n"] == n:
                return it["answer"]
    return None


def main() -> None:
    ans = pymupdf.open(ANSWER)
    jindo = pymupdf.open(JINDO)
    match = pymupdf.open(MATCH)

    jindo_boxes = collect_boxes(ans, 1, 40)
    match_boxes = collect_boxes(ans, 41, 64)
    jindo_hints = spread_hints(jindo, skip_front=5)
    match_hints = spread_hints(match, skip_front=0)
    jindo_pairs = to_pairs(jindo_boxes, "실력-3-1-진도북")
    match_pairs = to_pairs(match_boxes, "실력-3-1-매칭북")

    jindo_bad = badge_check(jindo_boxes, jindo_hints)
    match_bad = badge_check(match_boxes, match_hints)

    probes = []
    for book, src, n, ap, needle in PROBES:
        pool = jindo_pairs if book == "진도북" else match_pairs
        got = find_answer(pool, src_page=src, n=n, ans_page=ap, book=book)
        ok = bool(got and needle in got)
        probes.append({"book": book, "src": src, "n": n, "expect": needle, "got": got, "ok": ok})
        print("probe", "OK" if ok else "FAIL", src, n, got)

    empty = sum(1 for p in jindo_pairs + match_pairs for it in p["items"] if not it["answer"])
    col_tidy = sum(
        1
        for p in jindo_pairs
        for it in p["items"]
        if re.fullmatch(r"\d+[+\-]\d+=\d+", it["answer"] or "")
    )

    report = {
        "source": {
            "jindo": JINDO.name,
            "match": MATCH.name,
            "answer": ANSWER.name,
            "rule": "정답 1~40 진도북, 41~64 매칭북. 흰 상자만 압축 정답. 배지 「정답 N쪽」.",
        },
        "jindo": {
            "boxes": len(jindo_boxes),
            "items": sum(len(p["items"]) for p in jindo_pairs),
            "badgeDisagree": jindo_bad,
        },
        "match": {
            "boxes": len(match_boxes),
            "items": sum(len(p["items"]) for p in match_pairs),
            "badgeDisagree": match_bad,
        },
        "emptyAnswers": empty,
        "columnOpsTidied": col_tidy,
        "probes": probes,
        "pairs": jindo_pairs + match_pairs,
    }
    dest = OUT / "skill31-item-pairs.json"
    dest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"진도북 상자 {report['jindo']['boxes']} 문항 {report['jindo']['items']} "
        f"배지어긋 {len(jindo_bad)}"
    )
    print(
        f"매칭북 상자 {report['match']['boxes']} 문항 {report['match']['items']} "
        f"배지어긋 {len(match_bad)}"
    )
    print("세로셈 정리", col_tidy, "빈 답", empty, "wrote", dest)
    print("sections", Counter(p["section"] for p in jindo_pairs))
    fail = [p for p in probes if not p["ok"]]
    if fail:
        raise SystemExit(f"probe fail {fail}")

    ans.close()
    jindo.close()
    match.close()


if __name__ == "__main__":
    main()
