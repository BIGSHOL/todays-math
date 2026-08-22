# -*- coding: utf-8 -*-
"""초등 난이도 갈래(D-71) 변이 시험 — 「이 시험이 정말 무는가」를 확인한다.

    python scripts/qa/mutate-elem-tiers.py g3
    python scripts/qa/mutate-elem-tiers.py g5

**판정 순서가 이 도구의 알맹이다** (CLAUDE.md 2026-08-20·08-21):

  ⑴ 파일이 바뀌었나      — 안 바뀌면 치환이 실패한 것이다(따옴표·역슬래시가 흔한 범인)
  ⑵ **산출물이 바뀌었나** — 파일이 바뀌어도 뜻이 안 바뀌면 «가드가 아니다»가 거짓말이 된다
  ⑶ 그제서야 시험이 빨개지나

⑵ 를 건너뛰면 **멀쩡한 가드를 의심하고 고치러 간다** — 가드가 없는 것보다 나쁘다.
빨강일 때는 «어떤 검사가» 떨어졌는지도 찍는다. 엉뚱한 검사가 대신 걸린 것을
「잡았다」로 읽지 않기 위해서다.

변이 목록은 **소스의 실제 문자열**이라 코드가 바뀌면 「자리를 못 찾았다」로 시끄럽게
깨진다 — 조용히 통과하는 것보다 낫다. 그때는 목록을 지금 소스에 맞춰 고친다.
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROBE_PATH = os.path.join(ROOT, "scripts", "qa", ".mutate-elem-tiers.probe.ts")

PROBE_TS = """
import { elementaryUnits, generateElementaryProblem } from "../../src/lib/elementary/generate";
import { ELEM_TIERS } from "../../src/lib/elementary/difficulty";

