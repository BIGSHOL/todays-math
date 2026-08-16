# -*- coding: utf-8 -*-
"""공식 정답면에서 **특정 문항의 정답 줄만 오려** 한 장으로 붙인다.

왜: 분류 결과를 사람이 눈으로 확인해야 한다. 지난 회차에 "한 시험지에 어긋남이
몰리면 추출 결함" 이라는 가드를 거꾸로 걸어, 몰린 48건이 전부 진짜 DB 오답이었는데
교정에서 뺄 뻔했다. **텍스트 추출을 믿지 말고 지면을 봐라.**

  python scripts/qa/shot-official-answer.py 3073-20 3154-19 ...
  python scripts/qa/shot-official-answer.py --from-report 값이다름 --limit 12

출력: scripts/qa/_probe/official-check.png (gitignore 됨)
"""
import argparse
import json
import pathlib
import re
import sys

import fitz  # PyMuPDF

PAIRS = "scripts/qa/reports/final-pairs.json"
OFFICIAL = pathlib.Path("scripts/qa/reports/official-answers")
CLASSIFIED = "scripts/qa/reports/answer-mismatch-classified.json"
OUT = pathlib.Path("scripts/qa/_probe/official-check.png")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

NUMBER_HEAD = re.compile(r"^\s*(?:\[(\d{1,2})\]|(\d{1,2})\s*[.)])")


def crop(pdf: str, page_no: int, number: str) -> "fitz.Pixmap | None":
    """정답면에서 `<번호>.` 로 시작하는 블록을 찾아 그 줄만 오린다."""
    doc = fitz.open(pdf)
    try:
        page = doc[page_no]
        for block in page.get_text("blocks"):
            head = NUMBER_HEAD.match(block[4].strip())
            if not head:
                continue
            if (head.group(1) or head.group(2)) != number:
                continue
            rect = fitz.Rect(block[0] - 2, block[1] - 2, block[2] + 2, block[3] + 2)
            # 한 줄짜리 정답은 너무 납작해 읽기 어렵다. 최소 높이를 준다.
            if rect.height < 18:
                rect.y1 = rect.y0 + 18
            return page.get_pixmap(clip=rect, dpi=170)
        return None
    finally:
        doc.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*", help="<examId>-<번호>")
    ap.add_argument("--from-report", default=None, help="분류 갈래 이름")
    ap.add_argument("--limit", type=int, default=12)
    a = ap.parse_args()

    ids = list(a.ids)
    if a.from_report:
        doc = json.load(open(CLASSIFIED, encoding="utf-8"))
        group = next(g for g in doc["rules"] if g["rule"] == a.from_report)
        items = group["items"]
        step = max(1, len(items) // a.limit)
        ids = [items[i]["externalId"] for i in range(0, len(items), step)][: a.limit]

    pairs = {
        p["examId"]: p["pdf"]
        for p in json.load(open(PAIRS, encoding="utf-8"))["pairs"]
    }
    shots = []
    for ext in ids:
        # ⚠️ externalId 형식을 가정하지 마라. 트랙 C 가 RPM 행에 sumaek UUID 를 채우면서
        # `<examId>-<번호>` 를 전제한 다른 도구가 조용히 31건을 잃은 적이 있다
        # (에러가 아니라 숫자만 줄었다). 기출 형식이 아니면 건너뛰고 이유를 찍는다.
        if "-" not in ext or not ext.rsplit("-", 1)[0].isdigit():
            print(f"  ! {ext} 기출 externalId 형식이 아니다 — 건너뜀")
            continue
        exam_id, number = ext.rsplit("-", 1)
        exam_id = int(exam_id)
        meta_path = OFFICIAL / f"{exam_id}.json"
        if not meta_path.exists():
            print(f"  ! {ext} 공식 정답 산출물 없음")
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        item = meta["items"].get(number)
        if item is None:
            print(f"  ! {ext} 항목 없음")
            continue
        pix = crop(pairs[exam_id], item["page"], number)
        if pix is None:
            print(f"  ! {ext} 블록 못 찾음")
            continue
        shots.append((ext, pix))

    if not shots:
        print("오려낼 것이 없다")
        return
    width = max(p.width for _, p in shots) + 150
    height = sum(p.height + 8 for _, p in shots) + 10
    out = fitz.open()
    page = out.new_page(width=width, height=height)
    y = 5
    for ext, pix in shots:
        page.insert_text((4, y + 14), ext, fontsize=11)
        page.insert_image(
            fitz.Rect(140, y, 140 + pix.width, y + pix.height), pixmap=pix
        )
        y += pix.height + 8
    OUT.parent.mkdir(parents=True, exist_ok=True)
    page.get_pixmap(dpi=72).save(str(OUT))
    print(f"{len(shots)}건 → {OUT}")


if __name__ == "__main__":
    main()
