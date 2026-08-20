# -*- coding: utf-8 -*-
"""큐브수학 숫자 글리프가 어느 코드·글꼴인지 센다. 읽기만 한다."""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PDF = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념응용\응용강화북"
    r"\큐브수학 개념응용 5-2 응용강화북.pdf"
)
MATCH = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념\매칭북"
    r"\큐브수학 개념 4-2_매칭북.pdf"
)
OUT = Path("scripts/qa/reports/cube-probe")


def span_dump(page: pymupdf.Page, limit: int = 80) -> list[dict]:
    rows = []
    d = page.get_text("rawdict")
    for b in d.get("blocks", []):
        if b.get("type") != 0:
            continue
        for line in b.get("lines", []):
            for sp in line.get("spans", []):
                font = sp.get("font") or ""
                size = round(float(sp.get("size") or 0), 2)
                text = sp.get("text") or ""
                chars = sp.get("chars") or []
                if not text and chars:
                    text = "".join(ch.get("c") or "" for ch in chars)
                if not text:
                    continue
                codes = [f"U+{ord(c):04X}" for c in text[:24]]
                rows.append(
                    {
                        "font": font,
                        "size": size,
                        "n": len(text),
                        "text": text[:40],
                        "codes": codes,
                    }
                )
                if len(rows) >= limit:
                    return rows
    return rows


def font_counter(doc: pymupdf.Document, pages: int = 3) -> list[tuple]:
    c: Counter[str] = Counter()
    odd: Counter[str] = Counter()  # 비한글·비ASCII 출력가능 제외
    for i in range(min(pages, doc.page_count)):
        d = doc[i].get_text("rawdict")
        for b in d.get("blocks", []):
            if b.get("type") != 0:
                continue
            for line in b.get("lines", []):
                for sp in line.get("spans", []):
                    font = sp.get("font") or "?"
                    chars = sp.get("chars") or []
                    text = sp.get("text") or "".join(ch.get("c") or "" for ch in chars)
                    c[font] += len(text)
                    for ch in text:
                        o = ord(ch)
                        if o < 32 or (127 <= o < 0xAC00) or o > 0xD7A3:
                            if not (0x3130 <= o <= 0x318F):  # 호환 자모
                                odd[f"{font}\tU+{o:04X}\t{ch!r}"] += 1
    return c.most_common(20), odd.most_common(40)


def main() -> None:
    doc = pymupdf.open(PDF)
    print(f"app52 pages={doc.page_count}")
    fonts, odd = font_counter(doc, 3)
    print("── fonts p1-3 ──")
    for name, n in fonts:
        print(f"  {n:6}  {name}")
    print("── odd glyphs p1-3 ──")
    for k, n in odd:
        print(f"  {n:4}  {k}")
    dump = span_dump(doc[0], 50)
    (OUT / "app52-spans.json").write_text(
        json.dumps(dump, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    doc.close()

    doc = pymupdf.open(MATCH)
    print(f"\nmatch42 pages={doc.page_count}")
    fonts, odd = font_counter(doc, 2)
    print("── fonts p1-2 ──")
    for name, n in fonts:
        print(f"  {n:6}  {name}")
    print("── odd glyphs p1-2 ──")
    for k, n in odd:
        print(f"  {n:4}  {k}")
    dump = span_dump(doc[0], 40)
    (OUT / "match42-spans.json").write_text(
        json.dumps(dump, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    # 정답면 후보
    for pno in (37, 38, 63, 64):
        if pno <= doc.page_count:
            t = doc[pno - 1].get_text() or ""
            print(f"\n--- match p{pno} chars={len(t)} ---")
            print("\n".join(t.splitlines()[:25]))
            pix = doc[pno - 1].get_pixmap(dpi=110)
            pix.save(str(OUT / f"match42-ans-p{pno}.png"))
    doc.close()


if __name__ == "__main__":
    main()
