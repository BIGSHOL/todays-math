# -*- coding: utf-8 -*-
"""파일럿 산출물(textlayer-pilot.json) → final-batch 형태로 변환.

N드라이브가 끊긴 동안에도 **변환·단원분류 경로를 검증**하려고 쓴다.
정답은 완료 HWP 에 있으므로 여기엔 없다(본문·단원 매핑만 본다).
메타데이터는 로컬 exam_index.db 에서 경로로 조회한다(N: 불필요).

사용: python scripts/qa/pilot-to-batch.py [출력디렉터리]
"""
import json
import pathlib
import sqlite3
import sys

IDX = r"D:\시험지 한글화\db\exam_index.db"
IN = "scripts/qa/reports/textlayer-pilot.json"
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "scripts/qa/reports/pilot-batch")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.append(str(pathlib.Path(__file__).parent))
from final_meta import unit_grade  # noqa: E402

con = sqlite3.connect(IDX)
by_path = {}
for eid, sp, level, grade, subject, school in con.execute(
    "select id, src_path, level, grade, subject, school from exams where src_path is not null"
):
    k = sp.replace("\\", "/").lower()
    by_path[k[3:].strip("/") if k[:3] == "n:/" else k.strip("/")] = (
        eid, level, grade, subject, school
    )

OUT.mkdir(parents=True, exist_ok=True)
n = miss = 0
for rec in json.load(open(IN, encoding="utf-8")):
    key = rec["file"].replace("\\", "/").lower().strip("/")
    row = by_path.get(key)
    if not row:
        miss += 1
        continue
    eid, level, grade, subject, school = row
    paper = {
        "meta": {
            "exam_id": eid,
            "school": school,
            "grade": unit_grade(level, grade, subject),
            "subject": subject,
            "level": level,
            "raw_grade": grade,
        },
        "_sourceFile": "N:\\" + rec["file"].replace("/", "\\"),
        "questions": rec["doc"].get("questions") or [],
        "_answers": [],
    }
    (OUT / f"{eid}.json").write_text(
        json.dumps(paper, ensure_ascii=False), encoding="utf-8"
    )
    n += 1

print("변환 %d편 · 인덱스 미매칭 %d편 → %s" % (n, miss, OUT))
