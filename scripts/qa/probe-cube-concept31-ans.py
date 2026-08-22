# -*- coding: utf-8 -*-
"""개념 3-1 정답 및 해설.pdf 가 진도북과 맞는지. 공유 DB 금지.

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

ROOT = Path(r"N:\개인\강아\교재자료\큐브수학 개념") / "큐브수학 개념" / "진도북"
JINDO = ROOT / "큐브수학 개념 3-1_진도북.pdf"
ANSWER = ROOT / "큐브 개념 3-1 정답 및 해설.pdf"
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
ANS_HINT = re.compile(r"정답\s*0*(\d{1,3})\s*쪽")
PAGE_RANGE = re.compile(r"(\d{2,3})\s*[~\-～〜]\s*(\d{2,3})\s*쪽")
PAGE_ONE = re.compile(r"(?<!\d)(\d{2,3})\s*쪽")


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


def kind_of(text: str) -> str:
    head = re.sub(r"\s+", "", text[:500])
    tail = re.sub(r"\s+", "", text[-120:])
    if "매칭북" in head or "매칭북" in tail:
        return "매칭북"
    if "진도북" in head:
        return "진도북"
    if "평가" in head[:80] or "학업성취" in head:
        return "평가"
    return "미분류"


def main() -> None:
    if not ANSWER.exists():
        raise SystemExit(f"없음: {ANSWER}")
    if not JINDO.exists():
        raise SystemExit(f"없음: {JINDO}")

    ans = pymupdf.open(ANSWER)
    jindo = pymupdf.open(JINDO)
    print(f"정답 {ans.page_count}쪽 {ANSWER.stat().st_size}B · 진도북 {jindo.page_count}쪽")

    leftovers: Counter[str] = Counter()
    rows = []
    kind = "진도북"
    for i in range(ans.page_count):
        text = decode(ans[i].get_text() or "")
        leftovers.update(leftover(text))
        k = kind_of(text)
        if k != "미분류":
            kind = k
        ranges = [(int(a), int(b)) for a, b in PAGE_RANGE.findall(text) if int(a) <= int(b) <= 200]
        rows.append(
            {
                "ansPage": i + 1,
                "kind": kind,
                "ranges": ranges,
                "head": re.sub(r"\s+", " ", text[:180]).strip(),
            }
        )

    print("정답 쪽 종류", dict(Counter(r["kind"] for r in rows)))
    print("남은 제어문자", leftovers.most_common(8))

    # 진도북 「정답 N쪽」
    hints = []
    cited: Counter[int] = Counter()
    for i in range(jindo.page_count):
        text = decode(jindo[i].get_text() or "")
        nums = sorted({int(n) for n in ANS_HINT.findall(text)})
        if nums:
            hints.append({"page": i + 1, "answerPages": nums})
            for n in nums:
                cited[n] += 1
    over = [n for n in cited if n < 1 or n > ans.page_count]
    print("진도북이 가리키는 정답 쪽", sorted(cited)[:20], "... total", len(cited))
    print("정답 PDF 쪽수를 넘는 힌트", over)
    print("진도북 힌트 있는 쪽", len(hints), "/", jindo.page_count)

    # 표본 오림: 정답 1, 진도북 배지 있는 첫 문제 쪽, 화면 20 중 몇 쪽
    live_pages = [25, 28, 49, 50, 69, 70, 90, 110, 113, 115, 140, 142, 144, 145, 150, 151, 152]
    clips = [(ANSWER, 1, "c31ans-p01.png"), (ANSWER, 2, "c31ans-p02.png")]
    # 진도북 25쪽의 정답 힌트
    for jp in [9, 25, 28, 69, 145]:
        text = decode(jindo[jp - 1].get_text() or "")
        nums = [int(n) for n in ANS_HINT.findall(text)]
        print(f"진도북 p{jp} 정답힌트 {nums} footer={re.sub(chr(92)+'s+',' ', text[-80:])[:70]}")
        if nums:
            ap = nums[0]
            clips.append((ANSWER, ap, f"c31ans-from-j{jp:03d}-A{ap:02d}.png"))
            clips.append((JINDO, jp, f"c31jindo-p{jp:03d}.png"))

    for pdf, pno, name in clips:
        doc = pymupdf.open(pdf)
        if 1 <= pno <= doc.page_count:
            pix = doc[pno - 1].get_pixmap(matrix=pymupdf.Matrix(1.15, 1.15), alpha=False)
            pix.save(str(OUT / name))
            print("png", name)
        doc.close()

    report = {
        "answer": ANSWER.name,
        "jindo": JINDO.name,
        "pages": {"answer": ans.page_count, "jindo": jindo.page_count},
        "kinds": dict(Counter(r["kind"] for r in rows)),
        "leftover": leftovers.most_common(12),
        "jindoCites": {str(k): v for k, v in sorted(cited.items())},
        "citeOverflow": over,
        "hintCount": len(hints),
        "answerIndex": rows[:8] + rows[-3:],
        "livePageHints": [
            {"jindoPage": jp, "hints": [int(n) for n in ANS_HINT.findall(decode(jindo[jp - 1].get_text() or ""))]}
            for jp in live_pages
            if jp <= jindo.page_count
        ],
    }
    dest = OUT / "concept31-ans-survey.json"
    dest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", dest)
    print("--- 정답 앞 8쪽 ---")
    for r in rows[:8]:
        rng = ",".join(f"{a}-{b}" for a, b in r["ranges"][:3]) or "-"
        print(f"A{r['ansPage']:02d} {r['kind']:6} {rng:18} {r['head'][:70]}")
    print("--- 정답 끝 4쪽 ---")
    for r in rows[-4:]:
        rng = ",".join(f"{a}-{b}" for a, b in r["ranges"][:3]) or "-"
        print(f"A{r['ansPage']:02d} {r['kind']:6} {rng:18} {r['head'][:70]}")

    ans.close()
    jindo.close()


if __name__ == "__main__":
    main()
