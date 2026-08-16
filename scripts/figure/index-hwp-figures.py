# -*- coding: utf-8 -*-
"""HWPX(정본) 에서 **문항별 그림 목록**을 뽑아 색인한다. 변환 없음 · LLM 토큰 0.

트랙 D 가 완료본 HWP 를 `.hwpx` 로 전량 변환해 두었다(3,302편). HWPX 는 zip 이고
`<hp:pic>` 이 문단 흐름 안에 그대로 있으므로 **어느 문항의 그림인지 문서 구조로**
정해진다 — PDF 좌표 추정(`map-figures.py`)보다 정확하다.

    python scripts/figure/index-hwp-figures.py                     전량 색인
    python scripts/figure/index-hwp-figures.py --exams 3670,3679   일부만
    HWPX_DIR=<경로> python scripts/figure/index-hwp-figures.py     산출물 위치 지정

출력: `scripts/figure/hwp-figure-index.json`
      {"<examId>": {"q": {"<문항순번>": [{"ref","ext","bytes","w","h"}]},
                    "questions": 22, "banner": 1}}

⚠️ 여기서의 문항 번호는 **HWP 순번**(미주 앵커 기준)이다. DB 문항번호와 맞추려면
   트랙 D 의 `hwp-verdicts.jsonl`(`n` ↔ `hwpNumber`, `align`)로 옮겨야 한다.
   순번을 그대로 DB 번호로 쓰지 마라 — 문항 결손이 있는 편이 960편이다(D 실측).

⚠️ 원본(N드라이브·D 워크트리)은 **읽기만** 한다. 한 바이트도 쓰지 않는다.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.append(str(pathlib.Path("scripts/vendor/testchanger")))
import hwp_extract as HX  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HP = HX.HP
OUT = pathlib.Path("scripts/figure/hwp-figure-index.json")

# 트랙 D 산출물 기본 위치. 다른 컴퓨터에서는 HWPX_DIR 로 준다.
HWPX_CANDIDATES = (
    r"C:\Users\user\orca\workspaces\testautocreator\잔여-D-HWP\scripts\qa\reports\hwpx",
    "scripts/qa/reports/hwpx",
)

# 학원 배너(머리 띠)는 그림이 아니다. 실측: 비 9.9~10.7, 폭 291,840~314,580,
# 파일 4MB 안팎으로 편당 한 장.
#
# ⚠️ 처음엔 "비 5:1 이상" 으로 잡았다가 **진짜 그림을 버렸다**(2026-08-16).
# 수직선(`P Q A R B S T` 눈금선, 비 5.4)과 가로로 긴 데이터 표(비 5.8)가
# 그 범위에 들어간다 — 둘 다 없으면 문항을 못 푼다. 폭 조건을 같이 걸어야 한다.
# 새 규칙으로 배너는 1,863장(전부 4MB대), 편당 2장 이상인 편이 66 → 4 로 줄고
# 가로형 그림 158장이 되살아난다.
BANNER_RATIO = 8.0
BANNER_MIN_WIDTH = 200_000


def hwpx_dir() -> pathlib.Path:
    env = os.environ.get("HWPX_DIR")
    cands = (env,) + HWPX_CANDIDATES if env else HWPX_CANDIDATES
    for c in cands:
        if c and pathlib.Path(c).is_dir():
            return pathlib.Path(c)
    raise SystemExit(
        "hwpx 디렉터리를 찾을 수 없다. HWPX_DIR 를 설정하라.\n"
        f"(후보: {', '.join(str(c) for c in cands)})"
    )


def _pic_info(node) -> dict:
    info: dict = {}
    for child in node.iter():
        tag = child.tag.split("}")[-1]
        if tag in ("orgSz", "img"):
            info[tag] = dict(child.attrib)
    return info


def walk(node, out: list) -> None:
    """문서 순서대로 (kind, value). `hwp_extract._walk` 의 그림 판(版)."""
    for child in node:
        if child.tag in HX._SKIP_CTRL:
            continue
        tag = child.tag.split("}")[-1]
        if child.tag == HP + "endNote":
            # 미주 = 문항 앵커. `hwp_extract.parse_exam` 과 같은 규약이라
            # 여기서 센 순번이 그쪽 `number` 와 일치한다.
            out.append(("endnote", None))
        elif tag == "pic":
            out.append(("pic", _pic_info(child)))
        else:
            walk(child, out)


def is_banner(info: dict) -> bool:
    org = info.get("orgSz") or {}
    try:
        width, height = int(org.get("width", 0)), int(org.get("height", 0))
    except ValueError:
        return False
    if height <= 0:
        return False
    return width / height >= BANNER_RATIO and width >= BANNER_MIN_WIDTH


def index_one(path: pathlib.Path) -> dict:
    items: list = []
    with zipfile.ZipFile(path) as z:
        for name in sorted(
            n for n in z.namelist() if re.match(r"Contents/section\d+\.xml", n)
        ):
            walk(ET.fromstring(z.read(name).decode("utf-8")), items)
        bins = {
            pathlib.Path(n).stem.lower(): (n, z.getinfo(n).file_size)
            for n in z.namelist()
            if n.lower().startswith("bindata/")
        }

    q, per, banner, head = 0, {}, 0, 0
    for kind, val in items:
        if kind == "endnote":
            q += 1
            continue
        if kind != "pic":
            continue
        if is_banner(val):
            banner += 1
            continue
        if q == 0:
            head += 1
            continue
        ref = ((val.get("img") or {}).get("binaryItemIDRef") or "").lower()
        name, size = bins.get(ref, (None, 0))
        org = val.get("orgSz") or {}
        per.setdefault(str(q), []).append(
            {
                "ref": ref,
                "bin": name,
                "ext": pathlib.Path(name).suffix.lstrip(".").lower() if name else None,
                "bytes": size,
                "w": int(org.get("width", 0) or 0),
                "h": int(org.get("height", 0) or 0),
            }
        )
    return {"questions": q, "q": per, "banner": banner, "head": head}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exams", help="쉼표로 구분한 examId 목록(기본: 전량)")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    src = hwpx_dir()
    files = sorted(src.glob("*.hwpx"), key=lambda p: p.stem)
    if args.exams:
        want = {e.strip() for e in args.exams.split(",") if e.strip()}
        files = [f for f in files if f.stem in want]

    out, stat = {}, {"편": 0, "실패": 0, "그림문항": 0, "그림": 0, "배너": 0, "문항밖": 0}
    for i, f in enumerate(files, 1):
        try:
            rec = index_one(f)
        except Exception as exc:  # noqa: BLE001
            stat["실패"] += 1
            if stat["실패"] <= 5:
                print(f"  ! {f.stem} {type(exc).__name__} {exc}"[:160], flush=True)
            continue
        out[f.stem] = rec
        stat["편"] += 1
        stat["그림문항"] += len(rec["q"])
        stat["그림"] += sum(len(v) for v in rec["q"].values())
        stat["배너"] += rec["banner"]
        stat["문항밖"] += rec["head"]
        if i % 500 == 0:
            print(f"  … {i}/{len(files)}", flush=True)

    pathlib.Path(args.out).write_text(
        json.dumps(out, ensure_ascii=False), encoding="utf-8"
    )
    print("── HWP 그림 색인 ──")
    for k, v in stat.items():
        print(f"  {k:8s} {v}")
    print("→", args.out)


if __name__ == "__main__":
    main()
