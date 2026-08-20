# -*- coding: utf-8 -*-
from pathlib import Path
import pymupdf

PDF = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념\진도북"
    r"\큐브수학 개념 3-1_진도북.pdf"
)
OUT = Path("public/dev/cube-scrape")
NEEDLES = [
    ("p028-q02", 28, "다음과 같은 방법으로"),
    ("p028-q02b", 28, "2에서 1을 뺍니다"),
    ("p069-div", 69, "몫"),
    ("p090-q05b", 90, "43"),
]


def main() -> None:
    doc = pymupdf.open(PDF)
    mat = pymupdf.Matrix(2.0, 2.0)
    for name, pno, needle in NEEDLES:
        page = doc[pno - 1]
        hits = page.search_for(needle)
        print(name, needle, hits[:4])
        if not hits:
            continue
        r = hits[0]
        clip = pymupdf.Rect(
            max(16, r.x0 - 80),
            max(16, r.y0 - 80),
            min(page.rect.x1 - 8, r.x1 + 250),
            min(page.rect.y1 - 8, r.y0 + 240),
        )
        pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
        dest = OUT / f"r3d-{name}.png"
        pix.save(dest)
        print(" ", dest.name)
    doc.close()


if __name__ == "__main__":
    main()
