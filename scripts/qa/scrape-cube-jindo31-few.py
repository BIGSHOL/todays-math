# -*- coding: utf-8 -*-
"""단원마무리·평가·수학익힘에서 계산/문장제 몇 개를 긁어 지면과 대조한다."""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PDF = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념\진도북"
    r"\큐브수학 개념 3-1_진도북.pdf"
)
OUT = Path("scripts/qa/reports/cube-probe")
ITEMS = json.load(open(OUT / "jindo31-items.json", encoding="utf-8"))["items"]

# 눈으로 쓸 만해 보이는 후보. 그림·그리기·선잇기 없음.
PICK = [
    "cube-concept-3-1-p024-q03",  # 문장제 동물원
    "cube-concept-3-1-p024-q02",  # 계산 비교
    "cube-concept-3-1-p024-q04",  # 계산 빈칸 덧셈
    "cube-concept-3-1-p028-q04",  # 단원마무리 126+745
    "cube-concept-3-1-p028-q05",  # 단원마무리 781-254 (기호 확인)
    "cube-concept-3-1-p029-q14",  # 문장제 초콜릿
    "cube-concept-3-1-p030-q16",  # 문장제 수 카드
    "cube-concept-3-1-p149-q01",  # 평가 세로셈
    "cube-concept-3-1-p149-q04",  # 평가 문장제 야구장
]


def item_by_id(oid: str) -> dict | None:
    for it in ITEMS:
        if it["id"] == oid:
            return it
    return None


def minus_census(page: pymupdf.Page) -> list[str]:
    """뺄셈이 글자인지 획인지 본다."""
    d = page.get_text("rawdict")
    odd = Counter()
    for b in d.get("blocks", []):
        if b.get("type") != 0:
            continue
        for line in b.get("lines", []):
            for sp in line.get("spans", []):
                font = sp.get("font") or "?"
                chars = sp.get("chars") or []
                text = sp.get("text") or "".join(ch.get("c") or "" for ch in chars)
                for ch in text:
                    o = ord(ch)
                    if ch in "-−–—－" or o < 32 or (0x80 <= o < 0xA0):
                        odd[f"{font}\tU+{o:04X}\t{ch!r}"] += 1
    return [f"{n:4}  {k}" for k, n in odd.most_common(20)]


def main() -> None:
    doc = pymupdf.open(PDF)
    lines = []
    pages_needed = sorted({item_by_id(i)["page"] for i in PICK if item_by_id(i)})
    for pno in pages_needed:
        pix = doc[pno - 1].get_pixmap(dpi=110)
        pix.save(str(OUT / f"scrape-p{pno}.png"))
        print(f"--- p{pno} minus/control ---")
        for row in minus_census(doc[pno - 1]):
            print(" ", row)
    doc.close()

    out_items = []
    for oid in PICK:
        it = item_by_id(oid)
        if not it:
            print("MISSING", oid)
            continue
        body = it["content"]
        # 쪽 바닥글만 가볍게. 본문을 지우지는 않는다.
        body = re.sub(r"\n수학 3－1\s*$", "", body)
        body = re.sub(r"\n\d{3}\s*$", "", body)
        out_items.append({**it, "content": body.strip()})
        lines.append("=" * 60)
        lines.append(f"{it['id']}  {it['genre']}  p{it['page']}  flags={it['flags']}")
        lines.append("-" * 60)
        lines.append(body.strip())
        lines.append("")

    (OUT / "scrape-few.json").write_text(
        json.dumps(out_items, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "scrape-few.txt").write_text("\n".join(lines), encoding="utf-8")
    print("wrote scrape-few.txt", "n=", len(out_items))


if __name__ == "__main__":
    main()
