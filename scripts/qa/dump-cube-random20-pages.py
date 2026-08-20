# -*- coding: utf-8 -*-
"""무작위 20(seed=20260822) 원본 쪽·문항 오림. 창을 띄우지 않는다."""
from pathlib import Path

import pymupdf

PDF = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념\진도북"
    r"\큐브수학 개념 3-1_진도북.pdf"
)
OUT = Path("public/dev/cube-scrape")

PAGES = [
    24, 25, 28, 46, 47, 48, 64, 66, 70,
    110, 111, 112, 115, 116, 139, 140, 142, 143, 146, 150,
]

NEEDLES = [
    ("p024-q06", 24, "수 카드 3장을 한 번씩만"),
    ("p025-q11", 25, "도쿄타워"),
    ("p028-q06", 28, "+272"),
    ("p046-q06", 46, "직각을 그리기 위해"),
    ("p047-q07", 47, "점 ㅂ을 각의"),
    ("p048-q17", 48, "크고 작은 정사각형"),
    ("p064-q06", 64, "나눗셈식에 알맞은 문장"),
    ("p066-q37", 66, "두발자전거"),
    ("p070-q20", 70, "배 40개를 봉지"),
    ("p110-q80", 110, "8 DN보다"),
    ("p111-q07", 111, "필통에 들어 있는 자"),
    ("p112-q13", 112, "8시 16분 24초"),
    ("p115-q09", 115, "단위 사이의 관계"),
    ("p116-q17", 116, "축구 경기"),
    ("p139-q02", 139, "선을 더 그려서"),
    ("p140-q11", 140, "두 분수의 크기를 비교"),
    ("p142-q23", 142, "분수 맞히기"),
    ("p143-q2", 143, "남은 부분을 분수로"),
    ("p146-q18", 146, "육 점 오"),
    ("p150-q12", 150, "곱셈식을 나눗셈식"),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(PDF)
    mat_page = pymupdf.Matrix(1.2, 1.2)
    mat_clip = pymupdf.Matrix(2.0, 2.0)
    page_rect = doc[0].rect
    print("page", page_rect)

    for pno in PAGES:
        pix = doc[pno - 1].get_pixmap(matrix=mat_page, alpha=False)
        dest = OUT / f"rand2-p{pno}.png"
        pix.save(dest)
        print("page", pno, dest.name, pix.width, pix.height)

    for name, pno, needle in NEEDLES:
        page = doc[pno - 1]
        hits = page.search_for(needle)
        print(f"{name} needle={needle!r} hits={len(hits)} {hits[:3]}")
        if not hits:
            alt = needle.replace("DN", "cm")
            hits = page.search_for(alt)
            print("  alt", alt, hits[:3])
        if not hits:
            continue
        r = hits[0]
        clip = pymupdf.Rect(
            max(20, r.x0 - 40),
            max(20, r.y0 - 50),
            min(page.rect.x1 - 10, r.x1 + 220),
            min(page.rect.y1 - 10, r.y0 + 220),
        )
        pix = page.get_pixmap(matrix=mat_clip, clip=clip, alpha=False)
        dest = OUT / f"detail2-{name}.png"
        pix.save(dest)
        print("  clip", clip, dest.name, pix.width, pix.height)

    doc.close()


if __name__ == "__main__":
    main()
