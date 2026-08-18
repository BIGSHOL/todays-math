# -*- coding: utf-8 -*-
"""RPM 교재 PDF 에서 `source_coords` 좌표대로 문항 그림을 오려낸다. **LLM 토큰 0.**

계획: `scripts/qa/reports/rpm-crop-plan.json`
      (`npx tsx scripts/qa/recover-rpm-figures-from-pdf.ts` 가 만든다)
산출: `public/figures/rpm/<externalId>/0.png`
      `scripts/qa/reports/rpm-crop-result.json`

사용: python scripts/figure/crop-rpm-from-pdf.py [--dpi 200] [--limit N]

## 좌표계

sumaek 의 `questions.source_coords` 는 `{"x0","y0","x1","y1","page"}` 이고
**PDF 포인트 좌표 · 좌상단 원점**이다(PyMuPDF 기본과 같다). 그래서 `fitz.Rect` 에
그대로 넣는다. `page` 는 1부터다 — PyMuPDF 인덱스는 0부터라 1을 뺀다.

## 지키는 것

- 원본 이미지를 그대로 뽑지 않고 **영역을 렌더**한다. 교재는 도형이 벡터로 그려져 있어
  xref 추출이 획 단위로 쪼개진다(실측: 기출 2065-4 가 15조각). 영역 렌더는 한 장이다.
- 좌표가 페이지 밖이거나 넓이가 0이면 **오려내지 않는다.** 엉뚱한 자리를 오리면
  그림 없음보다 나쁘다.
- 이미 있는 파일은 건너뛴다(멱등). 중단 후 다시 돌리면 이어 달린다.
- 실패는 결과 파일에 이유와 함께 남긴다 — 숫자만 줄어드는 침묵을 만들지 않는다.
"""
import argparse
import importlib.util
import json
import pathlib
import sys

import fitz

# `map-figures.py` 의 그림 검출을 그대로 쓴다 — 이미지 블록 + 벡터 획 군집.
# 검출 규칙을 여기 다시 쓰면 두 곳이 갈라지고, 갈라지면 같이 눈이 먼다.
_HERE = pathlib.Path(__file__).parent
_spec = importlib.util.spec_from_file_location("mapfig", _HERE / "map-figures.py")
mapfig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mapfig)

PLAN = pathlib.Path("scripts/qa/reports/rpm-crop-plan.json")
RESULT = pathlib.Path("scripts/qa/reports/rpm-crop-result.json")
# 원본이 대개 118dpi 라 200 이면 충분히 선명하고 파일도 작다(기출 추출기와 같은 값).
DEFAULT_DPI = 200
# 여백 — 좌표가 획에 딱 붙어 있으면 선이 잘려 보인다.
PAD = 2.0
# 그림에 딸린 라벨을 되찾을 때 허용하는 세로 간격(pt). 본문 줄높이가 약 12pt 라
# 이보다 크게 잡으면 발문 마지막 줄이 딸려 온다(실측 간격 9.3pt).
LABEL_GAP = 4.0
# 조각이 이만큼(pt) 넘게 떨어져 있으면 다른 덩어리로 본다. 그림 조각 사이 간격보다는
# 크고, 쪽 장식과 그림 사이(실측 39pt)보다는 작아야 한다.
CLUSTER_GAP = 12
# 으뜸 덩어리에서 이만큼(pt) 넘게 떨어진 덩어리는 그림이 아니라 쪽 장식으로 본다.
# 한 그림의 조각 사이(액자 3장 등)보다는 크고, 장식까지의 거리(실측 39·90pt)보다는 작아야 한다.
MAX_RUN_GAP = 30

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def _largest_run(parts: list[fitz.Rect], axis: str) -> list[fitz.Rect]:
    """한 축으로 투영해 **가장 넓이가 큰 덩어리**만 남긴다.

    문항 사각형 안에 그림 말고 다른 것이 끼어 있을 때가 있다 — 실측 `019fd1d6-f4e6` 은
    쪽 장식 배지(`09`)가 그래프에서 세로로 39pt 떨어져 같이 들어왔다. 그림이 여러 조각인
    경우(성냥개비 5단계, 액자 3장)를 쪼개면 안 되므로 **조각끼리 붙어 있으면 한 덩어리**로
    보고, `CLUSTER_GAP` 이상 떨어진 것만 가른다.

    조각이 수천 개라(실측 7,122) 쌍별 비교는 못 쓴다. 1pt 격자에 칠해 빈 구간을 찾는다.
    """
    if not parts:
        return parts
    lo = min((r.y0 if axis == "y" else r.x0) for r in parts)
    hi = max((r.y1 if axis == "y" else r.x1) for r in parts)
    n = max(1, int(hi - lo) + 2)
    filled = bytearray(n)
    for r in parts:
        a = int((r.y0 if axis == "y" else r.x0) - lo)
        b = int((r.y1 if axis == "y" else r.x1) - lo)
        for i in range(max(0, a), min(n, b + 1)):
            filled[i] = 1

    runs: list[tuple[float, float]] = []
    i = 0
    while i < n:
        if not filled[i]:
            i += 1
            continue
        j = i
        gap = 0
        while j + 1 < n:
            if filled[j + 1]:
                gap = 0
            else:
                gap += 1
                if gap > CLUSTER_GAP:
                    break
            j += 1
        runs.append((lo + i, lo + j - min(gap, CLUSTER_GAP)))
        i = j + 1

    if len(runs) <= 1:
        return parts

    def center(r: fitz.Rect) -> float:
        return (r.y0 + r.y1) / 2 if axis == "y" else (r.x0 + r.x1) / 2

    def area_in(run: tuple[float, float]) -> float:
        return sum(
            max(r.get_area(), 1.0) for r in parts if run[0] <= center(r) <= run[1]
        )

    # **거리로 가른다.** 「가장 큰 덩어리만」으로 했더니 두 줄짜리 그림의 아랫줄을 잃었고
    # (실측 `019fd1d6-871b` 액자 [3장]), 「크기로 남긴다」로 바꿨더니 이번엔 **쪽 장식
    # 동그라미가 으뜸의 65%나 되어** 그대로 남았다(적대적 리뷰 실측 `019fd1da-41ef`).
    # 크기는 장식과 그림을 못 가른다 — 가르는 것은 **떨어진 거리**다.
    # 한 그림의 조각들은 서로 붙어 있고, 쪽 장식은 멀리 있다(실측 39pt · 90pt).
    areas = {run: area_in(run) for run in runs}
    main = max(runs, key=lambda r: areas[r])
    keep = [
        run
        for run in runs
        if max(main[0] - run[1], run[0] - main[1], 0) <= MAX_RUN_GAP
    ]
    return [r for r in parts if any(run[0] <= center(r) <= run[1] for run in keep)]


