# -*- coding: utf-8 -*-
"""**그림 칸 원장** — 그림 파일 한 장마다 「원본 지면에서 몇 pt 였나」를 적는다.

지금까지 이 값은 아무 데도 없었다. `map-figures.py` 의 `map_exam()` 과
`crop-rpm-from-pdf.py` 의 `figure_rect()` 가 **런타임에 만들고 그대로 버렸다**
(`figure-manifest.json` 에 `rect` 키가 0건). 그 값이 없으면 300dpi 재크롭도,
인쇄 물리 크기도, 벡터 SVG 의 목표 크기도 못 한다.

산출: `scripts/qa/reports/figure-rect-ledger-<부분>.json` → `--merge` 로 합친다.

## 규칙을 옮겨 적지 않는다

검출 규칙은 `map-figures.py` 를 **그대로 import 해서 부른다**. 여기 다시 쓰면
원장과 실제 크롭이 갈라지고, 갈라져도 아무도 모른다.

## 「구했다」를 **파일마다 증명한다**

「지금 `map_exam()` 이 주는 rect 가 그때 그 파일의 rect 인가」는 가정이면 안 된다.

- **네이티브 추출분**(`xref` 있음): `doc.extract_image(xref)` 의 바이트와 디스크
  파일의 md5 를 견준다. 같으면 그 rect 는 **그 파일의 rect 임이 증명**된다.
- **클립 렌더분**(`xref` 없음): 바이트 대조가 안 된다(렌더는 재현이 아니다).
  대신 픽셀 치수가 `rect × CLIP_DPI/72` 와 맞는지 본다.
- 어느 쪽도 아니면 `rect_pt` 를 **적지 않고**(null) 사유를 남긴다.
  조용히 빼지 않는다 — 이 저장소는 「N passed」가 분모를 안 말해 준 사고를 겪었다.

사용:
  python scripts/figure/build-rect-ledger.py --part exam [--limit N]
  python scripts/figure/build-rect-ledger.py --part rpm  [--limit N]
  python scripts/figure/build-rect-ledger.py --merge
"""
import argparse
import collections
import hashlib
import importlib.util
import json
import pathlib
import re
import sqlite3
import sys
import time

import fitz
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.append(str(ROOT / "scripts" / "qa"))

_spec = importlib.util.spec_from_file_location("mapfig", HERE / "map-figures.py")
mapfig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mapfig)

FIGROOT = ROOT / "public" / "figures"
REPORTS = ROOT / "scripts" / "qa" / "reports"

#: `extract-all-figures.py` 가 클립 렌더에 쓴 해상도. **거기서 읽어 온다** —
#: 손으로 적으면 그쪽이 바뀌어도 이 검산이 조용히 통과한다.
_EXTRACT_SRC = (HERE / "extract-all-figures.py").read_text(encoding="utf-8")
_m = re.search(r"^CLIP_DPI\s*=\s*(\d+)", _EXTRACT_SRC, re.M)
if not _m:
    raise SystemExit("extract-all-figures.py 에서 CLIP_DPI 를 못 찾았다 — 이름이 바뀌었나?")
CLIP_DPI = int(_m.group(1))

#: 렌더 픽셀 치수 검산 허용 오차(px). PyMuPDF 는 clip 을 픽셀 격자에 맞춰 반올림한다.
DIM_TOL = 2

FN = re.compile(
    r"^(?P<fam>q|hwp-q|hwppdf-q|pdf-q|tbl-q)(?P<num>\d+)(?:_(?P<idx>\d+))?\.(?P<ext>\w+)$"
)
#: `map_exam()` 이 좌표를 아는 것은 PDF 오려내기 계열(`qNN`)뿐이다.
PDF_MAPPED_FAM = "q"

NO_COORD_REASON = {
    "hwp-q": "HWP BinData 에서 꺼낸 이미지 — PDF 좌표가 애초에 없다"
             " (recover-hwp-figures.py / prepare-load-figures.py)",
    # `figure-attach-ledger.json` 이 계획 이름을 적어 둬서 짚혔다:
    # `pdf-figure-result-hwp.json` — HWP 를 PDF 로 바꾼 사본(.hwp-pdf/, gitignore)을
    # `crop-pdf-by-stem.py` 로 오린 것이다. 그 사본이 이 컴퓨터에 없어 자리는 못 구한다.
    "hwppdf-q": "crop-pdf-by-stem.py 를 **HWP 변환본**에 돌린 것"
                " (계획 pdf-figure-result-hwp.json). 변환 사본이 이 컴퓨터에 없다",
    "pdf-q": "crop-pdf-by-stem.py 계열 — 별도 좌표 경로",
    "tbl-q": "crop-table-by-stem.py 계열 — 표 오려내기 (계획 table-crop-result.json)",
}

