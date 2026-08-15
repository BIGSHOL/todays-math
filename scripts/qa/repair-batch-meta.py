# -*- coding: utf-8 -*-
"""이미 뽑아 둔 배치 산출물의 `meta.grade` 를 다시 계산한다. **재추출 없음.**

배경(2026-08-15): `pair-final-sources.py` 가 `exams.level` 을 SELECT 에서
빠뜨려, 추출 산출물의 `meta.level` 이 전부 None 이었다. `unit_grade()` 는
level 이 "중" 일 때만 중등 분기를 타므로 중학 시험지가 통째로 고등 분기로
빠져 학년 미해석이 됐다(793편 16,459문항).

N드라이브를 다시 읽을 필요는 없다 — 학년은 `exam_index.db` 만 있으면 되고
본문·정답은 멀쩡하다. 그래서 산출물의 meta 만 제자리에서 고친다.

    python scripts/qa/repair-batch-meta.py scripts/qa/reports/final-batch
    python scripts/qa/repair-batch-meta.py <디렉토리> --dry
"""
import argparse
import collections
import json
import pathlib
import sqlite3
import sys

sys.path.append(str(pathlib.Path(__file__).parent))
from final_meta import unit_grade  # noqa: E402
from tc_paths import exam_index_db  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", nargs="?", default="scripts/qa/reports/final-batch")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()

    con = sqlite3.connect(exam_index_db())
    src = {
        eid: (level, grade, subject)
        for eid, level, grade, subject in con.execute(
            "select id, level, grade, subject from exams"
        )
    }

    stat = collections.Counter()
    for f in sorted(pathlib.Path(a.dir).glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        meta = data.get("meta") or {}
        eid = meta.get("exam_id")
        row = src.get(eid)
        if row is None:
            stat["인덱스에 없음"] += 1
            continue
        level, grade, subject = row
        fixed = unit_grade(level, grade, subject)
        n = len(data.get("questions") or [])
        if meta.get("grade") == fixed and meta.get("level") == level:
            stat["그대로"] += 1
            continue
        if meta.get("grade") is None and fixed is not None:
            stat["학년 회복"] += 1
            stat["학년 회복(문항)"] += n
        elif fixed is None:
            stat["여전히 미해석"] += 1
            stat["여전히 미해석(문항)"] += n
        else:
            stat["학년 변경"] += 1
        meta["level"] = level
        meta["grade"] = fixed
        meta["raw_grade"] = grade
        data["meta"] = meta
        if not a.dry:
            f.write_text(
                json.dumps(data, ensure_ascii=False), encoding="utf-8"
            )

    print("── 배치 메타 재계산 ──" + (" (드라이런)" if a.dry else ""))
    for k, v in sorted(stat.items()):
        print(f"  {k:<20} {v}")


if __name__ == "__main__":
    main()
