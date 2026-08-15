# -*- coding: utf-8 -*-
"""전량 추출 전에 **1편당 소요 시간**을 잰다 — 전체 일정을 숫자로 잡기 위해.

PDF 본문(textlayer)과 HWP 정답(hwp_extract)을 각각 몇 편씩 돌려 중앙값을 낸다.
N: 는 네트워크 드라이브라 I/O 가 지배적이다.

사용: python scripts/qa/time-extract.py [편수]
"""
import json
import pathlib
import statistics
import subprocess
import sys
import tempfile
import time

sys.path.append(str(pathlib.Path(__file__).parent))
from tc_paths import testchanger_dir  # noqa: E402

TC = testchanger_dir()
sys.path.append(str(TC))
sys.path.append(str(TC / "db"))

import textlayer  # noqa: E402

PAIRS = "scripts/qa/reports/final-pairs.json"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 3

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

pairs = [
    p
    for p in json.load(open(PAIRS, encoding="utf-8"))["pairs"]
    if p["pdf"] and p["hwp"]
][:N]

pdf_t, hwp_t, q_pdf, q_hwp = [], [], 0, 0
tmp = pathlib.Path(tempfile.mkdtemp(prefix="time_"))

for i, p in enumerate(pairs):
    t0 = time.time()
    try:
        doc = textlayer.extract(pathlib.Path(p["pdf"]))
        q_pdf += len(doc.get("questions") or [])
        pdf_t.append(time.time() - t0)
    except Exception as exc:  # noqa: BLE001
        print("PDF 실패:", exc)

    out = tmp / f"{i}.json"
    t0 = time.time()
    r = subprocess.run(
        [sys.executable, "scripts/hwp_extract.py", p["hwp"], "-o", str(out)],
        cwd=str(TC),
        capture_output=True,
        timeout=600,
    )
    hwp_t.append(time.time() - t0)
    if out.exists():
        q_hwp += len(json.loads(out.read_text(encoding="utf-8"))["questions"])
    elif r.returncode:
        print("HWP 실패:", (r.stderr or b"").decode("utf-8", "replace")[:160])

print("표본 %d편" % len(pairs))
print("PDF 본문  중앙 %.1fs  합계 %.0fs  문항 %d" % (
    statistics.median(pdf_t or [0]), sum(pdf_t), q_pdf))
print("HWP 정답  중앙 %.1fs  합계 %.0fs  문항 %d" % (
    statistics.median(hwp_t or [0]), sum(hwp_t), q_hwp))
per = statistics.median(pdf_t or [0]) + statistics.median(hwp_t or [0])
print("1편당 %.1fs → 2,257편 단일 프로세스 %.1f시간" % (per, per * 2257 / 3600))