HWP_NOTE = (
    "원본이 HWP 다. 오려낸 것은 변환 PDF 인데 그 캐시가 없다"
    " (testchanger db/pages 디렉터리 자체가 없음). 재변환은 한컴 COM 이 필요해"
    " 금지(절대 규칙 9)"
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def px_of(path: pathlib.Path):
    try:
        with Image.open(path) as im:
            return [im.width, im.height]
    except Exception:
        return None


def mm(pt: float) -> float:
    return round(pt / 72.0 * 25.4, 2)


class PageInfo:
    """한 쪽에서 kind 판정에 필요한 것만 한 번 모아 둔다."""

    def __init__(self, page):
        self.rect = page.rect
        page_area = page.rect.get_area()
        self.images = []
        for im in page.get_images(full=True):
            for r in page.get_image_rects(im[0]):
                # ⚠️ **쪽을 덮는 이미지는 그림이 아니라 배경이다.** RPM 교재는 쪽마다
                #    81dpi 배경 이미지를 한 장 깔아 두는데(브리프 §2 실측), 그걸 세면
                #    **전량이 raster 로 읽힌다** — §12 가 실측한 「RPM 100% 벡터」와
                #    정반대가 된다. `crop-rpm-from-pdf.is_page_furniture` 와 같은 기준.
                if r.get_area() >= page_area * 0.7:
                    continue
                self.images.append(r)
        self.draw = []
        W, H = page.rect.width, page.rect.height
        for d in page.get_drawings():
            r = d["rect"]
            # ⚠️ `r.is_empty` 로 거르지 않는다 — `fitz.Rect.is_empty` 는 폭·높이 중
            #    하나만 0이어도 참이라 **축에 나란한 곧은 선이 전부 걸린다**
            #    (2026-08-19: 획 99개 중 97개가 그 모양이었고 그게 전개도였다).
            if r.is_infinite:
                continue
            if r.width > W * 0.8 or r.height > H * 0.8:
                continue  # 쪽 테두리·단 구분선
            self.draw.append((r, len(d.get("items") or [])))

    def kind(self, rect):
        """(kind, 획수, 이미지 덮음률) — §12 기준: 드로잉 덩어리 vs 삽입 이미지.

        획수는 `map-figures._page_layout` 과 **같은 단위**로 센다 — 드로잉 객체 수가
        아니라 `len(d["items"])` 의 합이다. 상자 하나가 객체 2개·items 56개로 오는
        일이 흔해서, 단위가 다르면 같은 그림을 한쪽은 벡터로 한쪽은 아니라고 읽는다.
        """
        area = rect.get_area()
        if area <= 0:
            return None, 0, 0.0
        cover = 0.0
        for ir in self.images:
            inter = ir & rect
            if not inter.is_empty:
                cover = max(cover, inter.get_area() / area)
        strokes = sum(n for r, n in self.draw if not (r & rect).is_empty)
        if cover >= 0.5:
            return "raster", strokes, round(cover, 3)
        if strokes >= 4:
            return "vector", strokes, round(cover, 3)
        return None, strokes, round(cover, 3)


def row(figure, **kw):
    base = {
        "figure": figure,
        "source_pdf": None,
        "source_exists": False,
        "page_index0": None,
        "rect_pt": None,
        "width_mm": None,
        "height_mm": None,
        "native_xref": None,
        "kind": None,
        "current_px": None,
        "render_dpi": None,
        "match": None,
        "note": None,
    }
    base.update(kw)
    return base


# ── PNG 안에 **렌더 해상도가 적혀 있다** ─────────────────────────────────────
# PyMuPDF 는 `get_pixmap(dpi=D)` 로 그린 PNG 의 `pHYs` 에 D 를 적는다. 픽셀/미터가
# 정수라 되읽으면 199.9996 · 299.9994 처럼 **딱 떨어지지 않는 값**이 나오고, 그게
# 곧 「이 파일은 우리가 클립 렌더한 것」이라는 지문이다. 원본 이미지를 그대로 꺼낸
# 파일(JPEG)은 이 값이 아예 없고, 원본 PNG 를 그대로 꺼낸 것은 96.012 처럼
# **그 이미지 자신의** 값이라 렌더 해상도가 아니다.
#
# ⚠️ 그래서 이 값을 「rect 를 구하는 두 번째 길」로 쓸 수 있다:
#     rect 크기(pt) = 픽셀 / 렌더dpi * 72
#   RPM 은 전량이 클립 렌더라 이 길로 **크기만은 100% 구해진다.**
#   기출 클립 렌더분에서는 `map_exam` 이 준 rect 와 **서로 검산**한다.
RENDER_DPI_EPS = 0.02
KNOWN_RENDER_DPI = (150, 200, 300, 400, 600)


def render_dpi_of(path):
    """이 파일이 PyMuPDF 클립 렌더면 그 dpi, 아니면 None."""
    try:
        with Image.open(path) as im:
            d = im.info.get("dpi")
    except Exception:
        return None
    if not d:
        return None
    v = float(d[0])
    # 픽셀/미터가 정수로 저장되므로 되읽은 값은 딱 떨어지지 않는다(200 → 199.9996,
    # 96 → 96.012). 정수로 되읽히면 그건 우리가 적은 값이 아니다.
    if abs(v - round(v)) < 1e-9:
        return None
    for cand in KNOWN_RENDER_DPI:
        if abs(v - cand) < RENDER_DPI_EPS:
            return cand
    return None


def build_exam(limit):
    con = sqlite3.connect(mapfig.IDX)
    src_of = {str(i): sp for i, sp in con.execute("select id, src_path from exams")}
    dirs = sorted(
        (p for p in FIGROOT.iterdir() if p.is_dir() and p.name != "rpm"),
        key=lambda p: p.name,
    )
    if limit:
        dirs = dirs[:limit]

    out = []
    stat = collections.Counter()
    t0 = time.time()

    for d in dirs:
        eid = d.name
        files = sorted(d.iterdir())
        sp = src_of.get(eid)
        pdf = pathlib.Path(sp) if sp else None
        is_pdf = bool(pdf) and pdf.suffix.lower() == ".pdf"
        exists = bool(pdf) and pdf.exists()

        mapped = None
        note_fail = None
        doc = None
        pages = {}
        need_map = any(
            (FN.match(f.name) or None) and FN.match(f.name).group("fam") == PDF_MAPPED_FAM
            for f in files
        )
        if need_map and is_pdf and exists:
            try:
                mapped = mapfig.map_exam(pdf)
                doc = fitz.open(pdf)
                stat["편:매핑함"] += 1
            except Exception as exc:  # noqa: BLE001
                stat["편:매핑실패"] += 1
                note_fail = "map_exam 실패: %s" % type(exc).__name__

        for f in files:
            rel = "%s/%s" % (eid, f.name)
            m = FN.match(f.name)
            px = px_of(f)
            if not m:
                stat["이름규칙 밖"] += 1
                out.append(row(rel, source_pdf=str(pdf) if pdf else None,
                               source_exists=exists, current_px=px,
                               note="파일명이 알려진 계열이 아니다"))
                continue
            fam = m.group("fam")
            num, idx = int(m.group("num")), int(m.group("idx") or 0)

            if fam != PDF_MAPPED_FAM:
                stat["좌표없음:%s" % fam] += 1
                out.append(row(rel, source_pdf=str(pdf) if pdf else None,
                               source_exists=exists, current_px=px,
                               note=NO_COORD_REASON[fam]))
                continue
            if not is_pdf:
                stat["좌표없음:원본이 HWP"] += 1
                out.append(row(rel, source_pdf=str(pdf) if pdf else None,
                               source_exists=exists, current_px=px, note=HWP_NOTE))
                continue
            if not exists:
                stat["좌표없음:원본 PDF 없음"] += 1
                out.append(row(rel, source_pdf=str(pdf), source_exists=False,
                               current_px=px, note="원본 PDF 가 디스크에 없다"))
                continue
            if mapped is None:
                stat["좌표없음:map 실패"] += 1
                out.append(row(rel, source_pdf=str(pdf), source_exists=True,
                               current_px=px, note=note_fail))
                continue

            figs = mapped.get(num) or []
            if idx >= len(figs):
                stat["좌표없음:대응 없음"] += 1
                out.append(row(rel, source_pdf=str(pdf), source_exists=True,
                               current_px=px,
                               note="지금 map_exam 은 %d번에 그림 %d장을 주는데 파일은"
                                    " %d번째다 — 대응이 없다" % (num, len(figs), idx + 1)))
                continue

            g = figs[idx]
            x0, y0, x1, y1 = g["rect"]
            rect = fitz.Rect(x0, y0, x1, y1)
            pno = g["page"]
            if pno not in pages:
                pages[pno] = PageInfo(doc[pno])
            kind, strokes, cover = pages[pno].kind(rect)

            match = None
            note = None
            render_dpi = None
            if g["xref"]:
                stat["네이티브"] += 1
                try:
                    data = doc.extract_image(g["xref"])["image"]
                except Exception as exc:  # noqa: BLE001
                    note = "xref 추출 실패: %s" % type(exc).__name__
                    stat["증명실패:xref"] += 1
                else:
                    if hashlib.md5(data).hexdigest() == hashlib.md5(f.read_bytes()).hexdigest():
                        match = "bytes"
                        stat["증명:바이트"] += 1
                    else:
                        note = "같은 자리인데 바이트가 다르다 — 그때 그 파일이 아닐 수 있다"
                        stat["증명실패:바이트"] += 1
            else:
                stat["클립렌더"] += 1
                # ⚠️ `CLIP_DPI` 를 그대로 믿지 않는다 — RPM 은 같은 스크립트를
                #    `--dpi 300` 으로도 돌려 두 벌이 섞여 있었다. **파일이 스스로
                #    말하는 값**(PNG pHYs)이 있으면 그걸 먼저 쓰고, 상수와 다르면
                #    사유에 적는다.
                fdpi = render_dpi_of(f)
                use = fdpi or CLIP_DPI
                want = [round(rect.width / 72.0 * use),
                        round(rect.height / 72.0 * use)]
                if px and abs(px[0] - want[0]) <= DIM_TOL and abs(px[1] - want[1]) <= DIM_TOL:
                    match = "dims"
                    stat["증명:치수"] += 1
                    if fdpi and fdpi != CLIP_DPI:
                        stat["렌더 dpi 가 상수와 다름:%d" % fdpi] += 1
                    elif fdpi:
                        # 두 길이 **서로** 검산됐다 — map_exam 의 rect 와 파일이 적어 둔
                        # 렌더 dpi 가 같은 치수를 가리킨다.
                        stat["교차검산:rect↔png dpi"] += 1
                else:
                    note = "렌더 치수가 안 맞는다 — 파일 %s vs rect×%ddpi %s" % (px, use, want)
                    stat["증명실패:치수"] += 1
                render_dpi = fdpi
            if g["xref"]:
                render_dpi = None

            out.append(row(
                rel, source_pdf=str(pdf), source_exists=True, page_index0=pno,
                rect_pt=[round(v, 2) for v in (rect.x0, rect.y0, rect.x1, rect.y1)]
                if match else None,
                width_mm=mm(rect.width) if match else None,
                height_mm=mm(rect.height) if match else None,
                native_xref=bool(g["xref"]),
                kind=kind if match else None,
                current_px=px, render_dpi=render_dpi, match=match, note=note,
            ))
            if match:
                stat["kind:%s" % kind] += 1
        if doc:
            doc.close()

    stat["초"] = round(time.time() - t0, 1)
    return out, dict(stat)


# ── RPM ─────────────────────────────────────────────────────────────────────
_rpm_spec = importlib.util.spec_from_file_location("croprpm", HERE / "crop-rpm-from-pdf.py")
_croprpm = None


def croprpm():
    global _croprpm
    if _croprpm is None:
        _croprpm = importlib.util.module_from_spec(_rpm_spec)
        _rpm_spec.loader.exec_module(_croprpm)
    return _croprpm


ORIGIN = REPORTS / "rpm-origin.json"
RPM_CONTENT = REPORTS / "rpm-figure-content.json"
#: 교재 PDF 를 찾을 곳. **인벤토리 같은 파생물을 안 본다** — 경로를 직접 친다
#: (2026-08-18: 「N드라이브에 없다」의 근거가 낡은 인벤토리였다).
BOOK_ROOTS = (
    pathlib.Path(r"N:\개인\강아\교재자료\RPM\22"),
    ROOT / ".rpm-src",
)
#: 원본 지면과 오려낸 파일이 **같은 그림인가** — 96×96 회색조 평균 절대차.
#: 문턱은 반대쪽 표본으로 재서 정했다(아래 주석).
DIFF_OK = 0.03
#: 쪽 오프셋 후보. 실측으로 3-2 만 +3 이고 나머지는 0 이다(대장 쪽수 대조 §1.2).
PAGE_OFFSETS = (0, 3)


def _norm(im):
    return im.convert("L").resize((96, 96), Image.BILINEAR)


def img_diff(a, b):
    from PIL import ImageChops
    d = ImageChops.difference(_norm(a), _norm(b))
    h = d.histogram()
    return sum(i * c for i, c in enumerate(h)) / sum(h) / 255.0


def build_rpm(limit):
    cr = croprpm()
    origin = json.loads(ORIGIN.read_text(encoding="utf-8"))
    by_ext = {r["externalId"]: r for r in origin["목록"]}
    content = json.loads(RPM_CONTENT.read_text(encoding="utf-8")) if RPM_CONTENT.exists() else {}
    if not content:
        print("⚠️ 본문이 없다 — figure_rect 가 발문과 그림을 못 가른다."
              " 먼저 npx tsx scripts/qa/dump-rpm-figure-content.ts")

    def book_path(name):
        for r in BOOK_ROOTS:
            p = r / name
            if p.exists():
                return p
        return None

    root = FIGROOT / "rpm"
    dirs = sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: p.name)
    if limit:
        dirs = dirs[:limit]

    out, stat = [], collections.Counter()
    docs = {}
    t0 = time.time()

    for d in dirs:
        rec = by_ext.get(d.name)
        files = sorted(d.iterdir())
        bp = book_path(rec["book"]) if rec else None
        for fi, f in enumerate(files):
            rel = "rpm/%s/%s" % (d.name, f.name)
            px = px_of(f)
            dpi = render_dpi_of(f)
            wmm = hmm = None
            if px and dpi:
                wmm, hmm = mm(px[0] / dpi * 72.0), mm(px[1] / dpi * 72.0)
                stat["크기:png dpi 로 구함(%d)" % dpi] += 1
            else:
                stat["크기:못 구함"] += 1

            base = dict(
                source_pdf=str(bp) if bp else (rec["book"] if rec else None),
                source_exists=bool(bp), current_px=px, render_dpi=dpi,
                width_mm=wmm, height_mm=hmm,
                # RPM 오려내기는 **언제나 영역 렌더**다(교재 도형이 벡터라
                # xref 추출이 획 단위로 쪼개진다 — crop-rpm-from-pdf.py 머리말).
                native_xref=False,
                match="png-dpi" if dpi else None,
            )
            if rec is None:
                stat["원장에 원본 정보 없음"] += 1
                out.append(row(rel, note="rpm-origin.json 에 이 externalId 가 없다", **base))
                continue
            if bp is None:
                stat["원본 교재 없음"] += 1
                out.append(row(rel, note="교재 PDF 를 못 찾았다: %s" % rec["book"], **base))
                continue
            if len(files) > 1:
                stat["무리 그림 — 자리 못 구함"] += 1
                out.append(row(rel, note="한 문항에 그림이 %d장이다(무리 그림)."
                                         " figure_rect 는 칸 하나만 주므로 어느 장이"
                                         " 어느 칸인지 못 가른다" % len(files), **base))
                continue

            if bp not in docs:
                docs[bp] = fitz.open(bp)
            doc = docs[bp]
            tim = Image.open(f)
            db_key = cr.content_key(content.get(rec["problemId"], ""))
            best = None
            for off in PAGE_OFFSETS:
                pi = rec["page"] - 1 + off
                if not (0 <= pi < doc.page_count):
                    continue
                page = doc[pi]
                c = rec["rect"]
                box = fitz.Rect(c["x0"], c["y0"], c["x1"], c["y1"]) & page.rect
                if box.is_empty or box.width < 4 or box.height < 4:
                    continue
                cands = []
                fig = cr.figure_rect(page, box, db_key, avoid=[])
                if fig is not None:
                    cands.append(fig)
                wide = fitz.Rect(box.x0, box.y0,
                                 page.rect.x1 - cr.WIDEN_RIGHT_MARGIN, box.y1) & page.rect
                if wide.width > box.width + 1:
                    fw = cr.figure_rect(page, wide, db_key, avoid=[])
                    if fw is not None:
                        cands.append(fw)
                for fg in cands:
                    P = cr.PAD
                    r = fitz.Rect(fg.x0 - P, fg.y0 - P, fg.x1 + P, fg.y1 + P) & page.rect
                    if r.width < 2 or r.height < 2:
                        continue
                    pm = page.get_pixmap(clip=r, dpi=150, colorspace=fitz.csGRAY)
                    got = Image.frombytes("L", (pm.width, pm.height), pm.samples)
                    v = img_diff(tim, got)
                    if best is None or v < best[0]:
                        best = (v, pi, r, page)
                if best and best[0] <= DIFF_OK:
                    break

            if best and best[0] <= DIFF_OK:
                v, pi, r, page = best
                kind, strokes, cover = PageInfo(page).kind(r)
                stat["자리:찾음"] += 1
                stat["kind:%s" % kind] += 1
                # ── 두 길이 **서로** 검산되는가 ────────────────────────────
                # 크기는 PNG 에 적힌 렌더 dpi 에서, 자리는 `figure_rect` 에서
                # **따로** 왔다. 둘이 같은 치수를 가리켜야 한다.
                # ⚠️ 겹쳐 대조만으로는 dpi 가 틀려도 안 걸린다 — 변이로 확인했다
                #    (렌더 dpi 를 상수 200 으로 고정했더니 60건 중 46건의 mm 가
                #    1.5배로 틀리는데 「자리:찾음 27」은 **그대로**였다).
                note = "원본 지면과 겹쳐 대조 %.3f (문턱 %.2f)" % (v, DIFF_OK)
                if dpi and px:
                    want = [round(r.width / 72.0 * dpi), round(r.height / 72.0 * dpi)]
                    if abs(px[0] - want[0]) <= DIM_TOL and abs(px[1] - want[1]) <= DIM_TOL:
                        stat["교차검산:rect↔png dpi"] += 1
                    else:
                        stat["⚠교차검산 어긋남"] += 1
                        note += " · ⚠ 치수 교차검산 어긋남: 파일 %s vs rect×%ddpi %s" % (
                            px, dpi, want)
                out.append(row(
                    rel, page_index0=pi,
                    rect_pt=[round(x, 2) for x in (r.x0, r.y0, r.x1, r.y1)],
                    kind=kind, note=note,
                    **{**base, "match": "rect+png-dpi" if dpi else "rect"}))
            else:
                stat["자리:못 찾음"] += 1
                out.append(row(rel, note="figure_rect 를 다시 불러도 디스크 파일과 안 맞는다"
                                         " (겹쳐 대조 %s). 그때 오려낸 계획(rpm-crop-plan"
                                         "-gated.json · 무리 그림 계획)이 이 컴퓨터에 없다"
                                         % ("%.3f" % best[0] if best else "칸 못 찾음"), **base))

    stat["초"] = round(time.time() - t0, 1)
    return out, dict(stat)


