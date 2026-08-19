# -*- coding: utf-8 -*-
"""오려낸 그림들을 **한 장에 모아** 눈으로 훑는다. 라벨을 같이 찍는다."""
from __future__ import annotations
import json, math, pathlib, sys
import fitz
sys.stdout.reconfigure(encoding="utf-8")

items = []           # (label, path)
src = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
key = sys.argv[2] if len(sys.argv) > 2 else "계획"
for p in src[key]:
    for u in p["urls"]:
        items.append((p.get("externalId") or f"{p['e']}-{p['q']}", pathlib.Path("public" + u)))
per = int(sys.argv[3]) if len(sys.argv) > 3 else 6
outdir = pathlib.Path(sys.argv[4]) if len(sys.argv) > 4 else pathlib.Path(".probe/sheets")
outdir.mkdir(parents=True, exist_ok=True)
CW, CH, HDR = 460, 330, 18
for si in range(0, len(items), per):
    chunk = items[si:si + per]
    cols = 2
    rows = math.ceil(len(chunk) / cols)
    doc = fitz.open()
    page = doc.new_page(width=CW * cols, height=(CH + HDR) * rows)
    page.draw_rect(page.rect, color=None, fill=(1, 1, 1))
    for i, (label, f) in enumerate(chunk):
        cx, cy = (i % cols) * CW, (i // cols) * (CH + HDR)
        page.insert_text((cx + 6, cy + 13), label, fontsize=11, color=(0.7, 0, 0))
        if not f.exists():
            page.insert_text((cx + 6, cy + 40), "파일 없음", fontsize=10); continue
        img = fitz.open(str(f)); r = img[0].rect
        sc = min((CW - 12) / max(r.width, 1), (CH - 12) / max(r.height, 1), 3.0)
        w, h = r.width * sc, r.height * sc
        page.insert_image(fitz.Rect(cx + 6, cy + HDR, cx + 6 + w, cy + HDR + h), filename=str(f))
        page.draw_rect(fitz.Rect(cx + 4, cy + HDR - 2, cx + 8 + w, cy + HDR + 2 + h),
                       color=(0.8, 0.8, 0.8), width=0.5)
    out = outdir / f"sheet{si // per + 1}.png"
    page.get_pixmap(dpi=100).save(str(out))
    print(f"→ {out}  ({len(chunk)}장)")
