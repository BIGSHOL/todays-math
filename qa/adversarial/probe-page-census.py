# -*- coding: utf-8 -*-
"""좌표 대조가 **체계적으로 실패할 만한 지면**이 자동 97건에 섞였는지 센다.

브리프가 지목한 넷:
  ㉠ 회전된 쪽        — 좌표계가 통째로 돌아간다
  ㉡ 2단 조판          — `col` 이 반쪽으로 갈라 읽기 순서를 만든다
  ㉢ 보기가 세로로 놓인 문항 — 마커가 그림 «중간 높이» 에 앉는다 (실제로 판정이 거꾸로 걸렸던 자리)
  ㉣ 그림이 겹치는 문항 — 줄 묶기(세로 겹침)가 무너진다

그리고 하나 더 — 회수기가 «자동» 을 준 문항의 그림이 **여러 쪽·여러 단**에 걸쳤는가.
검수 시트(`shot-choice-figure-pairs.py`)는 `figs[0]["page"]` 한 쪽만, 그것도
반쪽 폭만 오려 그린다. 걸친 문항이 있으면 **눈으로 본 것이 전량이 아니다.**
"""
from __future__ import annotations
import collections, importlib.util, json, pathlib, sys

import fitz

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("rec", ROOT / "scripts/qa/choice_figure_recover.py")
rec = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rec)
mapfig = rec.mapfig
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

cands = {c["id"]: c for c in json.loads((ROOT / "scripts/qa/reports/choice-figure-candidates.json").read_text(encoding="utf-8"))}
pairs = json.loads((ROOT / "scripts/qa/reports/choice-figure-pairs.json").read_text(encoding="utf-8"))
auto = [p for p in pairs if p["verdict"] == "자동"]

tally = collections.Counter()
detail = {"회전": [], "여러쪽": [], "여러단": [], "그림겹침": [], "세로보기": [], "시트가림": []}

for p in auto:
    it = cands[p["id"]]
    pdf = pathlib.Path(it["sourceFile"].replace("\\", "/"))
    doc = fitz.open(pdf)
    figs_raw = mapfig.map_exam(pdf).get(p["figureQnum"]) or []
    tag = "%s %s %s번" % (p["id"][:8], it.get("school"), it.get("questionNumber"))

    # ── DB 가 실제로 갖고 있는 그림만 본다 (배열이 그것들에 대응한다)
    import re
    keep = set()
    for url in it["figureUrls"]:
        m = re.match(r"^q\d+(?:_(\d+))?\.", url.split("/")[-1])
        if m:
            keep.add(int(m.group(1) or 0))
    figs = [f for i, f in enumerate(figs_raw) if i in keep]
    if not figs:
        continue

    pages = {f["page"] for f in figs}
    rots = {doc[pno].rotation for pno in pages}
    cols = set()
    for f in figs:
        pg = doc[f["page"]]
        mid = pg.rect.width / 2
        cols.add(0 if (f["rect"][0] + f["rect"][2]) / 2 < mid else 1)

    if rots - {0}:
        tally["회전된 쪽"] += 1
        detail["회전"].append(tag + " rot=%s" % sorted(rots))
    if len(pages) > 1:
        tally["그림이 여러 쪽에 걸침"] += 1
        detail["여러쪽"].append(tag)
    if len(cols) > 1:
        tally["그림이 두 단에 걸침"] += 1
        detail["여러단"].append(tag)

    # ㉣ 그림끼리 겹치는가 (같은 쪽, 면적 겹침 > 0)
    overlap = False
    for a in range(len(figs)):
        for b in range(a + 1, len(figs)):
            if figs[a]["page"] != figs[b]["page"]:
                continue
            ax0, ay0, ax1, ay1 = figs[a]["rect"]
            bx0, by0, bx1, by1 = figs[b]["rect"]
            if min(ax1, bx1) - max(ax0, bx0) > 1 and min(ay1, by1) - max(ay0, by0) > 1:
                overlap = True
    if overlap:
        tally["그림끼리 겹침"] += 1
        detail["그림겹침"].append(tag)

    # ㉢ 보기 그림이 세로로 긴가 — 마커가 중간 높이에 앉는 부류
    tall = [f for f in figs if (f["rect"][3] - f["rect"][1]) > 1.4 * (f["rect"][2] - f["rect"][0])]
    if tall:
        tally["세로로 긴 보기 그림"] += 1
        detail["세로보기"].append(tag + " (%d장)" % len(tall))

    # 검수 시트가 못 그리는 그림이 있는가 — 첫 쪽·그 반쪽 밖
    pno0 = figs_raw[0]["page"] if figs_raw else None
    pg = doc[pno0] if pno0 is not None else None
    hidden = 0
    if pg is not None:
        mid = pg.rect.width / 2
        xs = [f["rect"][0] for f in figs_raw if f["page"] == pno0] + [f["rect"][2] for f in figs_raw if f["page"] == pno0]
        left = 0 if (min(xs) < mid if xs else True) else mid
        for f in figs:
            if f["page"] != pno0:
                hidden += 1
                continue
            if f["rect"][0] < left - 8 or f["rect"][2] > left + mid + 8:
                hidden += 1
    if hidden:
        tally["검수 시트에 안 그려진 그림이 있는 문항"] += 1
        detail["시트가림"].append(tag + " (%d장)" % hidden)
    doc.close()

print("자동 97건 · 체계적으로 실패할 만한 지면 census\n")
for k in ["회전된 쪽", "그림이 여러 쪽에 걸침", "그림이 두 단에 걸침", "그림끼리 겹침",
          "세로로 긴 보기 그림", "검수 시트에 안 그려진 그림이 있는 문항"]:
    print("  %-34s %3d / 97" % (k, tally[k]))
print()
for k, v in detail.items():
    if v:
        print("  [%s] %s" % (k, " · ".join(v[:8]) + (" …" if len(v) > 8 else "")))