#: 못 구한 사유를 **부류로** 센다. 사유 문장에 파일 치수·문항 번호가 섞여 있어
#: 문자열 앞머리로 세면 한 건짜리 칸이 90개 넘게 생겨 「몇 건이 왜 빠졌나」가 안 보인다.
NO_RECT_KINDS = (
    ("HWP BinData 계열 — PDF 좌표가 애초에 없다", "BinData"),
    # ⚠️ 순서가 뜻이 있다. 「figure_rect 재현 실패」 사유 문장 **안에도**
    #    「무리 그림 계획」이라는 말이 들어 있어서, 무리 쪽을 먼저 보면
    #    600건이 통째로 무리로 세어진다(실제로 93 이 693 이 됐다).
    #    낱말이 파일 안 다른 곳에도 있는지 먼저 볼 것(CLAUDE.md 2026-08-18).
    ("RPM figure_rect 재현 실패 — 계획 rect 는 source_coords", "figure_rect 를 다시 불러도"),
    ("RPM 무리 그림 — 어느 장이 어느 칸인지 못 가른다", "한 문항에 그림이"),
    ("지금 map_exam 결과에 대응이 없다", "대응이 없다"),
    ("같은 자리인데 바이트가 다르다", "바이트가 다르다"),
    ("렌더 치수가 안 맞는다", "렌더 치수가 안 맞는다"),
    ("RPM 계획으로도 자리 못 구함", "계획 3개로 쪽을 고르고"),
    # hwppdf 바늘을 crop-pdf-by-stem **앞**에 둔다. 새 주석에 crop-pdf-by-stem.py 가
    # 들어 있어, 순서가 바뀌면 15장이 crop-pdf 계열로 빨려 들어간다.
    ("hwppdf 계열 — HWP 변환본 오려내기, 사본 없음", "HWP 변환본"),
    ("hwppdf 계열 — 만든 경로 미확인", "hwppdf 계열"),
    ("crop-pdf-by-stem 계열", "crop-pdf-by-stem.py 계열"),
    ("crop-table-by-stem 계열", "crop-table-by-stem"),
    ("원본이 HWP — 변환 PDF 캐시가 없다", "원본이 HWP"),
    ("원본 PDF 가 디스크에 없다", "원본 PDF 가 디스크에 없다"),
    ("교재 PDF 를 못 찾았다", "교재 PDF 를 못 찾았다"),
)


