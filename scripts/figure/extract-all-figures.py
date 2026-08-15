# -*- coding: utf-8 -*-
"""완료본 전 편에서 문항 그림을 뽑아 `public/figures/` 에 떨구고 대장을 남긴다.

**LLM 토큰 0 · API 0.** 원본 PDF 에 심긴 이미지를 그대로 오려 낸다(재구성 없음).

산출:
  public/figures/<examId>/q<번호>[_i].<ext>
  scripts/figure/figure-manifest.json   {examId: {번호: [상대경로…]}}

멱등: 이미 있는 파일은 건너뛴다. 중단 후 같은 명령을 다시 돌리면 이어 달린다.
화면 출력은 집계뿐(토큰 절약 원칙 §4).

사용: python scripts/figure/extract-all-figures.py [--limit N] [--out public/figures]
"""
import argparse
import collections
import importlib.util
import json
import pathlib
import sqlite3
import sys
import time

import fitz

HERE = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("mapfig", HERE / "map-figures.py")
mapfig = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mapfig)

IDX = mapfig.IDX
PAGES = mapfig.PAGES
MANIFEST = HERE / "figure-manifest.json"
# 원본 이미지가 안 잡힐 때 그 영역을 렌더하는 해상도. 원본이 대개 118dpi 라
# 200 이면 충분히 선명하고 파일도 작다.
CLIP_DPI = 200

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--out", default="public/figures")
    a = ap.parse_args()

    outroot = pathlib.Path(a.out)
    con = sqlite3.connect(IDX)
    cached = {p.name for p in PAGES.iterdir() if (p / "src.pdf").exists()}

    # D-37 — 완료본이고, 문항이 추출돼 있고, 원본 PDF 가 로컬에 있는 시험지
    exams = [
        eid
        for eid, src, n in con.execute(
            "select e.id, e.src_path,"
            " (select count(*) from questions q where q.exam_id=e.id)"
            " from exams e where e.src_path is not null order by e.id"
        )
        if n > 0 and str(eid) in cached and "완료" in (src or "")
    ]
    if a.limit:
        exams = exams[: a.limit]

    manifest = {}
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    stat = collections.Counter()
    bytes_total = 0
    t0 = time.time()

    for eid in exams:
        key = str(eid)
        try:
            mapped = mapfig.map_exam(PAGES / key / "src.pdf")
        except Exception as exc:  # noqa: BLE001
            stat["실패:편"] += 1
            if stat["실패:편"] <= 3:
                print("  ! %s %s" % (eid, type(exc).__name__))
            continue

        if not mapped:
            stat["그림없음:편"] += 1
            continue

        doc = fitz.open(PAGES / key / "src.pdf")
        entry = {}
        for num, figs in sorted(mapped.items()):
            paths = []
            for i, f in enumerate(figs):
                # 원본 이미지가 잡히면 그대로(무손실). 안 잡히면 그 영역을 렌더한다 —
                # 이미지가 폼 XObject 안에 있거나 벡터로 그려진 그림이 이 경우다.
                if f["xref"]:
                    info = doc.extract_image(f["xref"])
                    data, ext = info["image"], info["ext"]
                else:
                    x0, y0, x1, y1 = f["rect"]
                    pix = doc[f["page"]].get_pixmap(
                        clip=fitz.Rect(x0, y0, x1, y1), dpi=CLIP_DPI
                    )
                    data, ext = pix.tobytes("png"), "png"
                    stat["클립 렌더"] += 1
                name = f"q{num:02d}" + (f"_{i}" if i else "") + f".{ext}"
                dest = outroot / key / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                if dest.exists():
                    stat["건너뜀:이미있음"] += 1
                else:
                    dest.write_bytes(data)
                    stat["새로 뽑음"] += 1
                bytes_total += dest.stat().st_size
                paths.append(f"/figures/{key}/{name}")
            if paths:
                entry[str(num)] = paths
        doc.close()

        if entry:
            manifest[key] = entry
            stat["편"] += 1
            stat["문항"] += len(entry)

    MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=0), encoding="utf-8"
    )

    print("── 완료본 그림 전량 추출 (토큰 0) ──")
    print(
        "대상 %d편 · 그림 있는 %d편 · 그림 붙은 문항 %d · %.0fs"
        % (len(exams), stat["편"], stat["문항"], time.time() - t0)
    )
    print(
        "파일 새로 %d · 기존 %d · 총 %.1f MB"
        % (stat["새로 뽑음"], stat["건너뜀:이미있음"], bytes_total / 1048576)
    )
    for k in ("그림없음:편", "xref 못찾음", "실패:편"):
        if stat[k]:
            print("  %-14s %d" % (k, stat[k]))
    print("→ %s · 대장 %s" % (outroot, MANIFEST))


if __name__ == "__main__":
    main()
