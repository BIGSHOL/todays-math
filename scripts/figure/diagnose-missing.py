# -*- coding: utf-8 -*-
"""그림을 못 붙인 문항이 원본 PDF 에선 어떤 모양인지 진단한다.

배경(2026-08-15): 그림 참조 문항 554건 중 84건에 그림이 없다. 원본 PDF 는 전부
로컬 캐시에 있으므로 **접근 문제가 아니라 검출 문제**다. 무엇을 놓쳤는지 본다:
  - 임베드 이미지가 있는데 크기 문턱(24pt)에 걸렸나
  - 이미지가 아니라 **벡터 드로잉**으로 그려졌나
  - 문항 번호 앵커를 못 잡아 엉뚱한 문항에 붙었나

사용: python scripts/figure/diagnose-missing.py <examId:번호> [<examId:번호> ...]
"""
import pathlib
import sys

import fitz

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1] / "qa"))
from tc_paths import testchanger_dir  # noqa: E402

sys.path.append(str(pathlib.Path(__file__).parent))
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location(
    "mapfig", pathlib.Path(__file__).parent / "map-figures.py"
)
mapfig = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mapfig)

PAGES = testchanger_dir() / "db" / "pages"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

for arg in sys.argv[1:]:
    eid, num = arg.split(":")
    num = int(num)
    pdf = PAGES / eid / "src.pdf"
    print(f"── 시험지 {eid} 문항 {num} ──")
    if not pdf.exists():
        print("   원본 PDF 없음")
        continue

    mapped = mapfig.map_exam(pdf)
    print(f"   그림이 붙은 문항: {sorted(mapped)[:14]}")
    print(f"   이 문항에 붙은 그림: {len(mapped.get(num, []))}개")

    doc = fitz.open(pdf)
    # 이 문항의 세로 범위를 앵커로 추정해 그 구간의 이미지·벡터를 센다
    for pno in range(doc.page_count):
        page = doc[pno]
        anchors, images = mapfig._page_layout(page)
        here = [a for a in anchors if a[2] == num]
        if not here:
            continue
        col, y0, _ = here[0]
        nxt = [a for a in anchors if (a[0], a[1]) > (col, y0)]
        y1 = nxt[0][1] if nxt and nxt[0][0] == col else page.rect.height
        n_img = sum(1 for c, y, _ in images if c == col and y0 <= y <= y1)
        drawings = [
            d
            for d in page.get_drawings()
            if not d["rect"].is_empty
            and y0 <= d["rect"].y0 <= y1
            and (0 if d["rect"].x0 < page.rect.width / 2 else 1) == col
        ]
        big = [d for d in drawings if d["rect"].width > 24 and d["rect"].height > 24]
        print(
            f"   {pno + 1}쪽 {col}단 y[{y0:.0f}~{y1:.0f}]"
            f"  통과한 이미지 {n_img}  벡터조각 {len(drawings)}(큰것 {len(big)})"
        )
        # 문턱에 걸린 작은 이미지도 세어 본다
        raw = page.get_text("rawdict")
        small = 0
        for blk in raw.get("blocks", []):
            if blk.get("type") == 0:
                continue
            x0, by0, x1, by1 = blk.get("bbox", (0, 0, 0, 0))
            if not (y0 <= by0 <= y1):
                continue
            if x1 - x0 < 24 or by1 - by0 < 24:
                small += 1
        if small:
            print(f"        문턱(24pt) 미만으로 버린 이미지 {small}개")
    doc.close()