def no_rect_kind(note):
    n = note or ""
    for label, needle in NO_RECT_KINDS:
        if needle in n:
            return label
    return "분류 안 됨: %s" % n[:60]


def do_merge():
    rows, parts = [], {}
    for p in sorted(REPORTS.glob("figure-rect-ledger-*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        rows.extend(d["행"])
        parts[p.name] = d.get("집계")
    agg = collections.Counter()
    for r in rows:
        agg["행"] += 1
        agg["rect 있음" if r["rect_pt"] else "rect 없음"] += 1
        agg["크기(mm) 있음" if r["width_mm"] else "크기(mm) 없음"] += 1
        if not r["rect_pt"]:
            agg["사유:%s" % no_rect_kind(r["note"])] += 1
        else:
            agg["kind:%s" % r["kind"]] += 1
            agg["증명:%s" % r["match"]] += 1
        if r["note"] and "교차검산 어긋남" in r["note"]:
            agg["⚠ 치수 교차검산 어긋남"] += 1
    disk = sum(1 for f in FIGROOT.rglob("*") if f.is_file())
    agg["디스크 파일"] = disk
    agg["원장에 안 담긴 파일"] = disk - agg["행"]
    out = {
        "기준": "그림 파일 한 장 = 한 행. rect 는 원본 PDF 지면 좌표(pt).",
        "만든이": "scripts/figure/build-rect-ledger.py",
        "부분": parts,
        "집계": dict(agg),
        "행": rows,
    }
    dest = REPORTS / "figure-rect-ledger.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
    for k, v in sorted(agg.items()):
        print("  %-56s %s" % (k, v))
    print("→ %s" % dest)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--part", choices=["exam", "rpm"])
    ap.add_argument("--limit", type=int)
    ap.add_argument("--merge", action="store_true")
    a = ap.parse_args()
    REPORTS.mkdir(parents=True, exist_ok=True)

    if a.merge:
        do_merge()
        return

    if a.part == "exam":
        rows, stat = build_exam(a.limit)
    elif a.part == "rpm":
        rows, stat = build_rpm(a.limit)
    else:
        raise SystemExit("--part 를 주세요")

    dest = REPORTS / ("figure-rect-ledger-%s.json" % a.part)
    dest.write_text(json.dumps(
        {"기준": "그림 파일 한 장 = 한 행", "부분": a.part,
         "집계": stat, "행": rows}, ensure_ascii=False, indent=0), encoding="utf-8")
    for k, v in sorted(stat.items()):
        print("  %-30s %s" % (k, v))
    print("행 %d → %s" % (len(rows), dest))


if __name__ == "__main__":
    main()
