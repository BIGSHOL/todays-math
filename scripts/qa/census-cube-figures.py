# -*- coding: utf-8 -*-
"""개념 진도북 8권 — 그림·조작 마커 전쪽 센수. 공유 DB 금지. 한컴 COM 금지."""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(r"N:\개인\강아\교재자료\큐브수학 개념") / "큐브수학 개념" / "진도북"
OUT = Path("scripts/qa/reports/cube-probe/cube-figure-census.json")

EHSANG = {i: str(i - 0x11) for i in range(0x11, 0x1B)}


def decode(s: str) -> str:
    return "".join(EHSANG.get(ord(c), c) for c in s)


# 한 쪽이 여러 마커에 걸릴 수 있다. 분모는 쪽.
MARKERS: list[tuple[str, re.Pattern[str]]] = [
    ("조작-그리세요", re.compile(r"그리세요|그려 보|완성해 보|이으|이어 보")),
    ("조작-재기", re.compile(r"재어 보|자를 대|각도기를 사용|컴퍼스")),
    ("수모형", re.compile(r"수 모형|십 모형|백 모형|일 모형")),
    ("시계", re.compile(r"시계")),
    ("각도기", re.compile(r"각도기")),
    ("분수색칠", re.compile(r"색칠한 부분|색칠하고")),
    ("막대그래프", re.compile(r"막대그래프")),
    ("꺾은선", re.compile(r"꺾은선")),
    ("그림그래프", re.compile(r"그림그래프")),
    ("띠그래프", re.compile(r"띠그래프")),
    ("원그래프", re.compile(r"원그래프")),
    ("전개도", re.compile(r"전개도")),
    ("쌓기나무", re.compile(r"쌓기나무|위에서 본")),
    ("합동", re.compile(r"합동")),
    ("대칭", re.compile(r"선대칭|점대칭|대칭축")),
    ("돌리기뒤집기", re.compile(r"돌리|뒤집|밀기")),
    ("직육면체", re.compile(r"직육면체|정육면체")),
    ("각기둥뿔", re.compile(r"각기둥|각뿔")),
    ("원기둥뿔구", re.compile(r"원기둥|원뿔")),
    ("넓이", re.compile(r"넓이")),
    ("부피겉넓이", re.compile(r"부피|겉넓이")),
    ("원주", re.compile(r"원주|원주율")),
]


def main() -> None:
    report: dict = {}
    for path in sorted(ROOT.glob("큐브수학 개념 *_진도북.pdf")):
        g = re.search(r"(\d-\d)", path.name)
        key = g.group(1) if g else path.stem
        doc = pymupdf.open(path)
        hits: Counter[str] = Counter()
        n_draw = n_img = n_pages = 0
        first_hit: dict[str, int] = {}
        for i, page in enumerate(doc):
            n_pages += 1
            if page.get_drawings():
                n_draw += 1
            if page.get_images():
                n_img += 1
            text = decode(page.get_text() or "")
            for name, pat in MARKERS:
                if pat.search(text):
                    hits[name] += 1
                    first_hit.setdefault(name, i + 1)
        rec = {
            "file": path.name,
            "pages": n_pages,
            "pagesWithDrawings": n_draw,
            "pagesWithImages": n_img,
            "markerPages": dict(hits),
            "firstPage": first_hit,
        }
        report[key] = rec
        print(key, "p", n_pages, "draw", n_draw, "img", n_img)
        for k, v in hits.most_common():
            print(f"  {k:12} {v:3}  first p{first_hit[k]}")
        doc.close()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
