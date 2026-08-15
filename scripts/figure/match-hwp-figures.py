# -*- coding: utf-8 -*-
"""DB 에 붙은 그림이 **HWP 정본의 그 문항 그림과 같은 그림인지** 이미지로 대조한다.

`map-figures.py` 는 PDF 좌표로 그림을 문항에 배치한다 — 인접 문항의 그림까지 끌어오는
과다 부착이 생긴다(실측: 양쪽 다 그림이 있는 5,779행 중 DB 가 더 많은 것 549행,
HWP 가 더 많은 것 23행 — 편향이 한쪽이다). HWPX 는 그림이 문단 흐름 안에 있어
소유 문항이 문서 구조로 정해지므로 **정본**으로 쓴다.

    python scripts/figure/match-hwp-figures.py            전량 대조
    python scripts/figure/match-hwp-figures.py --limit 200

선행: `python scripts/figure/index-hwp-figures.py` (HWP 그림 색인)
      트랙 D 의 `hwp-verdicts.jsonl` (DB 문항번호 ↔ HWP 순번 정렬)
출력: `scripts/qa/reports/figure-match-plan.json` — 문항별 유지/제거/회수 계획

── 대조 방법 (보정 실측 2026-08-16) ──────────────────────────────────────
종횡비를 보존해 64×64 회색 썸네일로 만든 뒤 **피어슨 상관**을 본다.
같은 그림 400쌍: 중앙 0.998 · r≥0.6 이 92.2%.
다른 그림 340쌍: 중앙 0.063 · r≥0.6 이  0.6%.
→ 임계 0.6. 평균차(MAE)로는 갈리지 않는다(수학 그림은 대부분 흰 바탕이라
   저해상도에서 서로 비슷해진다) — 그래서 상관을 쓴다.

── 떼는 조건 (정밀도 우선) ─────────────────────────────────────────────
"그 문항 그림과 안 맞다" 만으로는 떼지 않는다. **그 그림이 같은 시험지의 다른
문항 것임이 증명될 때만** 뗀다. 안 맞지만 어디에도 없는 그림은 보류한다 —
선택지마다 그림인 문항(실측 최대 6장)이 있고, HWP 가 그 그림을 `<hp:pic>` 이
아니라 OLE·벡터로 담았을 수 있기 때문이다. 그런 것을 떼면 문항이 못 풀게 된다.

⚠️ 이 스크립트는 **DB 를 쓰지 않는다.** 계획만 만든다. 적용은 `prune-figures.mjs`.
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

N = 64
THRESHOLD = 0.6
INDEX = pathlib.Path("scripts/figure/hwp-figure-index.json")
ROWS = pathlib.Path("scripts/qa/reports/figure-rows.json")
OUT = pathlib.Path("scripts/qa/reports/figure-match-plan.json")

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
    """종횡비를 보존해 흰 바탕 64×64 회색 썸네일로 만든다."""
    src = fitz.open(str(path)) if path is not None else fitz.open(stream=data, filetype=ext)
    rect = src[0].rect
    scale = min(N / max(rect.width, 1), N / max(rect.height, 1))
    tw, th = rect.width * scale, rect.height * scale
    x, y = (N - tw) / 2, (N - th) / 2
    doc = fitz.open()
    page = doc.new_page(width=N, height=N)
    page.draw_rect(fitz.Rect(0, 0, N, N), color=None, fill=(1, 1, 1))
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--threshold", type=float, default=THRESHOLD)
    args = ap.parse_args()

    index = json.loads(INDEX.read_text(encoding="utf-8"))
    rows = json.loads(ROWS.read_text(encoding="utf-8"))
    if args.limit:
        rows = rows[: args.limit]
    src = hwpx_dir()

    zcache: dict[str, zipfile.ZipFile] = {}
    tcache: dict[tuple[str, str], list[int] | None] = {}

    def exam_pics(exam: str) -> list[tuple[str, str]]:
        """(문항순번, BinData 이름) 전량 — 떼기 전에 '주인 찾기' 용."""
        idx = index.get(exam) or {}
        return [(q, p["bin"]) for q, pics in (idx.get("q") or {}).items()
                for p in pics if p.get("bin")]

    def hwp_thumb(exam: str, binname: str):
        key = (exam, binname)
        if key not in tcache:
            try:
                if exam not in zcache:
                    zcache[exam] = zipfile.ZipFile(src / f"{exam}.hwpx")
                data = zcache[exam].read(binname)
                tcache[key] = thumb(data=data, ext=pathlib.Path(binname).suffix.lstrip("."))
            except Exception:  # noqa: BLE001
                tcache[key] = None
        return tcache[key]

    plan, stat = [], {
        "행": 0, "HWP없음": 0, "DB그림없음": 0, "대조실패": 0,
        "전부일치": 0, "일부오배치": 0, "전부오배치": 0,
        "일부보류": 0, "주인불명": 0,
        "제거대상장수": 0, "보류장수": 0,
    }
    for i, r in enumerate(rows, 1):
        exam, hq = r["e"], str(r["hwpQ"])
        pics = (index.get(exam) or {}).get("q", {}).get(hq, [])
        db_urls = r.get("db") or []
        stat["행"] += 1
        if not pics:
            stat["HWP없음"] += 1
            plan.append({**r, "verdict": "HWP없음", "keep": db_urls, "drop": []})
            continue
        if not db_urls:
            stat["DB그림없음"] += 1
            plan.append({**r, "verdict": "회수후보", "keep": [], "drop": [],
                         "hwpPics": [p["bin"] for p in pics]})
            continue

        hwp_thumbs = [(p["bin"], hwp_thumb(exam, p["bin"])) for p in pics]
        hwp_thumbs = [(b, t) for b, t in hwp_thumbs if t is not None]
        if not hwp_thumbs:
            stat["대조실패"] += 1
            plan.append({**r, "verdict": "대조실패", "keep": db_urls, "drop": []})
            continue

        keep, drop, hold, scores, owners = [], [], [], {}, {}
        failed = False
        for url in db_urls:
            p = pathlib.Path("public" + url)
            if not p.exists():
                drop.append(url)  # 파일이 없으면 깨진 이미지다 — 떼는 게 낫다
                scores[url] = None
                continue
            try:
                t = thumb(path=p)
            except Exception:  # noqa: BLE001
                failed = True
                keep.append(url)
                scores[url] = None
                continue
            best = max((pearson(t, ht), b) for b, ht in hwp_thumbs)
            scores[url] = round(best[0], 3)
            if best[0] >= args.threshold:
                keep.append(url)
                continue
            # 이 문항 그림이 아니다. **다른 문항 것임이 증명될 때만** 뗀다.
            owner, owner_score = None, 0.0
            for q2, bin2 in exam_pics(exam):
                if q2 == hq:
                    continue
                t2 = hwp_thumb(exam, bin2)
                if t2 is None:
                    continue
                r2 = pearson(t, t2)
                if r2 > owner_score:
                    owner, owner_score = q2, r2
            if owner is not None and owner_score >= args.threshold:
                drop.append(url)
                owners[url] = {"문항": owner, "점수": round(owner_score, 3)}
            else:
                hold.append(url)
                scores[url] = {"이문항": scores[url], "최고타": round(owner_score, 3)}

        verdict = ("대조실패" if failed else
                   "전부일치" if not drop and not hold else
                   "주인불명" if not drop and hold and not keep else
                   "일부보류" if not drop and hold else
                   "전부오배치" if not keep and not hold else "일부오배치")
        stat[verdict] = stat.get(verdict, 0) + 1
        stat["제거대상장수"] += len(drop) if keep else 0
        stat["보류장수"] += len(hold)
        plan.append({**r, "verdict": verdict, "keep": keep, "drop": drop, "hold": hold,
                     "scores": scores, "owners": owners, "hwpN": len(pics)})
        if i % 500 == 0:
            print(f"  … {i}/{len(rows)}", flush=True)

    OUT.write_text(json.dumps(
        {"임계": args.threshold, "집계": stat, "계획": plan}, ensure_ascii=False), encoding="utf-8")
    print("── HWP 정본 대조 ──")
    for k, v in stat.items():
        print(f"  {k:10s} {v}")
    print("→", OUT)


if __name__ == "__main__":
    main()
