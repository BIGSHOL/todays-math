# -*- coding: utf-8 -*-
"""트랙 D — `pair-final-sources.py` 가 **제외한** 완료본의 HWP 짝.

`pair-final-sources.py` 는 exam_index 에 이미 문항이 추출된 시험지(A단계 358편)를
`done` 으로 빼 버린다. 그건 "다시 추출할 필요가 없다" 는 뜻이었지 "HWP 가 필요 없다"
는 뜻이 아니다 — 그 358편의 문항은 **DB 에 들어가 있고**(실측 6,399행) D-2 교체 판정
대상이다. 그래서 여기서 따로 짝을 만든다.

출력: scripts/qa/reports/final-pairs-extra.json  (final-pairs.json 과 같은 스키마)
"""
import json
import os
import pathlib
import re
import sqlite3
import sys

sys.path.append(str(pathlib.Path(__file__).parent))
from tc_paths import exam_index_db  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PAIRS = "scripts/qa/reports/final-pairs.json"
OUT = "scripts/qa/reports/final-pairs-extra.json"
FINAL_MARK = re.compile(r"[(（]\s*완\s*료\s*[)）]")

already = {
    str(p["examId"])
    for p in json.load(open(PAIRS, encoding="utf-8"))["pairs"]
}

con = sqlite3.connect(exam_index_db())
files: dict[str, dict] = {}
for eid, path, ext, status in con.execute(
    "select exam_id, path, ext, status from exam_files"
):
    if not (FINAL_MARK.search(path or "") or (status or "") == "완료"):
        continue
    slot = {".pdf": "pdf", ".hwp": "hwp", ".hwpx": "hwp"}.get((ext or "").lower())
    if not slot:
        continue
    files.setdefault(str(eid), {"pdf": None, "hwp": None})
    files[str(eid)][slot] = files[str(eid)][slot] or path

meta = {
    str(e): dict(
        zip(("school", "level", "grade", "subject", "year", "semester", "round"), r)
    )
    for e, *r in con.execute(
        "select id, school, level, grade, subject, year, semester, round from exams"
    )
}

pairs = []
for eid, f in sorted(files.items()):
    if eid in already or not f["hwp"]:
        continue
    pairs.append({"examId": eid, "pdf": f["pdf"], "hwp": f["hwp"], **meta.get(eid, {})})

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(
    {"policy": "완료본 한정 — D-37 · pair-final-sources 가 제외한 이미추출분", "pairs": pairs},
    open(OUT, "w", encoding="utf-8"),
    ensure_ascii=False,
)
print(f"제외분 완료본 HWP {len(pairs)}편 → {OUT}")
