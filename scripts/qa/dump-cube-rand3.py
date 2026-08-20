# -*- coding: utf-8 -*-
"""3차 무작위 20 원본 쪽·문항 오림. 창을 띄우지 않는다."""
from pathlib import Path

import pymupdf

PDF = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념\진도북"
    r"\큐브수학 개념 3-1_진도북.pdf"
)
OUT = Path("public/dev/cube-scrape")
PAGES = [25, 28, 49, 50, 69, 70, 90, 110, 113, 115, 140, 142, 144, 145, 150, 151, 152]
NEEDLES = [
    ("p025-q08", 25, "두 가지 방법으로 계산하려고"),
    ("p028-q02", 28, "700에서 500을 빼고"),
    ("p049-q1", 49, "직각삼각형이 아닌"),
    ("p050-q07", 50, "직사각형을 모두 찾아"),
    ("p069-q11", 69, "나눗셈의 몫을 곱셈식"),
    ("p069-q49", 69, "나눗셈"),
    ("p070-q19", 70, "털실"),
    ("p090-q05", 90, "안에 알맞은 수를 써넣으세요"),
    ("p110-q04", 110, "긴 것부터 차례로"),
    ("p113-q10", 113, "시계가 나타내는 시각"),
    ("p115-q10", 115, "빈칸에 알맞게 써넣으세요"),
    ("p140-q08", 140, "만큼 색"),
    ("p142-q19", 142, "두 소수의 크기를 비교"),
    ("p142-q21", 142, "큰 수부터 순서대로"),
    ("p144-q05", 144, "과자를 똑같이"),
    ("p145-q08", 145, "색칠하지 않은 부분"),
    ("p145-q09", 145, "분수나 소수"),
    ("p150-q13", 150, "나눗셈의 몫을 곱셈식"),
    ("p151-q19", 151, "딸기가 한 상자"),
    ("p152-q26", 152, "색칠한 부분은 전체의 얼마"),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(PDF)
    mat_page = pymupdf.Matrix(1.15, 1.15)
    mat_clip = pymupdf.Matrix(2.0, 2.0)
    for pno in PAGES:
        pix = doc[pno - 1].get_pixmap(matrix=mat_page, alpha=False)
        dest = OUT / f"r3-p{pno}.png"
        pix.save(dest)
        print("page", pno, dest.name)
    for name, pno, needle in NEEDLES:
        page = doc[pno - 1]
        hits = page.search_for(needle)
        print(f"{name} {needle!r} n={len(hits)} {hits[:2]}")
        if not hits:
            continue
        r = hits[0]
        clip = pymupdf.Rect(
            max(16, r.x0 - 70),
            max(16, r.y0 - 70),
            min(page.rect.x1 - 8, r.x1 + 240),
            min(page.rect.y1 - 8, r.y0 + 230),
        )
        pix = page.get_pixmap(matrix=mat_clip, clip=clip, alpha=False)
        dest = OUT / f"r3d-{name}.png"
        pix.save(dest)
        print(" ", dest.name, clip)
    doc.close()


if __name__ == "__main__":
    main()
