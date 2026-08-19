# -*- coding: utf-8 -*-
"""PDF 오려내기가 **놓친 그림**을 HWP 정본(BinData)에서 오려 온다. 토큰 0 · API 0.

`map-figures.py` 는 PDF 좌표로 그림을 찾는다 — 임베드 이미지가 아닌 형태나 줄머리
인식 실패로 놓치는 문항이 있다(A-2 실측 96건). HWPX 는 `<hp:pic>` 이 문단 안에
있어 그런 문항의 그림도 그대로 갖고 있다.

    python scripts/figure/recover-hwp-figures.py                드라이런(추출 안 함)
    python scripts/figure/recover-hwp-figures.py --write        public/figures/ 에 기록
    python scripts/figure/recover-hwp-figures.py --write --limit 50

선행: `node scripts/figure/export-figure-rows.mjs` (정렬행 지도)
      `python scripts/figure/index-hwp-figures.py`
      `node scripts/qa/_gap-full.mjs` 류로 만든 회수 후보 목록
입력: `scripts/qa/reports/figure-recover-candidates.json`
출력: `public/figures/<examId>/hwp-qNN[_i].png` + `scripts/qa/reports/figure-recover-plan.json`

- **PNG 로 통일**한다. HWP 는 무압축 BMP 를 많이 쓴다(편당 27MB) — 그대로 두면
  지면·화면이 무거워진다. 실측 압축비 약 1/8 (3.4MB bmp → 439KB png).
- 이미 같은 이름의 파일이 있으면 다시 쓰지 않는다(재실행이 곧 이어달리기).
- **DB 는 건드리지 않는다.** 적용은 `attach-hwp-figures.mjs`.

── 정밀도 필터 두 개 (2026-08-16 표본 검수에서 걸린 것) ─────────────────
1. **본문 일치**(`--min-sim`): 트랙 D 의 `hwp-verdicts.jsonl` 이 준 DB 본문 ↔ HWP
   발문 유사도가 낮으면 그 행은 그 HWP 문항이 아니다. 표본에서 sim 0.075 인 행에
   엉뚱한 그림(택배 표 문제에 지도 그림)이 붙을 뻔했다.
2. **장식 걸러내기**: `<hp:pic>` 에는 그림만 있는 게 아니다. (가)~(다) 풀이 과정에
   쓰는 **화살표 도형**이 문항마다 3장씩 들어 있었다. 같은 이미지가 시험지 안에서
   여러 번 되풀이되면 장식으로 보고 버린다.
3. **이미 남의 문항에 붙어 있으면 버린다**: '오른쪽 그림과 같이' 처럼 지면 오른쪽에
   떠 있는 그림은 HWP 문단 흐름에서 **앞 문항** 범위에 걸린다(실측 4321: 12번의
   16점 격자가 11번에 잡혔다). 회수하려는 이미지가 같은 시험지의 다른 문항에 이미
   붙어 있는 그림과 같으면 앵커 어긋남으로 보고 회수하지 않는다.

   ⚠️ **이 가드는 «DB 에 붙어 있는 것이 옳다»를 전제한다.** 그런데 이 저장소가 이미
   적어 둔 정밀도 한계가 정확히 그 반대다 — PDF 오려내기는 **옆 문항 그림을 딸려
   담는다**(16-figure-recovery-ledger §3.3). 그러면 손상된 사본이 «HWP 가 틀렸다»는
   증거로 읽힌다. 2026-08-19 실측: 후보 11행 중 6행이 여기 걸렸고 **여섯 장을 다 열어
   보니 여섯 다 DB 쪽이 틀렸다**(예: 2622 는 q09.jpeg 가 6번 그림, q09_1.jpeg 가
   9번 그림 — 한 칸씩 밀려 있었다).

   그렇다고 가드를 끄면 진짜 앵커 어긋남(4321)이 되살아난다. **문턱을 옮기지 말고
   근거를 하나 더 요구한다** — `--eyecheck` 로 준 파일에 «사람이 열어 보고 회수라고
   적은 행»만 이 가드를 통과한다. 그 파일에는 무엇을 보고 그렇게 정했는지가 함께 있다.

── `--eyecheck` (2026-08-19) ────────────────────────────────────────────────
`scripts/qa/hwp-figure-eyecheck.json` — `{판정: {<problemId>: {판정, 근거}}}`.
`회수` 로 적힌 행만 앵커 가드를 넘어간다. 적혀 있지 않은 행은 예전과 똑같이 버린다.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import pathlib
import sys
import zipfile

import fitz

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

CAND = pathlib.Path("scripts/qa/reports/figure-recover-candidates.json")
INDEX = pathlib.Path("scripts/figure/hwp-figure-index.json")
ROWMAP = pathlib.Path("scripts/qa/reports/figure-row-map.json")
VERDICTS = os.environ.get(
    "HWP_VERDICTS",
    "C:/Users/user/orca/workspaces/testautocreator/잔여-D-HWP/scripts/qa/reports/hwp-verdicts.jsonl",
)
OUT = pathlib.Path("scripts/qa/reports/figure-recover-plan.json")
FIGROOT = pathlib.Path("public/figures")

# 배너는 색인 단계에서 이미 걸렀다. 여기서는 지나치게 작은 조각만 버린다
# (아이콘·불릿이 pic 으로 들어간 경우).
MIN_PX = 40

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


def thumb(path: pathlib.Path | None = None, data: bytes | None = None,
          ext: str | None = None) -> list[int]:
    """`match-hwp-figures.py` 와 같은 규약의 64×64 회색 썸네일."""
    src = fitz.open(str(path)) if path is not None else fitz.open(stream=data, filetype=ext)
    rect = src[0].rect
    scale = min(64 / max(rect.width, 1), 64 / max(rect.height, 1))
    tw, th = rect.width * scale, rect.height * scale
    x, y = (64 - tw) / 2, (64 - th) / 2
    doc = fitz.open()
    page = doc.new_page(width=64, height=64)
    page.draw_rect(fitz.Rect(0, 0, 64, 64), color=None, fill=(1, 1, 1))
    box = fitz.Rect(x, y, x + tw, y + th)
    if path is not None:
        page.insert_image(box, filename=str(path))
    else:
        page.insert_image(box, stream=data)
    return list(page.get_pixmap(colorspace=fitz.csGRAY).samples)


def pearson(a: list[int], b: list[int]) -> float:
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    if va == 0 or vb == 0:
        return 0.0
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb)


def to_png(data: bytes, ext: str) -> tuple[bytes, int, int]:
    """BinData 원본 → PNG 바이트. 크기(px)도 함께 돌려준다."""
    img = fitz.open(stream=data, filetype=ext)
    pdf = fitz.open("pdf", img.convert_to_pdf())
    page = pdf[0]
    # 원본 화소 그대로 (변환 PDF 는 1px = 1pt 로 만들어진다). 150dpi 로 올리면
    # 없는 해상도를 만들어 파일만 커진다 — 실측 43MB → 12MB 차이.
    pix = page.get_pixmap(dpi=72)
    return pix.tobytes("png"), pix.width, pix.height


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="파일을 실제로 기록한다")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--min-sim", type=float, default=0.6,
                    help="DB 본문 ↔ HWP 발문 유사도 하한 (트랙 D 판정)")
    ap.add_argument("--max-repeat", type=int, default=2,
                    help="같은 이미지가 한 시험지에서 이 횟수를 넘으면 장식으로 본다")
    ap.add_argument("--eyecheck", default="",
                    help="사람이 열어 보고 내린 판정 파일. 여기서 «회수» 인 행만 "
                         "앵커 어긋남 가드를 통과한다 (윗글 참조)")
    args = ap.parse_args()

    # 1) 본문 일치 — 트랙 D 판정에서 유사도만 읽는다(파일 in).
    sim: dict[str, float] = {}
    with open(VERDICTS, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            v = json.loads(line)
            if v.get("sim") is not None:
                sim[v["id"]] = v["sim"]

    # 2) 장식 — 같은 BinData 가 한 시험지 안에서 몇 문항에 걸쳐 쓰였나.
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    repeat: dict[tuple[str, str], int] = {}
    for exam_id, rec in index.items():
        for _q, pics in (rec.get("q") or {}).items():
            for pic in pics:
                if pic.get("bin"):
                    key = (exam_id, pic["bin"])
                    repeat[key] = repeat.get(key, 0) + 1

    # 3) 앵커 어긋남 — 시험지별로 '이미 다른 문항에 붙어 있는 그림' 썸네일.
    attached: dict[str, list[tuple[int, list[int]]]] = {}
    for row in json.loads(ROWMAP.read_text(encoding="utf-8")):
        for url in row.get("db") or []:
            f = pathlib.Path("public" + url)
            if not f.exists():
                continue
            attached.setdefault(row["e"], []).append((row["q"], f))

    # 사람이 열어 보고 «회수» 라고 적은 행 — 앵커 가드를 넘어갈 수 있는 것들.
    cleared: set[str] = set()
    if args.eyecheck:
        eye = json.loads(pathlib.Path(args.eyecheck).read_text(encoding="utf-8"))
        cleared = {k for k, v in (eye.get("판정") or {}).items()
                   if v.get("판정") == "회수"}
        print(f"  육안 판정 파일: «회수» {len(cleared)}행 ({args.eyecheck})")

    cands = json.loads(CAND.read_text(encoding="utf-8"))
    if args.limit:
        cands = cands[: args.limit]
    src = hwpx_dir()

    plan, stat = [], {
        "후보행": 0, "회수행": 0, "회수장수": 0, "건너뜀:이미있음": 0,
        "건너뜀:너무작음": 0, "건너뜀:본문불일치": 0, "건너뜀:장식반복": 0,
        "건너뜀:앵커어긋남": 0,
        "실패": 0, "쓴바이트": 0, "원본바이트": 0,
    }
    zcache: dict[str, zipfile.ZipFile] = {}
    att_cache: dict[str, list[int] | None] = {}
    for c in cands:
        stat["후보행"] += 1
        exam = c["e"]
        s_val = sim.get(c["id"])
        if s_val is not None and s_val < args.min_sim:
            stat["건너뜀:본문불일치"] += 1
            continue
        try:
            if exam not in zcache:
                zcache[exam] = zipfile.ZipFile(src / f"{exam}.hwpx")
            z = zcache[exam]
        except Exception:  # noqa: BLE001
            stat["실패"] += 1
            continue

        urls = []
        for i, binname in enumerate(c["pics"]):
            if repeat.get((exam, binname), 0) > args.max_repeat:
                stat["건너뜀:장식반복"] += 1
                continue
            name = f"hwp-q{int(c['q']):02d}" + (f"_{i}" if i else "") + ".png"
            dest = FIGROOT / exam / name
            url = f"/figures/{exam}/{name}"
            try:
                raw = z.read(binname)
                ext = pathlib.Path(binname).suffix.lstrip(".")
                png, w, h = to_png(raw, ext)
            except Exception:  # noqa: BLE001
                stat["실패"] += 1
                continue
            if w < MIN_PX or h < MIN_PX:
                stat["건너뜀:너무작음"] += 1
                continue
            # 앵커 어긋남: 같은 시험지의 **다른 문항**에 이미 붙어 있는 그림이면 버린다.
            try:
                mine = thumb(data=raw, ext=ext)
            except Exception:  # noqa: BLE001
                mine = None
            if mine is not None:
                clash = None
                for other_q, other_file in attached.get(exam, []):
                    if other_q == c["q"]:
                        continue
                    key = str(other_file)
                    if key not in att_cache:
                        try:
                            att_cache[key] = thumb(path=other_file)
                        except Exception:  # noqa: BLE001
                            att_cache[key] = None
                    t = att_cache[key]
                    if t is not None and pearson(mine, t) >= 0.6:
                        clash = other_q
                        break
                if clash is not None and c["id"] not in cleared:
                    stat["건너뜀:앵커어긋남"] += 1
                    continue
                if clash is not None:
                    # 사람이 열어 보고 «DB 쪽이 잘못 붙은 것» 이라고 확인한 행이다.
                    stat["앵커가드:사람이통과시킴"] = (
                        stat.get("앵커가드:사람이통과시킴", 0) + 1
                    )
            urls.append(url)
            stat["회수장수"] += 1
            if dest.exists():
                stat["건너뜀:이미있음"] += 1
                continue
            stat["원본바이트"] += len(raw)
            stat["쓴바이트"] += len(png)
            if args.write:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(png)

        if urls:
            stat["회수행"] += 1
            plan.append({"id": c["id"], "e": exam, "q": c["q"], "mention": c.get("mention"),
                         "sim": s_val, "urls": urls})

    OUT.write_text(json.dumps({"기록": args.write, "집계": stat, "계획": plan},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    print("── HWP 그림 회수 ──", "기록함" if args.write else "드라이런(파일 안 씀)")
    for k, v in stat.items():
        if k.endswith("바이트"):
            print(f"  {k:14s} {v/1e6:.1f}MB")
        else:
            print(f"  {k:14s} {v}")
    print("→", OUT)


if __name__ == "__main__":
    main()
