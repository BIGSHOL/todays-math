# -*- coding: utf-8 -*-
"""우리 DB의 기출 문항 → testchanger exam_index.db 역추적 (원본 시험지 복원).

사용:
  node scripts/qa/dump-pastexam.mjs      # DB에서 기출 본문 덤프
  python scripts/qa/trace-source.py      # 인덱스 대조 → reports/source-map.json

실측(2026-08-14): 훼손 기출 123건 중 112건(91.1%) 역추적 성공,
전체 기출 3,569건 중 2,301건 매칭, 그중 원본 정답 보유 1,480건.

LLM 토큰 0 — 전부 로컬 문자열 대조다.
매칭되면 exam_id/문항번호/학교/연도/원본경로(src_path)를 복원할 수 있다.
"""
import json, re, sqlite3, sys, unicodedata

import pathlib
import sys

sys.path.append(str(pathlib.Path(__file__).parent))
from tc_paths import exam_index_db  # noqa: E402

IDX = exam_index_db()
IN = "scripts/qa/reports/pastexam-dump.json"

def sig(s: str) -> str:
    """LaTeX·공백·구두점을 걷어낸 비교용 서명. 한글/영숫자만 남긴다."""
    s = unicodedata.normalize("NFKC", s or "")
    s = re.sub(r"\\[a-zA-Z]+", " ", s)          # \frac, \sqrt ...
    s = re.sub(r"[${}\\_^~,.·、，\s\[\]()]", "", s)
    s = re.sub(r"[^0-9A-Za-z가-힣+\-=<>≤≥×÷]", "", s)
    return s

def q_text(oj: dict) -> str:
    parts = []
    for b in (oj.get("contents") or []):
        v = b.get("value")
        if v: parts.append(str(v))
    for ch in (oj.get("choices") or []):
        for b in (ch.get("contents") or []):
            v = b.get("value")
            if v: parts.append(str(v))
    return "".join(parts)

data = json.load(open(IN, encoding="utf-8"))
con = sqlite3.connect(IDX)

# 인덱스 서명 → (exam_id, number)
index = {}
prefix_index = {}
n_q = 0
for qid, exam_id, number, oj in con.execute(
        "select id, exam_id, number, ocr_json from questions where ocr_json is not null"):
    try:
        o = json.loads(oj)
    except Exception:
        continue
    t = sig(q_text(o))
    if len(t) < 12:
        continue
    n_q += 1
    index.setdefault(t, (exam_id, number))
    prefix_index.setdefault(t[:40], (exam_id, number))

def match(items):
    exact = pref = miss = 0
    hits = []
    for it in items:
        s = sig(it["content"])
        if s in index:
            exact += 1; hits.append((it["id"], index[s]))
        elif len(s) >= 40 and s[:40] in prefix_index:
            pref += 1; hits.append((it["id"], prefix_index[s[:40]]))
        else:
            miss += 1
    return exact, pref, miss, hits

ea, pa, ma, hits_all = match(data["all"])
ed, pd, md, hits_dmg = match(data["damaged"])

print("index questions with signature:", n_q)
print("ALL past_exam    : total=%d exact=%d prefix=%d miss=%d  (recovered %.1f%%)"
      % (len(data["all"]), ea, pa, ma, (ea+pa)*100.0/max(1,len(data["all"]))))
print("DAMAGED past_exam: total=%d exact=%d prefix=%d miss=%d  (recovered %.1f%%)"
      % (len(data["damaged"]), ed, pd, md, (ed+pd)*100.0/max(1,len(data["damaged"]))))

# 복원 가능한 메타데이터 샘플 (원본 경로 포함) — 3건만
print("\n-- sample recovered metadata --")
for pid, (exam_id, number) in hits_dmg[:3]:
    row = con.execute(
        "select school, grade, subject, year, semester, round, src_path from exams where id=?",
        (exam_id,)).fetchone()
    print(json.dumps({"problem": pid[:8], "exam_id": exam_id, "q_no": number,
                      "school": row[0], "grade": row[1], "subject": row[2],
                      "year": row[3], "semester": row[4], "round": row[5],
                      "src_path": row[6]}, ensure_ascii=False))

json.dump([{"problemId": p, "examId": e, "questionNumber": n} for p, (e, n) in hits_all],
          open("scripts/qa/reports/source-map.json", "w", encoding="utf-8"), ensure_ascii=False)
print("\nwrote _match_out.json:", len(hits_all))
