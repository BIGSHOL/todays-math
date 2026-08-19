# -*- coding: utf-8 -*-
"""옛 그림과 300dpi 를 한 장에 나란히 둔다. 눈으로 보기 위한 것."""
from __future__ import annotations

import math
import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[2]
OLD = ROOT / "public" / "figures"
NEW = ROOT / "public" / "figures-300"
OUT = ROOT / "docs" / "planning" / "tracks" / "reports" / "figure-raster"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# 비용 10편에서 가로가 늘어난 것 + 네이티브 스캔 + 깨끗 + RPM
PAIRS = [
    ("728/q09.png", "728/q09.png", "폴백 보기상자"),
    ("728/q04.jpeg", "728/q04.png", "네이티브 좌표평면"),
    ("3614/q02.png", "3614/q02.png", "폴백 소인수나무"),
    ("3852/q01.jpeg", "3852/q01.png", "네이티브 깨끗한 삼각형"),
    ("2180/q01.jpeg", "2180/q01.png", "네이티브 스캔 전개도"),
    ("4942/q14.png", "4942/q14.png", "폴백 빈칸"),
    (
        "rpm/019fd1d7-7b6f-7534-a077-df801389ab71/0.png",
        "rpm/019fd1d7-7b6f-7534-a077-df801389ab71/0.png",
        "RPM 각 200→300",
    ),
    (
        "rpm/019fd1d7-6586-72a9-97f0-925640e07476/0.png",
        "",
        "RPM 재크롭 실패 — 옛만",
    ),
]


def place(page, path: Path, rect: fitz.Rect, label: str) -> None:
    page.insert_text((rect.x0, rect.y0 - 3), label, fontsize=8, color=(0.3, 0.3, 0.3))
    if not path or not path.exists():
        page.insert_text((rect.x0 + 6, rect.y0 + 20), "없음", fontsize=10)
        return
    img = fitz.open(str(path))
    r = img[0].rect
    sc = min(rect.width / max(r.width, 1), rect.height / max(r.height, 1))
    w, h = r.width * sc, r.height * sc
    box = fitz.Rect(rect.x0, rect.y0, rect.x0 + w, rect.y0 + h)
    page.insert_image(box, filename=str(path))
    page.draw_rect(box, color=(0.8, 0.8, 0.8), width=0.4)
    img.close()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    CW, CH, HDR = 280, 200, 28
    rows = len(PAIRS)
    doc = fitz.open()
    page = doc.new_page(width=CW * 2 + 24, height=(CH + HDR) * rows + 20)
    page.draw_rect(page.rect, color=None, fill=(1, 1, 1))
    page.insert_text((12, 12), "왼: 지금 public/figures   오른: 300dpi public/figures-300", fontsize=10)
    for i, (a, b, note) in enumerate(PAIRS):
        y = 22 + i * (CH + HDR)
        page.insert_text((12, y + 10), note, fontsize=9, color=(0.6, 0, 0))
        place(page, OLD / a, fitz.Rect(12, y + 16, 12 + CW - 8, y + 16 + CH - 8), "지금")
        if b:
            place(
                page,
                NEW / b,
                fitz.Rect(12 + CW, y + 16, 12 + CW + CW - 8, y + 16 + CH - 8),
                "300",
            )
    dest = OUT / "sheet-recrop-pairs.png"
    page.get_pixmap(dpi=120).save(str(dest))
    doc.close()
    print(f"→ {dest}")


if __name__ == "__main__":
    main()