def largest_cluster(parts: list[fitz.Rect]) -> list[fitz.Rect]:
    """**세로로만** 걸러 낸다 — 쪽 장식처럼 작고 떨어진 것만 버린다.

    가로로도 걸러 봤다가 수직선 그림을 잃었다 — 눈금 점 사이가 30pt씩 벌어져 있어
    점 하나만 남고 크기 검사에서 떨어졌다(실측 `019fd1d5-988a`). 성긴 그림은 가로로
    원래 듬성듬성하다.

    걸러 내려던 쪽 장식은 세로로 39pt 떨어져 있어 **세로만으로 갈린다.**
    과다 절단이 미검출보다 나쁘므로(잘못 오린 그림은 눈에 안 띈다) 여기서 멈춘다.
    """
    return _largest_run(parts, "y")


def figure_rect(page, box: fitz.Rect) -> fitz.Rect | None:
    """문항 사각형 **안에서 그림만** 골라 낸다.

    `source_coords` 는 문항 블록 전체(발문 + 그림)다. 그대로 오리면 발문이 지면에
    **두 번** 나온다 — 본문 글자로 한 번, 그림 안에 또 한 번. 실측으로 확인했다.

    ## 왜 페이지 단위 검출기(`map-figures.py`)를 그대로 못 쓰나

    그건 「이 그림은 몇 번 문항 것인가」를 푸는 도구라 판정 단위가 **페이지**다. 여기서는
    문항 사각형을 **이미 알고 있으므로** 그 안만 보면 된다. 그대로 썼더니 둘이 걸렸다:

    1. **분모가 틀렸다.** 한 이미지 블록이 두 문항에 걸쳐 있으면(실측 `019fd1d5-c472`,
       겹침비 0.37) 「후보의 절반 이상이 이 문항 안」 규칙이 **진짜를 버린다.** 물어야 할
       것은 후보가 얼마나 들어왔나가 아니라 **겹친 부분이 그림이라 할 만한 크기인가**다.
    2. **수직선이 「긴 밑줄」로 걸러진다.** 페이지 검출기는 `height<2 and width>120` 을
       밑줄로 버리는데, 수직선 그림의 축이 정확히 그 모양이다(실측 `019fd1d5-988a`).

    그래서 문항 안에서 **글자가 아닌 것**을 모은다. 분수 가로줄처럼 글자 블록 안에 있는
    획은 뺀다 — 그건 수식이지 그림이 아니다.

    하나도 없으면 **오려내지 않는다** — 발문 사진을 붙이느니 안 붙이는 게 낫다.
    """
    page_area = page.rect.get_area()
    raw = page.get_text("rawdict")
    text_boxes = [
        fitz.Rect(*b["bbox"])
        for b in raw.get("blocks", [])
        if b.get("type") == 0 and not fitz.Rect(*b["bbox"]).is_empty
    ]

    def is_inside_text(r: fitz.Rect) -> bool:
        """글자 블록에 거의 잠겨 있으면 수식 부속이다(분수 가로줄·근호 등)."""
        for t in text_boxes:
            inter = r & t
            if not inter.is_empty and inter.get_area() >= r.get_area() * 0.8:
                return True
        return False

    def is_page_furniture(r: fitz.Rect) -> bool:
        """쪽 전체를 덮는 것은 그림이 아니다 — 배경 이미지·쪽 테두리다.

        RPM 교재는 **쪽 전체가 이미지 블록 하나**다(실측 `Rect(0,0,623.6,841.9)`).
        그걸 후보로 받으면 문항 박스가 통째로 잡혀 발문이 딸려 온다.
        """
        return r.get_area() >= page_area * 0.7

    core: list[fitz.Rect] = []

    for b in raw.get("blocks", []):
        if b.get("type") == 0:
            continue
        r = fitz.Rect(*b["bbox"])
        if is_page_furniture(r):
            continue
        inter = r & box
        if inter.is_empty or inter.width < 12 or inter.height < 12:
            continue
        core.append(inter)

    # 문항 박스에 **닿는** 획을 먼저 모은다. 박스 밖으로 나간 부분까지 통째로 쓴다
    # (도형이 박스를 넘어갈 때가 있다 — 정사각뿔 꼭대기가 28pt 밖이었다).
    # 다만 박스에 아예 안 닿는 조각은 여기서 못 줍는다 — 그건 아래 2차 수집이 맡는다.
    for d in page.get_drawings():
        r = fitz.Rect(d["rect"])
        if r.is_empty or r.is_infinite or is_page_furniture(r):
            continue
        if (r & box).is_empty or is_inside_text(r):
            continue
        # **박스로 자르지 않는다.** 도형이 문항 좌표를 넘어갈 때가 있다 —
        # 실측 `019fd1d9-5745` 정사각뿔은 박스 위로 28pt 삐져나와 있어 꼭대기가 잘렸다.
        # `source_coords` 는 발문 기준이라 그림 전체를 감싸지 않는다.
        core.append(r)

    if not core:
        return None

    core = largest_cluster(core)
    if not core:
        return None
    out = core[0]
    for r in core[1:]:
        out |= r

    # ── 그림에 딸린 «글자 라벨»을 되찾는다 ──────────────────────────────
    # 수직선의 눈금 숫자(`-4 -3 -2 …`)와 점 이름(`a b c d e`)은 **글자 블록**이다.
    # 획만 오리면 숫자가 빠진 반쪽 그림이 나간다. 그렇다고 문항 안 글자를 다 넣으면
    # 발문이 딸려 온다 — 그래서 **획 덩어리에 붙어 있는 것만** 넣는다.
    #   · 세로로 `LABEL_GAP` 안에 있고
    #   · 가로로 획 덩어리와 실제로 겹친다(오른쪽 그림 옆 발문을 배제한다)
    # 한 번만 넓힌다. 되풀이하면 라벨 → 발문으로 기어올라간다(실측: 발문 마지막 줄까지 9.3pt).
    band = fitz.Rect(out)
    for t in text_boxes:
        if (t & box).is_empty and (t & band).is_empty:
            continue
        vgap = max(band.y0 - t.y1, t.y0 - band.y1, 0)
        hgap = max(band.x0 - t.x1, t.x0 - band.x1, 0)
        vover = min(band.y1, t.y1) - max(band.y0, t.y0)
        hover = min(band.x1, t.x1) - max(band.x0, t.x0)
        # 위·아래로 붙었거나(가로가 겹치고 세로 간격이 좁다), 옆으로 붙었거나
        # (세로가 겹치고 가로 간격이 좁다). 한 축만 보면 **옆에 붙은 라벨을 잃는다** —
        # 실측 `019fd1da-6321` 은 그래프 오른쪽 `3x-2y+12=0` 이 잘려 `=0` 이 사라졌다.
        # ⚠️ 예전엔 `min(t.width, band.width)` 로 쟀다. 그러면 **폭 237pt 짜리 발문 줄을
        # 폭 66pt 짜리 그림 띠에 견주게 되어** 언제나 30%를 넘겼고, 발문이 통째로 딸려
        # 들어왔다(적대적 리뷰 실측 3건). 재는 대상은 **글자 블록 자신**이어야 한다 —
        # 진짜 라벨(`-4`, `O A`, `4x+3y=12`)은 좁아서 여전히 통과한다.
        below = vgap <= LABEL_GAP and hover >= t.width * 0.3
        beside = hgap <= LABEL_GAP and vover >= t.height * 0.3
        if not (below or beside):
            continue
        out |= t

    # 쪽 밖으로는 못 나간다. 박스로는 자르지 않는다(위 주석 참조).
    out = out & page.rect
    # 너무 작으면 그림이 아니라 잡티다(밑줄 한 토막·점 하나).
    if out.is_empty or out.width < 30 or out.height < 20:
        return None
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dpi", type=int, default=DEFAULT_DPI)
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()

    if not PLAN.exists():
        raise SystemExit(
            f"계획이 없다: {PLAN}\n"
            "먼저 돌려라 — npx tsx scripts/qa/recover-rpm-figures-from-pdf.ts"
        )
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    items = plan["목록"][: a.limit] if a.limit else plan["목록"]

    # 원본이 없으면 **그 사실을 먼저 말한다.** 0건 성공을 조용히 보고하지 않는다.
    missing_pdf = sorted(
        {i["pdf"] for i in items if not pathlib.Path(i["pdf"]).exists()}
    )
    if missing_pdf:
        print(f"⛔ 원본 PDF 가 없다 ({len(missing_pdf)}개):")
        for m in missing_pdf:
            print(f"   {m}")
        print("   → 문서 docs/planning/16-figure-recovery-ledger.md §4.1 참조")

    docs: dict[str, fitz.Document] = {}
    ok: list[dict] = []
    fail: list[dict] = []
    skipped = 0

    try:
        for it in items:
            out = pathlib.Path(it["out"])
            if out.exists() and out.stat().st_size > 0:
                skipped += 1
                ok.append(
                    {"problemId": it["problemId"], "publicPath": to_public(out)}
                )
                continue

            pdf = it["pdf"]
            if not pathlib.Path(pdf).exists():
                fail.append({"externalId": it["externalId"], "이유": "원본 PDF 없음"})
                continue
            if pdf not in docs:
                docs[pdf] = fitz.open(pdf)
            doc = docs[pdf]

            page_index = int(it["page"]) - 1
            if not (0 <= page_index < doc.page_count):
                fail.append(
                    {"externalId": it["externalId"], "이유": f"쪽 범위 밖 {it['page']}"}
                )
                continue
            page = doc[page_index]

            x0, y0, x1, y1 = (float(v) for v in it["rect"])
            box = fitz.Rect(x0, y0, x1, y1) & page.rect
            if box.is_empty or box.width < 4 or box.height < 4:
                fail.append(
                    {"externalId": it["externalId"], "이유": "좌표가 비었거나 너무 작다"}
                )
                continue

            fig = figure_rect(page, box)
            if fig is None:
                fail.append(
                    {"externalId": it["externalId"], "이유": "문항 안에서 그림을 못 찾았다"}
                )
                continue
            rect = fitz.Rect(
                fig.x0 - PAD, fig.y0 - PAD, fig.x1 + PAD, fig.y1 + PAD
            ) & page.rect

            out.parent.mkdir(parents=True, exist_ok=True)
            pix = page.get_pixmap(clip=rect, dpi=a.dpi)
            pix.save(str(out))
            ok.append({"problemId": it["problemId"], "publicPath": to_public(out)})
    finally:
        for d in docs.values():
            d.close()

    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(
        json.dumps(
            {
                "대상": len(items),
                "성공수": len(ok),
                "이미있음": skipped,
                "실패수": len(fail),
                "실패": fail,
                "성공": ok,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(
        f"── 오려내기 ── 대상 {len(items)} · 성공 {len(ok)}"
        f"(그중 이미있음 {skipped}) · 실패 {len(fail)}"
    )
    for reason in sorted({f['이유'] for f in fail}):
        n = sum(1 for f in fail if f["이유"] == reason)
        print(f"   실패:{reason} {n}")
    print(f"→ {RESULT}")
    if ok and not missing_pdf:
        print(
            "다음: ALLOW_SHARED_IMPORT=1 npx tsx "
            "scripts/qa/recover-rpm-figures-from-pdf.ts --attach"
        )


def to_public(out: pathlib.Path) -> str:
    """`public/figures/rpm/<id>/0.png` → `/figures/rpm/<id>/0.png`"""
    return "/" + out.as_posix().split("public/", 1)[1]


if __name__ == "__main__":
    main()
