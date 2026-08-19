# -*- coding: utf-8 -*-
"""□(`\\square`) 로 무너진 RPM 해설·정답을 **정답책 원문으로 되살릴 계획**을 만든다.

    python scripts/qa/plan-rpm-square-repair.py            # 집계
    python scripts/qa/plan-rpm-square-repair.py --list 8   # 표본을 나란히
    python scripts/qa/plan-rpm-square-repair.py --emit     # 계획 파일로

입력: `scripts/qa/reports/rpm-square-rows.json` · `rpm-origin.json` · `.rpm-src/*정답.pdf`
출력: `scripts/qa/reports/rpm-square-repair.json`

## 왜 이제 되나 — 분수를 되살렸다

2026-08-19 아침까지는 「원문은 쌓인 분수가 납작해져 못 쓴다」가 전제였다. 틀렸다.
분수선은 글자가 아니라 **선**이라 텍스트 레이어에 안 남을 뿐, 벡터로 남아 있다.
`rpm_page_text.py` 가 좌표로 분자·분모를 되찾는다. 그래서 이제 원문 쪽이 **양쪽 다**
성하다 — 우리 것은 □ 자리가 통째로 죽어 있다(해설 2,577자리 · 정답 132자리).

## 이 계획이 손대는 것

`solution` 과 `answer` 뿐이다. `content`(발문)는 정답책에 없다 — **학생용** 책에서
좌표로 오려 와야 하고, 그건 다른 작업이다(233행 · □ 398자리).

## 「같은 문항인가」를 **본문 밖에서** 검산한다

번호로 찾은 것만으로는 모른다. 그래서 두 가지를 본다.

1. **한글 서술의 닮음** — 수식은 표기가 달라 못 견주지만 「따라서」·「이므로」는 같다.
   □ 는 수식 자리만 먹으므로 우리 쪽 한글은 살아 있다.
2. **책이 찍은 `답`** 과 우리 `answer` 의 숫자·한글 — 출처가 다른 값이다.

둘 중 **하나도 못 대면 계획에 넣지 않는다.** 애매하면 안 바꾼다.

## 잃는 것을 센다 (D-20)

바꾸면 우리 쪽 서술이 줄어드는 행이 있다. 원문 한글이 우리 것의 60% 에 못 미치면
**본문을 잃는 것**이므로 계획에서 뺀다. 건수만 보지 말고 그 분포를 같이 찍는다.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import re
import sys
from difflib import SequenceMatcher

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
import rpm_guards  # noqa: E402  — 두 계획이 **같은 가드**를 쓴다
#: ⚠️ **지금 DB 값**을 봐야 한다. 옛 스냅숏을 보면 이미 고친 행을 다시 계획에
#:    올리고, 적용기는 「값이 달라졌다」로 전부 건너뛴다 — 아무것도 안 고쳐진다.
CENSUS = pathlib.Path("scripts/qa/reports/rpm-damage-census.json")
ORIGIN = pathlib.Path("scripts/qa/reports/rpm-origin.json")
OUT = pathlib.Path("scripts/qa/reports/rpm-square-repair.json")
SRC = pathlib.Path(".rpm-src")
KO = re.compile(r"[가-힣]+")
#: 답을 견줄 때 남기는 것. ⚠️ **동그라미 숫자를 빼면 안 된다** — 객관식 답은 대부분
#: `⑤` 한 글자뿐이라, 한글·숫자만 남기면 양쪽이 **빈 문자열**이 되어 «못 잰다»가 된다
#: (실측: 근거 못 댄 94행 중 67행이 이것 때문이었다).
NUM_KO = re.compile(r"[가-힣0-9①-⑮㉠-㉪ㄱ-ㅎ]+")
#: 한글 서술이 이만큼은 닮아야 같은 문항으로 본다(대응쌍 만들 때와 같은 값).
MIN_KO_SIM = 0.55
#: 견줄 한글이 이만큼도 없으면 그 열쇠로는 판정 못 한다.
MIN_KO_LEN = 8
#: 답으로 검산할 때의 문턱. 답은 짧아 한 글자만 달라도 크게 떨어진다.
MIN_ANSWER_SIM = 0.5
#: 원문 한글이 우리 것의 이만큼은 돼야 한다. 밑돌면 **본문을 잃는다**.
KEEP_RATIO = 0.6
#: 변환 뒤에도 남으면 화면에서 깨지는 글자 — 하나라도 있으면 안 바꾼다.
RESIDUE = re.compile(r"[^\x20-\x7e가-힣\s∠△∽≤≥≠±×÷√…∴∵⋮※°⑴-⑿①-⑳❶-❺㉠-㉪㈀-㈜ㄱ-ㅎ→∼≡∥⊥¨⋯，、。]")


def load(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, HERE / path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def ko(t: str) -> str:
    return "".join(KO.findall(t or ""))


def numko(t: str) -> str:
    return "".join(NUM_KO.findall(t or ""))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", type=int, default=0)
    ap.add_argument("--emit", action="store_true")
    a = ap.parse_args()

    auditsol = load("auditsol", "audit-rpm-solutions.py")
    rpmlatex = load("rpmlatex", "rpm_book_latex.py")

    census = json.loads(CENSUS.read_text(encoding="utf-8"))
    hurt: dict[str, dict[str, int]] = {}
    for g in census["갈래"]:
        field = g["갈래"].split(":")[0]
        if field not in ("solution", "answer"):
            continue
        for pid in g["id"]:
            hurt.setdefault(pid, {})[field] = 1
    rows = [
        {"id": pid, "sq": sq, **{f: (census["지금"][pid] or {}).get(f) for f in ("content", "answer", "solution")}}
        for pid, sq in hurt.items()
        if pid in census["지금"]
    ]
    origin = {
        o["problemId"]: o
        for o in json.loads(ORIGIN.read_text(encoding="utf-8"))["목록"]
        if o.get("problemId")
    }

    books: dict[str, dict[int, tuple[str, str]]] = {}
    plan: list[dict] = []
    tally: dict[str, int] = {}
    lost: list[dict] = []

    def bump(k: str) -> None:
        tally[k] = tally.get(k, 0) + 1

    for r in rows:
        want = [f for f in ("solution", "answer") if r["sq"].get(f)]
        if not want:
            bump("발문만 깨졌다 — 학생용 책이 필요하다")
            continue
        o = origin.get(r["id"])
        if not o or not o.get("book") or not o.get("printedNumber"):
            bump("출처가 없다")
            continue
        book = o["book"]
        pdf = SRC / book.replace("학생용", "정답")
        if not pdf.exists():
            bump("정답책이 없다")
            continue
        if book not in books:
            books[book] = auditsol.book_solution_map(pdf)
            print(f"  {book} 색인 {len(books[book])}", flush=True)
        q = int(re.sub(r"\D", "", o["printedNumber"]) or 0)
        got = books[book].get(q)
        if not got:
            bump("정답책에 그 번호가 없다")
            continue
        body, bans = got
        bans = auditsol.ANSWER_PREFIX.sub("", bans)

        # ── 같은 문항인가 — 본문 밖 근거 둘 ─────────────────────────────
        our_ko, book_ko = ko(r.get("solution")), ko(body)
        sim_sol = (
            SequenceMatcher(None, book_ko, our_ko).ratio()
            if len(our_ko) >= MIN_KO_LEN and len(book_ko) >= MIN_KO_LEN
            else None
        )
        oa, ba = numko(r.get("answer")), numko(bans)
        sim_ans = SequenceMatcher(None, ba, oa).ratio() if oa and ba else None
        aligned = (sim_sol is not None and sim_sol >= MIN_KO_SIM) or (
            sim_ans is not None and sim_ans >= MIN_ANSWER_SIM
        )
        if not aligned:
            bump("같은 문항인지 확인할 근거가 없다")
            continue

        for field in want:
            raw = body if field == "solution" else bans
            if not raw.strip():
                bump(f"원본에 {field} 이 없다")
                continue
            value = rpmlatex.wrap_math(rpmlatex.to_latex(raw))
            left = sorted(set(RESIDUE.findall(value)))
            if left:
                bump(f"변환 뒤에도 원문 글자가 남는다 ({''.join(left)[:6]})")
                continue
            # ⚠️ 분수 약물이 안 풀린 자리는 `;` 가 **그대로 남는다**(`;2N;`=n/2 · `;[!;`=1/x
            #    — 분자·분모가 글자인 경우). 남은 `;` 는 아스키라 잔재 검사에 안 걸린다.
            #    한글 수학 서술에 `;` 는 거의 안 쓰이니 남아 있으면 실패로 본다.
            if ";" in value:
                bump("분수 약물이 안 풀렸다 (`;` 가 남는다)")
                continue
            # 순환소수 표시 `H` 는 우리 표기(숫자 위 점)로 못 옮겼다 — 안 바꾼다.
            if re.search(r"\dH", value):
                bump("순환소수 표시를 못 옮겼다")
                continue
            if " ".join(value.split()) == " ".join((r.get(field) or "").split()):
                bump("바뀌는 것이 없다")
                continue
            why = rpm_guards.check(value, r.get(field))
            if why:
                bump(why)
                continue
            if field == "solution":
                nk, ok_ = len(ko(value)), len(our_ko)
                if ok_ and nk < ok_ * KEEP_RATIO:
                    bump("원문이 더 짧다 — 본문을 잃는다")
                    lost.append({"id": r["id"], "book": book, "q": q, "우리": ok_, "원문": nk})
                    continue
            plan.append(
                {
                    "id": r["id"], "field": field, "book": book, "q": q,
                    "□": r["sq"][field], "sim": round(sim_sol or -1, 3),
                    "answerSim": round(sim_ans or -1, 3),
                    "current": r.get(field), "value": value,
                }
            )

    print(f"\n□ 가 든 {len(rows)}행 · 되살릴 자리 {len(plan)}")
    byf: dict[str, int] = {}
    for p in plan:
        byf[p["field"]] = byf.get(p["field"], 0) + 1
    print(f"  갈래별 {byf} · 되살아나는 □ {sum(p['□'] for p in plan)}자리")
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"  건너뜀: {k} {v}")
    if lost:
        print(f"\n  ⚠ 본문을 잃어 뺀 것 {len(lost)} (우리 한글 → 원문 한글)")
        for l in lost[:8]:
            print(f"     {l['book'][7:10]} #{l['q']}  {l['우리']} → {l['원문']}")

    for p in plan[: a.list]:
        print(f"\n═══ {p['book'][7:10]} #{p['q']} [{p['field']}] □{p['□']} 닮음 {p['sim']}/{p['answerSim']}")
        print(f"  지금 {' '.join((p['current'] or '').split())[:250]}")
        print(f"  원문 {' '.join(p['value'].split())[:250]}")

    if a.emit:
        OUT.write_text(
            json.dumps({"집계": tally, "잃는것": lost, "목록": plan}, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
        print(f"\n→ {OUT}")


if __name__ == "__main__":
    main()
