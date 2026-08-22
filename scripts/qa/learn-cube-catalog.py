# -*- coding: utf-8 -*-
"""큐브 폴더 목록 + 학년별 단원·문항 유형 표본. 공유 DB 금지. 한컴 COM 금지."""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(r"N:\개인\강아\교재자료\큐브수학 개념")
OUT = Path("scripts/qa/reports/cube-probe")

EHSANG = {i: str(i - 0x11) for i in range(0x11, 0x1B)}
GLYPH = {**EHSANG, 0x1E: "=", 0x1F: "<", 0x1D: ">", 0x0E: "-", 0x0C: "+", 0x40: "×", 0x96: "÷"}


def decode(s: str) -> str:
    return "".join(GLYPH.get(ord(c), c) for c in s)


def classify_rel(rel: str) -> dict:
    s = rel.replace("\\", "/")
    series = "기타"
    if "개념응용" in s:
        series = "개념응용"
    elif "실력" in s:
        series = "실력"
    elif "개념" in s:
        series = "개념"
    kind = "기타"
    name = Path(s).name
    if "정답" in name or "해설" in name:
        kind = "정답"
    elif "매칭" in name:
        kind = "매칭북"
    elif "응용강화" in name:
        kind = "응용강화북"
    elif "진도" in name:
        kind = "진도북"
    elif name.lower().endswith(".hwp") or name.lower().endswith(".hwpx"):
        kind = "hwp"
    elif name.lower().endswith(".zip"):
        kind = "zip"
    g = re.search(r"([3-6])-([12])", name) or re.search(r"([3-6])-([12])", s)
    grade = f"초{g.group(1)}-{g.group(2)}" if g else "?"
    return {"series": series, "kind": kind, "grade": grade, "name": name, "rel": s}


def list_files() -> list[dict]:
    rows = []
    for p in ROOT.rglob("*"):
        if not p.is_file():
            continue
        rel = str(p.relative_to(ROOT))
        if any(x in rel.lower() for x in [".ds_store", "thumbs.db"]):
            continue
        meta = classify_rel(rel)
        meta["bytes"] = p.stat().st_size
        meta["ext"] = p.suffix.lower()
        if p.suffix.lower() == ".pdf":
            try:
                doc = pymupdf.open(p)
                meta["pages"] = doc.page_count
                doc.close()
            except Exception as e:
                meta["pages"] = None
                meta["error"] = type(e).__name__
        rows.append(meta)
    rows.sort(key=lambda r: (r["series"], r["grade"], r["kind"], r["name"]))
    return rows


