# -*- coding: utf-8 -*-
"""B단계 추출 전에 **소단원 태그가 있는 구간**을 층화 표본으로 찾는다.

문제(2026-08-15 실측): 완료 HWP 의 `[소단원]` 태그 유무가 구간마다 갈린다.
  offset 0   구간 → 소단원 0.0%
  offset 900 구간 → 소단원 70.6%
소단원이 없으면 단원 분류가 안 돼 적재되지 않는다. 2,257편을 무작정 돌리면
상당수가 헛일이다.

그래서 원본 폴더별로 몇 편씩만 뽑아 소단원 보유율을 재고, **높은 폴더부터** 돌린다.
표본 추출은 편당 4.5초라 60편이면 5분이면 끝난다.

사용: python scripts/qa/survey-topic-coverage.py [폴더당표본수]
출력: 폴더별 소단원·정답 보유율 표 + reports/topic-coverage.json
"""
import collections
import importlib.util
import json
import pathlib
import random
import sys
import tempfile
import time

HERE = pathlib.Path(__file__).parent
sys.path.append(str(HERE))
from tc_paths import testchanger_dir  # noqa: E402

TC = testchanger_dir()
sys.path.append(str(TC))
sys.path.append(str(TC / "db"))

# 하이픈 파일명이라 일반 import 가 안 된다 — 경로로 읽는다.
spec = importlib.util.spec_from_file_location("efb", HERE / "extract-final-batch.py")
efb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(efb)

PAIRS = "scripts/qa/reports/final-pairs.json"
OUT = "scripts/qa/reports/topic-coverage.json"
PER_GROUP = int(sys.argv[1]) if len(sys.argv) > 1 else 4

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def group_of(hwp: str) -> str:
    """원본 경로에서 묶음 이름 — `개인/기출/<이것>/<저것>/…`"""
    parts = hwp.replace("/", "\\").split("\\")
    try:
        i = parts.index("기출")
    except ValueError:
        i = 1
    return "/".join(parts[i + 1 : i + 3])


pairs = [
    p
    for p in json.load(open(PAIRS, encoding="utf-8"))["pairs"]
    if p["pdf"] and p["hwp"]
]
groups: dict[str, list] = collections.defaultdict(list)
for p in pairs:
    groups[group_of(p["hwp"])].append(p)

print("페어 %d편 · 폴더 묶음 %d개 · 묶음당 표본 %d" % (len(pairs), len(groups), PER_GROUP))

random.seed(5)
work = pathlib.Path(tempfile.mkdtemp(prefix="tc_"))
rows = []
t0 = time.time()

for name, items in sorted(groups.items(), key=lambda kv: -len(kv[1])):
    sample = random.sample(items, min(PER_GROUP, len(items)))
    q = topic = ans = 0
    fail = 0
    for p in sample:
        try:
            answers = efb.hwp_answers(p["hwp"], work)
        except Exception:  # noqa: BLE001
            fail += 1
            continue
        q += len(answers)
        topic += sum(1 for a in answers if a.get("topic"))
        ans += sum(1 for a in answers if a.get("answer"))
    rows.append(
        {
            "group": name,
            "exams": len(items),
            "sampled": len(sample),
            "questions": q,
            "topicPct": round(topic * 100.0 / max(1, q), 1),
            "answerPct": round(ans * 100.0 / max(1, q), 1),
            "failed": fail,
        }
    )

rows.sort(key=lambda r: (-r["topicPct"], -r["exams"]))
pathlib.Path(OUT).write_text(
    json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8"
)

print("\n소단원  정답   편수  표본문항  폴더")
for r in rows:
    print(
        "%5.1f%% %5.1f%% %5d %8d  %s%s"
        % (
            r["topicPct"],
            r["answerPct"],
            r["exams"],
            r["questions"],
            r["group"][:48],
            f"  (실패 {r['failed']})" if r["failed"] else "",
        )
    )
good = sum(r["exams"] for r in rows if r["topicPct"] >= 50)
print("\n소단원 50%↑ 묶음의 시험지 합계: %d편 / %d편" % (good, len(pairs)))
print("%.0fs → %s" % (time.time() - t0, OUT))
