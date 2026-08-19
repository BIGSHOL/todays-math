# -*- coding: utf-8 -*-
"""비용 10편 + 눈으로 본 스캔 후보만 개선기에 넣는다. 전량을 훑지 않는다."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COST = ROOT / "docs" / "planning" / "tracks" / "reports" / "figure-raster" / "cost10.json"
SRC = ROOT / "public" / "figures-300"
DST = ROOT / "public" / "figures-300-enhanced"
REPORT = ROOT / "docs" / "planning" / "tracks" / "reports" / "figure-raster" / "enhance-sample.json"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    eids = json.loads(COST.read_text(encoding="utf-8"))["편"]
    # 비용 10편에 더해, 눈으로 스캔으로 확인한 편(있으면).
    extra = ["2180"]
    dirs = []
    for e in eids + extra:
        d = SRC / e
        if d.is_dir():
            dirs.append(d)
    # 임시로 한 루트 아래 심볼릭 없이, enhance-figures 는 rglob 이라
    # 각 편을 따로 돌리면 보고서가 덮인다. 그래서 파일 목록을 모아
    # --src 를 figures-300 으로 두되 limit 없이 걸러야 한다.
    # 가장 단순한 길: 대상 파일만 있는 목록을 enhance-figures 가 받게
    # 하지 않고, 여기서 직접 부른다.
    sys.path.insert(0, str(ROOT / "scripts" / "figure"))
    from enhance_guards import enhance_gray, judge, speckle_strength
    from PIL import Image

    files = []
    for d in dirs:
        files.extend(
            p
            for p in d.iterdir()
            if p.suffix.lower() in {".png", ".jpg", ".jpeg"}
        )
    print(f"대상 편 { [d.name for d in dirs] } · 파일 {len(files)}")
    skipped = kept = 0
    discarded = []
    for src in files:
        with Image.open(src) as im:
            im.load()
            speckle = speckle_strength(im)
            if speckle < 3.0:
                skipped += 1
                continue
            out = enhance_gray(im)
            g = judge(im, out)
        rel = src.relative_to(SRC)
        if not g.ok:
            discarded.append({"path": rel.as_posix(), "이유": g.reason, "speckle": round(speckle, 3)})
            print(f"  버림 {rel}  {g.reason}  speckle={speckle:.2f}")
            continue
        dest = DST / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        out.save(dest, "PNG")
        kept += 1
        print(f"  유지 {rel}  speckle={speckle:.2f}  revert={g.revert_mean:.2f}")
    REPORT.write_text(
        json.dumps(
            {
                "편": [d.name for d in dirs],
                "파일": len(files),
                "깨끗건너뜀": skipped,
                "유지": kept,
                "버림": discarded,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"깨끗 {skipped} · 유지 {kept} · 버림 {len(discarded)} → {REPORT}")


if __name__ == "__main__":
    main()
