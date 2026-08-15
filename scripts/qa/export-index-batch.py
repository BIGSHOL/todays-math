# -*- coding: utf-8 -*-
"""이미 추출이 끝난 exam_index.db 문항 → 우리 이관 형태로 내보낸다. **N드라이브 불필요**.

배경(2026-08-15): N드라이브에서 새로 뽑기 전에, testchanger 가 **이미 추출·검수까지
끝내 둔** 9,173문항이 로컬 `exam_index.db` 에 있다. 소단원 86%·정답 84%가 채워져 있고
우리 DB 에 들어온 건 2,301건뿐이다. 새 추출보다 이쪽이 훨씬 싸다(파일 I/O 0, 토큰 0).

D-37 대로 **완료본 시험지만** 고른다.

  python scripts/qa/export-index-batch.py --limit 30
  python scripts/qa/export-index-batch.py --limit 30 --bucket A   # HWP2PDF 완료본만

출력: scripts/qa/reports/index-batch/<examId>.json  (final-batch 와 같은 모양)
화면에는 집계만 찍는다.
"""
import argparse
import collections
import json
import pathlib
import re
import sqlite3
import sys

import pathlib
import sys

sys.path.append(str(pathlib.Path(__file__).parent))
from tc_paths import exam_index_db  # noqa: E402

IDX = exam_index_db()
DEFAULT_OUT = "scripts/qa/reports/index-batch"

sys.path.append(str(pathlib.Path(__file__).parent))
from final_meta import clean_answer, unit_grade  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

FINAL = re.compile(r"[(（]\s*완\s*료\s*[)）]")
HWP2PDF = "HWP 2 PDF"


def bucket(src_path: str | None) -> str:
    if not src_path or not FINAL.search(src_path):
        return "C"
    return "A" if HWP2PDF in src_path else "B"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--bucket", default="AB", help="A/B/C 조합 (기본 AB = 완료본만)")
    ap.add_argument("--out", default=DEFAULT_OUT)
    a = ap.parse_args()

    outdir = pathlib.Path(a.out)
    outdir.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(IDX)

    exams = [
        row
        for row in con.execute(
            "select e.id, e.level, e.grade, e.subject, e.school, e.src_path,"
            " (select count(*) from questions q where q.exam_id=e.id) n"
            " from exams e where n>0 order by e.id"
        )
        if bucket(row[5]) in a.bucket
    ]
    picked = exams[a.offset : a.offset + a.limit]

    stat = collections.Counter()
    for eid, level, grade, subject, school, src_path, _n in picked:
        questions, answers = [], []
        for number, ocr_json, answer, solution, topic, difficulty in con.execute(
            "select number, ocr_json, answer, solution, topic, difficulty"
            " from questions where exam_id=? order by number",
            (eid,),
        ):
            if not ocr_json:
                stat["ocr_json 없음"] += 1
                continue
            try:
                o = json.loads(ocr_json)
            except Exception:  # noqa: BLE001
                stat["ocr_json 깨짐"] += 1
                continue
            o["number"] = number
            questions.append(o)
            answers.append(
                {
                    "number": number,
                    "answer": clean_answer(answer),
                    "solution": (solution or "").strip() or None,
                    "topic": (topic or "").strip() or None,
                    "difficulty": (difficulty or "").strip() or None,
                }
            )

        if not questions:
            continue
        paper = {
            "meta": {
                "exam_id": eid,
                "school": school,
                "grade": unit_grade(level, grade, subject),
                "subject": subject,
                "level": level,
                "raw_grade": grade,
            },
            "_sourceFile": src_path,
            "questions": questions,
            "_answers": answers,
        }
        (outdir / f"{eid}.json").write_text(
            json.dumps(paper, ensure_ascii=False), encoding="utf-8"
        )
        stat["편"] += 1
        stat["문항"] += len(questions)
        stat["정답"] += sum(1 for x in answers if x["answer"])
        stat["소단원"] += sum(1 for x in answers if x["topic"])
        if paper["meta"]["grade"] is None:
            stat["학년미상편"] += 1

    q = max(1, stat["문항"])
    print("── exam_index 내보내기 (완료본 %s · 토큰 0 · N드라이브 불필요) ──" % a.bucket)
    print("대상 시험지 %d편 중 %d편 · 문항 %d" % (len(exams), stat["편"], stat["문항"]))
    for k in ("정답", "소단원"):
        print("  %-5s %5d (%4.1f%%)" % (k, stat[k], stat[k] * 100.0 / q))
    for k in ("학년미상편", "ocr_json 없음", "ocr_json 깨짐"):
        if stat[k]:
            print("  %-12s %d" % (k, stat[k]))
    print("→", outdir)


if __name__ == "__main__":
    main()
