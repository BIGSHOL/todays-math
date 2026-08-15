# -*- coding: utf-8 -*-
"""역추적 매핑(source-map.json) → 원본 메타데이터 JSON.

exam_index.db 에서 학교·과목·연도·학기·회차·원본경로·원본정답을 뽑아
Problem 백필용 레코드로 만든다. LLM 토큰 0 (SQLite 조회뿐).

선행: node scripts/qa/dump-pastexam.mjs && python scripts/qa/trace-source.py
출력: scripts/qa/reports/source-meta.json
"""
import json, sqlite3, collections

import pathlib
import sys

sys.path.append(str(pathlib.Path(__file__).parent))
from tc_paths import exam_index_db  # noqa: E402

IDX = exam_index_db()
MAP = "scripts/qa/reports/source-map.json"
OUT = "scripts/qa/reports/source-meta.json"

mapping = json.load(open(MAP, encoding="utf-8"))
con = sqlite3.connect(IDX)

# exam 메타 캐시
exam_cache = {}
def exam_meta(exam_id):
    if exam_id not in exam_cache:
        exam_cache[exam_id] = con.execute(
            "select school, grade, subject, year, semester, round, src_path from exams where id=?",
            (exam_id,)).fetchone()
    return exam_cache[exam_id]

# externalId 충돌 검사 — UNIQUE 제약이 있으므로 중복 매핑은 버린다
ext_count = collections.Counter(
    f'{m["examId"]}-{m["questionNumber"]}' for m in mapping)

records, dropped_dup, missing_exam = [], 0, 0
for m in mapping:
    ext = f'{m["examId"]}-{m["questionNumber"]}'
    if ext_count[ext] > 1:
        dropped_dup += 1          # 같은 원본 문항에 여러 DB 행이 붙음 → 안전하게 제외
        continue
    e = exam_meta(m["examId"])
    if not e:
        missing_exam += 1
        continue
    school, grade, subject, year, semester, rnd, src_path = e
    q = con.execute(
        "select answer, solution from questions where exam_id=? and number=?",
        (m["examId"], m["questionNumber"])).fetchone()
    records.append({
        "problemId": m["problemId"],
        "externalId": ext,
        "examId": str(m["examId"]),
        "questionNumber": m["questionNumber"],
        "school": school or None,
        "subject": subject or None,
        "sourceFile": src_path or None,
        # 원본 정답/해설 — 2단계(정답 회수)에서 쓴다. 여기서는 싣기만 한다.
        "originAnswer": (q[0] or None) if q else None,
        "originSolution": (q[1] or None) if q else None,
    })

json.dump(records, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
print("mapping           :", len(mapping))
print("dropped (dup ext) :", dropped_dup)
print("missing exam row  :", missing_exam)
print("records written   :", len(records))
print("  with origin answer:", sum(1 for r in records if r["originAnswer"]))
print("->", OUT)
