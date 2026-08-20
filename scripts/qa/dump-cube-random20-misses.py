# -*- coding: utf-8 -*-
"""추출 번호가 어긋난 문항을 한글 조각으로 다시 찾는다."""
from pathlib import Path

import pymupdf

PDF = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념\진도북"
    r"\큐브수학 개념 3-1_진도북.pdf"
)
OUT = Path("public/dev/cube-scrape")

NEEDLES = [
    ("p024-q06", 24, "만들 수 있"),
    ("p024-q06b", 24, "한 번씩만"),
    ("p028-q06", 28, "안에 알맞은 수를 써넣으세요"),
    ("p070-q20", 70, "봉지 한 개에 배를"),
    ("p070-q20b", 70, "똑같이 나누어 담으려"),
    ("p110-q80", 110, "더 긴 것"),
    ("p110-q80b", 110, "보다"),
    ("p112-q13", 112, "후의 시각을 시계에"),
    ("p112-q13b", 112, "지금 시각은"),
    ("p048-fig", 48, "정사각형은"),
]


def main() -> None:
    doc = pymupdf.open(PDF)
    mat = pymupdf.Matrix(2.0, 2.0)
    for name, pno, needle in NEEDLES:
        page = doc[pno - 1]
        hits = page.search_for(needle)
        print(f"{name} {needle!r} {hits}")
        if not hits:
            continue
        r = hits[0]
        # wider clip for figures sitting left of stem
        clip = pymupdf.Rect(
            max(20, r.x0 - 80),
            max(20, r.y0 - 80),
            min(page.rect.x1 - 8, r.x1 + 250),
            min(page.rect.y1 - 8, r.y0 + 250),
        )
        pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
        dest = OUT / f"detail2-{name}.png"
        pix.save(dest)
        print(" ", dest.name, clip)
    doc.close()


if __name__ == "__main__":
    main()
