# -*- coding: utf-8 -*-
"""단계 0 ① · ⑤ — 원장 vs 지금 디스크. 읽기만 한다.

    python scripts/qa/measure-figure-ledger-disk.py

분모를 먼저 찍는다. 추측한 값은 안 적는다.
"""
from __future__ import annotations

import json
import pathlib
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
# 파이프 안에서도 절이 끝나는 대로 보이게.
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
LEDGER = ROOT / "scripts/qa/reports/figure-rect-ledger.json"
FIGURES = ROOT / "public/figures"
SVG = ROOT / "public/figures-svg"
QUALITY = pathlib.Path(r"C:/Users/user/orca/workspaces/testautocreator/그림화질")
QUALITY_FIG = QUALITY / "public/figures"
QUALITY_300 = QUALITY / "public/figures-300"

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


def list_images(root: pathlib.Path) -> dict[str, pathlib.Path]:
    if not root.is_dir():
        return {}
    out: dict[str, pathlib.Path] = {}
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in IMAGE_EXT:
            continue
        rel = p.relative_to(root).as_posix()
        out[rel] = p
    return out


def list_svg(root: pathlib.Path) -> dict[str, pathlib.Path]:
    if not root.is_dir():
        return {}
    return {
        p.relative_to(root).as_posix(): p
        for p in root.rglob("*.svg")
        if p.is_file()
    }


