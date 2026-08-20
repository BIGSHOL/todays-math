# -*- coding: utf-8 -*-
"""진도북 3-1 그림 오림. 검수 화면용 PNG 만 만든다."""
from __future__ import annotations

import sys
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PDF = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념\진도북"
    r"\큐브수학 개념 3-1_진도북.pdf"
)
OUT = Path("public/dev/cube-scrape")
OUT.mkdir(parents=True, exist_ok=True)

# (이름, 쪽, x0,y0,x1,y1) — 쪽 폭·높이 비율. 지면 스크린샷으로 잡음.
# 24쪽 삽화는 임베드 이미지 bbox 를 쓴다. 비율로 자르면 발문 한글이 남는다.
ILLUST_CLIP_PT = (123.15, 631.36, 265.13, 716.46)

CLIPS = [
    ("p24-q01-sum", 24, 0.12, 0.20, 0.42, 0.32),
    ("p24-q03-illust", 24, None, None, None, None),  # ILLUST_CLIP_PT
    ("p24-q04-boxes", 24, 0.56, 0.12, 0.94, 0.30),
    ("p24-q05-shapes", 24, 0.54, 0.43, 0.94, 0.64),
    ("p28-q01-blocks", 28, 0.08, 0.155, 0.44, 0.40),
    ("p29-q10-tree", 29, 0.07, 0.54, 0.46, 0.76),
    ("p29-q12-cards", 29, 0.56, 0.14, 0.90, 0.30),
    ("p30-q16-cards", 30, 0.10, 0.356, 0.34, 0.412),
    ("p149-q03-box", 149, 0.14, 0.61, 0.38, 0.76),
    ("p149-q07-angle", 149, 0.58, 0.54, 0.88, 0.66),
]


def main() -> None:
    doc = pymupdf.open(PDF)
    for name, page, a, b, c, d in CLIPS:
        p = doc[page - 1]
        if a is None:
            clip = pymupdf.Rect(*ILLUST_CLIP_PT)
        else:
            r = p.rect
            clip = pymupdf.Rect(r.width * a, r.height * b, r.width * c, r.height * d)
        pix = p.get_pixmap(clip=clip, dpi=150)
        dest = OUT / f"{name}.png"
        pix.save(str(dest))
        print(f"{dest.name} {pix.width}x{pix.height}")
    doc.close()


if __name__ == "__main__":
    main()
