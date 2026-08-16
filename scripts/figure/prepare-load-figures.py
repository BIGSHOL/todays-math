# -*- coding: utf-8 -*-
"""트랙 E 가 새로 적재할 행의 그림을 **미리 뽑아 둔다**. DB 를 보지 않는다.

E 는 `figureUrls` 를 비운 채로 넣는다(트랙 A 컬럼이라 안 건드린다). 그 행들에 붙일
그림은 우리가 HWP 정본에서 오려 둬야 한다. **적재가 끝나기 전에 붙일 수는 없지만
파일은 미리 만들 수 있다** — 그림 파일 실재 확인이 연결의 전제이기 때문이다(A-1 원칙).

    python scripts/figure/prepare-load-figures.py            드라이런
    python scripts/figure/prepare-load-figures.py --write    public/figures/ 에 기록

입력: 트랙 E 인계 `load-figure-handoff.json` (편 → 문항번호 → 그림 장수)
      `scripts/figure/hwp-figure-index.json` (내 raster 색인)
출력: `scripts/qa/reports/figure-load-plan.json` — (편, 문항번호) → 붙일 경로들
      E 의 적재 통보를 받은 뒤 `attach-load-figures.mjs` 가 이 계획을 DB 에 반영한다.

⚠️ **E 인계 장수는 그림이 아닌 것을 포함한다.** 그쪽은 트랙 D 의 `hwpx-figures.json`
   기준이고 D 는 `hp:pic` 외에 `hp:container`·`hp:ole` 까지 센다. 그런데 실측해 보니
   그 container 의 정체는 대부분 **서술형 양식 띠**였다 — 크기가 `29540×2187`(비 13.5)로
   편·문항이 달라도 **글자 그대로 같고**, 안에 `rect` 4 + `drawText` 4 + `line` 1 이 든
   채점란이다. 234행 중 **232행이 이 띠 하나뿐**이었다(그림이 아니라 서식이다).

   그래서 세는 방식을 이렇게 맞춘다:
     기대 그림 수 = E 인계 장수 − (그 문항의 양식 띠 개수)
   이러면 「장수 불일치」로 보류됐던 61행이 전부 확정으로 풀린다(실측: 그 61행은
   양식 띠 1개씩만 더 세고 있었다).

   ⚠️ 파일럿에서 확인한 것 — 이 띠를 그림으로 보고 PDF 로 변환해 그 자리를 렌더하면
   **해설 지면의 손글씨 풀이**가 잡힌다(2721-20 실측: 수직선 위 파란 펜 풀이 2장).
   학생 시험지에 정답 스케치를 인쇄하게 된다. 렌더가 됐다와 그림이 맞다는 다른 말이다.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import zipfile

import fitz

sys.path.append(str(pathlib.Path("scripts/vendor/testchanger")))
import hwp_extract as HX  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HANDOFF = os.environ.get(
    "LOAD_FIGURE_HANDOFF",
    "C:/Users/user/orca/workspaces/testautocreator/잔여-E-신규적재"
    "/scripts/qa/handoff/load-figure-handoff.json",
)
INDEX = pathlib.Path("scripts/figure/hwp-figure-index.json")
OUT = pathlib.Path("scripts/qa/reports/figure-load-plan.json")
FIGROOT = pathlib.Path("public/figures")
MIN_PX = 40
# 서술형 양식 띠(채점란) — 그림이 아니다. 크기가 편·문항 무관하게 같다.
FORM_STRIP_RATIO = 12.0
FORM_STRIP_MAX_H = 3000

HWPX_CANDIDATES = (
    r"C:\Users\user\orca\workspaces\testautocreator\잔여-D-HWP\scripts\qa\reports\hwpx",
    "scripts/qa/reports/hwpx",
)


def hwpx_dir() -> pathlib.Path:
    env = os.environ.get("HWPX_DIR")
    for c in ((env,) + HWPX_CANDIDATES if env else HWPX_CANDIDATES):
        if c and pathlib.Path(c).is_dir():
            return pathlib.Path(c)
    raise SystemExit("hwpx 디렉터리를 찾을 수 없다. HWPX_DIR 를 설정하라.")


def form_strips(path: pathlib.Path) -> dict[int, int]:
    """문항별 **양식 띠** 개수 — 기대 그림 수에서 빼기 위한 것."""
    import xml.etree.ElementTree as ET  # noqa: PLC0415
    import re as _re  # noqa: PLC0415

    HP = HX.HP  # noqa: N806
    per: dict[int, int] = {}
    items: list = []

    def walk(node):
        for ch in node:
            if ch.tag in HX._SKIP_CTRL:
                continue
            tag = ch.tag.split("}")[-1]
            if ch.tag == HP + "endNote":
                items.append(("endnote", None))
                continue
            if tag in ("container", "ole"):
                sz = None
                for c in ch.iter():
                    if c.tag.split("}")[-1] == "orgSz":
                        try:
                            sz = (int(c.attrib.get("width", 0)), int(c.attrib.get("height", 0)))
                        except ValueError:
                            sz = None
                        break
                items.append(("shape", sz))
                continue
            walk(ch)

    with zipfile.ZipFile(path) as z:
        for name in sorted(n for n in z.namelist()
                           if _re.match(r"Contents/section\d+\.xml", n)):
            walk(ET.fromstring(z.read(name).decode("utf-8")))
    q = 0
    for kind, sz in items:
        if kind == "endnote":
            q += 1
            continue
        if not q or not sz or sz[1] <= 0:
            continue
        if sz[0] / sz[1] >= FORM_STRIP_RATIO and sz[1] <= FORM_STRIP_MAX_H:
            per[q] = per.get(q, 0) + 1
    return per


def to_png(data: bytes, ext: str) -> tuple[bytes, int, int]:
    img = fitz.open(stream=data, filetype=ext)
    pdf = fitz.open("pdf", img.convert_to_pdf())
    pix = pdf[0].get_pixmap(dpi=72)  # 원본 화소 그대로
    return pix.tobytes("png"), pix.width, pix.height


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--max-repeat", type=int, default=2,
                    help="같은 이미지가 한 시험지에서 이 횟수를 넘으면 장식으로 본다")
    args = ap.parse_args()

    handoff = json.loads(pathlib.Path(HANDOFF).read_text(encoding="utf-8"))
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    src = hwpx_dir()

    repeat: dict[tuple[str, str], int] = {}
    for exam, rec in index.items():
        for _q, pics in (rec.get("q") or {}).items():
            for pic in pics:
                if pic.get("bin"):
                    key = (exam, pic["bin"])
                    repeat[key] = repeat.get(key, 0) + 1

    plan, held = [], []
    stat = {
        "인계행": 0, "확정행": 0, "확정장수": 0,
        "보류:벡터/OLE만": 0, "보류:장수불일치": 0, "그림아님:양식띠뿐": 0,
        "건너뜀:장식반복": 0, "건너뜀:너무작음": 0, "실패": 0,
        "쓴바이트": 0,
    }
    zcache: dict[str, zipfile.ZipFile] = {}
    strips_cache: dict[str, dict[int, int]] = {}

    for exam, by_q in sorted(handoff["편별"].items(), key=lambda kv: int(kv[0])):
        for q_str, want in sorted(by_q.items(), key=lambda kv: int(kv[0])):
            stat["인계행"] += 1
            pics = (index.get(exam) or {}).get("q", {}).get(q_str, [])
            if exam not in strips_cache:
                try:
                    strips_cache[exam] = form_strips(src / f"{exam}.hwpx")
                except Exception:  # noqa: BLE001
                    strips_cache[exam] = {}
            want_real = want - strips_cache[exam].get(int(q_str), 0)
            if not pics:
                if want_real <= 0:
                    stat["그림아님:양식띠뿐"] += 1
                    held.append({"e": exam, "q": int(q_str), "want": want, "raster": 0,
                                 "사유": "그림이 아니라 서술형 양식 띠다(회수 대상 아님)"})
                else:
                    stat["보류:벡터/OLE만"] += 1
                    held.append({"e": exam, "q": int(q_str), "want": want, "raster": 0,
                                 "사유": "HWP 에 BinData 그림이 없다(벡터로 그린 진짜 그림)"})
                continue
            if len(pics) != want_real:
                stat["보류:장수불일치"] += 1
                held.append({"e": exam, "q": int(q_str), "want": want, "raster": len(pics),
                             "기대": want_real,
                             "사유": "E 인계 장수(양식 띠 제외)와 raster 장수가 다르다"})
                continue

            try:
                if exam not in zcache:
                    zcache[exam] = zipfile.ZipFile(src / f"{exam}.hwpx")
                z = zcache[exam]
            except Exception:  # noqa: BLE001
                stat["실패"] += 1
                continue

            urls = []
            for i, pic in enumerate(pics):
                binname = pic.get("bin")
                if not binname:
                    continue
                if repeat.get((exam, binname), 0) > args.max_repeat:
                    stat["건너뜀:장식반복"] += 1
                    continue
                name = f"hwp-q{int(q_str):02d}" + (f"_{i}" if i else "") + ".png"
                dest = FIGROOT / exam / name
                url = f"/figures/{exam}/{name}"
                try:
                    raw = z.read(binname)
                    png, w, h = to_png(raw, pathlib.Path(binname).suffix.lstrip("."))
                except Exception:  # noqa: BLE001
                    stat["실패"] += 1
                    continue
                if w < MIN_PX or h < MIN_PX:
                    stat["건너뜀:너무작음"] += 1
                    continue
                urls.append(url)
                if dest.exists():
                    continue
                stat["쓴바이트"] += len(png)
                if args.write:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(png)

            if urls:
                stat["확정행"] += 1
                stat["확정장수"] += len(urls)
                plan.append({"e": exam, "q": int(q_str), "urls": urls})

    OUT.write_text(json.dumps(
        {"기록": args.write, "인계파일": HANDOFF, "집계": stat, "계획": plan, "보류": held},
        ensure_ascii=False), encoding="utf-8")
    print("── 트랙 E 적재분 그림 준비 ──", "기록함" if args.write else "드라이런(파일 안 씀)")
    for k, v in stat.items():
        print(f"  {k:16s} {v/1e6:.1f}MB" if k.endswith("바이트") else f"  {k:16s} {v}")
    print("→", OUT)


if __name__ == "__main__":
    main()
