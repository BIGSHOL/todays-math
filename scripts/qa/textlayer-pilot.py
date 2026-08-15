# -*- coding: utf-8 -*-
"""완료본 PDF → 문항 JSON 파일럿 — **LLM 토큰 0 · OCR API 0**.

testchanger 의 `db/textlayer.py` 를 그대로 부른다(재구현 금지). 그 모듈은
born-digital PDF 의 텍스트 레이어를 읽고, HWP 수식폰트의 사용자영역 코드(U+E0xx)를
`pua_table.json` 으로 되돌린 뒤, 글자 좌표·크기로 분수/첨자를 조립한다.

완료본은 전부 born-digital 이라(표본 80/80) 비전·OCR 이 아예 필요 없다 — D-37 방침의
품질 근거에 더해, **비용 근거**가 여기서 나온다.

사용: python scripts/qa/textlayer-pilot.py [건수]
출력: 요약 표 + 첫 편 발췌 (상세는 reports/textlayer-pilot.json)
"""
import json
import pathlib
import sys

sys.path.append(str(pathlib.Path(__file__).parent))
from tc_paths import testchanger_dir  # noqa: E402

TC = testchanger_dir()
sys.path.append(str(TC))
sys.path.append(str(TC / "db"))

import textlayer  # noqa: E402  (경로 주입 후에만 import 가능)

QUEUE = "scripts/qa/reports/extract-queue.json"
OUT = "scripts/qa/reports/textlayer-pilot.json"
ROOT = "N:\\"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 3

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

queue = json.load(open(QUEUE, encoding="utf-8"))["queue"]["P1"][:N]
results = []

print("파일                                        문항  정답  보기결손  수식  잔존PUA")
tot_q = tot_a = 0
for rel in queue:
    path = pathlib.Path(ROOT + rel.replace("/", "\\"))
    try:
        # 정답면도 같은 PDF 안에 있다 — 비전 없이 함께 걷는다.
        doc, answers = textlayer.extract(path, with_answers=True)
    except Exception as exc:  # noqa: BLE001 — 파일럿이라 원인만 본다
        print("%-44s 실패: %s" % (rel.split("/")[-1][:44], exc))
        continue
    qs = doc.get("questions") or []
    n_ans = sum(
        1 for q in qs if str((answers or {}).get(q.get("number"), "")).strip()
    )
    tot_q += len(qs)
    tot_a += n_ans
    text = json.dumps(doc, ensure_ascii=False)
    pua = sum(1 for c in text if 0xE000 <= ord(c) <= 0xF8FF)
    eq = text.count('"equation"')
    no_choice = sum(
        1 for q in qs if q.get("type") == "객관식" and len(q.get("choices") or []) < 4
    )
    print(
        "%-44s %4d %5d %8d %5d %8d"
        % (rel.split("/")[-1][:44], len(qs), n_ans, no_choice, eq, pua)
    )
    results.append(
        {
            "file": rel,
            "questions": len(qs),
            "answers": n_ans,
            "pua": pua,
            "doc": doc,
            "answerMap": answers,
        }
    )

json.dump(results, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
print(
    "\n합계 문항 %d · 정답 %d (%.1f%%)"
    % (tot_q, tot_a, tot_a * 100.0 / max(1, tot_q))
)

if results:
    print("\n── 첫 편 1~2번 문항 발췌 ──")
    for q in (results[0]["doc"].get("questions") or [])[:2]:
        print("#%s [%s점]" % (q.get("number"), q.get("score")))
        for b in q.get("contents") or []:
            print("   %s| %s" % (b["type"][:3], (b.get("value") or "")[:110]))
        for c in q.get("choices") or []:
            v = " ".join((b.get("value") or "") for b in c.get("contents") or [])
            print("   (%s) %s" % (c.get("number"), v[:80]))
print("\n→", OUT)
