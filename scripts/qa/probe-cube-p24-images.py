# -*- coding: utf-8 -*-
"""24쪽 삽화 bbox 를 이미지 객체에서 직접 읽는다."""
import sys
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PDF = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념\진도북"
    r"\큐브수학 개념 3-1_진도북.pdf"
)


def main() -> None:
    doc = pymupdf.open(PDF)
    page = doc[23]
    print("rect", tuple(page.rect))
    for i, img in enumerate(page.get_images(full=True)):
        xref = img[0]
        rects = page.get_image_rects(xref)
        print(f"img{i} xref={xref} rects={[(r.x0, r.y0, r.x1, r.y1) for r in rects]}")
    doc.close()


if __name__ == "__main__":
    main()
