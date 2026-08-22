# -*- coding: utf-8 -*-
"""지난번 천장 표본에 없던 그림 종류 — 합동·그래프·원·분수격자."""
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
    ("개념-3-2", ROOT / "큐브수학 개념" / "진도북" / "큐브수학 개념 3-2_진도북.pdf", [76, 133]),
    ("개념-4-2", ROOT / "큐브수학 개념" / "진도북" / "큐브수학 개념 4-2_진도북.pdf", [38, 114]),
    ("개념-5-2", ROOT / "큐브수학 개념" / "진도북" / "큐브수학 개념 5-2_진도북.pdf", [38, 64, 68]),
    ("개념-6-1", ROOT / "큐브수학 개념" / "진도북" / "큐브수학 개념 6-1_진도북.pdf", [110, 132]),
    ("개념-3-1", ROOT / "큐브수학 개념" / "진도북" / "큐브수학 개념 3-1_진도북.pdf", [19, 113]),
]


def main() -> None:
    for key, path, pages in TARGETS:
        if not path.exists():
            print("missing", key)
            continue
        doc = pymupdf.open(path)
        for pno in pages:
            if pno < 1 or pno > doc.page_count:
                print("skip", key, pno)
                continue
            pix = doc[pno - 1].get_pixmap(matrix=pymupdf.Matrix(1.35, 1.35), alpha=False)
            dest = OUT / f"{key}-p{pno:03d}.png"
            pix.save(dest)
            print("wrote", dest.name, pix.width, pix.height)
        doc.close()


if __name__ == "__main__":
    main()
