# -*- coding: utf-8 -*-
"""RPM 원장의 「자리 못 구함」을 계획 파일 3개 + 디스크 PNG 로 메운다.

앞 세션은 「그때 쓴 계획이 이 컴퓨터에 없다」고 적었는데, 메인 워크트리에 있었고
여기로 복사돼 있다. 세 파일을 겹쳐 대조한 실측:

  rpm-crop-plan-gated.json      403 문항 — 본문 유사도 0.85 · 책별 쪽 오프셋
  rpm-crop-plan-main667.json    667 문항
  rpm-crop-plan-recrop1646.json 1,646 문항
  합집합 1,854. 겹치는 545문항의 **rect 불일치 0.**

⚠️ 그 rect 는 그림 칸이 **아니다.** 세 파일 모두 `rpm-origin.json` 의
`source_coords`(문항 상자)와 같고, 디스크 PNG 치수(`rect × dpi`)와는
0건이 맞는다. 원장에 그대로 옮겨 적으면 발문 상자가 그림 칸이 된다.

계획이 실제로 주는 것:
  1. 3-2 의 쪽 오프셋 +3 (gated). 그리고 **−3 도 필요했다** — 원장 재현은
     `(0, +3)` 만 봐서 1-1·1-2 의 일부가 통째로 빗나갔다(표본 5건 중 3건).
  2. 자리 못 구한 600장의 원본 PDF·쪽·상자 **전량**이 recrop1646 에 있다.

그림 칸은 디스크 PNG 를 그 쪽 **전체** 위에 겹쳐 찾아 증명한다.
문항 상자 안에서만 찾으면 라벨·옆 그림 조각을 집는다(실측 5/5).

  python scripts/figure/fill-rpm-rects-from-plans.py
  python scripts/figure/fill-rpm-rects-from-plans.py --limit 30 --sheet
"""
from __future__ import annotations

import argparse
import collections
import importlib.util
import json
import pathlib
import sys
import time

import fitz
from PIL import Image, ImageChops

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))

_spec = importlib.util.spec_from_file_location("ledger", HERE / "build-rect-ledger.py")
L = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(L)

REPORTS = ROOT / "scripts" / "qa" / "reports"
FIG = ROOT / "public" / "figures"
RPM_LEDGER = REPORTS / "figure-rect-ledger-rpm.json"
OUT_STATS = REPORTS / "rpm-rect-fill.json"
SHEET = ROOT / ".work" / "rpm-rect-fill-sheet.png"

PLAN_FILES = (
    ("gated", "rpm-crop-plan-gated.json"),
    ("main667", "rpm-crop-plan-main667.json"),
    ("recrop1646", "rpm-crop-plan-recrop1646.json"),
)

#: 원장이 자리를 「구했다」고 한 문턱과 **같은 값**. 낮추면 찾은 척하고
#: 옆 그림을 붙인다. 표본을 눈으로 봐서 0.03 아래는 같은 그림이었다.
DIFF_OK = L.DIFF_OK  # 0.03
#: 쪽 전체에서 찾으면 **옆 문항의 닮은 도형**이 0.029 로 통과한다
#: (실측 `019fd1d7-a1ec`: 디스크는 △OBC, 찾은 칸은 △DEF). 96×96 평균차는
#: 이 부류를 구조적으로 못 가른다. 그래서 문항 상자(+80pt)와 **안 겹치면**
#: 문턱을 더 낮춘다. 0.020 이하는 실린더·교점 같이 상자 밖에 있는 진짜 그림
#: (눈으로 확인). 그 위는 다른 표·다른 삼각형이었다.
FAR_STEM_DIFF_OK = 0.020
STEM_PAD = 80.0
LOC_DPI = 72
PAGE_OFFSETS = (-3, 0, 3)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def mad96(a: Image.Image, b: Image.Image) -> float:
    d = ImageChops.difference(
        a.convert("L").resize((96, 96), Image.BILINEAR),
        b.convert("L").resize((96, 96), Image.BILINEAR),
    )
    h = d.histogram()
    return sum(i * c for i, c in enumerate(h)) / sum(h) / 255.0


def mad_raw(a: Image.Image, b: Image.Image) -> float:
    d = ImageChops.difference(a, b)
    h = d.histogram()
    s = sum(h) or 1
    return sum(i * c for i, c in enumerate(h)) / s / 255.0


