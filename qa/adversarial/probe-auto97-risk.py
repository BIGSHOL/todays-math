# -*- coding: utf-8 -*-
"""자동 97건에 «내가 정한» 위험 지표를 붙여 의심스러운 순서로 늘어놓는다.

만든 사람이 고른 표본이 아니라 **구조적으로 틀릴 수 있는 자리**부터 본다.
"""
from __future__ import annotations
import importlib.util, json, pathlib, sys, collections

import fitz

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "qa"))
spec = importlib.util.spec_from_file_location("rec", ROOT / "scripts" / "qa" / "choice_figure_recover.py")
rec = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rec)
mapfig = rec.mapfig

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

cands = {c["id"]: c for c in json.loads((ROOT / "scripts/qa/reports/choice-figure-candidates.json").read_text(encoding="utf-8"))}
pairs = json.loads((ROOT / "scripts/qa/reports/choice-figure-pairs.json").read_text(encoding="utf-8"))
auto = [p for p in pairs if p["verdict"] == "자동"]

rows = []
for p in auto:
    it = cands[p["id"]]
    pdf = pathlib.Path(it["sourceFile"].replace("\\", "/"))
    qnum = p["figureQnum"]
    doc = fitz.open(pdf)
    figs_raw = mapfig.map_exam(pdf).get(qnum) or []
    figs = []
    for i, f in enumerate(figs_raw):
        x0, y0, x1, y1 = f["rect"]
        page = doc[f["page"]]
        mid = page.rect.width / 2
        figs.append({"i": i, "page": f["page"], "rect": f["rect"], "col": 0 if (x0 + x1) / 2 < mid else 1})

    MARK_ABOVE, MARK_BELOW = 60.0, 10.0
    marks_all = []
    for pno in sorted({f["page"] for f in figs}):
        here = [f for f in figs if f["page"] == pno]
        cols = {f["col"] for f in here}
        lo = min(f["rect"][1] for f in here) - MARK_ABOVE
        hi = max(f["rect"][3] for f in here) + MARK_BELOW
        for m in rec.page_markers(doc[pno]):
            if m["col"] not in cols or not (lo <= m["y"] <= hi):
                continue
            marks_all.append(dict(m, page=pno))
    marks = rec.choice_run(marks_all)

    figs_sorted = []
    for pno in sorted({f["page"] for f in figs}):
        figs_sorted.extend(rec.row_order([f for f in figs if f["page"] == pno]))

    # 어떤 등급으로 붙었나 (같은 줄 vs 바로 위) · 후보가 여럿이었나
    grade = collections.Counter()
    ambiguous = 0
    margins = []
    for f in figs_sorted:
        same_page = [m for m in marks if m["page"] == f["page"]]
        x0, y0, x1, y1 = f["rect"]
        cands_m = []
        for m in same_page:
            if m["col"] != f["col"]:
                continue
            if m["x"] > x0 + rec.RIGHT_TOL:
                continue
            same_row = y0 - rec.ROW_TOL <= m["y"] <= y1
            just_above = y0 - rec.ABOVE_TOL <= m["y"] < y0
            if not (same_row or just_above):
                continue
            cands_m.append(((0 if same_row else 1, abs(m["y"] - y0), x0 - m["x"]), m["n"]))
        if not cands_m:
            continue
        cands_m.sort()
        grade["같은줄" if cands_m[0][0][0] == 0 else "바로위"] += 1
        if len(cands_m) > 1:
            # 1등과 2등이 다른 번호인데 근소하면 위험
            others = [c for c in cands_m[1:] if c[1] != cands_m[0][1]]
            if others:
                ambiguous += 1
                margins.append(round(others[0][0][1] - cands_m[0][0][1], 1))

    doc.close()
    pgs = {f["page"] for f in figs}
    cols = {f["col"] for f in figs}
    kinds = collections.Counter(m["kind"] for m in marks)
    dropped = len(marks_all) - len(marks)
    # 발문 그림이 보기 그림 사이에 끼었나
    order_flags = [("S" if f["i"] in set(p.get("stem") or []) else "C") for f in figs_sorted]
    stem_interleaved = "S" in "".join(order_flags).strip("S")
    rows.append({
        "id": p["id"][:8],
        "school": it.get("school"),
        "q": it.get("questionNumber"),
        "fq": qnum,
        "arr": p["choiceFigureIndex"],
        "nfig": len(figs_raw),
        "pages": len(pgs),
        "cols": len(cols),
        "markKind": ("line" if kinds.get("line") else "") + ("circ" if kinds.get("circled") else ""),
        "droppedMarks": dropped,
        "justAbove": grade.get("바로위", 0),
        "ambiguous": ambiguous,
        "minMargin": min(margins) if margins else None,
        "stemInterleaved": stem_interleaved,
        "nStem": len(p.get("stem") or []),
    })

def risk(r):
    s = 0
    s += 40 if r["pages"] > 1 else 0
    s += 30 if r["cols"] > 1 else 0
    s += 25 if r["markKind"] == "line" else 0
    s += 20 * r["ambiguous"]
    s += 15 if r["stemInterleaved"] else 0
    s += 10 * r["justAbove"]
    s += 5 * min(r["droppedMarks"], 4)
    if r["minMargin"] is not None:
        s += max(0, int(20 - r["minMargin"]))
    return -s

rows.sort(key=risk)
out = ROOT / "qa/adversarial/auto97-risk.json"
out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
print("%-9s %-8s %3s %3s  %-16s %5s %4s %4s %-6s %4s %4s %4s %6s %s" % (
    "id", "school", "q", "fq", "array", "nfig", "pg", "col", "kind", "drop", "above", "amb", "margin", "stemIn"))
for r in rows:
    print("%-9s %-8s %3s %3s  %-16s %5d %4d %4d %-6s %4d %4d %4d %6s %s" % (
        r["id"], (r["school"] or "?")[:8], r["q"], r["fq"], str(r["arr"]), r["nfig"], r["pages"], r["cols"],
        r["markKind"], r["droppedMarks"], r["justAbove"], r["ambiguous"], r["minMargin"], r["stemInterleaved"]))
print("\n총", len(rows))
print("여러 쪽", sum(1 for r in rows if r["pages"] > 1), "· 여러 단", sum(1 for r in rows if r["cols"] > 1),
      "· 줄머리마커", sum(1 for r in rows if r["markKind"] == "line"),
      "· 애매", sum(1 for r in rows if r["ambiguous"]),
      "· 바로위사용", sum(1 for r in rows if r["justAbove"]),
      "· 발문끼임", sum(1 for r in rows if r["stemInterleaved"]))
