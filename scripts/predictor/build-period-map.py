# -*- coding: utf-8 -*-
"""examId → 연도·학기·중간/기말 지도를 만든다.

추출 산출물(`final-batch/*.json`, `index-batch/*.json`)에는 **연/학기/회차가 없다.**
그래서 예측기가 시리즈를 시간순으로 못 세운다(docs/planning/11-score-predictor.md §2.4).

근본 해결은 `scripts/qa/extract-final-batch.py` 가 meta 에 3줄을 더 싣는 것이고,
그 전까지 이 스크립트가 두 출처를 조인해 지도를 만든다. 둘 다 로컬 계산이라 비용 0.

  1) `final-pairs.json`  — examId/year/semester/round (B단계 페어 산출물)
  2) `exam_index.db`     — exams(id, year, semester, round) 5,925행 전부 채워져 있음

사용:
  PYTHONIOENCODING=utf-8 python scripts/predictor/build-period-map.py
  → scripts/qa/reports/period-map.json  (gitignore 대상, 언제든 재생성 가능)

경로는 환경변수로 덮어쓸 수 있다:
  PREDICTOR_CORPUS_DIR  추출 산출물이 있는 reports 디렉토리
  TESTCHANGER_DIR       testchanger 저장소(= exam_index.db 위치)
"""
import json
import os
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CORPUS = Path(
    os.environ.get(
        "PREDICTOR_CORPUS_DIR",
        REPO.parent / "handoff-a-index" / "scripts" / "qa" / "reports",
    )
)
OUT = REPO / "scripts" / "qa" / "reports" / "period-map.json"

TESTCHANGER_CANDIDATES = [
    os.environ.get("TESTCHANGER_DIR"),
    r"F:\시험지변환기",
    r"D:\시험지 한글화",
]


def from_pairs(mapping: dict) -> int:
    path = CORPUS / "final-pairs.json"
    if not path.exists():
        print(f"  (건너뜀) {path} 없음")
        return 0
    raw = json.loads(path.read_text(encoding="utf-8"))
    rows = raw.get("pairs") if isinstance(raw, dict) else raw
    n = 0
    for r in rows or []:
        eid = r.get("examId") or r.get("exam_id") or r.get("id")
        if eid is None or not r.get("year"):
            continue
        mapping[str(eid)] = {
            "year": r["year"],
            "semester": r.get("semester"),
            "round": r.get("round"),
            "source": "final-pairs",
        }
        n += 1
    return n


def from_index(mapping: dict) -> int:
    db = None
    for cand in TESTCHANGER_CANDIDATES:
        if not cand:
            continue
        p = Path(cand) / "db" / "exam_index.db"
        if p.exists():
            db = p
            break
    if db is None:
        print("  (건너뜀) exam_index.db 를 찾지 못했다")
        return 0
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)   # 읽기 전용
    n = 0
    for eid, year, semester, rnd in con.execute(
        "select id, year, semester, round from exams"
    ):
        key = str(eid)
        if key in mapping or not year:
            continue
        mapping[key] = {
            "year": year,
            "semester": semester,
            "round": rnd,
            "source": "exam_index",
        }
        n += 1
    con.close()
    return n


def main() -> int:
    mapping: dict = {}
    a = from_pairs(mapping)
    b = from_index(mapping)
    if not mapping:
        print("지도를 만들 재료가 없다. PREDICTOR_CORPUS_DIR / TESTCHANGER_DIR 를 확인하라.")
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(mapping, ensure_ascii=False), encoding="utf-8")

    # 실제 코퍼스가 얼마나 덮이는지 같이 보고한다 — 이게 예측기가 쓸 수 있는 편수다.
    covered = total = 0
    for sub in ("final-batch", "index-batch"):
        d = CORPUS / sub
        if not d.exists():
            continue
        for f in d.glob("*.json"):
            total += 1
            if f.stem in mapping:
                covered += 1
    print(f"period-map: {len(mapping)}건 (final-pairs {a} + exam_index {b}) → {OUT}")
    print(f"코퍼스 덮임: {covered}/{total} 편"
          + (f" ({covered / total * 100:.1f}%)" if total else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
