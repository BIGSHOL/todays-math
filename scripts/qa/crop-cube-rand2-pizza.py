# -*- coding: utf-8 -*-
"""p143 서술형 피자 삽화만 오린다. 창을 띄우지 않는다."""
from pathlib import Path

import pymupdf

PDF = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념\진도북"
    r"\큐브수학 개념 3-1_진도북.pdf"
)
OUT = Path("public/dev/cube-scrape/p143-q2-pizza.png")


def main() -> None:
    doc = pymupdf.open(PDF)
    page = doc[142]
    clip = pymupdf.Rect(430, 170, 518, 244)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(2.4, 2.4), clip=clip, alpha=False)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    pix.save(OUT)
    print(OUT, pix.width, pix.height)
    doc.close()


if __name__ == "__main__":
    main()
