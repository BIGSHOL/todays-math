# -*- coding: utf-8 -*-
"""RPM 무리 그림 — **짝을 사람이 정하는 검수 시트**.

    python scripts/figure/sheet-rpm-group-pair.py                 # 시트를 만든다
    python scripts/figure/sheet-rpm-group-pair.py --probe <무리키>  # 좌표 지도
    python scripts/figure/sheet-rpm-group-pair.py --emit          # 판정대로 계획을 낸다

## 무엇이 막고 있었나 — **찾은 건 다 찾았는데 «누구 것»인지 모른다**

`plan-rpm-group-figures.py` 는 지면에 인쇄된 무리 표시 `[0014~0017]` 로 띠를 잡고
그 안의 그림 덩어리를 찾는다. 149건이 그렇게 회수됐다. 남은 46건은 **띠도 찾았고
덩어리도 찾았다.** 못 한 것은 **짝짓기** 하나다:

  · `덩어리 수와 소문항 수가 다르다`  24건 — 그림 2개인데 소문항 3개 같은 배치
  · `소문항이 격자로 놓인 무리`        22건 — 세로·가로가 다 겹쳐 한 축으로 못 가름

자동으로 밀면 **틀린 그림**이 붙는다. 그리고 틀린 그림은 지면에서 티가 안 난다
(문서 16 §4.4). 그래서 여기서는 **사람이 본다.**

## 지키는 것 넷 — 앞 시트(`sheet-rpm-stem-split.py`)와 같다

1. **찾는 규칙은 한 곳뿐이다.** 띠·덩어리·소문항 자리는 전부
   `plan-rpm-group-figures.py` 가 잰 것을 그대로 읽는다(`rpm-group-plan-report.json`).
   여기서 다시 찾지 않는다 — 찾는 눈이 둘이면 둘이 같이 눈이 먼다.
2. **오려내기·검사는 손대지 않는다.** 이 스크립트는 **좌표만** 낸다. 발문 침입·문장·
   선택지 번호·옆 문항 침입·완비 검사는 `crop-rpm-from-pdf.py` 가 그대로 한다.
   `avoid`/`forbid` 도 계획 쪽 `guard_boxes()` 를 **그대로 부른다**.
3. **조용히 빼지 않는다.** `--emit` 은 판정이 안 적힌 행이 하나라도 있으면 멈춘다.
4. **판정은 사유와 함께 커밋된다** (`scripts/qa/reports/rpm-pair-decision.json`).

## 시트가 보여 주는 것

무리마다 PNG 한 장(`<책>-p<쪽>-<무리>.png`):

  · **빨강 ①②③…** 자동으로 찾은 그림 덩어리 (번호는 위→아래, 같으면 왼→오른)
  · **파랑 0014…**  소문항의 좌표 상자 — 「이 번호가 누구인가」
  · 옆에 소문항마다 DB 발문 머리를 적는다

사람은 소문항마다 **덩어리 번호**를 고르거나, 어느 덩어리도 아니면 `--probe` 로
좌표를 보고 **네모를 직접 그린다**(`칸`). 아무것도 아니면 `버린다`.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import shutil
import sys
from collections import defaultdict

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

_HERE = pathlib.Path(__file__).parent
_spec = importlib.util.spec_from_file_location(
    "planrpmgroup", _HERE / "plan-rpm-group-figures.py"
)
plan_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(plan_mod)

REPORT = pathlib.Path("scripts/qa/reports/rpm-group-plan-report.json")
PLAN = pathlib.Path("scripts/qa/reports/rpm-crop-plan.json")
GATED = pathlib.Path("scripts/qa/reports/rpm-crop-plan-gated.json")
CONTENT = pathlib.Path("scripts/qa/reports/rpm-crop-content.json")
SHEET = pathlib.Path("scripts/qa/reports/rpm-pair-sheet.json")
SHOTS = pathlib.Path("scripts/qa/reports/rpm-pair-sheet")
DECISION = pathlib.Path("scripts/qa/reports/rpm-pair-decision.json")
OUT = pathlib.Path("scripts/qa/reports/rpm-pair-crop-plan.json")
SRC = pathlib.Path(".rpm-src")

#: 사람이 볼 사유 — 이 셋만 「짝을 못 정했다」다. 나머지(무리 표시를 못 찾았다 등)는
#: **띠 자체가 없어서** 보여 줄 것이 없다. 시트가 그것까지 삼키면 「사람이 봤다」가
#: 「볼 것이 없었다」를 덮는다.
PAIR_REASONS = (
    "덩어리 수와 소문항 수가 다르다",
    "소문항이 격자로 놓인 무리 — 한 축으로 못 가른다",
    "덩어리 수는 맞는데 차례가 안 맞는다",
)

#: 시트 PNG 해상도. 띠 하나가 한 화면에 들어와야 고를 수 있다.
SHEET_DPI = 200


def load(p: pathlib.Path):
    return json.loads(p.read_text(encoding="utf-8"))


def group_key(r: dict) -> str:
    """무리 하나를 가리키는 이름 — 파일 이름으로도 쓴다."""
    book = r["책"].replace("RPM 중학 ", "").replace(" 학생용.pdf", "")
    return f"{book}-p{r['쪽']}-{r['무리']}"


def blob_boxes(r: dict) -> list[list[float]]:
    """이 무리에서 사람에게 보여 줄 덩어리.

    격자 배치는 축을 못 정했으므로 두 축의 덩어리를 **합쳐** 보여 준다.
    같은 그림이 두 축에서 다르게 잘릴 수 있으니 **겹치는 것은 하나로 본다** —
    번호가 둘이면 사람이 어느 쪽을 고를지 헷갈린다.
    """
    got: list[pymupdf.Rect] = []
    for axis in ("y", "x"):
        for b in r.get(f"덩어리{axis}", []):
            rect = pymupdf.Rect(*b)
            same = next(
                (
                    g
                    for g in got
                    if not (g & rect).is_empty
                    and (g & rect).get_area() >= 0.6 * min(g.get_area(), rect.get_area())
                ),
                None,
            )
            if same is None:
                got.append(rect)
            elif rect.get_area() > same.get_area():
                got[got.index(same)] = rect
    got.sort(key=lambda g: (round(g.y0, 0), g.x0))
    return [[g.x0, g.y0, g.x1, g.y1] for g in got]


def shot(book: str, page_index: int, band: list[float], blobs, members, out: pathlib.Path):
    """띠를 뜬다 — 덩어리는 빨강 번호, 소문항 상자는 파랑 인쇄번호."""
    doc = pymupdf.open(SRC / book)
    page = doc[page_index]
    for i, b in enumerate(blobs, 1):
        rect = pymupdf.Rect(*b)
        page.draw_rect(rect, color=(1, 0, 0), width=1.2)
        page.insert_text(
            (rect.x0 + 1, max(page.rect.y0 + 8, rect.y0 - 2)),
            f"[{i}]", fontsize=9, color=(1, 0, 0),
        )
    for m in members:
        rect = pymupdf.Rect(*m["상자"])
        page.draw_rect(rect, color=(0, 0, 1), width=0.8)
        page.insert_text(
            (rect.x1 + 2, rect.y1), m["인쇄번호"], fontsize=7, color=(0, 0, 1)
        )
    view = pymupdf.Rect(*band) + (-14, -14, 14, 14)
    view &= page.rect
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(page.get_pixmap(clip=view, dpi=SHEET_DPI).tobytes("png"))
    doc.close()


def build() -> None:
    rep = load(REPORT)
    plan = {r["externalId"]: r for r in load(PLAN)["목록"]}
    content = load(CONTENT) if CONTENT.exists() else {}
    gated = load(GATED)
    page_off = {b["책"]: int(b.get("쪽오프셋", 0)) for b in gated["책"] if "쪽오프셋" in b}

    rows = [r for r in rep["상세"] if r["이유"] in PAIR_REASONS]
    if not rows:
        raise SystemExit("짝을 못 정한 행이 없다 — 계획을 먼저 돌려라")
    by_group: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_group[group_key(r)].append(r)

    if SHOTS.exists():
        shutil.rmtree(SHOTS)
    SHOTS.mkdir(parents=True, exist_ok=True)

    sheet = []
    for gk, rs in sorted(by_group.items()):
        head = rs[0]
        blobs = blob_boxes(head)
        # 무리의 소문항은 모두 같다(같은 무리 표시). 「나」 표시만 행마다 다르다.
        members = [dict(m) for m in head["소문항"]]
        targets = {r["externalId"] for r in rs}
        for m in members:
            m["대상"] = m["id"] in targets
            pid = plan.get(m["id"], {}).get("problemId")
            m["발문"] = (content.get(pid, "") or "").replace("\n", " ")[:90]
        shot(
            head["책"],
            int(head["쪽"]) - 1,
            head["띠"],
            blobs,
            members,
            SHOTS / f"{gk}.png",
        )
        sheet.append(
            {
                "무리키": gk,
                "책": head["책"],
                "쪽": head["쪽"],
                "쪽오프셋": page_off.get(head["책"], 0),
                "무리": head["무리"],
                "이유": head["이유"],
                "띠": head["띠"],
                "덩어리": blobs,
                "소문항": members,
                "대상수": len(targets),
                "그림": str((SHOTS / f"{gk}.png").as_posix()),
            }
        )

    SHEET.write_text(
        json.dumps(
            {
                "기준": "무리 띠는 찾았고 덩어리도 찾았다 — 짝만 사람이 정한다",
                "무리": len(sheet),
                "대상": sum(s["대상수"] for s in sheet),
                "목록": sheet,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"무리 {len(sheet)}개 · 대상 {sum(s['대상수'] for s in sheet)}행")
    for s in sheet:
        print(
            f"  {s['무리키']:<28} 덩어리 {len(s['덩어리'])} · 소문항 "
            f"{len(s['소문항'])} (대상 {s['대상수']}) · {s['이유'][:20]}"
        )
    print(f"→ {SHEET}\n→ {SHOTS}/")


def probe(gk: str) -> None:
    """**좌표를 눈으로 고르기 위한 지도** — 띠 안의 잉크 덩어리·글자를 좌표째로 찍는다."""
    sheet = load(SHEET)
    row = next((s for s in sheet["목록"] if s["무리키"].startswith(gk)), None)
    if row is None:
        raise SystemExit(f"시트에 없는 무리: {gk}")
    doc = pymupdf.open(SRC / row["책"])
    page = doc[int(row["쪽"]) - 1]
    band = pymupdf.Rect(*row["띠"])
    print(f"== {row['무리키']}  띠={[round(v, 1) for v in row['띠']]}  {row['이유']}")
    for i, b in enumerate(row["덩어리"], 1):
        r = pymupdf.Rect(*b)
        print(f"   [{i}] [{r.x0:6.1f},{r.y0:6.1f},{r.x1:6.1f},{r.y1:6.1f}] {r.width:5.0f}x{r.height:5.0f}pt")
    print("   ── 소문항 ─────────────────────────────")
    for m in row["소문항"]:
        r = m["상자"]
        mark = "◀ 대상" if m.get("대상") else ""
        print(
            f"      {m['인쇄번호']} [{r[0]:6.1f},{r[1]:6.1f},{r[2]:6.1f},{r[3]:6.1f}] "
            f"{m['id'][:13]} {mark}\n         {m.get('발문', '')[:80]}"
        )
    parea = page.rect.get_area()
    pieces: list[pymupdf.Rect] = []
    for b in page.get_text("rawdict").get("blocks", []):
        if b.get("type") == 0:
            continue
        r = pymupdf.Rect(*b["bbox"])
        if r.get_area() < parea * 0.7 and not (r & band).is_empty:
            pieces.append(r)
    for d in page.get_drawings():
        r = pymupdf.Rect(d["rect"])
        if r.is_infinite or r.get_area() >= parea * 0.7:
            continue
        # ⚠️ **곧은 선은 `is_empty` 다** — 폭이나 높이 중 하나만 0이어도 참이다.
        # 계획 쪽 `Page.parts` 는 그 가드에서 선을 전부 버린다(RPM 은 `thin_pt=0`).
        # 그래서 **덩어리 네모가 선을 안 담는다** — 실측 1-2 p11 `[0030~0033]` 의
        # 가로 직선 216.6~301.9pt 가 통째로 빠져 네모가 255~291 로 잡혔다.
        # 사람이 네모를 그리는 자리에서까지 안 보이면 **잘린 그림을 붙이게 된다.**
        if r.x1 - r.x0 <= 0 or r.y1 - r.y0 <= 0:
            if r.x1 - r.x0 <= 0 and r.y1 - r.y0 <= 0:
                continue
            r = pymupdf.Rect(r.x0 - 0.5, r.y0 - 0.5, r.x1 + 0.5, r.y1 + 0.5)
        if not (r & band).is_empty:
            pieces.append(r)
    groups: list[list[pymupdf.Rect]] = []
    for r in pieces:
        near = [
            g
            for g in groups
            if any(
                max(x.x0 - r.x1, r.x0 - x.x1, 0) <= 12
                and max(x.y0 - r.y1, r.y0 - x.y1, 0) <= 12
                for x in g
            )
        ]
        if not near:
            groups.append([r])
            continue
        first = near[0]
        first.append(r)
        for other in near[1:]:
            first.extend(other)
            groups.remove(other)
    print("   ── 띠 안 잉크 덩어리 (큰 것부터) ───────")
    boxes = []
    for g in groups:
        u = g[0]
        for r in g[1:]:
            u |= r
        boxes.append((u.get_area(), u, len(g)))
    for area, u, n in sorted(boxes, reverse=True, key=lambda t: t[0])[:12]:
        print(
            f"      [{u.x0:6.1f},{u.y0:6.1f},{u.x1:6.1f},{u.y1:6.1f}] "
            f"{u.width:5.0f}x{u.height:5.0f}pt 조각{n}"
        )
    print("   ── 띠 안 글자 ─────────────────────────")
    for r, txt in _band_spans(page, band):
        print(f"      [{r.x0:6.1f},{r.y0:6.1f},{r.x1:6.1f},{r.y1:6.1f}] {txt[:40]!r}")
    doc.close()


def _band_spans(page, band: pymupdf.Rect):
    out = []
    for b in page.get_text("rawdict").get("blocks", []):
        if b.get("type") != 0:
            continue
        for ln in b.get("lines", []):
            for sp in ln.get("spans", []):
                tight = None
                txt = ""
                for c in sp.get("chars", []):
                    ch = c.get("c", "")
                    txt += ch
                    if not ch.strip():
                        continue
                    cr = pymupdf.Rect(*c["bbox"])
                    tight = cr if tight is None else (tight | cr)
                if tight is not None and not (tight & band).is_empty:
                    out.append((tight, txt))
    out.sort(key=lambda t: (round(t[0].y0), t[0].x0))
    return out


def missing_decisions(sheet: dict, dec: dict) -> list[str]:
    """판정이 안 적힌 **대상**을 돌려준다 — 비어 있어야 계획을 낼 수 있다.

    **조용히 빼지 않기 위한 자리다.** 안 적힌 것을 그냥 건너뛰면 「사람이 다 봤다」가
    거짓이 되고, 숫자만 줄어든 채로 「완료」가 된다(CLAUDE.md 2026-08-16 「재개 가능한
    배치의 실패 표시」와 같은 성질이다).
    """
    return [
        m["id"]
        for g in sheet["목록"]
        for m in g["소문항"]
        if m.get("대상") and m["id"] not in dec
    ]


def emit() -> None:
    """판정대로 `crop-rpm-from-pdf.py` 가 먹는 계획을 낸다.

    **판정이 안 적힌 대상이 하나라도 있으면 멈춘다** — 조용히 빼면 「사람이 다 봤다」가
    거짓이 된다.
    """
    sheet = load(SHEET)
    plan = {r["externalId"]: r for r in load(PLAN)["목록"]}
    content = load(CONTENT) if CONTENT.exists() else {}
    if not DECISION.exists():
        raise SystemExit(f"판정 파일이 없다: {DECISION}")
    dec = load(DECISION).get("판정", {})

    targets: list[tuple[dict, dict]] = []
    for s in sheet["목록"]:
        for m in s["소문항"]:
            if m.get("대상"):
                targets.append((s, m))
    missing = missing_decisions(sheet, dec)
    if missing:
        raise SystemExit(
            f"판정이 안 적힌 행 {len(missing)}건 — 멈춘다.\n  " + "\n  ".join(missing[:20])
        )

    emitted: list[dict] = []
    dropped: list[dict] = []
    docs: dict[str, pymupdf.Document] = {}
    try:
        for s, m in targets:
            d = dec[m["id"]]
            if d.get("버린다"):
                dropped.append({"externalId": m["id"], "왜": d.get("왜", "")})
                continue
            if "칸" in d:
                rect = pymupdf.Rect(*d["칸"])
            elif "덩어리" in d:
                idx = int(d["덩어리"])
                if not (1 <= idx <= len(s["덩어리"])):
                    raise SystemExit(f"{m['id']}: 덩어리 번호 {idx} 가 범위 밖")
                rect = pymupdf.Rect(*s["덩어리"][idx - 1])
            else:
                raise SystemExit(f"{m['id']}: 판정에 «덩어리»도 «칸»도 «버린다»도 없다")
            src = plan[m["id"]]
            book = s["책"]
            if book not in docs:
                docs[book] = pymupdf.open(SRC / book)
            pg = plan_mod.Page(docs[book][int(s["쪽"]) - 1])
            badges = [
                r
                for r, txt in pg.lines
                if txt.strip() in {x["인쇄번호"] for x in s["소문항"] if x["인쇄번호"]}
                and not (r & pymupdf.Rect(*s["띠"])).is_empty
            ]
            stem_key = plan_mod.key(content.get(src["problemId"], ""))
            avoid, forbid = plan_mod.guard_boxes(pg, rect, badges, stem_key)
            row = {
                    "problemId": src["problemId"],
                    "externalId": m["id"],
                    "pdf": src["pdf"],
                    "page": int(s["쪽"]),
                    "rect": [rect.x0, rect.y0, rect.x1, rect.y1],
                    "avoid": avoid,
                    "forbid": forbid,
                    "out": src["out"],
                    "무리": s["무리"],
                    "짝짓기": "사람" if "칸" in d else "사람(덩어리)",
                    "왜": d.get("왜", ""),
                    "덩어리": len(s["덩어리"]),
                    "소문항": len(s["소문항"]),
                    "pageOff": s["쪽오프셋"],
                    # 같은 무리의 형제 — 무리 공용 그림은 이들의 좌표 상자와
                    # **겹치는 것이 정상**이라 「옆 문항 침입」으로 세면 안 된다.
                    # 근거는 지면에 인쇄된 무리 표시다(짐작이 아니다).
                    "siblings": [x["id"] for x in s["소문항"] if x["id"] != m["id"]],
            }
            if "칸" in d:
                # **사람이 그린 네모는 울타리다.** 자동 좌표와 달리 ±60pt 로 자라면
                # 격자 무리에서 옆 칸을 끌고 온다 — 그래서 그 밖으로 못 나가게 막는다.
                row["bound"] = [rect.x0, rect.y0, rect.x1, rect.y1]
            emitted.append(row)
    finally:
        for d2 in docs.values():
            d2.close()

    OUT.write_text(
        json.dumps(
            {
                "기준": "무리 띠·덩어리는 계획이 찾고, 짝은 사람이 정했다",
                "문항수": len(emitted),
                "버린것": dropped,
                "목록": emitted,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"쓴다 {len(emitted)} · 버린다 {len(dropped)} / 대상 {len(targets)}")
    print(f"→ {OUT}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", metavar="무리키", help="좌표 지도를 찍는다")
    ap.add_argument("--emit", action="store_true", help="판정대로 계획을 낸다")
    a = ap.parse_args()
    if a.probe:
        probe(a.probe)
    elif a.emit:
        emit()
    else:
        build()


if __name__ == "__main__":
    main()
