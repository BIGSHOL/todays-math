# -*- coding: utf-8 -*-
"""추출 대상 선별 — **완료본(원본) 한정** (D-38).

방침(2026-08-14 원장님 확정): 기출 추출은 워드본을 PDF로 변환한 `(완료)` 표기 파일에서만 한다.
근거는 `docs/planning/08-import-ledger.md` §5.1 (완료본은 텍스트 레이어가 살아 있어 OCR 훼손이
1/5 수준, 정답 결손도 절반).

우선순위:
  P1  `HWP 2 PDF` 경로의 `(완료).PDF`   — 최상 품질
  P2  그 밖의 `(완료).PDF`
  P3  `(완료).hwp/.hwpx`                — PDF 변환 후 처리
  제외 비완료·스캔 원본 (완료본이 아예 없는 시험지에 한해서만 예외 허용)

중복 제외:
  - exam_index.db 에 이미 문항이 추출된 시험지
  - scripts/qa/imported-files.txt 에 기록된 처리 완료 파일

입력 : scripts/qa/nfile-inventory.txt.gz (N드라이브 전수 목록 — 재스캔 금지)
출력 : scripts/qa/reports/extract-queue.json (경로 목록, 우선순위별)
LLM 토큰 0 — 로컬 문자열 대조뿐. 화면 출력은 요약 표만.

사용: python scripts/qa/select-final-sources.py
"""
import collections
import gzip
import json
import os
import sqlite3
import sys

import pathlib
import sys

sys.path.append(str(pathlib.Path(__file__).parent))
from tc_paths import exam_index_db  # noqa: E402

IDX = exam_index_db()
INVENTORY = "scripts/qa/nfile-inventory.txt.gz"
IMPORTED = "scripts/qa/imported-files.txt"
OUT = "scripts/qa/reports/extract-queue.json"

FINAL = "(완료)"
HWP2PDF = "HWP 2 PDF"
DOC_EXT = {".pdf", ".hwp", ".hwpx"}

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def norm(path: str) -> str:
    """`N:\\개인\\...` 와 `개인/...` 를 같은 키로 만든다."""
    p = path.replace("\\", "/").strip()
    low = p.lower()
    if low.startswith("n:/"):
        p = p[3:]
    return p.strip("/")


def priority(rel: str) -> str:
    ext = os.path.splitext(rel)[1].lower()
    if FINAL not in rel:
        return "SKIP"
    if ext == ".pdf":
        return "P1" if HWP2PDF in rel else "P2"
    if ext in {".hwp", ".hwpx"}:
        return "P3"
    return "SKIP"


# ── 이미 추출된 시험지 (exam_index 에 문항이 있는 것) ────────────────────────
extracted = set()
con = sqlite3.connect(IDX)
for src_path, n in con.execute(
    "select e.src_path, (select count(*) from questions q where q.exam_id=e.id)"
    " from exams e where e.src_path is not null"
):
    if n > 0:
        extracted.add(norm(src_path))

# ── 이미 이관 처리한 파일 ────────────────────────────────────────────────────
imported = set()
if os.path.exists(IMPORTED):
    with open(IMPORTED, encoding="utf-8") as fh:
        imported = {norm(line) for line in fh if line.strip()}

# ── 인벤토리 선별 ────────────────────────────────────────────────────────────
queue = collections.defaultdict(list)
stat = collections.Counter()

with gzip.open(INVENTORY, "rt", encoding="utf-8") as fh:
    for line in fh:
        rel = norm(line)
        if not rel:
            continue
        ext = os.path.splitext(rel)[1].lower()
        if ext not in DOC_EXT:
            stat["기타확장자"] += 1
            continue
        p = priority(rel)
        if p == "SKIP":
            stat["제외:비완료"] += 1
            continue
        if rel in extracted:
            stat["제외:추출완료"] += 1
            continue
        if rel in imported:
            stat["제외:이관완료"] += 1
            continue
        queue[p].append(rel)
        stat[p] += 1

# ── P3(hwp) 중 이미 PDF 변환본이 있는 것은 뺀다 ──────────────────────────────
# 08 §5 메모: `HWP 2 PDF` 에 변환본이 있는 hwp 를 다시 변환하면 순수 낭비다.
def stem(rel: str) -> str:
    return os.path.splitext(os.path.basename(rel))[0].strip().lower()


pdf_stems = {stem(r) for r in queue["P1"] + queue["P2"]}
pdf_stems |= {stem(r) for r in extracted if r.lower().endswith(".pdf")}
kept = [r for r in queue["P3"] if stem(r) not in pdf_stems]
stat["제외:PDF변환본존재"] = len(queue["P3"]) - len(kept)
queue["P3"] = kept

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(
        {
            "policy": "완료본(원본) 한정 — D-38",
            "generatedFrom": INVENTORY,
            "counts": {k: len(v) for k, v in sorted(queue.items())},
            "queue": {k: sorted(v) for k, v in sorted(queue.items())},
        },
        fh,
        ensure_ascii=False,
    )

LABEL = {
    "P1": "P1 HWP2PDF 완료.PDF",
    "P2": "P2 기타 완료.PDF   ",
    "P3": "P3 완료.hwp        ",
}
print("── 추출 대기열 (완료본 한정) ──")
for p in ("P1", "P2", "P3"):
    print("%s %6d" % (LABEL[p], len(queue[p])))
print("대기 합계          %6d" % sum(len(v) for v in queue.values()))
print()
print("제외 내역:", json.dumps(
    {k: v for k, v in stat.items() if k.startswith("제외") or k == "기타확장자"},
    ensure_ascii=False))
print("→", OUT)
