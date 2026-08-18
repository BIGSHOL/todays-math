# -*- coding: utf-8 -*-
"""되찾은 짝을 **독립인 구현으로 검산한다** (읽기 전용).

왜 이게 필요한가
----------------
`choice_figure_recover.py` 는 짝을 **2차원 기하**로 짓는다(마커 왼쪽·같은 줄).
그 짝이 맞는지를 같은 기하로 다시 재면 동어반복이다 — 이 저장소가 여러 번 밟은
자리다(CLAUDE.md 2026-08-18 «지표의 «참»이 제품에서 나오면 성적이 오른다»).

그래서 **다른 구현**을 채점자로 쓴다. testchanger `db/textlayer.py` 는 같은 PDF 를
읽지만 짝을 **글자 스트림의 선형 순서**로 짓는다(`cut` 으로 ①②③④⑤ 사이를 자른다).
방법이 다르므로, 둘이 같은 답을 내면 그건 서로를 검산한 것이다.

⚠️ textlayer 의 그룹핑은 **완전하지 않다** — 두 열 배치에서 빈 보기를 버리며
   그림을 엉뚱한 보기에 몰아 넣는다(실측 5427 13번: 보기 2에 그림 둘). 그러니
   **textlayer 가 다섯 보기에 한 장씩 깨끗이 나눠 준 문항만** 채점에 쓴다.
   그런 문항이 몇 건인지도 같이 찍는다 — 채점 가능한 표본이 몇인지 숨기지 않는다.

  python scripts/qa/verify-choice-figure-pairs.py \
      --pairs scripts/qa/reports/choice-figure-pairs.json \
      --cands scripts/qa/reports/choice-figure-candidates.json
"""
from __future__ import annotations

import argparse
import collections
import io
import json
import pathlib
import sys

sys.path.append(str(pathlib.Path(__file__).resolve().parent))
from tc_paths import testchanger_dir  # noqa: E402

TC = testchanger_dir()
sys.path.append(str(TC))
sys.path.append(str(TC / "db"))
import textlayer  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def textlayer_pairs(pdf: pathlib.Path, qnum: int) -> dict[tuple, int] | None:
    """textlayer 가 낸 «bbox → 보기 번호». 깨끗한 1:1 이 아니면 None."""
    try:
        meta = textlayer.extract(pdf)
    except Exception:  # noqa: BLE001
        return None
    q = next(
        (x for x in meta.get("questions") or [] if x.get("number") == qnum), None
    )
    if not q:
        return None
    chs = q.get("choices") or []
    if len(chs) != 5:
        return None
    out: dict[tuple, int] = {}
    for c in chs:
        figs = [b for b in (c.get("contents") or []) if b.get("type") == "figure"]
        if len(figs) != 1:
            return None  # 한 보기에 그림이 둘 이상 = 그룹핑이 무너진 것
        f = figs[0]
        out[(f["page"] - 1, tuple(f["bbox"]))] = c["number"]
    return out if len(out) == 5 else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", default="scripts/qa/reports/choice-figure-pairs.json")
    ap.add_argument(
        "--cands", default="scripts/qa/reports/choice-figure-candidates.json"
    )
    ap.add_argument(
        "--out", default="scripts/qa/reports/choice-figure-verify.json"
    )
    a = ap.parse_args()

    pairs = {
        r["id"]: r
        for r in json.loads(pathlib.Path(a.pairs).read_text(encoding="utf-8"))
    }
    cands = {
        c["id"]: c
        for c in json.loads(pathlib.Path(a.cands).read_text(encoding="utf-8"))
    }

    import importlib.util

    root = pathlib.Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "mapfig", root / "scripts" / "figure" / "map-figures.py"
    )
    mapfig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mapfig)

    tally = collections.Counter()
    detail = []
    for pid, r in pairs.items():
        if r["verdict"] != "자동":
            continue
        c = cands[pid]
        pdf = pathlib.Path((c.get("sourceFile") or "").replace("\\", "/"))
        if not pdf.exists():
            tally["원본없음"] += 1
            continue
        qnum = r["figureQnum"]
        tl = textlayer_pairs(pdf, qnum)
        if tl is None:
            tally["채점불가:textlayer 그룹핑이 깨끗하지 않음"] += 1
            continue
        try:
            mapped = mapfig.map_exam(pdf).get(qnum) or []
        except Exception:  # noqa: BLE001
            tally["채점불가:map_exam 실패"] += 1
            continue
        # 내 짝 {그림색인: 보기번호} 를 bbox 열쇠로 옮긴다
        mine: dict[tuple, int] = {}
        for i_str, n in (r.get("pairs") or {}).items():
            i = int(i_str)
            if i >= len(mapped):
                continue
            f = mapped[i]
            mine[(f["page"], tuple(f["rect"]))] = n
        common = set(mine) & set(tl)
        if not common:
            tally["채점불가:같은 그림을 못 찾음"] += 1
            continue
        agree = sum(1 for k in common if mine[k] == tl[k])
        if agree == len(common) and len(common) == 5:
            tally["일치(5/5)"] += 1
        elif agree == len(common):
            tally["일치(%d/%d 만 겹침)" % (agree, len(common))] += 1
        else:
            tally["불일치"] += 1
            detail.append(
                {
                    "id": pid,
                    "school": c.get("school"),
                    "qnum": qnum,
                    "mine": {str(k): v for k, v in mine.items()},
                    "textlayer": {str(k): v for k, v in tl.items()},
                }
            )

    total = sum(tally.values())
    print("── 독립 구현(textlayer 선형 그룹핑)으로 검산 — «자동» %d건 ──" % total)
    for k, v in tally.most_common():
        print("  %5d  %s" % (v, k))
    scored = sum(v for k, v in tally.items() if k.startswith("일치")) + tally["불일치"]
    if scored:
        agree = sum(v for k, v in tally.items() if k.startswith("일치"))
        print("  채점 가능한 표본 %d건 중 일치 %d (%.1f%%)" % (scored, agree, agree * 100 / scored))
    else:
        print("  채점 가능한 표본이 0건이다 — 이 검산으로는 아무것도 말할 수 없다")
    pathlib.Path(a.out).write_text(
        json.dumps({"tally": tally, "불일치": detail}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print("→", a.out)


if __name__ == "__main__":
    main()
