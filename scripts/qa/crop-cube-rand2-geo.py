# -*- coding: utf-8 -*-
from pathlib import Path
import pymupdf

PDF = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념\진도북"
    r"\큐브수학 개념 3-1_진도북.pdf"
)
OUT = Path("public/dev/cube-scrape")
CLIPS = [
    ("p47-q07-fig", 47, pymupdf.Rect(70, 70, 280, 250)),
    ("p48-q17-fig", 48, pymupdf.Rect(360, 430, 600, 720)),
    ("p46-q06-fig", 46, pymupdf.Rect(360, 620, 620, 820)),
    ("p139-q02-fig", 139, pymupdf.Rect(70, 390, 280, 560)),
    ("p143-pizza", 143, pymupdf.Rect(390, 170, 560, 320)),
]


def main() -> None:
    doc = pymupdf.open(PDF)
    mat = pymupdf.Matrix(2.6, 2.6)
    for name, pno, clip in CLIPS:
        pix = doc[pno - 1].get_pixmap(matrix=mat, clip=clip, alpha=False)
        dest = OUT / f"geo-{name}.png"
        pix.save(dest)
        print(name, pix.width, pix.height)
    doc.close()


if __name__ == "__main__":
    main()