const unit = elementaryUnits().find(
  (u) => u.grade === "__GRADE__" && u.section.startsWith("__SECTION__"),
)!;
const out: string[] = [];
for (const tier of ELEM_TIERS) {
  for (const seed of [20260821, 7, 1234, 1, 2, 3]) {
    try {
      const p = generateElementaryProblem(unit, seed, tier);
      out.push(`${tier}|${seed}|${p.content}|${p.answer}|${p.solution}`);
    } catch (err) {
      out.push(`${tier}|${seed}|THROW ${String(err)}`);
    }
  }
}
console.log(JSON.stringify(out));
"""

# ── 변이 목록 ──────────────────────────────────────────────────────────
# (이름, 찾을 문자열, 바꿀 문자열). 찾을 문자열은 **소스 그대로**여야 한다.
G3_MUTS = [
    (
        "조건 훼손 — 기본 갈래의 받아올림 하한을 푼다",
        "function add3Word(unit: UnitSeed, rng: Rng): ElemProblem {\n  const [a, b] = addWithCarries(rng, 2, 3);",
        "function add3Word(unit: UnitSeed, rng: Rng): ElemProblem {\n  const [a, b] = addWithCarries(rng, 0, 3);",
    ),
    (
        "검산 훼손 — 기본 갈래 정답을 하나 올린다",
        "    n(a + b),\n    `${p.left} 수와 ${p.right} 수를 더합니다.",
        "    n(a + b + 1),\n    `${p.left} 수와 ${p.right} 수를 더합니다.",
    ),
    (
        "응용 둘째 단계 훼손 — 중간값을 안 더한다",
        "  const total = base + second;",
        "  const total = base + more;",
    ),
    (
        "심화 역산 훼손 — 어떤 수를 답으로 낸다",
        "    n(r.rightSum),",
        "    n(r.some),",
    ),
    (
        "소재 고정 — 기본 갈래가 늘 첫 소재",
        "  const p = pick(rng, ADD_PAIRS);",
        "  const p = ADD_PAIRS[0]!;\n  void rng;",
    ),
    (
        "갈래 뭉개기 — 심화를 연산으로",
        "    심화: add3Reverse,",
        "    심화: add3Calc,",
    ),
]

TARGETS = {
    "g3": {
        "file": "src/lib/elementary/g3.ts",
        "test": "src/__tests__/unit/elementaryG3Tiers.test.ts",
        "grade": "초3",
        "section": "1-1-2",
        "muts": G3_MUTS,
    },
    # elem-g5 가 채운다. 목록이 비면 **돌지 않고 멈춘다** — 「변이 0개 전부 빨강」이
    # 초록으로 읽히면 안 된다(0은 「깨끗」과 「못 셈」을 구분해 주지 않는다).
    "g5": {
        "file": "src/lib/elementary/g5.ts",
        "test": "src/__tests__/unit/elementaryG5Tiers.test.ts",
        "grade": "초5",
        "section": "1-6-2",
        "muts": [],
    },
}


def run(args: list[str]) -> tuple[int, str]:
    r = subprocess.run(args, capture_output=True, shell=True, cwd=ROOT)
    return r.returncode, r.stdout.decode("utf-8", "replace")


def probe(grade: str, section: str) -> str:
    ts = PROBE_TS.replace("__GRADE__", grade).replace("__SECTION__", section)
    io.open(PROBE_PATH, "w", encoding="utf-8").write(ts)
    try:
        _, out = run(["npx", "tsx", PROBE_PATH])
        return out.strip()
    finally:
        if os.path.exists(PROBE_PATH):
            os.remove(PROBE_PATH)


def failed_tests(test_path: str) -> tuple[int, list[str]]:
    code, txt = run(["npx", "vitest", "run", test_path, "--reporter=json"])
    names: list[str] = []
    try:
        data = json.loads(txt[txt.index("{"):])
        for suite in data.get("testResults", []):
            for case in suite.get("assertionResults", []):
                if case.get("status") == "failed":
                    names.append(case.get("title", "?"))
    except Exception:
        if code != 0:
            names = ["(판정 결과를 못 읽었다 — vitest 출력을 직접 보라)"]
    return code, names


def main() -> int:
    which = sys.argv[1] if len(sys.argv) > 1 else "g3"
    target = TARGETS.get(which)
    if target is None:
        print(f"모르는 대상입니다: {which} — {' · '.join(TARGETS)}")
        return 2
    if not target["muts"]:
        print(f"«{which}» 변이 목록이 비어 있습니다. 채우기 전에는 판정하지 않습니다 —")
        print("빈 목록으로 「전부 빨강」을 찍으면 아무것도 증명하지 못합니다.")
        return 2

    path = os.path.join(ROOT, target["file"])
    src = io.open(path, encoding="utf-8").read()
    if os.path.exists(PROBE_PATH):
        os.remove(PROBE_PATH)

    base = probe(target["grade"], target["section"])
    if not base.startswith("["):
        print("기준 산출물을 못 얻었습니다:", base[:400])
        return 1
    print(f"대상 {which} · 기준 산출물 {len(json.loads(base))}건\n")

    ok = True
    try:
        for name, before, after in target["muts"]:
            if before not in src:
                print(f"  ??    {name}\n        ← 자리를 못 찾았다(변이가 적용되지 않았다)")
                ok = False
                continue
            io.open(path, "w", encoding="utf-8").write(src.replace(before, after, 1))
            if io.open(path, encoding="utf-8").read() == src:
                print(f"  ??    {name}\n        ← 파일이 안 바뀌었다")
                ok = False
            elif probe(target["grade"], target["section"]) == base:
                print(f"  ??    {name}\n        ← **산출물이 그대로다.** 판정하지 않는다")
                ok = False
            else:
                code, names = failed_tests(target["test"])
                print(f"  {'RED  ' if code else 'GREEN'} {name}")
                for t in names[:3]:
                    print(f"        ↳ {t}")
                if code == 0:
                    print("        ← 시험이 못 잡는다")
                    ok = False
            io.open(path, "w", encoding="utf-8").write(src)
    finally:
        # 어떤 일이 있어도 되돌린다 — 변이가 남은 채 끝나면 그게 가장 나쁘다.
        io.open(path, "w", encoding="utf-8").write(src)
        if os.path.exists(PROBE_PATH):
            os.remove(PROBE_PATH)

    restored = io.open(path, encoding="utf-8").read() == src
    print("\n" + ("모든 변이가 빨강" if ok else "빠진 변이가 있다"))
    print("복원:", "예" if restored else "**아니오 — 손으로 확인하라**")
    return 0 if (ok and restored) else 1


if __name__ == "__main__":
    sys.exit(main())
