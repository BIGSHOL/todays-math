# -*- coding: utf-8 -*-
"""큐브수학 개념응용 5-2 응용강화북 파일럿 추출. 공유 DB 에 쓰지 않는다.

EHsang 숫자(U+0011..001A) 만 되돌리고, 쪽마다 다시 시작하는 1. 2. 3. 로 가른다.
시험지용 textlayer.extract() 는 쓰지 않는다 — 교재는 번호가 쪽마다 1 로 돌아온다.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PDF = Path(
    r"N:\개인\강아\교재자료\큐브수학 개념\큐브수학 개념응용\응용강화북"
    r"\큐브수학 개념응용 5-2 응용강화북.pdf"
)
OUT = Path("scripts/qa/reports/cube-probe")

# EHsang-Plain 숫자. 지면 실측(응용강화 5-2 p1): 동현 62, 태연 105, 2분.
# U+0011=0 … U+001A=9. +1 로 두면 62→73, 105→216 이 된다.
EHSANG_DIGIT = {i: str(i - 0x11) for i in range(0x11, 0x1B)}


def decode_cube_digits(s: str) -> str:
    return "".join(EHSANG_DIGIT.get(ord(c), c) for c in s)


UNIT_LINE = re.compile(r"^(\d+)\.\s+(.+)$")
# 응용강화 문항 번호는 혼자 한 줄이다. 단원 제목 `1. 수의 범위와 어림하기` 와 갈린다.
SOLO_NUM = re.compile(r"^(\d{1,2})\.\s*$")
BANNER = re.compile(r"^(\d{2})\s+(.+)$")


def split_page(text: str, page: int) -> list[dict]:
    lines = [ln.rstrip() for ln in text.splitlines()]
    unit = None
    lesson = None
    banner_no = None
    for ln in lines[:12]:
        m = UNIT_LINE.match(ln.strip())
        if m and re.search(r"[가-힣]{2,}", m.group(2)) and "하세요" not in m.group(2):
            unit = re.sub(r"\s+\d{2}$", "", m.group(2)).strip()
            break
    for ln in lines[:16]:
        s = ln.strip()
        bm = re.match(r"^(\d{2})\s+(.+)$", s)
        if bm and re.search(r"[가-힣]{3,}", bm.group(2)):
            banner_no = bm.group(1)
            lesson = bm.group(2).strip()
            break
        if re.fullmatch(r"\d{2}", s):
            banner_no = s
        elif banner_no and re.search(r"[가-힣]{3,}", s) and lesson is None:
            if s not in {"응용", "강화"} and "진도북" not in s and "정답" not in s:
                lesson = s
    starts: list[tuple[int, int]] = []
    for i, ln in enumerate(lines):
        m = SOLO_NUM.match(ln.strip())
        if m:
            starts.append((int(m.group(1)), i))
    items = []
    for i, (num, pos) in enumerate(starts):
        end = starts[i + 1][1] if i + 1 < len(starts) else len(lines)
        body = "\n".join(ln for ln in lines[pos + 1 : end] if ln.strip())
        items.append(
            {
                "id": f"cube-app-5-2-p{page:02d}-q{num}",
                "page": page,
                "number": num,
                "unitHint": unit,
                "lesson": lesson,
                "banner": banner_no,
                "content": body.strip(),
            }
        )
    return items


def main() -> None:
    doc = pymupdf.open(PDF)
    all_items = []
    for i in range(doc.page_count):
        raw = doc[i].get_text() or ""
        dec = decode_cube_digits(raw)
        items = split_page(dec, i + 1)
        all_items.extend(items)
    doc.close()

    units = {}
    for it in all_items:
        units.setdefault(it["unitHint"] or "?", 0)
        units[it["unitHint"] or "?"] += 1

    preview = []
    for it in all_items[:6]:
        preview.append(
            f"{it['id']}  [{it['unitHint']}] {it['lesson']}\n{it['content'][:400]}\n"
        )

    out = {
        "source": str(PDF),
        "pages": 24,
        "items": len(all_items),
        "byUnit": units,
        "problems": all_items,
    }
    (OUT / "app52-items.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "app52-preview.txt").write_text("\n---\n".join(preview), encoding="utf-8")
    print(f"items={len(all_items)}")
    print("byUnit")
    for k, n in units.items():
        print(f"  {n:3}  {k}")
    print("── preview 1 ──")
    print(preview[0] if preview else "(none)")
    first = all_items[0]["content"] if all_items else ""
    # 지면 실측(p1 문항1). 매핑이 한 칸 밀리면 62→73, 2분→3분.
    for needle in ("2분", "동현\n62", "태연\n105", "1급\n100 이상"):
        ok = needle in first
        print(f"guard {needle!r} {'OK' if ok else 'FAIL'}")
        if not ok:
            raise SystemExit("EHsang 숫자 매핑이 지면과 다르다")


if __name__ == "__main__":
    main()
