# -*- coding: utf-8 -*-
"""후반 학년 대표 쪽을 PNG 로 렌더. 그림 종류를 눈으로 확인하기 위함."""
from __future__ import annotations

import sys
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(r"N:\개인\강아\교재자료\큐브수학 개념")
OUT = Path("scripts/qa/reports/cube-probe/ceiling-pages")
OUT.mkdir(parents=True, exist_ok=True)

TARGETS = [
    ("개념-4-1", ROOT / "큐브수학 개념" / "진도북" / "큐브수학 개념 4-1_진도북.pdf", [38, 95, 114]),
    ("개념-5-1", ROOT / "큐브수학 개념" / "진도북" / "큐브수학 개념 5-1_진도북.pdf", [114, 133]),
    ("개념-5-2", ROOT / "큐브수학 개념" / "진도북" / "큐브수학 개념 5-2_진도북.pdf", [57, 114]),
    ("개념-6-1", ROOT / "큐브수학 개념" / "진도북" / "큐브수학 개념 6-1_진도북.pdf", [38, 76, 133]),
    ("개념-6-2", ROOT / "큐브수학 개념" / "진도북" / "큐브수학 개념 6-2_진도북.pdf", [57, 114, 133]),
    ("실력-6-2", ROOT / "큐브수학 실력" / "6-2 큐브실력" / "큐브수학 실력 6-2_진도북.pdf", [80, 120, 140]),
    ("응용강화-6-1", ROOT / "큐브수학 개념응용" / "응용강화북" / "큐브수학 개념응용 6-1 응용강화북.pdf", [15, 21]),
]


def main() -> None:
    for key, path, pages in TARGETS:
        if not path.exists():
            print("missing", key, path)
            continue
        doc = pymupdf.open(path)
        for pno in pages:
            if pno < 1 or pno > doc.page_count:
                print("skip", key, pno)
                continue
            page = doc[pno - 1]
            pix = page.get_pixmap(matrix=pymupdf.Matrix(1.4, 1.4), alpha=False)
            dest = OUT / f"{key}-p{pno:03d}.png"
            pix.save(dest)
            print("wrote", dest, pix.width, pix.height)
        doc.close()


if __name__ == "__main__":
    main()