def toc_from_jindo(path: Path, max_page: int = 6) -> list[str]:
    doc = pymupdf.open(path)
    units = []
    for i in range(min(max_page, doc.page_count)):
        t = decode(doc[i].get_text() or "")
        if "차례" not in t and i > 0:
            continue
        for m in re.finditer(r"(\d)\.\s*([가-힣][가-힣·와과 ]{1,16})", t):
            title = m.group(0).strip()
            if "하세요" in title or "구하기" in title:
                continue
            if title not in units:
                units.append(title)
    # also scan headers of later pages
    seen = set(units)
    for i in range(6, min(doc.page_count, 160), max(1, doc.page_count // 12)):
        t = decode(doc[i].get_text() or "")[:400]
        m = re.search(r"(\d)\.\s*([가-힣]{2,12})", t)
        if m and "하세요" not in m.group(2):
            title = f"{m.group(1)}. {m.group(2).strip()}"
            if title not in seen:
                units.append(title)
                seen.add(title)
    doc.close()
    return units


STEM_MARKERS = [
    ("분수", r"분수|소수|약분|통분|대분수"),
    ("비와비율", r"비\b|비율|백분율|%|비례"),
    ("넓이부피", r"넓이|부피|겉넓이|들이"),
    ("원기둥원뿔", r"원기둥|원뿔|구\b|전개도"),
    ("각기둥", r"각기둥|각뿔|쌓기나무|겨냥도"),
    ("합동대칭", r"합동|대칭|대응"),
    ("원", r"원주|지름|반지름|부채꼴|중심각"),
    ("속도", r"속력|거리|시간"),
    ("분수나눗셈", r"나눗셈|÷|몫"),
    ("곱셈", r"곱셈|×"),
    ("소수", r"소수"),
    ("도형", r"삼각형|사각형|각도|수직|평행"),
    ("시계", r"시\s*\d|시각|몇 시"),
    ("길이", r"cm|km|mm|길이"),
    ("문장제", r"구하세요|몇 (개|명|L)"),
]


def sample_stems(path: Path, pages: list[int]) -> dict:
    doc = pymupdf.open(path)
    hits: Counter[str] = Counter()
    snippets = []
    for pno in pages:
        if pno < 1 or pno > doc.page_count:
            continue
        t = decode(doc[pno - 1].get_text() or "")
        compact = re.sub(r"\s+", " ", t)
        for name, pat in STEM_MARKERS:
            if re.search(pat, compact):
                hits[name] += 1
        # keep a short problem-like line
        for ln in t.splitlines():
            s = ln.strip()
            if len(s) >= 18 and re.search(r"구하세요|써넣으세요|알아보세요|색칠", s):
                snippets.append({"page": pno, "line": re.sub(r"\s+", " ", s)[:90]})
                break
    doc.close()
    return {"markers": dict(hits), "snippets": snippets[:8], "pages": doc_page_safe(path)}


def doc_page_safe(path: Path) -> int:
    try:
        d = pymupdf.open(path)
        n = d.page_count
        d.close()
        return n
    except Exception:
        return 0


SAMPLES = [
    ("개념", "3-1", "진도북", "큐브수학 개념/진도북/큐브수학 개념 3-1_진도북.pdf", [9, 25, 28, 69, 113, 145, 152]),
    ("개념", "4-1", "진도북", None, [20, 50, 90, 140]),
    ("개념", "5-1", "진도북", None, [20, 50, 90, 140]),
    ("개념", "6-1", "진도북", None, [20, 50, 90, 140]),
    ("개념응용", "5-2", "응용강화북", "큐브수학 개념응용/응용강화북/큐브수학 개념응용 5-2 응용강화북.pdf", [1, 8, 16, 24]),
    ("실력", "6-1", "진도북", None, [20, 80, 140]),
]


def find_pdf(rows: list[dict], series: str, grade: str, kind: str) -> Path | None:
    for r in rows:
        if r["series"] == series and r["grade"] == grade and r["kind"] == kind and r.get("ext") == ".pdf":
            return ROOT / r["rel"]
    return None


def main() -> None:
    rows = list_files()
    pdfs = [r for r in rows if r.get("ext") == ".pdf"]
    by = Counter((r["series"], r["kind"]) for r in pdfs)
    print("PDF", len(pdfs), "/", len(rows), "files")
    for k, v in sorted(by.items()):
        print(" ", k, v)

    catalog = []
    for r in pdfs:
        catalog.append({k: r[k] for k in ("series", "kind", "grade", "pages", "bytes", "name", "rel")})
        print(f"{r['grade']:6} {r['series']:8} {r['kind']:10} p={str(r.get('pages')):4} {r['name']}")

    grade_units = {}
    stem_map = {}
    for series, grade, kind, rel, pages in SAMPLES:
        path = ROOT / rel if rel else find_pdf(rows, series, grade, kind)
        if path is None or not path.exists():
            print("missing", series, grade, kind)
            continue
        if kind == "진도북":
            units = toc_from_jindo(path)
            grade_units[f"{series}-{grade}"] = units
            print("units", series, grade, units)
        stem_map[f"{series}-{grade}-{kind}"] = sample_stems(path, pages)
        print("stems", series, grade, kind, stem_map[f"{series}-{grade}-{kind}"]["markers"])

    report = {
        "root": str(ROOT),
        "nFiles": len(rows),
        "nPdf": len(pdfs),
        "pdfBySeriesKind": {f"{a}/{b}": n for (a, b), n in by.items()},
        "catalog": catalog,
        "nonPdf": [
            {k: r[k] for k in ("series", "kind", "grade", "name", "ext", "bytes")}
            for r in rows
            if r.get("ext") != ".pdf"
        ],
        "units": grade_units,
        "stems": stem_map,
    }
    dest = OUT / "cube-catalog-learn.json"
    dest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", dest)


if __name__ == "__main__":
    main()
