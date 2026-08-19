# -*- coding: utf-8 -*-
"""자동 97건을 **다른 알고리즘**으로 다시 짝지어 대조한다.

회수기는 «그림마다 왼쪽/바로 위에 붙은 마커» 를 **탐욕적**으로 고르고, 읽기 순서로
줄 세워 마커 열과 견준다. 여기서는 그 규칙을 하나도 쓰지 않는다:

  · 단(column) 개념 없음
  · 읽기 순서 없음 · 줄 묶기 없음
  · «같은 줄이 바로 위를 이긴다» 같은 등급 없음
  · 대신 **전역 최소비용 배정** — 마커 n개를 그림 n장에 붙이는 모든 순열 중
    거리 합이 가장 작은 것을 고른다 (탐욕 대 전역, 알고리즘 부류가 다르다).

거리는 마커 기준점에서 그림 상자까지의 «잘린» 유클리드 거리다.
둘이 어긋나면 그 행을 찍는다.
"""
from __future__ import annotations
import importlib.util, itertools, json, math, pathlib, sys

import fitz

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("rec", ROOT / "scripts/qa/choice_figure_recover.py")
rec = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rec)
mapfig = rec.mapfig
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩"


def all_circled(page):
    """이 쪽의 원문자 마커 전부 — 회수기의 page_markers 를 안 쓴다(직접 훑는다)."""
    out = []
    for blk in page.get_text("rawdict").get("blocks", []):
        if blk.get("type") != 0:
            continue
        for line in blk.get("lines", []):
            for sp in line.get("spans", []):
                for ch in sp.get("chars") or []:
                    if ch["c"] in CIRCLED:
                        b = ch["bbox"]
                        out.append({"n": CIRCLED.index(ch["c"]) + 1,
                                    "x": (b[0] + b[2]) / 2, "y": (b[1] + b[3]) / 2,
                                    "bbox": b})
    return out


def box_dist(px, py, rect):
    x0, y0, x1, y1 = rect
    dx = max(x0 - px, 0, px - x1)
    dy = max(y0 - py, 0, py - y1)
    return math.hypot(dx, dy)


cands = {c["id"]: c for c in json.loads((ROOT / "scripts/qa/reports/choice-figure-candidates.json").read_text(encoding="utf-8"))}
pairs = json.loads((ROOT / "scripts/qa/reports/choice-figure-pairs.json").read_text(encoding="utf-8"))
auto = [p for p in pairs if p["verdict"] == "자동"]

agree = disagree = skipped = 0
bad = []
for p in auto:
    it = cands[p["id"]]
    pdf = pathlib.Path(it["sourceFile"].replace("\\", "/"))
    doc = fitz.open(pdf)
    figs_raw = mapfig.map_exam(pdf).get(p["figureQnum"]) or []
    theirs = {int(k): v for k, v in (p.get("pairs") or {}).items()}   # figIndex -> 보기번호
    if not theirs:
        skipped += 1
        doc.close()
        continue
    idxs = sorted(theirs)
    rects = [(figs_raw[i]["rect"], figs_raw[i]["page"]) for i in idxs]
    want = sorted(theirs.values())

    # 그림들이 있는 쪽에서 원문자 마커를 전부 모으고, 필요한 번호마다 «그림 무리에
    # 가장 가까운 것» 하나씩만 남긴다 (다른 문항의 같은 번호를 배제하되 기하 규칙은 안 쓴다)
    picked = {}
    for n in want:
        best = None
        for pno in sorted({pg for _, pg in rects}):
            for m in all_circled(doc[pno]):
                if m["n"] != n:
                    continue
                d = min(box_dist(m["x"], m["y"], r) for r, pg in rects if pg == pno) if any(pg == pno for _, pg in rects) else 1e9
                if best is None or d < best[0]:
                    best = (d, m, pno)
        if best is None:
            break
        picked[n] = best
    doc.close()
    if len(picked) != len(want):
        skipped += 1
        continue

    # 전역 최소비용 배정 (모든 순열)
    best_perm, best_cost = None, None
    for perm in itertools.permutations(want):
        cost = 0.0
        ok = True
        for (rect, pg), n in zip(rects, perm):
            d, m, mpg = picked[n]
            if mpg != pg:
                ok = False
                break
            cost += box_dist(m["x"], m["y"], rect)
        if not ok:
            continue
        if best_cost is None or cost < best_cost:
            best_cost, best_perm = cost, perm
    if best_perm is None:
        skipped += 1
        continue

    mine = dict(zip(idxs, best_perm))
    if mine == theirs:
        agree += 1
    else:
        disagree += 1
        bad.append({"id": p["id"][:8], "school": it.get("school"), "q": it.get("questionNumber"),
                    "theirs": theirs, "mine": mine})

print("전역 최소비용 배정으로 다시 짝지음")
print("  일치      %4d" % agree)
print("  어긋남    %4d" % disagree)
print("  못 잼     %4d" % skipped)
for b in bad:
    print("  🔴", b["id"], b["school"], b["q"], "회수기", b["theirs"], "→ 내 것", b["mine"])
(ROOT / "qa/adversarial/independent-match.json").write_text(
    json.dumps({"agree": agree, "disagree": disagree, "skipped": skipped, "bad": bad}, ensure_ascii=False, indent=1),
    encoding="utf-8")
