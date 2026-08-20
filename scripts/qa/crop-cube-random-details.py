# -*- coding: utf-8 -*-
from pathlib import Path
import pymupdf

PDF = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념\진도북"
    r"\큐브수학 개념 3-1_진도북.pdf"
)
OUT = Path("public/dev/cube-scrape")
# page is 1-based, clip in PDF points (A4 ~595x842)
CLIPS = [
    ("p29-q08", 29, pymupdf.Rect(30, 40, 300, 220)),
    ("p50-q01", 50, pymupdf.Rect(30, 80, 300, 200)),
    ("p50-q03", 50, pymupdf.Rect(30, 320, 300, 480)),
    ("p65-q09", 65, pymupdf.Rect(30, 560, 300, 760)),
    ("p65-q11", 65, pymupdf.Rect(300, 280, 560, 560)),
    ("p89-q2", 89, pymupdf.Rect(300, 40, 560, 280)),
    ("p91-q14", 91, pymupdf.Rect(300, 430, 560, 620)),
    ("p111-q11", 111, pymupdf.Rect(300, 280, 560, 460)),
    ("p116-q18", 116, pymupdf.Rect(30, 560, 300, 800)),
    ("p141-q17", 141, pymupdf.Rect(300, 430, 560, 640)),
    ("p151-q23", 151, pymupdf.Rect(300, 620, 560, 820)),
    ("p152-q24", 152, pymupdf.Rect(30, 40, 300, 180)),
]


def main() -> None:
    doc = pymupdf.open(PDF)
    mat = pymupdf.Matrix(2.2, 2.2)
    for name, pno, clip in CLIPS:
        pix = doc[pno - 1].get_pixmap(matrix=mat, clip=clip, alpha=False)
        dest = OUT / f"detail-{name}.png"
        pix.save(dest)
        print(name, dest.stat().st_size)
    doc.close()


if __name__ == "__main__":
    main()
