# -*- coding: utf-8 -*-
"""「문항 안에서 그림을 못 찾았다」로 남은 행을 **왜 못 찾았나**로 가른다.

    python scripts/figure/probe-rpm-nofig.py

세는 쪽과 고치는 쪽이 갈라지지 않게 `crop-rpm-from-pdf.figure_rect` 를 **그대로**
부르고 `trace` 만 받는다(진단기를 따로 쓰면 갈라진다 — 이 파일이 이미 한 번 값을 치렀다).
"""
from __future__ import annotations
import collections, importlib.util, io, json, pathlib, sys
import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

_HERE = pathlib.Path(__file__).parent
_spec = importlib.util.spec_from_file_location("croprpm", _HERE / "crop-rpm-from-pdf.py")
crop = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(crop)

J = lambda p: json.load(io.open(p, encoding="utf-8"))
mf = J("scripts/qa/reports/missing-figures.json")
missing = {r["externalId"] for r in mf["목록"]
           if r["source"] == "transformed" and r["externalId"]}
gp = J("scripts/qa/reports/rpm-group-plan-report.json")
rest = missing - {d["externalId"] for d in gp["상세"]}

content = J("scripts/qa/reports/rpm-crop-content.json")
RESULTS = (("scripts/qa/reports/rpm-crop-result-gated.json",
            "scripts/qa/reports/rpm-crop-plan-gated.json"),
           ("scripts/qa/reports/rpm-crop-result.json",
            "scripts/qa/reports/rpm-crop-plan.json"),
           ("scripts/qa/reports/rpm-crop-result-group.json",
            "scripts/qa/reports/rpm-group-crop-plan.json"))

rows, why = {}, {}
for res_p, plan_p in RESULTS:
    res, plan = J(res_p), {i["externalId"]: i for i in J(plan_p)["목록"]}
    for f in res.get("실패", []):
        e = f["externalId"]
        if e in rest and e not in rows and e in plan:
            rows[e] = plan[e]; why[e] = f["이유"]

print(f"잔여 {len(rest)} · 계획을 찾은 것 {len(rows)}")
docs, out = {}, []
for e, it in rows.items():
    pdf = it["pdf"]
    if pdf not in docs: docs[pdf] = pymupdf.open(pdf)
    page = docs[pdf][int(it["page"]) - 1]
    box = pymupdf.Rect(*it["rect"]) & page.rect
    key = crop.content_key(content.get(it["problemId"], ""))
    avoid = [pymupdf.Rect(*a) for a in it.get("avoid", [])]
    rec = {"externalId": e, "앞선사유": why[e],
           "책": pathlib.Path(pdf).name, "쪽": int(it["page"]),
           "상자": [round(v, 1) for v in box]}
    for tag, kw in (("현행", {}),
                    ("선살림", {"thin_pt": 0.5}),
                    ("글자속끔", {"drop_inside_text": False}),
                    ("문턱낮춤", {"min_size": (8.0, 8.0)}),
                    ("셋다", {"thin_pt": 0.5, "drop_inside_text": False,
                              "min_size": (8.0, 8.0)})):
        tr: dict = {}
        fig = crop.figure_rect(page, box, key, avoid=avoid, trace=tr, **kw)
        rec[tag] = {"찾음": fig is not None,
                    "칸": [round(v, 1) for v in fig] if fig else None,
                    "자취": {k: v for k, v in tr.items() if isinstance(v, int)}}
    out.append(rec)

pathlib.Path("C:/tmp/probe52/probe.json").write_text(
    json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

c = collections.Counter()
for r in out:
    got = [t for t in ("선살림", "글자속끔", "문턱낮춤") if r[t]["찾음"]]
    c["현행에서 이미 찾음" if r["현행"]["찾음"]
      else ("살아남 ← " + "·".join(got)) if got
      else ("셋다로도 못 찾음" if not r["셋다"]["찾음"] else "셋을 같이 켜야 찾음")] += 1
for k, v in c.most_common(): print(f"{v:4d}  {k}")
