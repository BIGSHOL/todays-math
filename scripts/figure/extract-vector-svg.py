# -*- coding: utf-8 -*-
"""**벡터인 그림은 SVG 로 뽑는다** (브리프 ㉯ · 화질 트랙 §4 ㉠ · §12).

RPM 교재는 표본 100.0%, 기출은 8.5% 가 원본에서 벡터다. 이 무리는 다시 자를
필요가 없다 — 해상도 개념이 사라진다.

## 어떻게 뽑나 — 세 걸음

1. ㉮ 원장(`figure-rect-ledger.json`)에서 `kind == "vector"` 이고 `rect_pt` 가
   **증명된** 행만 고른다.
2. 그 칸만 담은 한 쪽짜리 PDF 를 만들어(`show_pdf_page(clip=rect)`)
   `get_svg_image(text_as_path=True)` 로 SVG 를 얻고, `svg_prune` 으로 **칸 밖의
   것을 쳐낸다**(실측 443KB → 32KB).
3. **지면과 같은 렌더러(Chromium)로 그려 원본 크롭과 겹쳐 대조**한다.
   차이가 크면 **버린다.** 좌표를 옮기는 일이라 틀리면 도형이 통째로 어긋나는데,
   어긋난 그림은 지면에서 티가 안 난다.

## 글자를 **다시 조판하지 않는다** — 재 보고 그만뒀다 (2026-08-19)

처음엔 획을 `get_drawings()` 로 옮기고 글자는 `<text>` 로 다시 썼다. 도형은 잘
나왔는데 **글자가 통째로 틀렸다**: RPM 은 `℃` 가 `¾` 로, 분수가 엉뚱한 글자로
나온다(`EHsang`·`EHboNA` 자체 인코딩). 기출은 `HyhwpEQ` 가 PUA 를 써서 **표본 60건
중 58건**이 그렇다. 그리고 **이 오류는 겹쳐 대조에 안 걸린다** — `℃`↔`¾` 는 픽셀
차이가 작아 평균 절대차 0.027 로 통과했다. 「틀린 숫자는 아무 말도 안 한다」.
그래서 글리프는 **윤곽선 그대로** 옮긴다.

⚠️ 그 대가로 **글자 크기는 `type_scale` 로 통일할 수 없다**(§9 ⑥). 윤곽선이라
크기를 바꾸려면 다시 조판해야 하고, 다시 조판하면 위의 오류가 돌아온다.
선 굵기는 정규화한다 — 그건 내용을 안 바꾼다.

사용:
  python scripts/figure/extract-vector-svg.py --limit 40 --sheet
  python scripts/figure/extract-vector-svg.py --only rpm/
  python scripts/figure/extract-vector-svg.py
"""
import argparse
import collections
import json
import pathlib
import re
import subprocess
import sys
import time

import fitz
from PIL import Image, ImageChops

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "vendor" / "figure-engine"))
import svg_prune  # noqa: E402

REPORTS = ROOT / "scripts" / "qa" / "reports"
LEDGER = REPORTS / "figure-rect-ledger.json"
#: **새 디렉터리에 만든다.** `public/figures` 의 기존 파일은 지우지도 덮지도 않는다.
OUTROOT = ROOT / "public" / "figures-svg"
WORK = ROOT / ".work" / "svg-cmp"
RESULT = REPORTS / "figure-vector-svg-result.json"
SHOTS = HERE / "render-svg-shots.mjs"

# ── 엔진 정본에서 선 굵기를 **읽어 온다** ────────────────────────────────────
# 엔진에는 이름 붙은 상수가 없고 리터럴로만 있다. **없으면 멈춘다** —
# 손으로 적어 두면 엔진이 바뀌어도 이쪽은 조용히 옛 값을 쓴다(2026-08-13 교훈).
_ENGINE = ROOT / "vendor" / "figure-engine" / "core" / "figure_svg.py"
_W = sorted({float(x) for x in re.findall(r'stroke-width="([0-9.]+)"',
                                          _ENGINE.read_text(encoding="utf-8"))})
if not _W or max(_W) < 1.2:
    raise SystemExit("엔진에서 선 굵기를 못 읽었다 — figure_svg.py 가 바뀌었나?")
SOLID_W = max(_W)   # 실선 (엔진 실측 1.4)
AUX_W = min(_W)     # 보조선·점선 (엔진 실측 1.0)

#: §9 — 인쇄 그림 폭 상한(mm). `printGeometry.figureMaxWidth` 와 같은 값.
MAX_PRINT_MM = 70.0
#: 엔진의 선 굵기가 「70mm 짜리 그림에서 몇 mm 인가」로 환산되는 기준.
#: 엔진 도판은 viewBox 가 이 정도(lint 안전 한도 640)라, 1.4 단위 ≈ 0.2mm 다.
UNITS_PER_MM = 7.0
SOLID_MM = SOLID_W / UNITS_PER_MM
AUX_MM = AUX_W / UNITS_PER_MM
#: 흰 선은 «지우개»다(배경 위에 칸을 나누려고 덧그린다). 굵히면 내용을 지운다.
WHITE_LUMA = 0.9

