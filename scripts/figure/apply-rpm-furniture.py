# -*- coding: utf-8 -*-
"""쪽 장식(`--furniture`)을 끄고 켠 오려내기 결과에서 **붙일 것만** 남긴다.

    python scripts/figure/apply-rpm-furniture.py            # 재 보기만
    python scripts/figure/apply-rpm-furniture.py --emit     # 붙이기용 결과를 쓴다

## 왜 걸러야 하나 — **넓게 돈 결과를 처리 대상으로 물려받지 마라**

오려내기는 계획 전량을 돈다. 그래서 결과의 `성공` 에는 **이미 그림이 붙어 있는 행**이
대부분이다(실측 87 중 69). 그대로 `--attach` 에 넘기면 붙이는 쪽이 `figureUrls` 를
**덮어쓴다** — 다른 트랙이 그 사이 바꿔 놓은 그림까지 같이 지운다.
2026-08-18 에 43건이 433건이 됐던 자리와 같다(CLAUDE.md).

그래서 대상을 **다시 좁힌다**: 지금 「그림 유실」로 세어지는 행만 남긴다.
근거는 `scripts/qa/reports/missing-figures.json` — 세는 쪽과 같은 파일을 읽는다.

## 그리고 **판정이 없으면 멈춘다**

남은 행마다 `rpm-furniture-decision.json` 에 「쓴다/뺀다」와 사유가 있어야 한다.
없으면 멈춘다 — 조용히 빼지도, 조용히 붙이지도 않는다.
"""
from __future__ import annotations

import argparse
import io
import json
import pathlib
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

RESULTS = ("scripts/qa/reports/rpm-crop-result-furn-gated.json",
           "scripts/qa/reports/rpm-crop-result-furn-group.json")
PLANS = ("scripts/qa/reports/rpm-crop-plan-gated.json",
         "scripts/qa/reports/rpm-group-crop-plan.json")
MISSING = pathlib.Path("scripts/qa/reports/missing-figures.json")
DECISION = pathlib.Path("scripts/qa/reports/rpm-furniture-decision.json")
OUT = pathlib.Path("scripts/qa/reports/rpm-crop-result-furn.json")

J = lambda p: json.load(io.open(p, encoding="utf-8"))


def narrow(results: list[dict], pid2ext: dict[str, str],
           missing: set[str]) -> tuple[list[dict], dict[str, int]]:
    """붙일 행만 남기고, **왜 뺐는지 세어서** 같이 돌려준다."""
    keep, why = [], {"그림이 이미 있다": 0, "유실 목록에 없다": 0}
    for res in results:
        for s in res["성공"]:
            e = pid2ext.get(s["problemId"])
            if e in missing:
                keep.append({**s, "externalId": e})
            else:
                why["그림이 이미 있다" if e else "유실 목록에 없다"] += 1
    return keep, why


def missing_decisions(keep: list[dict], dec: dict) -> list[str]:
    return [r["externalId"] for r in keep if r["externalId"] not in dec]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--emit", action="store_true", help="붙이기용 결과를 쓴다")
    a = ap.parse_args()

    pid2ext = {i["problemId"]: i["externalId"]
               for p in PLANS for i in J(p)["목록"]}
    missing = {r["externalId"] for r in J(MISSING)["목록"] if r["externalId"]}
    results = [J(p) for p in RESULTS]
    keep, why = narrow(results, pid2ext, missing)

    total = sum(len(r["성공"]) for r in results)
    print(f"── 좁히기 ── 결과의 성공 {total} → 붙일 것 {len(keep)}")
    for k, v in why.items():
        print(f"   뺌:{k} {v}")
    if len(keep) + sum(why.values()) != total:
        raise SystemExit("🔴 분모가 안 맞는다 — 조용히 사라진 행이 있다")

    dec = J(DECISION) if DECISION.exists() else {}
    gap = missing_decisions(keep, dec)
    if gap:
        raise SystemExit(f"🔴 판정이 없는 행 {len(gap)}건 — {DECISION} 에 적어라\n"
                         + "\n".join("   " + g for g in gap[:10]))
    use = [r for r in keep if dec[r["externalId"]]["판정"] == "쓴다"]
    drop = [r for r in keep if dec[r["externalId"]]["판정"] != "쓴다"]
    print(f"   쓴다 {len(use)} · 사람이 뺀다 {len(drop)}")
    for r in drop:
        print(f"     뺌 {r['externalId']} — {dec[r['externalId']]['왜']}")
    if not a.emit:
        print("(--emit 를 붙이면 결과를 쓴다)")
        return
    OUT.write_text(json.dumps(
        {"기준": "쪽 장식 제외 + 두께 0 선 살림으로 새로 오린 것 중 지금 유실인 행",
         "대상": len(keep), "성공수": len(use), "이미있음": 0,
         "실패수": len(drop),
         "실패": [{"externalId": r["externalId"], "이유": "사람이 뺐다 — "
                   + dec[r["externalId"]]["왜"]} for r in drop],
         "성공": [{"problemId": r["problemId"], "publicPath": r["publicPath"]}
                  for r in use]},
        ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"→ {OUT}")


if __name__ == "__main__":
    main()