def main() -> None:
    want_pixels = "--pixels" in sys.argv
    print("원장 읽는 중…", flush=True)
    if not LEDGER.is_file():
        print(f"원장이 없다: {LEDGER}")
        sys.exit(1)

    raw = json.loads(LEDGER.read_text(encoding="utf-8"))
    rows = raw.get("행")
    if not isinstance(rows, list):
        print("원장 모양이 다르다 — 「행」 배열이 없다.")
        sys.exit(1)

    print("── 원장 머리 ──")
    for k in ("기준", "만든이", "부분"):
        if k in raw:
            print(f"  {k}: {raw[k]}")
    agg = raw.get("집계")
    if isinstance(agg, dict):
        print("  집계:")
        for k, v in agg.items():
            print(f"    {k}: {v}")

    ledger_figs: dict[str, dict] = {}
    dup = 0
    no_key = 0
    with_mm = 0
    with_rect = 0
    for r in rows:
        if not isinstance(r, dict):
            no_key += 1
            continue
        fig = r.get("figure")
        if not isinstance(fig, str) or not fig:
            no_key += 1
            continue
        if fig in ledger_figs:
            dup += 1
        ledger_figs[fig] = r
        mm = r.get("width_mm")
        if isinstance(mm, (int, float)) and mm == mm:
            with_mm += 1
        rect = r.get("rect_pt")
        if isinstance(rect, list) and len(rect) == 4:
            with_rect += 1

    print()
    print("── 분모 ──")
    print(f"  원장 행           {len(rows):,}")
    print(f"  figure 키 있는 행 {len(ledger_figs):,}  (중복 {dup} · 키없음 {no_key})")
    print(f"  width_mm 있는 행  {with_mm:,}")
    print(f"  rect_pt 있는 행   {with_rect:,}")

    print(f"디스크 훑는 중… {FIGURES}", flush=True)
    disk = list_images(FIGURES)
    print(f"  이 WT public/figures  {len(disk):,}장  ({FIGURES})", flush=True)

    print()
    print("── ① 원장 vs 이 워크트리 디스크 ──")
    missing_on_disk = sorted(k for k in ledger_figs if k not in disk)
    extra_on_disk = sorted(k for k in disk if k not in ledger_figs)
    print(f"  원장에 있고 디스크에도 있음  {len(ledger_figs) - len(missing_on_disk):,}")
    print(f"  원장에 있는데 디스크에 없음  {len(missing_on_disk):,}")
    print(f"  디스크에 있는데 원장에 없음  {len(extra_on_disk):,}")
    if missing_on_disk:
        print("  [디스크에 없는 원장 행] 앞 20")
        for k in missing_on_disk[:20]:
            print(f"    {k}")
    if extra_on_disk:
        print("  [원장에 없는 디스크 파일] 앞 40")
        for k in extra_on_disk[:40]:
            print(f"    {k}")
        prefixes: dict[str, int] = {}
        for k in extra_on_disk:
            head = k.split("/", 1)[0]
            prefixes[head] = prefixes.get(head, 0) + 1
        print("  [원장에 없는 파일] 첫 경로 조각별")
        for head, n in sorted(prefixes.items(), key=lambda x: -x[1])[:20]:
            print(f"    {head}: {n}")

    print()
    print("── ⑤ 바꿔치기 대상 재검산 (경로만. 픽셀은 --pixels 또는 measure-swap-subset.py) ──")
    if not QUALITY_300.is_dir():
        print(f"  그림화질/public/figures-300 이 없다: {QUALITY_300}")
        print("  → 이 항목은 못 잰다.")
    else:
        def stem_key(rel: str) -> str:
            parent, _, name = rel.rpartition("/")
            stem = name.rsplit(".", 1)[0]
            return f"{parent}/{stem}" if parent else stem

        print(f"디스크 훑는 중… {QUALITY_300}", flush=True)
        new = list_images(QUALITY_300)
        print(f"  그림화질 figures-300  {len(new):,}장", flush=True)
        q_old = list_images(QUALITY_FIG) if QUALITY_FIG.is_dir() else {}
        print(f"  그림화질 figures      {len(q_old):,}장  (measure-swap-subset.py 의 옛 짝)")
        print(f"  이 WT figures         {len(disk):,}장  (실제 바꿔치기 대상)")

        new_stems = {stem_key(k) for k in new}
        old_stems = {stem_key(k) for k in q_old}
        disk_stems = {stem_key(k) for k in disk}
        print(f"  300 ∩ 그림화질 옛     {len(new_stems & old_stems):,}  (어간)")
        print(f"  300 ∩ 이 WT           {len(new_stems & disk_stems):,}  (어간)")
        print(f"  300 만                {len(new_stems - disk_stems):,}")
        extra_this_vs_300 = sorted(k for k in disk if stem_key(k) not in new_stems)
        print(f"  이 WT 만 (300 에 없음) {len(extra_this_vs_300):,}")
        if extra_this_vs_300[:15]:
            for k in extra_this_vs_300[:15]:
                print(f"    {k}")

        if want_pixels:
            try:
                from PIL import Image
            except ImportError:
                print("  Pillow 가 없다 — 픽셀 비교는 못 잰다.")
                Image = None  # type: ignore

            def width_of(path: pathlib.Path) -> int | None:
                if Image is None:
                    return None
                try:
                    with Image.open(path) as im:
                        return im.size[0]
                except Exception:
                    return None

            def stem_match(
                folder: dict[str, pathlib.Path], rel: str
            ) -> pathlib.Path | None:
                if rel in folder:
                    return folder[rel]
                key = stem_key(rel)
                cands = [p for k, p in folder.items() if stem_key(k) == key]
                return cands[0] if len(cands) == 1 else None

            grew = same = shrunk = missing_old = broken = 0
            grew_this = same_this = missing_this = 0
            for rel, npth in new.items():
                op = stem_match(q_old, rel)
                tp = stem_match(disk, rel)
                nw = width_of(npth)
                if nw is None and Image is not None:
                    broken += 1
                    continue
                if op is None:
                    missing_old += 1
                else:
                    ow = width_of(op)
                    if ow is None:
                        broken += 1
                    elif nw is not None:
                        if nw > ow:
                            grew += 1
                        elif nw < ow:
                            shrunk += 1
                        else:
                            same += 1
                if tp is None:
                    missing_this += 1
                else:
                    tw = width_of(tp)
                    if tw is not None and nw is not None:
                        if nw > tw:
                            grew_this += 1
                        else:
                            same_this += 1
            print(f"  픽셀 (그림화질 옛 짝) 늘어남 {grew:,} · 그대로 {same:,} · 줄어듦 {shrunk:,} · 못찾음 {missing_old:,} · 못염 {broken:,}")
            print(f"  픽셀 (이 WT 짝)     늘어남 {grew_this:,} · 그대로/줄어듦 {same_this:,} · 짝없음 {missing_this:,}")
        else:
            print("  픽셀 비교는 건너뜀. `python scripts/qa/measure-swap-subset.py` 또는 `--pixels`.")

    svg = list_svg(SVG)
    print()
    print("── SVG (참고, 단계 3 분모) ──")
    print(f"  public/figures-svg    {len(svg):,}장  ({'있음' if SVG.is_dir() else '디렉터리 없음'})")


if __name__ == "__main__":
    main()
