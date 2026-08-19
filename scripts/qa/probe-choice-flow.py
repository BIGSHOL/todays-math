# -*- coding: utf-8 -*-
"""HWPX 문단 흐름에서 **한 문항의 «글자와 그림 순서»** 를 그대로 늘어놓는다.

보기 ①~⑤ 가 그림인 문항에서 「어느 그림이 ①인가」는 PDF 좌표로만 풀리는 게 아니다 —
HWPX 는 `<hp:pic>` 이 문단 안에 있으므로 **문서 순서가 곧 보기 순서**다.
그게 실제로 그런지 눈으로 보려고 만든 것이다.

    python scripts/qa/probe-choice-flow.py <examId> <문항번호>
"""
from __future__ import annotations
import pathlib, re, sys, zipfile
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")
sys.path.append("scripts/vendor/testchanger")
import hwp_extract as HX

HP = HX.HP
SRC = pathlib.Path("scripts/qa/reports/hwpx")

def walk(node, out):
    for child in node:
        if child.tag in HX._SKIP_CTRL:
            continue
        tag = child.tag.split("}")[-1]
        if child.tag == HP + "endNote":
            out.append(("endnote", "")); continue
        if tag == "pic":
            ref = ""
            for c in child.iter():
                if c.tag.split("}")[-1] == "img":
                    ref = (c.attrib.get("binaryItemIDRef") or "")
            out.append(("pic", ref)); continue
        if tag == "t":
            out.append(("t", "".join(child.itertext()))); continue
        walk(child, out)

def main() -> None:
    exam, num = sys.argv[1], int(sys.argv[2])
    items = []
    with zipfile.ZipFile(SRC / f"{exam}.hwpx") as z:
        for name in sorted(n for n in z.namelist()
                           if re.match(r"Contents/section\d+\.xml", n)):
            walk(ET.fromstring(z.read(name).decode("utf-8")), items)
    q = 0
    for kind, val in items:
        if kind == "endnote":
            q += 1
            if q > num:
                break
            continue
        if q != num:
            continue
        if kind == "pic":
            print(f"  [그림 {val}]")
        elif val.strip():
            print(f"  {val.strip()[:100]}")

main()
