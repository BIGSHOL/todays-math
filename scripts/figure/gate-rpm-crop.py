# -*- coding: utf-8 -*-
"""RPM 오려내기 **자동 관문** — 좌표가 가리키는 상자의 글자가 DB 본문과 같은가.

문서 16 §4.1 이 재부착 전제로 요구한 관문이다. 눈이 아니라 **숫자로** 좌표가 맞는지
가른다. 좌표가 어긋나도 그것은 여전히 «유효한 사각형»이라 조용히 엉뚱한 그림이
나온다 — 오려내기는 성공하고 내용만 틀리는, 침묵하는 실패다.

    python scripts/figure/gate-rpm-crop.py                 # 있는 책 전부 재 본다
    python scripts/figure/gate-rpm-crop.py --list          # 행별 점수 + 글자 대조
    python scripts/figure/gate-rpm-crop.py --emit          # 통과분만 계획으로 쓴다

입력: `.rpm-src/<책이름>.pdf`                  (원본 교재)
      `scripts/qa/reports/rpm-crop-plan.json`    (좌표 — sumaek `source_coords`)
      `scripts/qa/reports/rpm-crop-content.json` (DB 본문 — `dump-rpm-content` 산출)
출력: `scripts/qa/reports/rpm-crop-plan-gated.json` (`--emit`)

## 쪽수가 같다고 좌표가 맞는 게 아니다 — 이 관문이 생긴 이유

문서 16 §4.1 은 **쪽수로** 판을 확정했다(1-1 184쪽 · 2-1 192쪽). 판은 정말 맞았다.
그런데 N드라이브의 2-1 은 여백을 **잘라 낸 재저장본**이라 지면이 623.6×841.9 가
아니라 589.5×807.8 이다. 좌표는 자르기 전 기준이므로 왼쪽 17pt · 위 34pt 만큼
어긋난다. 그대로 오리면 발문 첫 줄이 잘리고 옆 문항 그림이 딸려 온다 —
**2026-08-18 적대적 리뷰가 잡은 「37건 중 14건 결함」의 진짜 원인이 이것이다.**
쪽수는 한 방향 지표라 이 어긋남을 구조적으로 못 본다.

그래서 여기서는 **책마다 (dx, dy) 를 실제로 맞춰 본다.** 맞춘 값이 0 근처면 원본
그대로인 것이고, 크게 벗어나면 잘라낸 재저장본이다. 어느 쪽이든 **본문 유사도가
근거**이므로 판이 다르면 어떤 (dx, dy) 로도 점수가 안 오른다 — 「다른 오프셋이
0보다 뚜렷이 나을 때만 어긋난 것」(CLAUDE.md 2026-08-16).

## 열쇠는 한글+숫자다

LaTeX 명령·중괄호·라틴 변수는 추출기마다 다르게 깨진다. 그걸 그대로 비교하면 같은
문항이 0.8 아래로 내려가고, 문턱을 낮추면 형제 문항이 통과한다. **훼손되는 부분을
버리고 훼손되지 않는 한글+숫자만 남긴다** — 숫자를 남기므로 「숫자만 다른 형제」는
갈라진다 (CLAUDE.md 2026-08-17).

## 통과 못 한 행을 「틀렸다」고 읽지 마라

떨어지는 행의 대부분은 **좌표 상자가 발문을 안 담은 소문항**이다(2-1 실측 8건이
전부 폭 26~43pt). 발문은 부모 문항에 있고 상자에는 번호만 있다 — 대 볼 글자가
없으니 **판정 불가**이지 오답이 아니다. 그래서 이 관문은 「통과분만 붙인다」에만
쓰고, 떨어진 행은 잠긴 채로 남긴다.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import statistics
import sys
from difflib import SequenceMatcher

import pymupdf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PLAN = pathlib.Path("scripts/qa/reports/rpm-crop-plan.json")
CONTENT = pathlib.Path("scripts/qa/reports/rpm-crop-content.json")
GATED = pathlib.Path("scripts/qa/reports/rpm-crop-plan-gated.json")
SRC = pathlib.Path(".rpm-src")
KEEP = re.compile(r"[가-힣0-9]+")
#: 이 폭·높이 아래 상자는 발문을 담을 수 없다 — 소문항 번호 칸이다(2-1 실측 26~43pt).
MIN_BOX_PT = 60.0
#: (dx, dy) 를 맞출 때만 상자를 이만큼 **깎는다**.
#: 상자는 글자보다 넉넉해서, 안 깎고 재면 ±10pt 를 움직여도 점수가 그대로다 —
#: 실측으로 (-17,-34) 와 (-23,-18) 이 둘 다 0.95 였다. 깎으면 갈린다(0.939 vs 0.795).
#: 「지표가 실패를 셀 수 있는 형태인지 먼저 확인하라」(CLAUDE.md 2026-08-16).
FIT_ERODE_PT = 8.0
#: 맞춘 오프셋이 (0,0) 보다 이만큼도 못 나으면 (0,0) 으로 본다.
FIT_TIE_MARGIN = 0.03
#: **쪽 오프셋**도 맞춘다. 같은 판이라도 표지 매수가 다르면 쪽이 통째로 밀린다 —
#: 실측 `RPM 중학 3-2` 는 139쪽인데 좌표는 136쪽 기준이라 중앙값이 0.087 이었다.
#: (dx, dy) 와 달리 이건 정수 쪽이고, 밀리면 «전혀 다른 쪽»이라 점수가 바닥을 친다.
PAGE_SWEEP = 6
#: 쪽 오프셋이 0 보다 이만큼은 나아야 «밀린 것»으로 본다.
PAGE_TIE_MARGIN = 0.2


def key(text: str) -> str:
    """훼손되지 않는 부분만 남긴다 — 한글과 숫자."""
    return "".join(KEEP.findall(text))


class Book:
    """한 권의 낱말 좌표를 한 번만 읽어 두고 (dx, dy) 를 바꿔 가며 잰다."""

    def __init__(self, pdf: pathlib.Path, rows: list[dict], content: dict[str, str]):
        self.rows = rows
        self.content = content
        self.page_off = 0
        doc = pymupdf.open(pdf)
        self.page_count = doc.page_count
        self.rect = doc[0].rect
        self.words: dict[int, list] = {}
        self.prect: dict[int, pymupdf.Rect] = {}
        wanted = set()
        for r in rows:
            base = int(r["page"]) - 1
            for off in range(-PAGE_SWEEP, PAGE_SWEEP + 1):
                if 0 <= base + off < doc.page_count:
                    wanted.add(base + off)
        for pi in sorted(wanted):
            self.words[pi] = doc[pi].get_text("words")
            self.prect[pi] = doc[pi].rect
        doc.close()

    def fit_page(self) -> int:
        """쪽 오프셋을 맞춘다. **0 보다 뚜렷이 낫지 않으면 0 이다.**"""
        sample = [r for r in self.rows if self.is_measurable(r)][:40] or self.rows[:40]
        base = statistics.median(self.scores(0, 0, sample)) if sample else 0.0
        best = (base, 0)
        for off in range(-PAGE_SWEEP, PAGE_SWEEP + 1):
            if off == 0:
                continue
            self.page_off = off
            sc = self.scores(0, 0, sample)
            if sc and (m := statistics.median(sc)) > best[0]:
                best = (m, off)
        self.page_off = 0
        return best[1] if best[0] - base >= PAGE_TIE_MARGIN else 0

    def box_text(self, row: dict, dx: float, dy: float, erode: float = 0.0) -> str | None:
        pi = int(row["page"]) - 1 + self.page_off
        if pi not in self.words:
            return None
        x0, y0, x1, y1 = row["rect"]
        box = pymupdf.Rect(x0 + dx + erode, y0 + dy + erode,
                           x1 + dx - erode, y1 + dy - erode) & self.prect[pi]
        got = []
        for w in self.words[pi]:
            wr = pymupdf.Rect(w[:4])
            # 낱말의 절반 이상이 상자 안일 때만 — 걸친 것을 다 세면 옆 단이 딸려 온다.
            if wr.intersects(box) and wr.intersect(box).get_area() > 0.5 * wr.get_area():
                got.append(w[4])
        return " ".join(got)

    def sim(self, row: dict, dx: float, dy: float, erode: float = 0.0) -> float | None:
        txt = self.box_text(row, dx, dy, erode)
        if txt is None:
            return None
        return SequenceMatcher(
            None, key(txt), key(self.content.get(row["problemId"], ""))
        ).ratio()

    def scores(self, dx: float, dy: float, rows: list[dict] | None = None,
               erode: float = 0.0) -> list[float]:
        return [s for r in (rows or self.rows)
                if (s := self.sim(r, dx, dy, erode)) is not None]

    def fit(self) -> tuple[float, float, float]:
        """(dx, dy) 를 맞춘다. 발문을 담은 상자만, **깎아서** 잰다."""
        sample = [r for r in self.rows if self.is_measurable(r)] or self.rows
        e = FIT_ERODE_PT
        best = (-1.0, 0.0, 0.0)
        for dx in range(-45, 6, 2):
            for dy in range(-45, 6, 2):
                sc = self.scores(dx, dy, sample, e)
                if sc and (m := statistics.median(sc)) > best[0]:
                    best = (m, float(dx), float(dy))
        for _ in range(2):
            _, bx, by = best
            step = 1.0 if _ == 0 else 0.25
            for i in range(-4, 5):
                for j in range(-4, 5):
                    dx, dy = bx + i * step, by + j * step
                    sc = self.scores(dx, dy, sample, e)
                    if sc and (m := statistics.median(sc)) > best[0]:
                        best = (m, dx, dy)
        # **0 보다 뚜렷이 낫지 않으면 0 이다.** 안 그러면 잡음이 몇 pt 를 만들어 내고,
        # 원본 그대로인 책까지 좌표를 흔든다(1-1 실측: 최적이라던 (-3,-1) 이 0 과 동점).
        zero = statistics.median(self.scores(0, 0, sample, e))
        if best[0] - zero < FIT_TIE_MARGIN:
            return 0.0, 0.0, zero
        return best[1], best[2], best[0]

    @staticmethod
    def is_measurable(row: dict) -> bool:
        x0, y0, x1, y1 = row["rect"]
        return (x1 - x0) >= MIN_BOX_PT and (y1 - y0) >= MIN_BOX_PT


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--book", help="이 책만 (계획의 `pdf` 파일명)")
    ap.add_argument("--src", default=str(SRC), help="원본 교재 디렉터리")
    ap.add_argument("--list", action="store_true", help="행별 점수와 글자를 찍는다")
    ap.add_argument("--min-sim", type=float, default=0.85)
    ap.add_argument("--no-fit", action="store_true", help="(dx, dy) 를 맞추지 않는다")
    ap.add_argument("--no-page-fit", action="store_true", help="쪽 오프셋을 맞추지 않는다")
    ap.add_argument("--emit", action="store_true",
                    help=f"통과분만 좌표를 고쳐 {GATED} 로 쓴다")
    a = ap.parse_args()

    plan = json.loads(PLAN.read_text(encoding="utf-8"))["목록"]
    content = json.loads(CONTENT.read_text(encoding="utf-8"))
    src = pathlib.Path(a.src)

    books: dict[str, list[dict]] = {}
    for r in plan:
        books.setdefault(pathlib.Path(r["pdf"]).name, []).append(r)
    if a.book:
        books = {a.book: books[a.book]}

    emitted: list[dict] = []
    summary: list[dict] = []
    for name, rows in sorted(books.items()):
        pdf = src / name
        if not pdf.exists():
            print(f"⛔ {name}: 원본이 없다 ({pdf}) — {len(rows)}행 보류")
            summary.append({"책": name, "대상": len(rows), "상태": "원본 없음"})
            continue
        book = Book(pdf, rows, content)
        book.page_off = 0 if a.no_page_fit else book.fit_page()
        dx, dy, fit_med = (0.0, 0.0, 0.0) if a.no_fit else book.fit()
        base = book.scores(0, 0)
        got = book.scores(dx, dy)
        measurable = [r for r in rows if Book.is_measurable(r)]
        passed = 0
        for r in rows:
            s = book.sim(r, dx, dy)
            if a.list:
                mark = "·" if Book.is_measurable(r) else "▫"
                print(f"{s if s is None else round(s, 3)} {mark} p{r['page']} {r['externalId'][:13]}")
                print(f"       상자 {key(book.box_text(r, dx, dy) or '')[:80]}")
                print(f"       DB   {key(content.get(r['problemId'], ''))[:80]}")
            if s is not None and s >= a.min_sim:
                passed += 1
                x0, y0, x1, y1 = r["rect"]
                emitted.append({**r, "page": int(r["page"]) + book.page_off,
                                "rect": [x0 + dx, y0 + dy, x1 + dx, y1 + dy],
                                "sim": round(s, 3), "dx": dx, "dy": dy,
                                "pageOff": book.page_off})

        print(f"\n── {name}  ({book.page_count}쪽 · {book.rect.width:.1f}×{book.rect.height:.1f})")
        print(f"   맞춘 오프셋 쪽{book.page_off:+d} dx={dx:g} dy={dy:g}"
              f"   (보정 없음 중앙값 {statistics.median(base):.3f}"
              f" → 보정 후 {statistics.median(got):.3f}"
              f" · {FIT_ERODE_PT:g}pt 깎아서 {fit_med:.3f})")
        print(f"   대상 {len(rows)}행 · 발문을 담은 상자 {len(measurable)}행"
              f" · {a.min_sim} 통과 {passed}행")
        summary.append({"책": name, "대상": len(rows), "쪽오프셋": book.page_off,
                        "dx": dx, "dy": dy,
                        "보정전중앙값": round(statistics.median(base), 3),
                        "보정후중앙값": round(statistics.median(got), 3),
                        "통과": passed})

    if a.emit:
        GATED.parent.mkdir(parents=True, exist_ok=True)
        GATED.write_text(json.dumps(
            {"기준": f"본문 유사도 {a.min_sim} 이상 · 책별 (dx,dy) 보정 적용",
             "책": summary, "문항수": len(emitted), "목록": emitted},
            ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\n통과 {len(emitted)}행 → {GATED}")


if __name__ == "__main__":
    main()
