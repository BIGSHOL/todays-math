# -*- coding: utf-8 -*-
"""HWPX 에 **이미지가 없는**(벡터로 그린) 그림을 PDF 로 변환해 오려 온다.

HWPX 의 `<hp:container>` 벡터 도형은 BinData 에 파일이 없다 — 꺼낼 이미지가 아예 없다
(실측: 보류 234행 전수 BinData 참조 0건). 남은 길은 원본을 PDF 로 찍어 그 자리를
**클립 렌더**하는 것이다. `map-figures.py` 가 이미 그 일을 한다(벡터 조각을 이어
사각형을 잡고 `extract-all-figures.py` 가 `xref` 없는 것을 렌더한다).

    python scripts/figure/render-vector-figures.py --pilot 3      3편만 (변환·렌더·보고)
    python scripts/figure/render-vector-figures.py                전량

설계 — **픽셀은 PDF 가, 소유권은 HWP 가 준다.**
  PDF 좌표 매칭은 인접 문항 그림을 끌어오는 과다 부착이 있다(A-5 실측).
  그래서 렌더는 PDF 에서 하되, **트랙 D 의 `hwpx-figures.json` 이 "그 문항에 그림이
  있다" 고 말한 (편, 번호)만 채택한다.** 문서 구조가 소유권을 정하므로 과다 부착이
  구조적으로 막힌다.

전제: 한컴오피스 COM (단일 인스턴스 — 다른 트랙이 쓰는 중이면 겹치지 마라).
출력: `public/figures/<examId>/vec-qNN[_i].png` + `scripts/qa/reports/figure-vector-plan.json`
**DB 는 건드리지 않는다.** 연결은 `attach-load-figures.mjs` 계열이 한다.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import pathlib
import re
import shutil
import sys
import time

import fitz

# 파일명에 하이픈이 있어 일반 import 가 안 된다(08 §7 의 함정 목록과 같은 이유).
HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("mapfig", HERE / "map-figures.py")
mapfig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mapfig)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PLAN_IN = pathlib.Path("scripts/qa/reports/figure-load-plan.json")
OUT = pathlib.Path("scripts/qa/reports/figure-vector-plan.json")
FIGROOT = pathlib.Path("public/figures")
WORK = pathlib.Path(
    os.environ.get(
        "VECTOR_WORKDIR",
        r"C:\Users\user\AppData\Local\Temp\claude"
        r"\C--Users-user-orca-workspaces-testautocreator----A---"
        r"\5fe97e27-cae2-43c4-84fd-9e5d9b640088\scratchpad\vecpdf",
    )
)
LOAD_ROWS = os.environ.get(
    "LOAD_ROWS",
    "C:/Users/user/orca/workspaces/testautocreator/잔여-E-신규적재"
    "/scripts/qa/reports/load-rows.json",
)
CLIP_DPI = 200


def hwp_to_pdf(src: pathlib.Path, workdir: pathlib.Path) -> pathlib.Path:
    """한컴 COM 으로 `.hwp` → `.pdf`. 이미 있으면 다시 만들지 않는다(이어달리기)."""
    workdir.mkdir(parents=True, exist_ok=True)
    local = workdir / re.sub(r"[^\w.\-]", "_", src.name)
    out = local.with_suffix(".pdf")
    if out.exists() and out.stat().st_size > 0:
        return out
    sys.path.insert(0, str(pathlib.Path("scripts/vendor/testchanger").resolve()))
    from core import hwp_com  # noqa: PLC0415

    hwp_com.ensure_com_initialized()
    import win32com.client  # noqa: PLC0415

    shutil.copy2(src, local)
    app = win32com.client.Dispatch("HWPFrame.HwpObject")
    try:
        try:
            app.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        except Exception:  # noqa: BLE001
            pass
        if not app.Open(str(local.resolve()), "HWP", "forceopen:true"):
            raise RuntimeError("HWP Open 실패")
        app.SaveAs(str(out.resolve()), "PDF", "")
    finally:
        try:
            app.Quit()
        except Exception:  # noqa: BLE001
            pass
    if not out.exists():
        raise RuntimeError("PDF 변환 실패")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pilot", type=int, default=0, help="앞의 N 편만 처리한다")
    args = ap.parse_args()

    plan_in = json.loads(PLAN_IN.read_text(encoding="utf-8"))
    held = [h for h in plan_in["보류"] if "벡터" in h["사유"]]
    want: dict[str, set[int]] = {}
    for h in held:
        want.setdefault(h["e"], set()).add(int(h["q"]))

    rows = json.loads(pathlib.Path(LOAD_ROWS).read_text(encoding="utf-8"))
    if isinstance(rows, dict):
        rows = rows.get("rows", [])
    src_of: dict[str, str] = {}
    for r in rows:
        e = str(r.get("examId") or "")
        if e in want and r.get("sourceFile"):
            src_of.setdefault(e, r["sourceFile"])

    exams = sorted(want, key=int)
    if args.pilot:
        exams = exams[: args.pilot]

    plan, stat = [], {
        "편": 0, "변환실패": 0, "원본없음": 0, "매칭0": 0,
        "대상문항": 0, "렌더문항": 0, "렌더장수": 0, "PDF엔없음": 0, "초": 0,
    }
    t0 = time.time()
    for exam in exams:
        srcpath = src_of.get(exam)
        if not srcpath or not pathlib.Path(srcpath).exists():
            stat["원본없음"] += 1
            continue
        t1 = time.time()
        try:
            pdf = hwp_to_pdf(pathlib.Path(srcpath), WORK)
        except Exception as exc:  # noqa: BLE001
            stat["변환실패"] += 1
            print(f"  ! {exam} 변환실패 {type(exc).__name__} {exc}"[:140], flush=True)
            continue
        try:
            mapped = mapfig.map_exam(pdf)
        except Exception as exc:  # noqa: BLE001
            stat["매칭0"] += 1
            print(f"  ! {exam} 매칭실패 {type(exc).__name__}", flush=True)
            continue

        doc = fitz.open(pdf)
        urls_by_q: dict[int, list[str]] = {}
        for num in sorted(want[exam]):
            stat["대상문항"] += 1
            figs = mapped.get(num) or []
            if not figs:
                stat["PDF엔없음"] += 1
                continue
            urls = []
            for i, f in enumerate(figs):
                if f.get("xref"):
                    info = doc.extract_image(f["xref"])
                    data, ext = info["image"], info["ext"]
                else:
                    x0, y0, x1, y1 = f["rect"]
                    pix = doc[f["page"]].get_pixmap(
                        clip=fitz.Rect(x0, y0, x1, y1), dpi=CLIP_DPI
                    )
                    data, ext = pix.tobytes("png"), "png"
                name = f"vec-q{num:02d}" + (f"_{i}" if i else "") + f".{ext}"
                dest = FIGROOT / exam / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
                urls.append(f"/figures/{exam}/{name}")
                stat["렌더장수"] += 1
            if urls:
                stat["렌더문항"] += 1
                urls_by_q[num] = urls
        doc.close()
        stat["편"] += 1
        for num, urls in urls_by_q.items():
            plan.append({"e": exam, "q": num, "urls": urls})
        print(f"  [{stat['편']}/{len(exams)}] {exam} 대상 {len(want[exam])} · "
              f"렌더 {len(urls_by_q)} · {time.time()-t1:.0f}s", flush=True)

    stat["초"] = round(time.time() - t0)
    OUT.write_text(json.dumps({"집계": stat, "계획": plan}, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    print("── 벡터 그림 렌더 ──")
    for k, v in stat.items():
        print(f"  {k:10s} {v}")
    print("→", OUT)


if __name__ == "__main__":
    main()
