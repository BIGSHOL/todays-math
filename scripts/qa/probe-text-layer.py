# -*- coding: utf-8 -*-
"""완료본 PDF에 **텍스트 레이어**가 있는지 표본 조사한다 — 추출 비용을 가르는 결정적 사실.

워드(HWP)→PDF 변환본은 born-digital 이라 텍스트가 그대로 박혀 있다.
텍스트 레이어가 있으면 OCR(=API 과금)을 **한 번도 부르지 않고** 추출할 수 있다.
스캔본은 텍스트가 0자라 OCR 이 불가피하다.

사용: python scripts/qa/probe-text-layer.py [표본수]
"""
import json
import os
import random
import sys

import fitz  # PyMuPDF

QUEUE = "scripts/qa/reports/extract-queue.json"
ROOT = "N:\\"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 40

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

queue = json.load(open(QUEUE, encoding="utf-8"))["queue"]
random.seed(11)

for p in ("P1", "P2"):
    items = random.sample(queue[p], min(N, len(queue[p])))
    born, scan, err = 0, 0, 0
    chars, pages_total = [], 0
    for rel in items:
        path = ROOT + rel.replace("/", "\\")
        try:
            with fitz.open(path) as doc:
                n_pages = doc.page_count
                text = "".join(doc[i].get_text() for i in range(min(3, n_pages)))
        except Exception:
            err += 1
            continue
        per_page = len(text) / max(1, min(3, n_pages))
        pages_total += n_pages
        chars.append(per_page)
        if per_page >= 200:
            born += 1
        else:
            scan += 1
    ok = born + scan
    print(
        "%s 표본 %d  텍스트레이어 %d (%.0f%%)  스캔 %d  열기실패 %d  "
        "평균 %d자/쪽  평균 %.1f쪽"
        % (
            p,
            len(items),
            born,
            born * 100.0 / max(1, ok),
            scan,
            err,
            sum(chars) / max(1, len(chars)),
            pages_total / max(1, ok),
        )
    )
