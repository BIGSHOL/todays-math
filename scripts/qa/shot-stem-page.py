# -*- coding: utf-8 -*-
"""오려내기가 「문항 둘레에서 그림을 못 찾았다」고 한 행을 **눈으로 보기 위해** 찍는다.

발문이 있는 자리를 찾아 그 둘레를 통째로 렌더한다. 그 그림에 도형이 보이면
«검출이 안 된다», 안 보이면 «원본에 없다» 다. 이 둘은 다음 수가 다르다.
"""
from __future__ import annotations
import importlib.util, json, pathlib, sys
import fitz

sys.stdout.reconfigure(encoding="utf-8")
_s = importlib.util.spec_from_file_location("crop", "scripts/figure/crop-pdf-by-stem.py")
crop = importlib.util.module_from_spec(_s); _s.loader.exec_module(crop)

OUT = pathlib.Path(".probe/stem-pages"); OUT.mkdir(parents=True, exist_ok=True)
plan = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))["목록"]
want = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
docs: dict[str, fitz.Document] = {}
for it in plan:
    if want and it["externalId"] not in want:
        continue
    if it["pdf"] not in docs:
        docs[it["pdf"]] = fitz.open(it["pdf"])
    doc = docs[it["pdf"]]
    key = crop.content_key(it["content"])
    best = (0, None, None)
    for pno in range(doc.page_count):
        page = doc[pno]
        words = page.get_text("words")
        ptext = "".join(crop.content_key(w[4]) for w in words)
        run = crop.longest_common_run(key, ptext)
        if run > best[0]:
            best = (run, pno, words)
    run, pno, words = best
    if pno is None:
        print(f"{it['externalId']}: 쪽을 못 찾음"); continue
    # 발문 조각들이 앉은 세로 구간을 잡고 넉넉히 위아래로 넓혀 렌더한다.
    page = doc[pno]
    hits = [w for w in words if len(crop.content_key(w[4])) >= 2
            and crop.content_key(w[4]) in key]
    if hits:
        y0 = min(w[1] for w in hits); y1 = max(w[3] for w in hits)
    else:
        y0, y1 = 0, page.rect.height
    clip = fitz.Rect(0, max(0, y0 - 40), page.rect.width, min(page.rect.height, y1 + 340))
    pix = page.get_pixmap(clip=clip, dpi=110)
    f = OUT / f"{it['externalId']}_p{pno+1}.png"
    f.write_bytes(pix.tobytes("png"))
    print(f"{it['externalId']}: 쪽 {pno+1} 겹침 {run}자 → {f.name}")
