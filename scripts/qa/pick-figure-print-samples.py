# -*- coding: utf-8 -*-
"""전후 비교 지면(`/dev/figure-print-size`)의 표본을 **분포에서 뽑는다**.

    python scripts/qa/pick-figure-print-samples.py
    python scripts/qa/pick-figure-print-samples.py --check   # 쓰지 않고 검산만

산출물(커밋된다): `src/app/dev/figure-print-size/samples.generated.json`

## 왜 손으로 안 고르나

1차의 표본 6장은 손으로 골랐다. 그러면 «가장 큰 실데이터»가 안 들어와 레이아웃이
깨지는 조건이 지워진다 — 2026-08-19 범위 피커가 정확히 그렇게 깨졌다(시안 픽스처가
중2 17개뿐이라 학년 열이 16행인 것을 아무도 못 봤다). 그래서 여기서는
**실측 원장 전량**에서 규칙으로 뽑는다:

  ㉠ 배율 분포 — 하위 5% · 25% · 중앙 · 75% · 상위 5% 근처에서 각 3문항
  ㉡ **15mm 미만 전량** — 이 변경의 유일한 위험이다. 한 장도 안 빠뜨린다
  ㉢ 커지는 그림 — 드물지만(0.6%) 방향이 반대라 따로 본다
  ㉣ mm 를 **모르는** 그림이 아는 그림과 한 문항에 섞인 것 — 실제 지면이 그렇게 나간다
  ㉤ 세로로 긴 그림 · 한 문항에 여러 장 붙은 것

## 문항 단위로 묶는다

지면은 «그림 한 장»이 아니라 «문항 한 칸»을 그린다. 파일 이름이
`<시험지>/[머리-]q<번호>[_<몇째>].<확장자>` 라 같은 문항의 그림이 한 칸에 같이 나간다.
형제를 빼고 보면 지면이 실제와 달라지므로 **형제를 다 넣는다** — 그래서 표본에는
15mm 미만이 아닌 그림도 딸려 들어온다(그게 실제 지면이다).

읽기만 한다. DB·`public/figures` 를 안 건드린다.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
LEDGER = ROOT / "scripts/qa/reports/figure-rect-ledger.json"
OUT = ROOT / "src/app/dev/figure-print-size/samples.generated.json"

CAP_MM = 70.0
TINY_MM = 15.0  # 「작아서 못 읽는가」를 보는 문턱
GROW = 1.02  # 이보다 커지면 «커진다»
SHRINK = 0.98  # 이보다 작아지면 «작아진다»

# 🔴 **그림을 자르지 않는다.** 한 문항에 20장이 붙은 것이 실제로 있고(4314/q05),
# 지면이 깨지는지는 바로 그런 문항에서만 보인다. 시안 픽스처가 작아서 레이아웃 결함을
# 지워 버린 사고가 이미 있었다(2026-08-19 범위 피커 — 학년 열이 16행인 것을 못 봤다).
# 그래서 표본에는 **가장 큰 실데이터**가 그대로 들어간다. 몇 장짜리가 들어갔는지는 찍는다.
BIG_ITEM = 8  # 이보다 많으면 「큰 문항」으로 따로 적는다 (자르지는 않는다)

QUESTION_RE = re.compile(r"^(?P<stem>.*q\d+)(?:_\d+)?$")


def question_key(figure: str) -> str:
    """같은 문항의 그림을 한 칸으로 묶는 열쇠."""
    directory, _, name = figure.rpartition("/")
    base = name.rsplit(".", 1)[0]
    if directory.startswith("rpm/"):
        return directory  # rpm/<uuid>/<몇째>.png — 디렉터리가 곧 문항이다
    m = QUESTION_RE.match(base)
    return f"{directory}/{m.group('stem')}" if m else f"{directory}/{base}"


def current_mm(row) -> float | None:
    px = row.get("current_px")
    if not px or not px[0]:
        return None
    return min(CAP_MM, px[0] / 96 * 25.4)


def new_mm(row) -> float | None:
    mm = row.get("width_mm")
    return min(CAP_MM, mm) if mm else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="쓰지 않고 검산만 한다")
    args = ap.parse_args()

    if not LEDGER.is_file():
        print(f"원장이 없다: {LEDGER}")
        print("  그림벡터 트랙의 산출물이다. 없으면 표본을 못 뽑는다.")
        sys.exit(1)

    rows = json.loads(LEDGER.read_text(encoding="utf-8"))["행"]
    by_figure = {r["figure"]: r for r in rows}
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(question_key(r["figure"]), []).append(r)
    for members in groups.values():
        members.sort(key=lambda r: r["figure"])

    measurable = [r for r in rows if new_mm(r) is not None and current_mm(r) is not None]
    ratios = sorted(
        ((new_mm(r) / current_mm(r), r["figure"]) for r in measurable),
        key=lambda t: t[0],
    )
    print(f"원장 {len(rows):,}행 · 잴 수 있는 것 {len(measurable):,}장 · 문항 {len(groups):,}개")

    picked: list[dict] = []
    seen_keys: set[str] = set()
    notes: list[str] = []

    def add(key: str, bucket: str, why: str) -> bool:
        if key in seen_keys or key not in groups:
            return False
        members = groups[key]
        if len(members) > BIG_ITEM:
            notes.append(f"{key}: 그림 {len(members)}장 — 자르지 않고 전부 넣었다")
        seen_keys.add(key)
        picked.append(
            {
                "키": key,
                "갈래": bucket,
                "왜": why,
                "그림": [f"/figures/{m['figure']}" for m in members],
            }
        )
        return True

    # ㉠ 배율 분포에서 고르게 — 각 분위수 근처에서 «서로 다른 문항» 3개.
    n = len(ratios)
    for frac, label in (
        (0.05, "하위 5%"),
        (0.25, "25%"),
        (0.50, "중앙"),
        (0.75, "75%"),
        (0.95, "상위 5%"),
    ):
        start = min(n - 1, int(n * frac))
        taken = 0
        for offset in range(0, n):
            for index in (start + offset, start - offset):
                if taken >= 3 or not (0 <= index < n):
                    continue
                ratio, figure = ratios[index]
                row = by_figure[figure]
                if add(
                    question_key(figure),
                    f"배율 {label}",
                    f"배율 x{ratio:.2f} — 지금 {current_mm(row):.1f}mm → 새 {new_mm(row):.1f}mm",
                ):
                    taken += 1
            if taken >= 3:
                break

    # ㉡ 15mm 미만 **전량**. 형제까지 같이 들어간다 — 그게 실제 지면이다.
    tiny = sorted(
        (r for r in measurable if new_mm(r) < TINY_MM), key=lambda r: new_mm(r)
    )
    for row in tiny:
        add(
            question_key(row["figure"]),
            f"{TINY_MM:g}mm 미만",
            f"이 문항에 {new_mm(row):.2f}mm 짜리가 있다 (지금 {current_mm(row):.1f}mm)",
        )

    # ㉢ 커지는 것 — 가장 크게 커지는 쪽부터 서로 다른 문항 4개.
    grow = sorted(
        (r for r in measurable if new_mm(r) > current_mm(r) * GROW),
        key=lambda r: -new_mm(r) / current_mm(r),
    )
    taken = 0
    for row in grow:
        if taken >= 4:
            break
        if add(
            question_key(row["figure"]),
            "커진다",
            f"배율 x{new_mm(row) / current_mm(row):.2f} — 지금 {current_mm(row):.1f}mm → 새 {new_mm(row):.1f}mm",
        ):
            taken += 1

    # ㉣ mm 를 **모르는** 그림이 아는 그림과 한 문항에 섞인 것.
    mixed = []
    for key, members in groups.items():
        known = sum(1 for m in members if new_mm(m) is not None)
        if 0 < known < len(members):
            mixed.append((len(members), key))
    mixed.sort(key=lambda t: (-t[0], t[1]))
    taken = 0
    for size, key in mixed:
        if taken >= 3:
            break
        unknown = [m for m in groups[key] if new_mm(m) is None]
        reason = (unknown[0].get("note") or "사유 없음").split(" (")[0]
        if add(
            key,
            "mm 모름 섞임",
            f"그림 {size}장 중 {len(unknown)}장이 mm 를 모른다 — {reason}",
        ):
            taken += 1

    # ㉤ 세로로 긴 그림. 문항 열 폭이 아니라 **칸 높이**를 먼저 먹는 부류다.
    tall = sorted(
        (
            r
            for r in measurable
            if r["current_px"][1] / r["current_px"][0] >= 2.5 and new_mm(r) >= TINY_MM
        ),
        key=lambda r: -r["current_px"][1] / r["current_px"][0],
    )
    taken = 0
    for row in tall:
        if taken >= 3:
            break
        px = row["current_px"]
        if add(
            question_key(row["figure"]),
            "세로로 길다",
            f"세로가 가로의 {px[1] / px[0]:.1f}배 ({px[0]}x{px[1]}px)",
        ):
            taken += 1

    # ㉥ 한 문항에 여러 장 — mm 를 아는 것만 골라 «여러 장이 같이 줄어드는» 모습을 본다.
    many = sorted(
        (
            (len(m), key)
            for key, m in groups.items()
            if all(new_mm(x) is not None for x in m) and len(m) >= 4
        ),
        key=lambda t: (-t[0], t[1]),
    )
    taken = 0
    for size, key in many:
        if taken >= 3:
            break
        if add(key, "한 문항 여러 장", f"한 칸에 그림 {size}장이 같이 들어간다"):
            taken += 1

    # 🔴 분모 검산 — 15mm 미만 전량이 정말 다 들어갔나.
    in_samples = {u.removeprefix("/figures/") for item in picked for u in item["그림"]}
    missing = [r["figure"] for r in tiny if r["figure"] not in in_samples]
    if missing:
        print(f"\n🔴 15mm 미만인데 표본에 없다: {len(missing)}장")
        for f in missing:
            print(f"    {f}")
        sys.exit(2)

    figures = sum(len(item["그림"]) for item in picked)
    print(f"\n표본 문항 {len(picked)}개 · 그림 {figures}장")
    by_bucket: dict[str, int] = {}
    for item in picked:
        by_bucket[item["갈래"]] = by_bucket.get(item["갈래"], 0) + 1
    for bucket, count in by_bucket.items():
        print(f"  {bucket:16s} {count:3d}문항")
    print(f"  {TINY_MM:g}mm 미만 {len(tiny)}장 전량 포함 확인")
    for note in notes:
        print(f"  · {note}")

    payload = {
        "기준": (
            "실측 원장(figure-rect-ledger.json)에서 규칙으로 뽑았다. "
            "손으로 고르지 않는다 — scripts/qa/pick-figure-print-samples.py"
        ),
        "원장행": len(rows),
        "잰 그림": len(measurable),
        f"{TINY_MM:g}mm미만": len(tiny),
        "큰 문항": notes,
        "문항": picked,
    }
    if args.check:
        print("\n--check 라 쓰지 않았다.")
        return
    OUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(f"\n  -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
