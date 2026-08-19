# -*- coding: utf-8 -*-
"""HWPX 문항 구간에 **무엇이 들어 있나** — 그림·그리기개체·표를 문항별로 센다.

「그 HWP 문항에 그림이 없다」가 «원본에 없다» 인지 «`<hp:pic>` 이 아닐 뿐» 인지를 가른다.
"""
from __future__ import annotations
import collections, json, pathlib, re, sys, zipfile
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")
sys.path.append("scripts/vendor/testchanger")
import hwp_extract as HX

HP = HX.HP
SRC = pathlib.Path("scripts/qa/reports/hwpx")
SHAPE = {"line","rect","ellipse","arc","polygon","curve","connectLine","container","textart","ole","chart","equation"}

def walk(node, out):
    for child in node:
        if child.tag in HX._SKIP_CTRL:
            continue
        tag = child.tag.split("}")[-1]
        if child.tag == HP + "endNote":
            out.append(("endnote", None)); continue
        if tag == "pic":
            out.append(("pic", None)); continue
        if tag == "container":
            # 그리기 개체 묶음 — 안쪽 도형 종류를 세고 더 내려가지 않는다.
            kinds = collections.Counter(c.tag.split("}")[-1] for c in child.iter()
                                        if c.tag.split("}")[-1] in SHAPE | {"pic"})
            out.append(("container", dict(kinds))); continue
        if tag in SHAPE:
            out.append(("shape:" + tag, None)); continue
        if tag == "tbl":
            out.append(("tbl", None))
        walk(child, out)

def scan(path):
    items = []
    with zipfile.ZipFile(path) as z:
        for name in sorted(n for n in z.namelist() if re.match(r"Contents/section\d+\.xml", n)):
            walk(ET.fromstring(z.read(name).decode("utf-8")), items)
    q, per = 0, {}
    for kind, val in items:
        if kind == "endnote":
            q += 1; continue
        if q == 0: continue
        d = per.setdefault(q, collections.Counter())
        d[kind] += 1
        if kind == "container":
            for k, n in (val or {}).items():
                d["·" + k] += n
    return per

if __name__ == "__main__":
    exams = sys.argv[1:]
    out = {}
    for e in exams:
        p = SRC / f"{e}.hwpx"
        if not p.exists():
            print(f"{e}: hwpx 없음"); continue
        try:
            out[e] = {str(k): dict(v) for k, v in scan(p).items()}
        except Exception as exc:
            print(f"{e}: 실패 {type(exc).__name__} {exc}")
    pathlib.Path("scripts/qa/reports/_hwp-objects.json").write_text(
        json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"편 {len(out)} → scripts/qa/reports/_hwp-objects.json")
