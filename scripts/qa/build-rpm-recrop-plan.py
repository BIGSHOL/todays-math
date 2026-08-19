# -*- coding: utf-8 -*-
"""rpm-origin.json + 디스크 그림으로 RPM 재크롭 계획을 만든다.

crop-rpm-from-pdf.py 가 읽는 형식 그대로. 좌표 규칙을 여기 옮기지 않는다.
out 만 public/figures-300/rpm/ 로 둔다. public/figures 는 안 덮는다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = ROOT / "scripts" / "qa" / "reports" / "rpm-origin.json"
FIG = ROOT / "public" / "figures" / "rpm"
BOOK_DIR = Path(r"N:\개인\강아\교재자료\RPM\22")
PLAN = ROOT / "scripts" / "qa" / "reports" / "rpm-crop-plan.json"
RECROP = ROOT / "docs" / "planning" / "tracks" / "reports" / "figure-raster" / "rpm-recrop-plan.json"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    origin = json.loads(ORIGIN.read_text(encoding="utf-8"))
    have = {p.name for p in FIG.iterdir() if p.is_dir()} if FIG.is_dir() else set()
    items = []
    skip = {
        "디스크없음": 0,
        "책없음": 0,
        "좌표없음": 0,
        "pdf없음": 0,
    }
    books_missing: set[str] = set()
    for row in origin["목록"]:
        eid = row.get("externalId") or ""
        if eid not in have:
            skip["디스크없음"] += 1
            continue
        book = row.get("book") or ""
        pdf = BOOK_DIR / book
        if not book:
            skip["책없음"] += 1
            continue
        if not pdf.exists():
            skip["pdf없음"] += 1
            books_missing.add(book)
            continue
        rect = row.get("rect") or {}
        try:
            x0, y0, x1, y1 = (
                float(rect["x0"]),
                float(rect["y0"]),
                float(rect["x1"]),
                float(rect["y1"]),
            )
            page = int(rect.get("page") or row.get("page") or 0)
        except (KeyError, TypeError, ValueError):
            skip["좌표없음"] += 1
            continue
        if not (x1 > x0 and y1 > y0 and page >= 1):
            skip["좌표없음"] += 1
            continue
        items.append(
            {
                "problemId": row.get("problemId") or eid,
                "externalId": eid,
                "pdf": str(pdf),
                "page": page,
                "rect": [x0, y0, x1, y1],
                "out": str(ROOT / "public" / "figures-300" / "rpm" / eid / "0.png"),
                "pageOff": 0,
            }
        )
    payload = {
        "기준": "rpm-origin source_coords + 디스크에 있는 rpm 그림만. 2022 중학 6권.",
        "문항수": len(items),
        "건너뜀": skip,
        "없는책": sorted(books_missing),
        "원본": sorted({i["pdf"] for i in items}),
        "목록": items,
    }
    for path in (PLAN, RECROP):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(
        f"계획 {len(items)} · 디스크없음 {skip['디스크없음']} · "
        f"pdf없음 {skip['pdf없음']} {sorted(books_missing)[:6]} · "
        f"좌표없음 {skip['좌표없음']}"
    )
    print(f"→ {RECROP}")
    print(f"→ {PLAN}  (crop-rpm-from-pdf 이웃상자용 기본 경로)")


if __name__ == "__main__":
    main()
