# -*- coding: utf-8 -*-
"""완료본(원본) 한정 추출 방침의 근거 측정 — exam_index.db 전수 집계.

버킷:
  A  HWP2PDF-완료 : `HWP 2 PDF` 경로의 `(완료)` 파일  — 워드→PDF 변환본, 텍스트 레이어 생존
  B  기타-완료    : 그 밖의 `(완료)` 파일
  C  비완료       : 나머지(스캔 원본 등)

지표: 문항 수 · 정답 없음 · 그림 참조 · OCR 훼손 의심 · 보기 없음(객관식인데 선택지 결손)

LLM 토큰 0 — SQLite 로컬 집계뿐. 출력은 요약 표만.
사용: python scripts/qa/survey-final-only.py
"""
import json
import re
import sqlite3
import sys

import pathlib
import sys

sys.path.append(str(pathlib.Path(__file__).parent))
from tc_paths import exam_index_db  # noqa: E402

IDX = exam_index_db()

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

FINAL = "(완료)"
HWP2PDF = "HWP 2 PDF"

# 그림 참조 표현 — 본문이 그림을 가리키는데 이미지가 없으면 출제 불가
FIGURE = re.compile(r"그림과\s*같|그림에서|아래\s*그림|다음\s*그림|위\s*그림|\[그림")
# OCR 훼손 의심 — 깨진 기호·빈 수식·제어문자
BROKEN = re.compile(r"[\ufffd\u25a1]|\$\s*\$|[○◇]{3,}")


def bucket(src_path: str) -> str:
    if not src_path:
        return "C"
    if FINAL in src_path:
        return "A" if HWP2PDF in src_path else "B"
    return "C"


def q_text(o: dict) -> str:
    parts = []
    for b in o.get("contents") or []:
        v = b.get("value")
        if v:
            parts.append(str(v))
    return " ".join(parts)


def n_choices(o: dict) -> int:
    return len(o.get("choices") or [])


con = sqlite3.connect(IDX)
exam_bucket = {
    eid: bucket(sp)
    for eid, sp in con.execute("select id, src_path from exams")
}

stat = {k: dict(q=0, no_ans=0, fig=0, broken=0, no_choice=0, exams=set()) for k in "ABC"}

for exam_id, ocr_json, answer in con.execute(
    "select exam_id, ocr_json, answer from questions"
):
    b = exam_bucket.get(exam_id, "C")
    s = stat[b]
    s["q"] += 1
    s["exams"].add(exam_id)
    if not (answer or "").strip():
        s["no_ans"] += 1
    if not ocr_json:
        s["broken"] += 1
        continue
    try:
        o = json.loads(ocr_json)
    except Exception:
        s["broken"] += 1
        continue
    t = q_text(o)
    if FIGURE.search(t):
        s["fig"] += 1
    if BROKEN.search(t) or len(t.strip()) < 8:
        s["broken"] += 1
    if o.get("type") == "객관식" and n_choices(o) < 4:
        s["no_choice"] += 1

NAME = {"A": "A HWP2PDF-완료", "B": "B 기타-완료   ", "C": "C 비완료      "}
print("버킷            시험지  문항   정답없음   그림참조   OCR훼손   보기결손")
for k in "ABC":
    s = stat[k]
    q = max(1, s["q"])
    print(
        "%s %5d %6d  %5d(%4.1f%%) %5d(%4.1f%%) %4d(%4.1f%%) %4d(%4.1f%%)"
        % (
            NAME[k],
            len(s["exams"]),
            s["q"],
            s["no_ans"],
            s["no_ans"] * 100.0 / q,
            s["fig"],
            s["fig"] * 100.0 / q,
            s["broken"],
            s["broken"] * 100.0 / q,
            s["no_choice"],
            s["no_choice"] * 100.0 / q,
        )
    )
tot = sum(stat[k]["q"] for k in "ABC")
print("합계 문항:", tot)
print("완료본(A+B) 문항:", stat["A"]["q"] + stat["B"]["q"])
