# -*- coding: utf-8 -*-
"""원본 시험지 첫 쪽의 **앞줄을 그대로 뜬다.** 해석은 하지 않는다.

## 왜 파일명이 아니라 문서를 읽나 (2026-08-18 실측)

파일명 `[강북고][1][공수2][25-2-중간대비]` 의 문서 제목은 **`2024년 2학기 중간고사`** 다.
「25년 … 대비」는 **모든 완료본에 찍히는 머리말**(그 시험지를 다음 해 대비용으로 쓴다는 뜻)
이고 실제 기출본에도 똑같이 있다. 144편의 파일명이 그 머리말의 연도를 집어 갔다.
파일명은 **파생물**이고 문서 제목이 정본이다(CLAUDE.md 2026-08-18 「파생물을 정본으로 읽으면」).

    1줄  2024년 2학기 중간고사           ← 시점. 「 대비」가 붙으면 그 편은 대비 시험지다
    2줄  강북고 1학년 수학               ← 학교·학년·과목
    3줄  학원 로고
    4줄  강북고 25년 2학기 중간고사 대비   ← 머리말. 연도가 **+1** 이다. 시점 근거로 쓰지 말 것

## 이 스크립트는 **해석하지 않는다**

줄을 읽는 쪽과 뜻을 정하는 쪽이 각자 규칙을 가지면 같이 눈이 먼다
(CLAUDE.md 2026-08-18 「목록을 손으로 쓰면」). 그래서 여기서는 `lines` 만 남기고,
연/학기/회차/대비 판정은 `src/lib/import/examIdentity.ts` **한 곳**이 한다.

## 사용

    PYTHONIOENCODING=utf-8 python scripts/qa/extract-exam-header.py [--limit N]

산출: scripts/qa/reports/exam-metadata/headers.jsonl (한 줄 = 한 편)
재실행이 곧 이어달리기다 — **줄을 실제로 읽은 편만** 건너뛴다. 「PDF 가 없어 못 읽음」은
다음 실행에서 다시 시도한다(쌍둥이 목록이 늘어날 수 있으므로).
N드라이브는 작업 도중 끊긴다(08 §7) — 끊기면 오류로 남고 다음 실행이 다시 집는다.
"""
import argparse
import json
import os
import sys
from pathlib import Path

OUT = Path("scripts/qa/reports/exam-metadata/headers.jsonl")
GROUPS = Path("scripts/qa/reports/exam-metadata/exam-groups.json")
TWINS = Path("scripts/qa/reports/exam-metadata/pdf-twins.json")
KEEP_LINES = 6


def read_lines(path: str) -> list[str]:
    import pymupdf

    doc = pymupdf.open(path)
    try:
        text = doc[0].get_text()
    finally:
        doc.close()
    return [ln.strip() for ln in text.split("\n") if ln.strip()][:KEEP_LINES]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    groups = json.loads(GROUPS.read_text(encoding="utf-8"))
    # 편 하나에 파일이 둘일 수 있다(hwp/PDF 짝) — PDF 를 고른다.
    best: dict[str, str] = {}
    for g in groups:
        p = g["sourceFile"]
        if not p:
            continue
        if g["examId"] not in best or p.lower().endswith(".pdf"):
            best[g["examId"]] = p

    # HWP 만 있는 편은 같은 이름의 PDF 변환본(08 §5.3)이 있으면 그것을 읽는다.
    twins: dict[str, str] = {}
    if TWINS.exists():
        twins = json.loads(TWINS.read_text(encoding="utf-8"))

    done: set[str] = set()
    if OUT.exists():
        for line in OUT.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            # 줄을 읽었거나, 읽었는데 글자가 없던 편(스캔본)은 «끝난 것»이다.
            if rec.get("lines") or rec.get("status") == "빈쪽":
                done.add(rec["examId"])

    todo = [(e, p) for e, p in sorted(best.items()) if e not in done]
    if args.limit:
        todo = todo[: args.limit]
    print(f"편 {len(best)} · 이미 읽음 {len(done)} · 이번에 {len(todo)}", flush=True)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    n_ok = n_none = n_err = 0
    with OUT.open("a", encoding="utf-8") as fh:
        for i, (eid, path) in enumerate(todo, 1):
            read_path = path if path.lower().endswith(".pdf") else twins.get(eid)
            rec: dict = {"examId": eid, "sourceFile": path, "readFrom": read_path}
            if not read_path:
                rec["status"] = "PDF없음"  # HWP 만 있고 변환본도 못 찾았다
                n_none += 1
            elif not os.path.exists(read_path):
                rec["status"] = "파일없음"
                n_err += 1
            else:
                try:
                    lines = read_lines(read_path)
                    rec["lines"] = lines
                    # 첫 쪽에 텍스트가 아예 없는 편(실측 54편) — 스캔본이라 글자층이 없다.
                    # 「아직 안 읽었다」와 구분해야 다음 실행이 영원히 다시 시도하지 않는다.
                    rec["status"] = "읽음" if lines else "빈쪽"
                    n_ok += 1 if lines else 0
                except Exception as exc:  # 파일 손상·마운트 끊김
                    rec["status"] = "오류"
                    rec["error"] = str(exc)[:200]
                    n_err += 1
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
            if i % 200 == 0:
                fh.flush()
                print(f"  {i}/{len(todo)} · 읽음 {n_ok} · PDF없음 {n_none} · 오류 {n_err}", flush=True)
    print(f"끝 — 읽음 {n_ok} · PDF없음 {n_none} · 오류 {n_err}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
