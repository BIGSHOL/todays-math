# -*- coding: utf-8 -*-
"""완료본 시험지의 **본문(PDF) ↔ 정답(HWP) 페어링** 가능 규모를 잰다.

발견(2026-08-15): 완료 PDF 에는 정답면이 없다(파일럿 20편 379문항, 정답 0건).
정답·해설·소단원·난이도는 **완료 HWP**(사람 검수본)에 들어 있고,
testchanger 는 `db/fill_answers.py` 로 그쪽에서 가져오고 있었다.

따라서 추출은 두 갈래를 짝지어야 한다 — 둘 다 비용 0:
  본문 : 완료 PDF 텍스트 레이어  (`db/textlayer.py`)
  정답 : 완료 HWP               (`scripts/hwp_extract.py`)

이 스크립트는 exam_files 를 훑어 **양쪽을 다 가진 시험지가 몇 편인지**만 센다.
"우선 정답 있는 문제"(원장님 1순위)를 채울 수 있는 실제 상한이 이 숫자다.

사용: python scripts/qa/pair-final-sources.py
출력: 요약 표 + scripts/qa/reports/final-pairs.json
"""
import collections
import json
import os
import re
import sqlite3
import sys

import pathlib
import sys

sys.path.append(str(pathlib.Path(__file__).parent))
from tc_paths import exam_index_db  # noqa: E402

IDX = exam_index_db()
OUT = "scripts/qa/reports/final-pairs.json"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

FINAL_MARK = re.compile(r"[(（]\s*완\s*료\s*[)）]")


def is_final(path: str, status: str | None) -> bool:
    """`(완료)` 표기 또는 인덱스가 '완료'로 표시한 파일."""
    return bool(FINAL_MARK.search(path or "")) or (status or "") == "완료"


con = sqlite3.connect(IDX)

# 이미 문항이 추출된 시험지는 제외 (재추출 방지)
done = {
    eid
    for (eid,) in con.execute(
        "select exam_id from questions group by exam_id having count(*)>0"
    )
}

by_exam = collections.defaultdict(lambda: {"pdf": [], "hwp": []})
for exam_id, path, ext, status in con.execute(
    "select exam_id, path, ext, status from exam_files"
):
    if not is_final(path, status):
        continue
    slot = "pdf" if (ext or "").lower() == ".pdf" else (
        "hwp" if (ext or "").lower() in (".hwp", ".hwpx") else None
    )
    if slot:
        by_exam[exam_id][slot].append(path)

stat = collections.Counter()
pairs = []
for exam_id, f in by_exam.items():
    if exam_id in done:
        stat["이미추출"] += 1
        continue
    has_pdf, has_hwp = bool(f["pdf"]), bool(f["hwp"])
    if has_pdf and has_hwp:
        stat["본문+정답"] += 1
        pairs.append({"examId": exam_id, "pdf": f["pdf"][0], "hwp": f["hwp"][0]})
    elif has_pdf:
        stat["본문만(PDF)"] += 1
        pairs.append({"examId": exam_id, "pdf": f["pdf"][0], "hwp": None})
    elif has_hwp:
        stat["정답원본만(HWP)"] += 1
        pairs.append({"examId": exam_id, "pdf": None, "hwp": f["hwp"][0]})

meta = {
    e: dict(zip(("school", "grade", "subject", "year", "semester", "round"), r))
    for e, *r in con.execute(
        "select id, school, grade, subject, year, semester, round from exams"
    )
}
for p in pairs:
    p.update(meta.get(p["examId"], {}))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(
    {"policy": "완료본 한정 — D-37", "pairs": pairs},
    open(OUT, "w", encoding="utf-8"),
    ensure_ascii=False,
)

print("── 완료본 시험지 페어링 (미추출분) ──")
for k in ("본문+정답", "본문만(PDF)", "정답원본만(HWP)", "이미추출"):
    print("%-16s %5d편" % (k, stat[k]))
print()
print("→", OUT)
