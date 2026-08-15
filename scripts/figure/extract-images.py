# -*- coding: utf-8 -*-
"""완료본 PDF에서 문항 그림(임베드 이미지)을 뽑아 파일로 떨군다 — 육안 검수용.

조사 결과(2026-08-15): 완료본의 그림은 **임베드 래스터 이미지**다(표본 30편 전부).
HWP 가 PDF 로 변환하며 그림 개체를 이미지로 심는다. 벡터 드로잉은 표·밑줄 정도뿐.

즉 **다시 그릴 필요가 없다** — 원본 이미지를 오려 오면 그대로다. 토큰 0.

사용: python scripts/figure/extract-images.py <exam_id> [출력디렉터리]
"""
import pathlib
import sys

import fitz

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1] / "qa"))
from tc_paths import testchanger_dir  # noqa: E402

PAGES = testchanger_dir() / "db" / "pages"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

eid = sys.argv[1]
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else f"out/figures/{eid}")
out.mkdir(parents=True, exist_ok=True)

doc = fitz.open(PAGES / str(eid) / "src.pdf")
rows = []

for pno in range(doc.page_count):
    page = doc[pno]
    W = page.rect.width
    for im in page.get_images(full=True):
        xref = im[0]
        try:
            rects = page.get_image_rects(xref)
        except Exception:
            continue
        if not rects:
            continue
        r = rects[0]
        # 머리 배너(학원 로고)와 장식 조각 제외 — textlayer.page_figures 와 같은 기준
        if pno == 0 and r.y0 < 110 and r.width > W * 0.6:
            continue
        if r.width < 24 or r.height < 24:
            continue
        info = doc.extract_image(xref)
        data, ext = info["image"], info["ext"]
        name = f"p{pno + 1}_x{xref}.{ext}"
        (out / name).write_bytes(data)
        rows.append(
            {
                "file": name,
                "page": pno + 1,
                "px": f'{info["width"]}x{info["height"]}',
                "pt": f"{r.width:.0f}x{r.height:.0f}",
                # 인쇄 품질 지표 — 지면 1pt 당 픽셀. 150dpi ≈ 2.1
                "dpi": round(info["width"] / max(r.width, 1) * 72),
                "kb": round(len(data) / 1024, 1),
                "y": round(r.y0),
            }
        )

doc.close()
print("시험지 %s · 그림 %d개 → %s" % (eid, len(rows), out))
print("파일              쪽   픽셀        지면(pt)   추정DPI   크기")
for r in rows[:20]:
    print(
        "%-16s %3d  %-11s %-10s %6d %7.1fKB"
        % (r["file"], r["page"], r["px"], r["pt"], r["dpi"], r["kb"])
    )
