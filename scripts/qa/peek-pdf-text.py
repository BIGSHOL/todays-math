# -*- coding: utf-8 -*-
"""완료본 PDF 텍스트 레이어의 실제 품질을 눈으로 본다(발췌만).

수식이 어떤 형태로 박혀 있는지가 관건이다. HWP 수식 객체가 PDF 로 갈 때
(a) 유니코드 텍스트로 남는지 (b) 심볼 폰트로 깨지는지 (c) 벡터 그림이 되어 사라지는지에 따라
추출 전략이 갈린다.

사용: python scripts/qa/peek-pdf-text.py [대기열인덱스] [줄수]
"""
import json
import sys

import fitz

QUEUE = "scripts/qa/reports/extract-queue.json"
ROOT = "N:\\"
IDX = int(sys.argv[1]) if len(sys.argv) > 1 else 0
LINES = int(sys.argv[2]) if len(sys.argv) > 2 else 40

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

rel = json.load(open(QUEUE, encoding="utf-8"))["queue"]["P1"][IDX]
print("파일:", rel)
with fitz.open(ROOT + rel.replace("/", "\\")) as doc:
    print("쪽수:", doc.page_count)
    text = doc[0].get_text()
    n_img = len(doc[0].get_images())
    n_draw = len(doc[0].get_drawings())
    print("1쪽 이미지 %d개 · 벡터드로잉 %d개" % (n_img, n_draw))
    print("── 1쪽 텍스트 발췌 ──")
    for line in text.splitlines()[:LINES]:
        print(repr(line))