# ── 문턱을 **대조군으로** 정했다 (2026-08-19) ────────────────────────────────
# 「획이 사라졌나」자를 만들었으면 **진짜로 사라진 표본**에 대 봐야 뜻이 있다.
# 그래서 낸 SVG 의 그릴 요소를 **절반 지운** 대조군 24장을 만들어 견줬다
# (`.work/ctrl_make.py`):
#
#   |                | 획손실 최소 | 중앙  | 최대  | 겹쳐대조 최소 | 중앙  | 최대  |
#   | 정상본 24장    |      0.000 | 0.005 | 0.061 |        0.007 | 0.018 | 0.033 |
#   | 절반 지운 24장 |      0.250 | 0.383 | 0.862 |        0.020 | 0.036 | 0.131 |
#
# ⚠️ **겹쳐 대조(평균 절대차)만으로는 안 갈린다** — 망가뜨린 것의 최소 0.020 이
#    멀쩡한 것의 최대 0.033 보다 **작다.** 획 손실 자가 따로 있어야 하는 이유다.
#: 겹쳐 대조 문턱.
DIFF_REJECT = 0.05
#: 획 손실 문턱 — 정상 최대 0.061 과 망가뜨린 것 최소 0.250 **사이**에 놓는다.
INK_LOSS_REJECT = 0.15

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def luma(hexcolor):
    try:
        h = hexcolor.lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except Exception:
        return 0.0
    return 0.299 * r + 0.587 * g + 0.114 * b


def normalize_strokes(svg, units_per_mm):
    """선 굵기를 엔진 정본으로 통일한다 — **물리 굵기가 같아지도록** 환산해서.

    viewBox 는 pt 단위인데 그림마다 인쇄 폭이 다르므로, 같은 숫자를 그대로 쓰면
    큰 그림에선 가늘어 보인다. 그래서 mm 로 환산해 넣는다(§9 가 없애려는 것이
    바로 그 제각각이다).

    ⚠️ **흰 선은 안 건드린다.** 배경 위에 칸을 나누려고 덧그린 «지우개»라
    굵히면 옆 칸 내용을 지운다(실측: 표 그림의 칸 구분선이 전부 흰 선이다).
    """
    solid = SOLID_MM * units_per_mm
    aux = AUX_MM * units_per_mm
    n = [0, 0]

    def one(m):
        tag = m.group(0)
        st = re.search(r'\bstroke="([^"]+)"', tag)
        if not st or st.group(1) == "none":
            return tag
        if luma(st.group(1)) >= WHITE_LUMA:
            n[1] += 1
            return tag
        dashed = "stroke-dasharray" in tag
        w = aux if dashed else solid
        n[0] += 1
        if re.search(r'\bstroke-width="[^"]*"', tag):
            return re.sub(r'\bstroke-width="[^"]*"', 'stroke-width="%.4f"' % w, tag)
        return tag[:-2] + ' stroke-width="%.4f"/>' % w

    return re.sub(r"<path\b[^>]*/>", one, svg), n[0], n[1]


def make_svg(doc, pno, rect, target_mm):
    nd = fitz.open()
    np_ = nd.new_page(width=rect.width, height=rect.height)
    np_.show_pdf_page(np_.rect, doc, pno, clip=rect)
    raw = np_.get_svg_image(text_as_path=True)
    pruned, dropped, _ = svg_prune.prune(raw, rect.width, rect.height)
    units_per_mm = rect.width / target_mm
    pruned, nw, nwhite = normalize_strokes(pruned, units_per_mm)
    # 인쇄 물리 크기를 **파일이 스스로 들고 다니게** 한다(§14: 지면이 픽셀이 아니라
    # mm 를 봐야 일관성이 성립한다).
    pruned = re.sub(r'(<svg\b[^>]*?)\swidth="[^"]*"\s*height="[^"]*"',
                    r'\1 width="%.3fmm" height="%.3fmm"'
                    % (target_mm, target_mm * rect.height / rect.width), pruned, count=1)
    return np_, pruned, dropped, nw, nwhite


