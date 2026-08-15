# -*- coding: utf-8 -*-
"""캐시된 원본 PDF에서 **그림이 어떤 형태로 들어 있는지** 표본 조사한다.

벡터 드로잉이냐 임베드 이미지냐에 따라 추출 전략이 완전히 달라진다:
  임베드 이미지 → 잘라내 PNG/데이터URI (원본 그대로, 다만 래스터)
  벡터 드로잉   → 경로를 SVG 로 재발행 (해상도 무한, 인쇄 최적)

사용: python scripts/figure/survey-figure-form.py [표본수]
"""
import collections
import pathlib
import random
import sqlite3
import sys

import fitz

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1] / "qa"))
from tc_paths import exam_index_db, testchanger_dir  # noqa: E402

IDX = exam_index_db()
PAGES = testchanger_dir() / "db" / "pages"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 30

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

con = sqlite3.connect(IDX)
cached = {p.name for p in PAGES.iterdir() if (p / "src.pdf").exists()}

# 완료본 + 캐시 있음 + 그림 문항 보유
cands = []
for eid, src in con.execute(
    "select id, src_path from exams where src_path is not null"
):
    if str(eid) not in cached or "완료" not in (src or ""):
        continue
    n = con.execute(
        "select count(*) from questions where exam_id=? and ocr_json like '%그림%'",
        (eid,),
    ).fetchone()[0]
    if n:
        cands.append((eid, n))

random.seed(3)
picked = random.sample(cands, min(N, len(cands)))
print("완료본·캐시·그림문항 보유 시험지 %d편 중 %d편 표본" % (len(cands), len(picked)))

stat = collections.Counter()
per_exam = []
for eid, nfig in picked:
    doc = fitz.open(PAGES / str(eid) / "src.pdf")
    imgs = draws = 0
    for pno in range(doc.page_count):
        page = doc[pno]
        imgs += len(page.get_images(full=True))
        W, H = page.rect.width, page.rect.height
        for d in page.get_drawings():
            r = d["rect"]
            if r.is_empty or r.is_infinite:
                continue
            if r.width > W * 0.8 or r.height > H * 0.8:
                continue
            if r.height < 2 and r.width > 120:
                continue
            draws += 1
    doc.close()
    per_exam.append((eid, nfig, imgs, draws))
    if imgs and not draws:
        stat["이미지만"] += 1
    elif draws and not imgs:
        stat["벡터만"] += 1
    elif draws and imgs:
        stat["둘 다"] += 1
    else:
        stat["둘 다 없음"] += 1

print(dict(stat))
print("\n시험지  그림문항  이미지  벡터")
for eid, nfig, imgs, draws in per_exam[:15]:
    print("%6d %7d %7d %6d" % (eid, nfig, imgs, draws))
