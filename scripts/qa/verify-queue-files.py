# -*- coding: utf-8 -*-
"""추출 대기열 파일이 N드라이브에 실제로 있는지 확인한다.

N: 는 네이버 MYBOX 네트워크 드라이브라 stat 가 느리다. 기본은 표본 확인,
`--all` 이면 전수 확인 후 결과를 파일로 남긴다(화면 출력은 요약만).

사용: python scripts/qa/verify-queue-files.py [--all]
"""
import json
import os
import random
import sys
import time

QUEUE = "scripts/qa/reports/extract-queue.json"
OUT = "scripts/qa/reports/queue-missing.json"
ROOT = "N:\\"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ALL = "--all" in sys.argv
SAMPLE = 60


def abspath(rel: str) -> str:
    return ROOT + rel.replace("/", "\\")


queue = json.load(open(QUEUE, encoding="utf-8"))["queue"]
missing = {}

print("── 대기열 파일 존재 확인 (%s) ──" % ("전수" if ALL else "표본 %d" % SAMPLE))
random.seed(7)
for p in ("P1", "P2", "P3"):
    items = queue.get(p, [])
    targets = items if ALL else random.sample(items, min(SAMPLE, len(items)))
    t0 = time.time()
    gone = [r for r in targets if not os.path.exists(abspath(r))]
    print(
        "%s  대상 %5d  존재 %5d  없음 %4d  (%.1fs)"
        % (p, len(targets), len(targets) - len(gone), len(gone), time.time() - t0)
    )
    for r in gone[:2]:
        print("    없음 예:", r)
    if gone:
        missing[p] = gone

if ALL:
    json.dump(missing, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print("→", OUT)