def cmp_images(o, m):
    """(평균 절대차, 사라진 획 비율, 새로 생긴 획 비율)

    ⚠️ **「획이 사라졌나」를 픽셀 대 픽셀로 세면 안 된다.** 원본은 200dpi 래스터라
    가는 선이 번져 있고 SVG 는 또렷하다. 같은 선이어도 반 픽셀 어긋나면 «사라졌다»로
    세어져서, 눈으로 보면 **똑같은 그림**이 「획 손실 54%」로 버려진다(첫 전량 실행에서
    버린 262건 중 242건이 그랬다 — 표본을 눈으로 보고서야 드러났다).

    그래서 **한 픽셀 부풀린 뒤에 견준다**: 원본에 잉크가 있던 자리 둘레 3×3 안에
    새 그림의 잉크가 하나도 없을 때만 「사라졌다」로 센다. 이러면 진짜로 없어진 선
    (칸 하나가 통째로 빠지는 것)은 그대로 걸리고, 굵기·번짐 차이는 안 걸린다.
    """
    from PIL import ImageFilter
    N = 256
    a = o.convert("L").resize((N, N), Image.BILINEAR)
    b = m.convert("L").resize((N, N), Image.BILINEAR)
    h = ImageChops.difference(a.resize((128, 128)), b.resize((128, 128))).histogram()
    mad = sum(i * c for i, c in enumerate(h)) / sum(h) / 255.0
    ab = a.point(lambda v: 255 if v < 160 else 0)
    bb = b.point(lambda v: 255 if v < 160 else 0)
    ad = ab.filter(ImageFilter.MaxFilter(3))
    bd = bb.filter(ImageFilter.MaxFilter(3))
    ink_a = sum(1 for v in ab.getdata() if v)
    ink_b = sum(1 for v in bb.getdata() if v)
    lost = sum(1 for x, y in zip(ab.getdata(), bd.getdata()) if x and not y)
    gained = sum(1 for x, y in zip(bb.getdata(), ad.getdata()) if x and not y)
    return (round(mad, 4),
            round(lost / ink_a, 3) if ink_a else None,
            round(gained / ink_b, 3) if ink_b else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--only", help="figure 경로 앞부분으로 거른다 (예: rpm/)")
    ap.add_argument("--sheet", action="store_true", help="표본 대조표(PNG)")
    ap.add_argument("--batch", type=int, default=300, help="Chromium 한 묶음 크기")
    a = ap.parse_args()

    led = json.loads(LEDGER.read_text(encoding="utf-8"))
    rows = [r for r in led["행"]
            if r.get("kind") == "vector" and r.get("rect_pt") and r.get("source_exists")]
    if a.only:
        rows = [r for r in rows if r["figure"].startswith(a.only)]
    total = len(rows)
    if a.limit:
        rows = rows[: a.limit]

    WORK.mkdir(parents=True, exist_ok=True)
    for old in WORK.glob("*"):
        old.unlink()  # ⚠️ fs.rmSync 금지 규칙은 node 쪽 이야기지만, 여기서도 통째로
        #                 지우지 않고 파일 단위로만 지운다.

    docs = {}
    stat = collections.Counter()
    recs = []
    t0 = time.time()
    stage = []

    for i, r in enumerate(rows):
        pdf = r["source_pdf"]
        if pdf not in docs:
            try:
                docs[pdf] = fitz.open(pdf)
            except Exception:  # noqa: BLE001
                docs[pdf] = None
                stat["원본 열기 실패"] += 1
        doc = docs[pdf]
        if doc is None:
            continue
        page_no = r["page_index0"]
        rect = fitz.Rect(*r["rect_pt"]) & doc[page_no].rect
        if rect.width < 4 or rect.height < 4:
            stat["칸이 너무 작다"] += 1
            continue
        target_mm = min(MAX_PRINT_MM, rect.width / 72.0 * 25.4)
        try:
            np_, svg, dropped, nw, nwhite = make_svg(doc, page_no, rect, target_mm)
        except Exception as exc:  # noqa: BLE001
            stat["SVG 생성 실패:%s" % type(exc).__name__] += 1
            continue
        drawables = len(re.findall(r"<(?:path|use|image)\b", svg[svg.find("</defs>"):]))
        if drawables == 0:
            stat["칸 안에 그릴 것이 없다"] += 1
            continue
        sp = WORK / ("s%06d.svg" % i)
        sp.write_text(svg, encoding="utf-8")
        pm = np_.get_pixmap(dpi=200, alpha=False)
        op = WORK / ("o%06d.png" % i)
        Image.frombytes("RGB", (pm.width, pm.height), pm.samples).save(op)
        stage.append({"i": i, "figure": r["figure"], "svg": sp, "orig": op,
                      "w": pm.width, "h": pm.height, "mm": round(target_mm, 2),
                      "rect": r["rect_pt"], "bytes": len(svg), "dropped": dropped,
                      "norm_strokes": nw, "white_strokes": nwhite,
                      "drawables": drawables})

    # ── Chromium 으로 한꺼번에 그린다 ────────────────────────────────────
    for s in range(0, len(stage), a.batch):
        chunk = stage[s: s + a.batch]
        jobs = [{"svg": str(x["svg"].resolve()),
                 "png": str((WORK / ("m%06d.png" % x["i"])).resolve()),
                 "w": x["w"], "h": x["h"]} for x in chunk]
        jf = WORK / "jobs.json"
        jf.write_text(json.dumps(jobs), encoding="utf-8")
        out = subprocess.run([("npx.cmd" if sys.platform == "win32" else "npx"),
                              "node", str(SHOTS), str(jf)],
                             capture_output=True, text=True, encoding="utf-8",
                             errors="replace", cwd=str(ROOT))
        if out.returncode != 0:
            out = subprocess.run(["node", str(SHOTS), str(jf)],
                                 capture_output=True, text=True, encoding="utf-8",
                             errors="replace", cwd=str(ROOT))
        if out.returncode != 0:
            raise SystemExit("Chromium 렌더 실패:\n" + (out.stderr or "")[-2000:])
        print("  렌더 %d/%d" % (min(s + a.batch, len(stage)), len(stage)))

    sheet_cells = []
    OUTROOT.mkdir(parents=True, exist_ok=True)
    for x in stage:
        mp = WORK / ("m%06d.png" % x["i"])
        if not mp.exists():
            stat["렌더 안 됨"] += 1
            continue
        o = Image.open(x["orig"])
        m = Image.open(mp)
        mad, lost, gained = cmp_images(o, m)
        ok = mad <= DIFF_REJECT and (lost is None or lost <= INK_LOSS_REJECT)
        stat["통과" if ok else "버림"] += 1
        recs.append({"figure": x["figure"], "print_mm": x["mm"], "rect_pt": x["rect"],
                     "bytes": x["bytes"], "drawables": x["drawables"],
                     "norm_strokes": x["norm_strokes"], "white_strokes": x["white_strokes"],
                     "diff": mad, "lost_ink": lost, "gained_ink": gained, "ok": ok})
        if ok:
            dest = OUTROOT / (x["figure"].rsplit(".", 1)[0] + ".svg")
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(x["svg"].read_text(encoding="utf-8"), encoding="utf-8")
        if a.sheet and len(sheet_cells) < 12:
            sheet_cells.append((x["figure"], mad, o.convert("L"), m.convert("L")))

    if sheet_cells:
        from PIL import ImageDraw
        CW, CH = 330, 240
        sh = Image.new("L", (CW * 2 + 30, CH * len(sheet_cells) + 20), 255)
        dr = ImageDraw.Draw(sh)
        for i, (n, mad, o, m) in enumerate(sheet_cells):
            y = i * CH + 16
            dr.text((5, y - 13), "%s diff=%.4f (왼:원본 200dpi / 오른:새 SVG@Chromium)"
                    % (n[:44], mad), fill=0)
            for j, im in enumerate((o, m)):
                c = im.copy()
                c.thumbnail((CW - 10, CH - 24))
                sh.paste(c, (j * CW + 10, y))
        sp = ROOT / ".work" / "vector-svg-sheet.png"
        sh.save(sp)
        print("대조표 →", sp)

    diffs = sorted(x["diff"] for x in recs)
    byt = sorted(x["bytes"] for x in recs if x["ok"])
    RESULT.write_text(json.dumps(
        {"기준": "벡터 그림을 SVG 로 다시 짜고 **지면과 같은 렌더러(Chromium)로**"
                 " 원본과 겹쳐 대조한 결과",
         "원장의 벡터 행": total, "돌린 행": len(rows),
         "문턱": {"diff": DIFF_REJECT, "ink_loss": INK_LOSS_REJECT},
         "선 굵기 정본": {"실선": SOLID_W, "보조선": AUX_W, "units_per_mm": UNITS_PER_MM},
         "집계": dict(stat), "행": recs}, ensure_ascii=False, indent=0), encoding="utf-8")
    print("벡터 행 %d 중 %d건 · %.1fs" % (total, len(rows), time.time() - t0))
    for k, v in sorted(stat.items()):
        print("  %-24s %d" % (k, v))
    if diffs:
        n = len(diffs)
        print("겹쳐 대조 — 중앙 %.4f · 75%% %.4f · 90%% %.4f · 최대 %.4f"
              % (diffs[n // 2], diffs[3 * n // 4], diffs[min(n - 1, int(n * 0.9))], diffs[-1]))
    if byt:
        n = len(byt)
        print("통과분 SVG 크기 — 중앙 %.1fKB · 최대 %.1fKB · 합계 %.1fMB"
              % (byt[n // 2] / 1024, byt[-1] / 1024, sum(byt) / 1048576))
    print("→", RESULT, "·", OUTROOT)


if __name__ == "__main__":
    main()
