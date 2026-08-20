# -*- coding: utf-8 -*-
"""개념 3-1 진도북에서 합격 표본·이전 무작위 40을 뺀 다음 20.

공유 DB 에 쓰지 않는다. 원장님이 2026-08-21 무작위 추가를 멈추셨다 —
이 스크립트를 다시 돌려 20을 더 고르지 말 것 (08 §5.5, 10 §9).
EXCLUDE 가 원장이다. SEED 를 바꾸면 지금 화면(`random20.ts`)과 갈린다.
"""
from __future__ import annotations

import json
import random
import re
from collections import Counter
from pathlib import Path

SRC = Path("scripts/qa/reports/cube-probe/jindo31-items.json")
OUT_TS = Path("src/app/dev/cube-scrape/random20.ts")
SEED = 20260823

EXCLUDE = {
    # 합격 표본 16
    "cube-concept-3-1-p149-q04",
    "cube-concept-3-1-p029-q14",
    "cube-concept-3-1-p030-q16",
    "cube-concept-3-1-p024-q03",
    "cube-concept-3-1-p028-q04",
    "cube-concept-3-1-p028-q05",
    "cube-concept-3-1-p024-q02",
    "cube-concept-3-1-p149-q01",
    "cube-concept-3-1-p028-q01",
    "cube-concept-3-1-p024-q04",
    "cube-concept-3-1-p024-q05",
    "cube-concept-3-1-p029-q10",
    "cube-concept-3-1-p029-q12",
    "cube-concept-3-1-p149-q03",
    "cube-concept-3-1-p149-q07",
    "cube-concept-3-1-p024-q01",
    # 이전 무작위 20
    "cube-concept-3-1-p029-q08",
    "cube-concept-3-1-p030-q20",
    "cube-concept-3-1-p050-q01",
    "cube-concept-3-1-p050-q03",
    "cube-concept-3-1-p065-q09",
    "cube-concept-3-1-p065-q11",
    "cube-concept-3-1-p066-q39",
    "cube-concept-3-1-p067-q2",
    "cube-concept-3-1-p068-q08",
    "cube-concept-3-1-p087-q09",
    "cube-concept-3-1-p089-q2",
    "cube-concept-3-1-p091-q25",
    "cube-concept-3-1-p111-q11",
    "cube-concept-3-1-p116-q18",
    "cube-concept-3-1-p141-q15",
    "cube-concept-3-1-p141-q17",
    "cube-concept-3-1-p143-q3",
    "cube-concept-3-1-p151-q20",
    "cube-concept-3-1-p151-q23",
    "cube-concept-3-1-p152-q24",
    # 2차 무작위 20
    "cube-concept-3-1-p024-q06",
    "cube-concept-3-1-p025-q11",
    "cube-concept-3-1-p028-q06",
    "cube-concept-3-1-p046-q06",
    "cube-concept-3-1-p047-q07",
    "cube-concept-3-1-p048-q17",
    "cube-concept-3-1-p064-q06",
    "cube-concept-3-1-p066-q37",
    "cube-concept-3-1-p070-q20",
    "cube-concept-3-1-p110-q80",
    "cube-concept-3-1-p111-q07",
    "cube-concept-3-1-p112-q13",
    "cube-concept-3-1-p115-q09",
    "cube-concept-3-1-p116-q17",
    "cube-concept-3-1-p139-q02",
    "cube-concept-3-1-p140-q11",
    "cube-concept-3-1-p142-q23",
    "cube-concept-3-1-p143-q2",
    "cube-concept-3-1-p146-q18",
    "cube-concept-3-1-p150-q12",
}

GENRE = {
    "단원마무리": "단원 마무리",
    "평가": "평가",
    "수학익힘": "수학 익힘",
}


CHROME_LINE = re.compile(
    r"^(?:문제|강의|서술형|풀이|답|이유|생각\s*문제|익힘책 공통|"
    r"교과서 공통|잘 틀리는 문제|정답\s*\$?\d+\$?\s*쪽|"
    r"\d+\s*단원\s*\|?\s*개념\d*|"
    r"\$?\d+\$?쪽 개념\d*|매칭북 .+더 연습|"
    r"수학 3[－\-]\s*1|단원\d+|정답\s*\$?\d+\$?쪽)\s*$"
)


