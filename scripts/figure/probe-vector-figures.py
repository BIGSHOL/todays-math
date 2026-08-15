# -*- coding: utf-8 -*-
"""완료본 PDF 안의 **벡터 도형**을 찾아낸다 — 타당성 스파이크.

배경(2026-08-15): 완료본은 HWP→PDF 변환본이라 그림이 **임베드 이미지가 아니라
벡터 드로잉**으로 들어 있다. testchanger `db/textlayer.py` 의 `page_figures()` 는
`page.get_images()` 만 보므로 이 그림들을 통째로 놓친다 — 그래서 이관된 문항의
"그림 참조"가 본문만 남고 그림이 사라졌다.

여기서는 드로잉을 **군집**으로 묶어 그림 후보 영역을 잡고, 페이지 가구(테두리·단
구분선·보기 박스·밑줄)를 걸러낸다. 결과는 집계와 bbox 목록만 찍는다.

사용: python scripts/figure/probe-vector-figures.py [exam_id]
"""
import collections
import json
import pathlib
import sqlite3
import sys

import fitz

IDX = r"D:\시험지 한글화\db\exam_index.db"
PAGES = pathlib.Path(r"D:\시험지 한글화\db\pages")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def pick_exam() -> int:
    """캐시된 원본이 있고 '그림' 문항이 있는 완료본 시험지 하나."""
    con = sqlite3.connect(IDX)
    cached = {p.name for p in PAGES.iterdir() if (p / "src.pdf").exists()}
    for eid, src in con.execute(
        "select id, src_path from exams where src_path like '%완료%' order by id"
    ):
        if str(eid) not in cached:
            continue
        n = con.execute(
            "select count(*) from questions where exam_id=? and ocr_json like '%그림%'",
            (eid,),
        ).fetchone()[0]
        if n >= 3:
            return eid
    raise SystemExit("후보 시험지를 찾지 못했습니다.")


def cluster(rects, gap=14.0):
    """가까운 사각형끼리 잇는다(연결요소). 그림 하나는 선 수십 개로 쪼개져 있다."""
    boxes = [list(r) for r in rects]
    merged = True
    while merged:
        merged = False
        out = []
        for b in boxes:
            hit = None
            for o in out:
                if (
                    b[0] <= o[2] + gap
                    and o[0] <= b[2] + gap
                    and b[1] <= o[3] + gap
                    and o[1] <= b[3] + gap
                ):
                    hit = o
                    break
            if hit:
                hit[0] = min(hit[0], b[0])
                hit[1] = min(hit[1], b[1])
                hit[2] = max(hit[2], b[2])
                hit[3] = max(hit[3], b[3])
                merged = True
            else:
                out.append(b[:])
        boxes = out
    return boxes


def main() -> None:
    eid = int(sys.argv[1]) if len(sys.argv) > 1 else pick_exam()
    pdf = PAGES / str(eid) / "src.pdf"
    print("시험지", eid, "→", pdf)

    doc = fitz.open(pdf)
    stat = collections.Counter()
    found = []

    for pno in range(doc.page_count):
        page = doc[pno]
        W, H = page.rect.width, page.rect.height
        rects = []
        for d in page.get_drawings():
            r = d["rect"]
            if r.is_empty or r.is_infinite:
                continue
            stat["드로잉"] += 1
            # 페이지 가구 제거 — 전폭/전고 선, 아주 얇고 긴 선(밑줄·구분선)
            if r.width > W * 0.8 or r.height > H * 0.8:
                stat["가구:전폭/전고"] += 1
                continue
            if r.height < 2 and r.width > 120:
                stat["가구:긴 밑줄"] += 1
                continue
            rects.append((r.x0, r.y0, r.x1, r.y1))

        for b in cluster(rects):
            w, h = b[2] - b[0], b[3] - b[1]
            # 그림이라 부를 최소 크기 — 밑줄 조각·글머리 장식 배제
            if w < 40 or h < 30:
                stat["작음:버림"] += 1
                continue
            stat["그림후보"] += 1
            found.append({"page": pno, "x0": round(b[0]), "y0": round(b[1]),
                          "w": round(w), "h": round(h)})

    print(json.dumps(dict(stat), ensure_ascii=False))
    print("\n쪽  위치(x0,y0)      크기")
    for f in found[:20]:
        print("%2d  (%4d,%4d)   %4d x %4d" % (f["page"], f["x0"], f["y0"], f["w"], f["h"]))
    print("\n그림 후보 %d개 / %d쪽" % (len(found), doc.page_count))
    doc.close()


if __name__ == "__main__":
    main()
