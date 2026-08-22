# -*- coding: utf-8 -*-
"""개념 진도북 3-1~6-2 차례 + 표본 유형. 공유 DB 금지. 한컴 COM 금지."""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(r"N:\개인\강아\교재자료\큐브수학 개념")
OUT = Path("scripts/qa/reports/cube-probe/cube-units-by-grade.json")
EHSANG = {i: str(i - 0x11) for i in range(0x11, 0x1B)}
GLYPH = {
    **EHSANG,
    0x1E: "=",
    0x1F: "<",
    0x1D: ">",
    0x0E: "-",
    0x0C: "+",
    0x40: "×",
    0x96: "÷",
}


def decode(s: str) -> str:
    return "".join(GLYPH.get(ord(c), c) for c in s)


CONCEPT_JINDO = [
    ROOT / "큐브수학 개념" / "진도북" / f"큐브수학 개념 {g}_진도북.pdf"
    for g in ("3-1", "3-2", "4-1", "4-2", "5-1", "5-2", "6-1", "6-2")
]
EXTRA = [
    ("응용-3-1", ROOT / "큐브수학 개념응용" / "진도북" / "큐브수학 개념응용 3-1 진도북.pdf"),
    ("응용-6-1", ROOT / "큐브수학 개념응용" / "진도북" / "큐브수학 개념응용 6-1 진도북.pdf"),
    ("응용강화-6-1", ROOT / "큐브수학 개념응용" / "응용강화북" / "큐브수학 개념응용 6-1 응용강화북.pdf"),
    ("실력-3-1", ROOT / "큐브수학 실력" / "3-1 큐브실력" / "큐브수학 실력 3-1_진도북.pdf"),
    ("실력-5-1", ROOT / "큐브수학 실력" / "5-1 큐브실력" / "큐브수학 실력 5-1_진도북.pdf"),
    ("실력-6-1", ROOT / "큐브수학 실력" / "6-1 큐브실력" / "큐브수학 실력 6-1_진도북.pdf"),
    ("실력-6-2", ROOT / "큐브수학 실력" / "6-2 큐브실력" / "큐브수학 실력 6-2_진도북.pdf"),
]

# 문항 유형 — 키워드가 겹치면 둘 다 센다. 분모는 쪽이 아니라 쪽 안 발문.
TYPE_MARKERS: list[tuple[str, re.Pattern[str]]] = [
    ("세로셈·빈칸연산", re.compile(r"빈칸에 알맞은|알맞은 수를 써넣|세로셈|계산하세요")),
    ("분수·소수", re.compile(r"분수|소수|색칠한")),
    ("시계·시간", re.compile(r"시계|시\s*분|몇 시|경과")),
    ("길이·들이·무게", re.compile(r"길이|들이|무게|몇\s*cm|몇\s*km|몇\s*m|몇\s*L|몇\s*kg")),
    ("각도·평면도형", re.compile(r"각|직각|평행|수직|삼각형|사각형|원|사다리꼴|마름모")),
    ("넓이·둘레", re.compile(r"넓이|둘레")),
    ("부피·들이상자", re.compile(r"부피")),
    ("직육면체·전개도", re.compile(r"직육면체|정육면체|전개도")),
    ("원기둥·원뿔·구", re.compile(r"원기둥|원뿔|구")),
    ("비·비율·백분율", re.compile(r"비율|백분율|프로|비례식|비의 값")),
    ("속력·거리·시간", re.compile(r"속력|시속|분속")),
    ("그래프·자료", re.compile(r"꺾은선|막대그래프|그림그래프|띠그래프|원그래프|줄기와 잎")),
    ("경우의수·확률", re.compile(r"경우의 수|확률")),
    ("비례배분·연비", re.compile(r"연비|비례배분")),
    ("그리기·잇기", re.compile(r"그리세요|이으|점 찍|자를 대|재어")),
    ("문장제·서술", re.compile(r"구하세요|풀이 과정을 쓰고")),
]


def toc_blob(doc: pymupdf.Document) -> str:
    parts = []
    for i in range(min(6, doc.page_count)):
        parts.append(decode(doc[i].get_text() or ""))
    return "\n".join(parts)


def units_from_toc(text: str) -> list[str]:
    units: list[str] = []
    # 차례: "1. 덧셈과 뺄셈" 또는 "01 덧셈과 뺄셈"
    for m in re.finditer(
        r"(?m)(?:^|\n)\s*(?:0?([1-9])|[①-⑩])[\.\s]+([가-힣][가-힣·와과및, ]{1,24})",
        text,
    ):
        title = re.sub(r"\s+", " ", m.group(2)).strip(" ·")
        if any(x in title for x in ("하세요", "구하기", "써넣", "알아보", "확인", "기본", "실력", "개념")):
            continue
        if len(title) < 2:
            continue
        line = f"{m.group(1) or '?'}. {title}"
        if line not in units:
            units.append(line)
    # 보조: "단원 N" 줄
    for m in re.finditer(r"단원\s*(\d)\s*([가-힣][가-힣·와과 ]{1,20})", text):
        line = f"{m.group(1)}. {m.group(2).strip()}"
        if line not in units:
            units.append(line)
    return units[:12]


def sample_pages(doc: pymupdf.Document) -> list[dict]:
    n = doc.page_count
    # 앞(개념)·중(기본)·뒤(응용/확인) 골고루
    targets = sorted({max(1, min(n, n * k // 8)) for k in range(1, 8)})
    out = []
    for pno in targets:
        raw = decode(doc[pno - 1].get_text() or "")
        compact = re.sub(r"\s+", " ", raw)
        hits = [name for name, pat in TYPE_MARKERS if pat.search(compact)]
        # 발문 한 줄
        stem = None
        m = re.search(
            r".{0,12}(구하세요|써넣으세요|색칠|그리세요|넓이|부피|원주|비례|속력|몇 시).{0,48}",
            compact,
        )
        if m:
            stem = m.group(0)[:90]
        else:
            stem = compact[40:130]
        out.append({"page": pno, "types": hits, "stem": stem})
    return out


def type_census(samples: list[dict]) -> dict[str, int]:
    c: Counter[str] = Counter()
    for s in samples:
        for t in s["types"]:
            c[t] += 1
    return dict(c)


def inspect(key: str, path: Path) -> dict:
    if not path.exists():
        print("missing", key, path)
        return {"missing": True, "file": path.name}
    doc = pymupdf.open(path)
    toc = toc_blob(doc)
    rec = {
        "file": path.name,
        "pages": doc.page_count,
        "units": units_from_toc(toc),
        "tocSnippet": re.sub(r"\s+", " ", toc)[:500],
        "samples": sample_pages(doc),
    }
    rec["typeHits"] = type_census(rec["samples"])
    print(key, rec["pages"], rec["units"])
    for s in rec["samples"]:
        print(f"  p{s['page']:03d} {s['types'][:4]} | {s['stem'][:70]}")
    doc.close()
    return rec


def main() -> None:
    report: dict = {"conceptJindo": {}, "extra": {}}
    for path in CONCEPT_JINDO:
        g = re.search(r"(\d-\d)", path.name)
        key = f"개념-{g.group(1)}" if g else path.stem
        report["conceptJindo"][key] = inspect(key, path)
    for key, path in EXTRA:
        report["extra"][key] = inspect(key, path)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