def clean(raw: str) -> str:
    chars = []
    for ch in raw:
        o = ord(ch)
        if o == 0x96:
            chars.append("÷")
        elif ch == "@":
            chars.append("×")
        elif o == 0x7F:
            chars.append(".")
        elif ch in "\n\t" or o >= 32:
            chars.append(ch)
    text = "".join(chars)
    text = text.replace("DN", "cm").replace("NN", "mm")
    text = text.replace("⇁", "□")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    text = re.sub(r"^(?:0[1-9]|[1-9]\d?)\s+", "", text.strip())
    text = re.sub(r"(\d+)[ \t]*×[ \t]*(\d+)(?:[ \t]*=[ \t]*(\d+))?", _times, text)
    text = re.sub(r"(\d+)[ \t]*÷[ \t]*(\d+)(?:[ \t]*=[ \t]*(\d+))?", _div, text)
    text = re.sub(r"(\d+)[ \t]*÷[ \t]*=", r"$\1 \\div $", text)
    lines = [ln for ln in text.splitlines() if not CHROME_LINE.match(ln.strip())]
    text = "\n".join(lines)
    text = wrap_text_numbers(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return text.strip()


def wrap_text_numbers(text: str) -> str:
    parts = text.split("$")
    for i in range(0, len(parts), 2):
        parts[i] = re.sub(
            r"(?<!\d)(\d+\.\d+|\d{1,4})(?!\d)", r"$\1$", parts[i]
        )
    return "$".join(parts)


def _times(m: re.Match[str]) -> str:
    a, b, c = m.group(1), m.group(2), m.group(3)
    return f"${a} \\times {b}={c}$" if c else f"${a} \\times {b}$"


def _div(m: re.Match[str]) -> str:
    a, b, c = m.group(1), m.group(2), m.group(3)
    return f"${a} \\div {b}={c}$" if c else f"${a} \\div {b}$"


def title(it: dict) -> str:
    flags = it.get("flags") or []
    if "문장제" in flags:
        return "문장제"
    if "그림필요" in flags:
        return "그림 필요"
    return "계산"


def main() -> None:
    data = json.loads(SRC.read_text(encoding="utf-8"))
    exclude = set(EXCLUDE)
    for eid in list(EXCLUDE):
        exclude.add(eid.replace("-q0", "-q"))
    pool = []
    for it in data["items"]:
        if it["genre"] not in GENRE:
            continue
        flags = it.get("flags") or []
        if "그리기" in flags or "선잇기" in flags:
            continue
        if it["id"] in exclude:
            continue
        compact = re.sub(r"\s+", "", it["content"])
        if len(compact) < 20:
            continue
        pool.append(it)

    rng = random.Random(SEED)
    chosen = rng.sample(pool, 20)
    chosen.sort(key=lambda x: (x["page"], str(x["number"]).zfill(2)))

    print("pool", len(pool), dict(Counter(x["genre"] for x in pool)))
    print("pick genre", dict(Counter(x["genre"] for x in chosen)))
    print(
        "문장제",
        sum(1 for x in chosen if "문장제" in (x.get("flags") or [])),
        "그림필요",
        sum(1 for x in chosen if "그림필요" in (x.get("flags") or [])),
    )
    for it in chosen:
        body = " / ".join(
            ln.strip() for ln in it["content"].splitlines() if ln.strip()
        )[:140]
        print(f"{it['id']} [{it['genre']}] {it.get('flags')}")
        print(" ", body)

    lines = [
        'import type { CubeScrapeItem } from "./fixtures";',
        "",
        f"/** 개념 3-1 진도북 무작위 20. seed={SEED}. 합격 16·이전 무작위 40은 빠졌다. */",
        "export const CUBE_RANDOM_20: CubeScrapeItem[] = [",
    ]
    for it in chosen:
        rec = {
            "id": it["id"],
            "genre": GENRE[it["genre"]],
            "page": it["page"],
            "title": title(it),
            "content": clean(it["content"]),
        }
        dumped = json.dumps(rec, ensure_ascii=False, indent=2)
        dumped = dumped.replace("\n", "\n  ")
        lines.append(f"  {dumped},")
    lines.append("];")
    lines.append("")
    OUT_TS.write_text("\n".join(lines), encoding="utf-8")
    print("wrote", OUT_TS)


if __name__ == "__main__":
    main()
