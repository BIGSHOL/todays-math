# -*- coding: utf-8 -*-
"""「문항 둘레에서 그림을 못 찾았다」가 **무엇 때문인지**를 센다.

`figure_rect` 가 후보를 버리는 자리마다 세어, 원인이 하나인지 여럿인지 본다.
"""
from __future__ import annotations
import collections, importlib.util, json, pathlib, sys
import fitz
sys.stdout.reconfigure(encoding="utf-8")
_s = importlib.util.spec_from_file_location("crop", "scripts/figure/crop-pdf-by-stem.py")
crop = importlib.util.module_from_spec(_s); _s.loader.exec_module(crop)
rpm = crop.croprpm

plan = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))["목록"]
fails = {f["externalId"] for f in json.loads(
    pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))["실패"]
    if f["이유"].startswith("문항 둘레에서")}

tally = collections.Counter()
rows = []
docs = {}
for it in plan:
    if it["externalId"] not in fails: continue
    if it["pdf"] not in docs: docs[it["pdf"]] = fitz.open(it["pdf"])
    doc = docs[it["pdf"]]
    stem = rpm.content_key(it["content"])
    pno, _ = crop.pick_page(doc, stem)
    if pno < 0: tally["쪽없음"] += 1; continue
    page = doc[pno]
    got = crop.stem_box(page, stem)
    if not got: tally["발문상자없음"] += 1; continue
    sb, _ = got
    box = fitz.Rect(sb.x0 - crop.AROUND_PT, sb.y0 - crop.AROUND_PT,
                    sb.x1 + crop.AROUND_PT, sb.y1 + crop.BELOW_PT) & page.rect
    page_area = page.rect.get_area()
    raw = page.get_text("rawdict")
    text_blocks = [fitz.Rect(*b["bbox"]) for b in raw.get("blocks", [])
                   if b.get("type") == 0 and not fitz.Rect(*b["bbox"]).is_empty]
    def inside_text(r):
        for t in text_blocks:
            i = r & t
            if not i.is_empty and i.get_area() >= r.get_area() * 0.8: return True
        return False
    n = collections.Counter()
    for d in page.get_drawings():
        r = fitz.Rect(d["rect"])
        n["획전체"] += 1
        if r.is_empty or r.is_infinite: n["빈획"] += 1; continue
        if r.get_area() >= page_area * 0.7: n["쪽장식"] += 1; continue
        if (r & box).is_empty: n["상자밖"] += 1; continue
        if inside_text(r): n["글자속(수식부속으로봄)"] += 1; continue
        n["살아남음"] += 1
    for b in raw.get("blocks", []):
        if b.get("type") == 0: continue
        r = fitz.Rect(*b["bbox"])
        n["이미지블록"] += 1
        inter = r & box
        if inter.is_empty or inter.width < 4.0 or inter.height < 4.0:
            n["이미지:상자밖/작음"] += 1
        else:
            n["살아남음"] += 1
    key = ("상자 안에 획이 아예 없다" if n["살아남음"] == 0 and n["글자속(수식부속으로봄)"] == 0
           else f"글자속으로 버려짐 {n['글자속(수식부속으로봄)']}" if n["살아남음"] == 0
           else "살아남았는데 군집/라벨 단계에서 버려짐")
    tally[key] += 1
    rows.append({"id": it["externalId"], "쪽": pno + 1, **n, "판정": key})

for k, v in tally.most_common(): print(f"{v:3d}  {k}")
pathlib.Path("scripts/qa/reports/_why-no-figure.json").write_text(
    json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"\n상세 {len(rows)}행 → scripts/qa/reports/_why-no-figure.json")
