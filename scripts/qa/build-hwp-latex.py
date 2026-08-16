# -*- coding: utf-8 -*-
"""트랙 D-3 (1/2) — HWP 산출물의 수식 스크립트를 **LaTeX 로 되돌린다**.

HWP 는 한글 수식 스크립트를 준다(`{1} over {2}`, `LEFT (`, `bar AB`, `SQRT`).
DB 는 KaTeX 가 읽는 `$...$` LaTeX 다. 그대로 넣으면 지면이 깨진다.

**변환기는 새로 만들지 않는다.** testchanger 에 `core/hwpeq_to_latex.py` 가 이미
있고 `latex_to_hwpeq` 와의 **왕복 일치**로 정합성을 재고 있다(그 파일 docstring).
`db/fill_answers.py` 가 완료본 HWP 에 같은 방식으로 쓰던 것을 그대로 따른다.

입력 : scripts/qa/reports/hwp/<examId>.json        (D-1 산출)
출력 : scripts/qa/reports/hwp-latex/<examId>.json  (수식만 LaTeX 로 치환)

사용: python scripts/qa/build-hwp-latex.py
"""
import argparse
import json
import pathlib
import re
import sys

sys.path.append(str(pathlib.Path(__file__).parent))
from tc_paths import testchanger_dir  # noqa: E402

TC = testchanger_dir()
sys.path.insert(0, str(TC))
from core.hwpeq_to_latex import hwpeq_to_latex  # noqa: E402
from hwpeq_unglue import postfix_latex, unglue  # noqa: E402
from hwp_text_clean import clean_exam  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SRC = pathlib.Path("scripts/qa/reports/hwp")
OUT = pathlib.Path("scripts/qa/reports/hwp-latex")

SPAN = re.compile(r"[$]([^$]+)[$]")


def conv(text):
    """`$...$` 안만 변환한다 — 바깥 한글 지문은 건드리지 않는다.

    변환 **전에** `unglue` 로 구조 키워드를 떼어낸다. 안 하면 `1over5x` 가 토크나이저에
    한 낱말로 삼켜져 날 문자열로 지면에 나간다(hwpeq_unglue.py 참조).
    """
    if not text:
        return text
    return SPAN.sub(
        lambda m: "$" + postfix_latex(hwpeq_to_latex(unglue(m.group(1)))) + "$", text
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="이미 만든 것도 다시 만든다")
    a = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    n = q = skipped = cleaned = 0
    for f in sorted(SRC.glob("*.json")):
        target = OUT / f.name
        if target.exists() and not a.force and target.stat().st_mtime >= f.stat().st_mtime:
            skipped += 1
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        # 트랙 E 발견 결함 — 수식 캡션의 base64 가 발문에 섞여 들어온다.
        cleaned += clean_exam(d)
        for item in d.get("questions") or []:
            item["stem"] = conv(item.get("stem"))
            item["choices"] = [conv(c) for c in (item.get("choices") or [])]
            item["solution"] = conv(item.get("solution"))
            q += 1
        target.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
        n += 1
    print("HWP→LaTeX 변환 %d편 (건너뜀 %d) · 문항 %d · base64 청소 %d문항 → %s"
          % (n, skipped, q, cleaned, OUT))


if __name__ == "__main__":
    main()