def locate(big: Image.Image, small: Image.Image):
    """큰 그림 안에서 작은 그림의 왼쪽 위 (px). 긴 변 100px 로 줄여 찾고 근처만 다시."""
    bw, bh = big.size
    sw, sh = small.size
    if sw >= bw or sh >= bh or sw < 4 or sh < 4:
        return None
    sc = max(1, int(round(max(bw, bh) / 100)))
    b4 = big.resize((max(1, bw // sc), max(1, bh // sc)), Image.BILINEAR)
    s4 = small.resize((max(4, sw // sc), max(4, sh // sc)), Image.BILINEAR)
    w4, h4 = b4.size
    sw4, sh4 = s4.size
    if sw4 >= w4 or sh4 >= h4:
        return None
    best = None
    for y in range(0, h4 - sh4 + 1):
        for x in range(0, w4 - sw4 + 1):
            v = mad_raw(b4.crop((x, y, x + sw4, y + sh4)), s4)
            if best is None or v < best[0]:
                best = (v, x, y)
    x0 = max(0, best[1] * sc - sc - 2)
    y0 = max(0, best[2] * sc - sc - 2)
    x1 = min(bw - sw, best[1] * sc + sc + 2)
    y1 = min(bh - sh, best[2] * sc + sc + 2)
    best2 = None
    for y in range(y0, y1 + 1, 2):
        for x in range(x0, x1 + 1, 2):
            v = mad_raw(big.crop((x, y, x + sw, y + sh)), small)
            if best2 is None or v < best2[0]:
                best2 = (v, x, y)
    return best2


def render(page, rect, dpi) -> Image.Image:
    pm = page.get_pixmap(clip=rect, dpi=dpi, colorspace=fitz.csGRAY)
    return Image.frombytes("L", (pm.width, pm.height), pm.samples)


def r4(rect) -> tuple:
    if isinstance(rect, dict):
        return tuple(round(float(rect[k]), 2) for k in ("x0", "y0", "x1", "y1"))
    return tuple(round(float(x), 2) for x in rect)


def load_plan(name):
    p = REPORTS / name
    if not p.exists():
        return None
    d = json.loads(p.read_text(encoding="utf-8"))
    by = {}
    for it in d["목록"]:
        by[it["externalId"]] = it
    return d, by


def plan_crosscheck(plans: dict) -> dict:
    """세 계획의 rect·page 가 얼마나 같은지 **세어서** 찍는다."""
    keys = {n: set(by) for n, (_, by) in plans.items()}
    union = set().union(*keys.values()) if keys else set()
    inter_rect_same = 0
    inter_rect_diff = 0
    page_diff = 0
    overlap_n = 0
    samples = []
    for ext in union:
        rects = {}
        pages = {}
        for n, (_, by) in plans.items():
            if ext in by:
                rects[n] = r4(by[ext]["rect"])
                pages[n] = int(by[ext]["page"])
        if len(rects) < 2:
            continue
        overlap_n += 1
        if len(set(rects.values())) == 1:
            inter_rect_same += 1
        else:
            inter_rect_diff += 1
            if len(samples) < 5:
                samples.append({"externalId": ext, "rect": rects, "page": pages})
        if len(set(pages.values())) > 1:
            page_diff += 1
    return {
        "파일별": {n: len(by) for n, (_, by) in plans.items()},
        "합집합": len(union),
        "겹침": overlap_n,
        "rect 같음": inter_rect_same,
        "rect 다름": inter_rect_diff,
        "page 다름": page_diff,
        "rect 불일치 표본": samples,
    }


def candidate_pages(doc, rec, g, rc) -> list[int]:
    pages = []
    if g:
        pages.append(int(g["page"]) - 1)
    if rc:
        pages.append(int(rc["page"]) - 1)
    op = int(rec["page"]) - 1
    for off in PAGE_OFFSETS:
        pages.append(op + off)
    out = []
    seen = set()
    for p in pages:
        if p in seen or not (0 <= p < doc.page_count):
            continue
        seen.add(p)
        out.append(p)
    return out


def fill_one(doc, rec, png, dpi, pages, cache):
    """(diff, page_index0, rect) 또는 None. cache: (pdf-name, pi) → 72dpi 쪽 그림."""
    w_pt = png.width / dpi * 72.0
    h_pt = png.height / dpi * 72.0
    small = png.resize(
        (max(4, round(png.width * LOC_DPI / dpi)),
         max(4, round(png.height * LOC_DPI / dpi))),
        Image.BILINEAR,
    )
    best = None
    pdf_key = str(doc.name) if hasattr(doc, "name") else id(doc)
    for pi in pages:
        key = (pdf_key, pi)
        if key not in cache:
            page = doc[pi]
            cache[key] = render(page, page.rect, LOC_DPI)
        big = cache[key]
        loc = locate(big, small)
        if loc is None:
            continue
        _, x, y = loc
        scale = LOC_DPI / 72.0
        rr = fitz.Rect(x / scale, y / scale,
                       (x + small.width) / scale, (y + small.height) / scale)
        page = doc[pi]
        for dy in (-1.0, -0.5, 0.0, 0.5, 1.0):
            for dx in (-1.0, -0.5, 0.0, 0.5, 1.0):
                cand = fitz.Rect(rr.x0 + dx, rr.y0 + dy,
                                 rr.x0 + dx + w_pt, rr.y0 + dy + h_pt) & page.rect
                if cand.width < 4 or cand.height < 4:
                    continue
                v = mad96(png, render(page, cand, dpi))
                if best is None or v < best[0]:
                    best = (v, pi, cand)
    return best


def stem_overlap(rect, rec) -> float:
    c = rec["rect"]
    stem = fitz.Rect(c["x0"] - STEM_PAD, c["y0"] - STEM_PAD,
                     c["x1"] + STEM_PAD, c["y1"] + STEM_PAD)
    inter = (fitz.Rect(rect) & stem)
    if inter.is_empty:
        return 0.0
    area = fitz.Rect(rect).get_area()
    return inter.get_area() / area if area else 0.0


def apply_row(row, best, page):
    v, pi, rect = best
    dpi = row.get("render_dpi")
    px = row.get("current_px")
    kind, strokes, cover = L.PageInfo(page).kind(rect)
    note = ("계획+디스크 PNG 쪽전체 겹쳐 대조 %.3f (문턱 %.2f). "
            "계획 rect 는 source_coords 라 그림 칸으로 안 썼다"
            % (v, DIFF_OK))
    if dpi and px:
        want = [round(rect.width / 72.0 * dpi), round(rect.height / 72.0 * dpi)]
        if abs(px[0] - want[0]) > L.DIM_TOL or abs(px[1] - want[1]) > L.DIM_TOL:
            note += " · ⚠ 치수 교차검산 어긋남: 파일 %s vs rect×%ddpi %s" % (px, dpi, want)
    row["page_index0"] = pi
    row["rect_pt"] = [round(x, 2) for x in (rect.x0, rect.y0, rect.x1, rect.y1)]
    row["kind"] = kind
    row["note"] = note
    row["match"] = "rect+png-dpi" if dpi else "rect"
    # 크기는 원래 PNG dpi 로 이미 들어 있다. rect 와도 맞아야 하므로 덮어쓴다.
    row["width_mm"] = L.mm(rect.width)
    row["height_mm"] = L.mm(rect.height)
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--sheet", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="원장을 쓰지 않는다")
    a = ap.parse_args()

    rpm = json.loads(RPM_LEDGER.read_text(encoding="utf-8"))
    origin = json.loads(L.ORIGIN.read_text(encoding="utf-8"))
    by_ext = {r["externalId"]: r for r in origin["목록"]}

    plans = {}
    missing_plans = []
    for key, fn in PLAN_FILES:
        loaded = load_plan(fn)
        if loaded is None:
            missing_plans.append(fn)
        else:
            plans[key] = loaded
    if missing_plans:
        raise SystemExit("계획 파일이 없다: %s" % ", ".join(missing_plans))
    xcheck = plan_crosscheck(plans)
    print("계획 교차", json.dumps(xcheck, ensure_ascii=False))
    if xcheck["rect 다름"]:
        print("⚠️ 세 계획의 rect 가 어긋난다 — 표본을 먼저 눈으로 봐라. 자동으로 안 메운다.")
        return

    gated = plans["gated"][1]
    recrop = plans["recrop1646"][1]
    main667 = plans["main667"][1]

    targets = [r for r in rpm["행"] if not r.get("rect_pt")]
    if a.limit:
        targets = targets[: a.limit]
    print("대상 %d / 원장 자리없음 %d" % (
        len(targets), sum(1 for r in rpm["행"] if not r.get("rect_pt"))))

    docs = {}
    cache = {}
    stat = collections.Counter()
    recs = []
    sheet_cells = []
    t0 = time.time()

    for i, row in enumerate(targets):
        fig = row["figure"]
        ext = fig.split("/")[1]
        rec = by_ext.get(ext)
        pdf = pathlib.Path(row["source_pdf"]) if row.get("source_pdf") else None
        if rec is None:
            stat["원본정보없음"] += 1
            recs.append({"figure": fig, "ok": False, "why": "rpm-origin 없음"})
            continue
        if not pdf or not pdf.exists():
            stat["원본PDF없음"] += 1
            recs.append({"figure": fig, "ok": False, "why": "pdf 없음"})
            continue
        png_path = FIG / fig
        if not png_path.exists():
            stat["디스크없음"] += 1
            recs.append({"figure": fig, "ok": False, "why": "png 없음"})
            continue
        dpi = row.get("render_dpi")
        px = row.get("current_px")
        if not dpi or not px:
            stat["dpi없음"] += 1
            recs.append({"figure": fig, "ok": False, "why": "png dpi 없음"})
            continue
        if pdf not in docs:
            docs[pdf] = fitz.open(pdf)
        doc = docs[pdf]
        png = Image.open(png_path).convert("L")
        pages = candidate_pages(doc, rec, gated.get(ext), recrop.get(ext))
        in_plans = [n for n, by in (("gated", gated), ("main667", main667),
                                    ("recrop1646", recrop)) if ext in by]
        best = fill_one(doc, rec, png, dpi, pages, cache)
        far = bool(best) and stem_overlap(best[2], rec) <= 0
        accept = bool(best) and best[0] <= DIFF_OK and (
            not far or best[0] <= FAR_STEM_DIFF_OK)
        if best and best[0] <= DIFF_OK and not accept:
            stat["상자밖거절"] += 1
        if accept:
            apply_row(row, best, doc[best[1]])
            stat["되찾음"] += 1
            stat["kind:%s" % row["kind"]] += 1
            recs.append({"figure": fig, "ok": True, "diff": round(best[0], 4),
                         "page_index0": best[1], "rect_pt": row["rect_pt"],
                         "plans": in_plans, "kind": row["kind"],
                         "far_stem": far})
            if a.sheet and len(sheet_cells) < 16:
                got = render(doc[best[1]], fitz.Rect(*row["rect_pt"]), 150)
                sheet_cells.append((fig, best[0], png, got))
        else:
            stat["못찾음"] += 1
            why = "겹쳐 대조 %.3f" % best[0] if best else "칸 못 찾음"
            was_group = "한 문항에 그림이" in (row.get("note") or "")
            if was_group:
                row["note"] = (
                    "한 문항에 그림이 여러 장이다(무리 그림). "
                    "쪽 전체에 디스크 PNG 를 겹쳐 찾아도 안 맞는다 (%s)" % why
                )
            else:
                row["note"] = (
                    "계획 3개로 쪽을 고르고 디스크 PNG 를 쪽 전체에 겹쳐 찾아도 안 맞는다"
                    " (%s). 계획 rect 는 source_coords 라 그림 칸이 아니다" % why
                )
            recs.append({"figure": fig, "ok": False,
                         "diff": round(best[0], 4) if best else None,
                         "page_index0": best[1] if best else None,
                         "plans": in_plans,
                         "why": why})
        if (i + 1) % 50 == 0:
            print("  %d/%d 되찾음 %d 못찾음 %d  %.0fs" % (
                i + 1, len(targets), stat["되찾음"], stat["못찾음"],
                time.time() - t0), flush=True)

    elapsed = round(time.time() - t0, 1)
    n_ok = stat["되찾음"]
    n_bad = stat["못찾음"] + stat["원본정보없음"] + stat["원본PDF없음"] + stat["디스크없음"] + stat["dpi없음"]
    print("대상 %d · 되찾음 %d · 못찾음 %d · %.1fs" % (len(targets), n_ok, n_bad, elapsed))
    for k, v in sorted(stat.items()):
        print("  %-24s %d" % (k, v))

    diffs = sorted(x["diff"] for x in recs if x.get("ok") and x.get("diff") is not None)
    if diffs:
        n = len(diffs)
        print("통과 겹쳐대조 — 최소 %.4f · 중앙 %.4f · 90%% %.4f · 최대 %.4f"
              % (diffs[0], diffs[n // 2], diffs[min(n - 1, int(n * 0.9))], diffs[-1]))

    out = {
        "기준": "계획 3개의 rect 는 source_coords 라 그림 칸으로 안 썼다. "
                "디스크 PNG 를 원본 쪽 전체에 겹쳐 자리를 증명한다.",
        "문턱": DIFF_OK,
        "계획교차": xcheck,
        "대상": len(targets),
        "되찾음": n_ok,
        "못찾음": n_bad,
        "초": elapsed,
        "집계": dict(stat),
        "행": recs,
    }
    if not a.dry_run:
        OUT_STATS.write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
        RPM_LEDGER.write_text(json.dumps(rpm, ensure_ascii=False, indent=0), encoding="utf-8")
        print("→", OUT_STATS)
        print("→", RPM_LEDGER, "(자리없는 행만 고침)")
        L.do_merge()
    else:
        print("dry-run — 원장을 안 썼다")

    if sheet_cells:
        from PIL import ImageDraw
        CW, CH = 330, 240
        sh = Image.new("L", (CW * 2 + 30, CH * len(sheet_cells) + 20), 255)
        dr = ImageDraw.Draw(sh)
        for i, (n, d, o, m) in enumerate(sheet_cells):
            y = i * CH + 16
            dr.text((5, y - 13), "%s diff=%.4f (왼:디스크 / 오른:찾은 칸)"
                    % (n[4:48], d), fill=0)
            for j, im in enumerate((o, m)):
                c = im.copy()
                c.thumbnail((CW - 10, CH - 24))
                sh.paste(c, (j * CW + 10, y))
        SHEET.parent.mkdir(parents=True, exist_ok=True)
        sh.save(SHEET)
        print("대조표 →", SHEET)


if __name__ == "__main__":
    main()
