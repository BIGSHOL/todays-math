# -*- coding: utf-8 -*-
"""실력 3-1 진도북 ↔ 정답 PDF 쪽 짝. 공유 DB 에 쓰지 않는다.

시험지 textlayer.extract() 는 쓰지 않는다 — 이 정답집은 64쪽이 문항 6개로 잘린다.
한컴 COM 도 쓰지 않는다 (정오표.hwp 는 열지 않음).
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
OUT.mkdir(parents=True, exist_ok=True)

# 08 §5.5 글리프. 한 칸 밀면 읽히는 오답.
EHSANG_DIGIT = {i: str(i - 0x11) for i in range(0x11, 0x1B)}
GLYPH = {
    **EHSANG_DIGIT,
    0x1E: "=",
    0x1F: "<",
    0x1D: ">",
    0x0E: "-",
    0x0C: "+",
    0x0040: "×",  # leftover @
    0x0096: "÷",
}


def decode(s: str) -> str:
    return "".join(GLYPH.get(ord(c), c) for c in s)


def leftover(s: str) -> Counter[str]:
    c: Counter[str] = Counter()
    for ch in s:
        o = ord(ch)
        if o < 32 and ch not in "\n\t\r":
            c[f"U+{o:04X}"] += 1
        elif 127 <= o < 160:
            c[f"U+{o:04X}"] += 1
    return c


PAGE_RANGE = re.compile(r"(\d{2,3})\s*[~\-～〜]\s*(\d{2,3})\s*쪽")
PAGE_ONE = re.compile(r"(?<!\d)(\d{2,3})\s*쪽")
UNIT = re.compile(r"(\d+)\.\s*([가-힣]{2,20})")


def classify_answer_page(text: str) -> str:
    head = re.sub(r"\s+", "", text[:400])
    if "매칭북" in head or "단원평가가기" in re.sub(r"\s+", "", text[-80:]):
        return "매칭북"
    if "진도북" in head and "정답및풀이" in head:
        return "진도북"
    if "매칭북" in text:
        return "매칭북"
    if "진도북" in text[:200]:
        return "진도북"
    return "미분류"


def extract_ranges(text: str) -> list[tuple[int, int]]:
    found: list[tuple[int, int]] = []
    for a, b in PAGE_RANGE.findall(text):
        lo, hi = int(a), int(b)
        if 1 <= lo <= hi <= 200:
            found.append((lo, hi))
    if found:
        return found
    for m in PAGE_ONE.findall(text):
        n = int(m)
        if 1 <= n <= 200:
            found.append((n, n))
    return found


def jindo_genre(text: str, page: int) -> str:
    compact = re.sub(r"\s+", "", text)
    if page <= 2:
        return "표지"
    if "차례" in text[:80]:
        return "목차"
    if "개념완성하기" in compact[:200] or "STEP" in text[:80] and "개념" in compact[:200]:
        return "개념완성"
    if "실력다지기" in compact[:200]:
        return "실력다지기"
    if "단원마무리" in compact[:120]:
        return "단원마무리"
    if "서술형" in compact[:80]:
        return "서술형"
    if "수학익힘" in compact[:80]:
        return "수학익힘"
    if "평가" in compact[:60] and page > 100:
        return "평가"
    return "기타"


def main() -> None:
    for p in (JINDO, ANSWER, MATCH):
        if not p.exists():
            raise SystemExit(f"없음: {p}")

    ans = pymupdf.open(ANSWER)
    jindo = pymupdf.open(JINDO)
    match = pymupdf.open(MATCH)
    print(f"정답 {ans.page_count}쪽 · 진도북 {jindo.page_count}쪽 · 매칭북 {match.page_count}쪽")

    pages = []
    leftovers: Counter[str] = Counter()
    for i in range(ans.page_count):
        raw = ans[i].get_text() or ""
        text = decode(raw)
        leftovers.update(leftover(text))
        kind = classify_answer_page(text)
        ranges = extract_ranges(text)
        units = [m.group(0) for m in UNIT.finditer(text[:300])][:4]
        pages.append(
            {
                "ansPage": i + 1,
                "kind": kind,
                "ranges": ranges,
                "units": units,
                "head": re.sub(r"\s+", " ", text[:180]).strip(),
            }
        )

    by_kind = Counter(p["kind"] for p in pages)
    print("정답 쪽 종류", dict(by_kind))
    print("남은 제어문자", leftovers.most_common(12))

    # 진도북 범위가 정답에 나온 쪽만 장르를 찍는다.
    covered: set[int] = set()
    for p in pages:
        if p["kind"] != "진도북":
            continue
        for lo, hi in p["ranges"]:
            covered.update(range(lo, hi + 1))
    print(f"정답이 가리키는 진도북 쪽 {min(covered) if covered else '-'}~{max(covered) if covered else '-'} ({len(covered)}쪽)")

    jindo_sample = []
    for pno in sorted(covered)[:8] + sorted(covered)[-4:]:
        if pno < 1 or pno > jindo.page_count:
            continue
        t = decode(jindo[pno - 1].get_text() or "")
        jindo_sample.append(
            {
                "page": pno,
                "genre": jindo_genre(t, pno),
                "head": re.sub(r"\s+", " ", t[:160]).strip(),
            }
        )

    # 정답 1쪽(008~009) ↔ 진도북 8·9 오림. 창을 띄우지 않는다.
    pair_clips = [
        (ANSWER, 1, "pair-ans-p01.png"),
        (JINDO, 8, "pair-jindo-p08.png"),
        (JINDO, 9, "pair-jindo-p09.png"),
        (ANSWER, 63, "pair-ans-p63.png"),
        (MATCH, 58, "pair-match-p58.png"),
    ]
    for pdf, pno, name in pair_clips:
        doc = pymupdf.open(pdf)
        if 1 <= pno <= doc.page_count:
            pix = doc[pno - 1].get_pixmap(matrix=pymupdf.Matrix(1.2, 1.2), alpha=False)
            dest = OUT / name
            pix.save(str(dest))
            print("png", dest.name, pdf.name, pno)
        doc.close()

    report = {
        "files": {
            "jindo": JINDO.name,
            "answer": ANSWER.name,
            "match": MATCH.name,
            "pages": {
                "jindo": jindo.page_count,
                "answer": ans.page_count,
                "match": match.page_count,
            },
        },
        "answerKinds": dict(by_kind),
        "leftoverControls": leftovers.most_common(20),
        "jindoPagesCited": sorted(covered),
        "jindoSample": jindo_sample,
        "answerPages": pages,
    }
    dest = OUT / "skill31-pair-survey.json"
    dest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", dest)

    print("--- 정답 쪽 요약 ---")
    for p in pages:
        rng = ",".join(f"{a}-{b}" if a != b else str(a) for a, b in p["ranges"][:3]) or "-"
        print(f"A{p['ansPage']:02d} {p['kind']:6} 쪽={rng:16} {p['units'][:2]}")

    ans.close()
    jindo.close()
    match.close()


if __name__ == "__main__":
    main()
