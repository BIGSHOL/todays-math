# -*- coding: utf-8 -*-
"""큐브수학 교재 PDF 텍스트 레이어·글꼴·지면 구조를 잰다. 읽기만 한다.

사용:
  PYTHONIOENCODING=utf-8 python scripts/qa/probe-cube-math.py

산출:
  scripts/qa/reports/cube-probe/summary.json
  scripts/qa/reports/cube-probe/samples.txt
  scripts/qa/reports/cube-probe/*.png
"""
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
OUT = Path("scripts/qa/reports/cube-probe")
OUT.mkdir(parents=True, exist_ok=True)

# 대표 표본: 얇은 책 / 매칭 / 진도 / 정답. 전량이 아니라 갈래당 하나.
SAMPLES = [
    ROOT / "큐브수학 개념응용" / "응용강화북" / "큐브수학 개념응용 5-2 응용강화북.pdf",
    ROOT / "큐브수학 개념" / "매칭북" / "큐브수학 개념 4-2_매칭북.pdf",
    ROOT / "큐브수학 개념" / "진도북" / "큐브수학 개념 5-2_진도북.pdf",
    ROOT / "큐브수학 실력" / "3-1 큐브실력" / "큐브수학실력3-1정답(01~64).pdf",
    ROOT / "큐브수학 실력" / "3-1 큐브실력" / "큐브수학 실력 3-1_매칭북.pdf",
]


def walk_pdfs() -> list[Path]:
    return sorted(p for p in ROOT.rglob("*.pdf") if p.is_file())


def classify(path: Path) -> dict[str, str]:
    rel = path.relative_to(ROOT).as_posix()
    series = "개념" if rel.startswith("큐브수학 개념/") else (
        "개념응용" if rel.startswith("큐브수학 개념응용/") else (
            "실력" if rel.startswith("큐브수학 실력/") else "기타"
        )
    )
    name = path.name
    kind = "기타"
    if "정답" in name:
        kind = "정답"
    elif "매칭" in name:
        kind = "매칭북"
    elif "응용강화" in name:
        kind = "응용강화북"
    elif "진도" in name:
        kind = "진도북"
    m = re.search(r"([3-6])[-_]([12])", name)
    grade = f"초{m.group(1)}-{m.group(2)}" if m else "?"
    return {"rel": rel, "series": series, "kind": kind, "grade": grade}


def font_census(page: pymupdf.Page) -> Counter[str]:
    c: Counter[str] = Counter()
    d = page.get_text("rawdict")
    for b in d.get("blocks", []):
        if b.get("type") != 0:
            continue
        for line in b.get("lines", []):
            for sp in line.get("spans", []):
                font = str(sp.get("font") or "")
                text = str(sp.get("text") or "")
                if font and text:
                    c[font] += len(text)
    return c


def probe_file(path: Path, deep: bool) -> dict:
    meta = classify(path)
    info: dict = {
        **meta,
        "bytes": path.stat().st_size,
        "ok": False,
    }
    try:
        doc = pymupdf.open(path)
    except Exception as e:
        info["error"] = str(e)[:200]
        return info
    try:
        n = doc.page_count
        info["pages"] = n
        sample_idx = list(range(min(3, n)))
        if n > 10:
            sample_idx.append(9)
        if n > 20:
            sample_idx.append(19)
        chars = []
        imgs = 0
        draws = 0
        fonts: Counter[str] = Counter()
        for i in sample_idx:
            page = doc[i]
            chars.append(len(page.get_text() or ""))
            imgs += len(page.get_images())
            draws += len(page.get_drawings())
            fonts.update(font_census(page))
        per = sum(chars) / max(1, len(chars))
        info.update(
            {
                "ok": True,
                "charsPerSamplePage": round(per, 1),
                "bornDigital": per >= 80,
                "imagesOnSample": imgs,
                "drawingsOnSample": draws,
                "topFonts": fonts.most_common(12),
            }
        )
        if deep:
            pages_out = []
            for i in sample_idx:
                page = doc[i]
                text = page.get_text() or ""
                pages_out.append(
                    {
                        "page": i + 1,
                        "chars": len(text),
                        "images": len(page.get_images()),
                        "drawings": len(page.get_drawings()),
                        "preview": "\n".join(text.splitlines()[:40]),
                    }
                )
                pix = page.get_pixmap(dpi=110)
                png = OUT / f"{path.stem[:40]}-p{i + 1}.png"
                pix.save(str(png))
                pages_out[-1]["png"] = png.name
            info["pagesOut"] = pages_out
        return info
    finally:
        doc.close()


def main() -> None:
    pdfs = walk_pdfs()
    print(f"pdfs={len(pdfs)}")
    rows = [probe_file(p, deep=False) for p in pdfs]
    ok = [r for r in rows if r.get("ok")]
    fail = [r for r in rows if not r.get("ok")]
    born = [r for r in ok if r.get("bornDigital")]
    print(f"open_ok={len(ok)} fail={len(fail)} born={len(born)}")
    by = {}
    for r in ok:
        key = f"{r['series']}/{r['kind']}"
        bucket = by.setdefault(key, {"n": 0, "pages": 0, "mb": 0.0, "chars": []})
        bucket["n"] += 1
        bucket["pages"] += int(r.get("pages") or 0)
        bucket["mb"] += (r.get("bytes") or 0) / 1e6
        bucket["chars"].append(r.get("charsPerSamplePage") or 0)
    print("── 갈래 ──")
    for k, v in sorted(by.items()):
        avg = sum(v["chars"]) / max(1, len(v["chars"]))
        print(
            f"  {k:20} 권={v['n']:2} 쪽={v['pages']:5} "
            f"{v['mb']:7.1f}MB  평균{avg:7.0f}자/쪽"
        )
    print("── 학년 ──")
    gcount: Counter[str] = Counter()
    gpages: Counter[str] = Counter()
    for r in ok:
        gcount[r["grade"]] += 1
        gpages[r["grade"]] += int(r.get("pages") or 0)
    for g in sorted(gcount):
        print(f"  {g}  권={gcount[g]:2} 쪽={gpages[g]:5}")

    font_all: Counter[str] = Counter()
    for r in ok:
        for name, n in r.get("topFonts") or []:
            font_all[name] += n
    print("── 글꼴 상위 ──")
    for name, n in font_all.most_common(20):
        print(f"  {n:8}  {name}")

    samples = []
    sample_txt = []
    for p in SAMPLES:
        print(f"sample {p.name} exists={p.exists()}")
        if not p.exists():
            continue
        rec = probe_file(p, deep=True)
        samples.append(rec)
        sample_txt.append("=" * 72)
        sample_txt.append(f"{rec.get('rel')} pages={rec.get('pages')} chars={rec.get('charsPerSamplePage')}")
        sample_txt.append("=" * 72)
        for pg in rec.get("pagesOut") or []:
            sample_txt.append(f"\n--- p{pg['page']} chars={pg['chars']} img={pg['images']} draw={pg['drawings']} ---")
            sample_txt.append(pg["preview"])

    (OUT / "summary.json").write_text(
        json.dumps(
            {
                "files": rows,
                "samples": [
                    {k: v for k, v in s.items() if k != "pagesOut"}
                    | {
                        "pagesOut": [
                            {kk: vv for kk, vv in pg.items() if kk != "preview"}
                            for pg in s.get("pagesOut") or []
                        ]
                    }
                    for s in samples
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (OUT / "samples.txt").write_text("\n".join(sample_txt), encoding="utf-8")
    print(f"wrote {OUT / 'summary.json'}")
    print(f"wrote {OUT / 'samples.txt'}")


if __name__ == "__main__":
    main()
