# -*- coding: utf-8 -*-
"""재크롭 뒤에 남는 스캔 잡음만 줄인다. 다시 그리지 않는다.

대상: public/figures-300 의 그림 중 점잡음이 문턱을 넘는 것.
결과는 public/figures-300-enhanced/ 에만 쓴다. 가드에 걸리면 버린다.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from enhance_guards import enhance_gray, judge, speckle_strength  # noqa: E402

ROOT = HERE.parents[1]
SRC_DEFAULT = ROOT / "public" / "figures-300"
DST_DEFAULT = ROOT / "public" / "figures-300-enhanced"
# 기출 표본 400장에서 점잡음 3.0 초과가 20.8%. 그 무리만 손본다.
SPECKLE_MIN = 3.0

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(SRC_DEFAULT))
    ap.add_argument("--dst", default=str(DST_DEFAULT))
    ap.add_argument("--limit", type=int)
    ap.add_argument("--min-speckle", type=float, default=SPECKLE_MIN)
    ap.add_argument(
        "--report",
        default=str(
            ROOT / "docs" / "planning" / "tracks" / "reports" / "figure-raster" / "enhance-result.json"
        ),
    )
    a = ap.parse_args()
    src_root = Path(a.src)
    dst_root = Path(a.dst)
    files = sorted(
        p
        for p in src_root.rglob("*")
        if p.suffix.lower() in {".png", ".jpg", ".jpeg"}
    )
    if a.limit:
        files = files[: a.limit]

    skipped_clean = 0
    kept = 0
    discarded: list[dict] = []
    t0 = time.perf_counter()
    for i, src in enumerate(files):
        with Image.open(src) as im:
            im.load()
            speckle = speckle_strength(im)
            if speckle < a.min_speckle:
                skipped_clean += 1
                continue
            out = enhance_gray(im)
            g = judge(im, out)
        rel = src.relative_to(src_root)
        if not g.ok:
            discarded.append(
                {
                    "path": rel.as_posix(),
                    "이유": g.reason,
                    "revert": round(g.revert_mean, 3),
                    "lost": g.lost,
                    "new": g.new,
                    "speckle": round(speckle, 3),
                }
            )
            continue
        dest = dst_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        out.save(dest, "PNG")
        kept += 1
        if (i + 1) % 50 == 0:
            print(f"  … {i+1}/{len(files)} 유지 {kept} 버림 {len(discarded)} 깨끗 {skipped_clean}")

    reasons: dict[str, int] = {}
    for d in discarded:
        key = d["이유"].split(" ")[0]
        reasons[key] = reasons.get(key, 0) + 1
    report = {
        "대상": len(files),
        "점잡음문턱": a.min_speckle,
        "깨끗건너뜀": skipped_clean,
        "유지": kept,
        "버림": len(discarded),
        "버림사유": reasons,
        "버림목록": discarded,
        "초": round(time.perf_counter() - t0, 2),
        "src": str(src_root),
        "dst": str(dst_root),
    }
    rpath = Path(a.report)
    rpath.parent.mkdir(parents=True, exist_ok=True)
    rpath.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(
        f"── 개선 ── 대상 {len(files)} · 깨끗 {skipped_clean} · "
        f"유지 {kept} · 버림 {len(discarded)} {reasons} · {report['초']}s"
    )
    print(f"→ {rpath}")


if __name__ == "__main__":
    main()
