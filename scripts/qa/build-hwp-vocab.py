# -*- coding: utf-8 -*-
"""HWP 수식 스크립트 **키워드 정본**을 변환기에서 그대로 뽑아 JSON 으로 굳힌다.

## 왜 만드나 — 손으로 나열한 목록은 반드시 샌다

잔재 지표(`measure-hwp-latex-residue.py`)도, 고치는 쪽(`hwpeq_unglue.py`)도
키워드를 **손으로 적어** 두었다. 그래서 `DIVIDE` 를 놓쳤고(2026-08-17),
다시 `le`·`ge`·소문자 `times` 를 놓쳤다(2026-08-18, 원장님 스크린샷).
세는 쪽과 고치는 쪽이 **같이 눈이 멀어** 있었다.

그래서 목록을 사람이 쓰지 않는다. 정본은 변환기 자신이다 —

    F:\\시험지변환기\\core\\latex_to_hwpeq.py   SYMBOL/GREEK/FUNC/ACCENT_MAP · _ROMAN_SKIP_EXTRA
    F:\\시험지변환기\\core\\hwpeq_to_latex.py   _REV(역매핑) · _STRUCT · _ACCENTS · _GLUE_PREFIX

이 스크립트가 그 맵을 **import 해서** 읽고 `hwp-vocab.json` 을 낸다.
세는 쪽(`census-math-tokens.ts`)과 고치는 쪽(`renderPostfixRules.ts`)이
**같은 파일 하나**를 읽는다.

## 정본에도 없는 것 — `le`·`ge`

정본 맵은 `\\le`·`\\leq` → `LEQ` 한 방향뿐이라 역매핑 키가 `LEQ` 밖에 없다.
HWP 원본이 쓰는 짧은꼴 `le`·`ge` 는 `_REV` 에 없어 **토큰이 그대로 흘러나간다**
(`hwpeq_to_latex._P.atom` 의 `v`/`low`/`up` 조회가 전부 빗나감).
정본을 그대로 믿으면 이 부류는 영영 안 잡힌다 — 그래서 정본에서 뽑은 목록과
**실측 census 로 발견한 목록을 따로** 싣고, 어느 쪽에서 왔는지 표시한다.
`census-math-tokens.ts` 가 정본 밖 잔재를 계속 새로 찾아내는 역할을 한다.

    python scripts/qa/build-hwp-vocab.py
    python scripts/qa/build-hwp-vocab.py --out scripts/qa/hwp-vocab.json
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

# 원본 저장소는 **읽기 전용**이다 (tracks/README §3). import 만 한다.
TESTCHANGER = pathlib.Path(r"F:\시험지변환기")

DEFAULT_OUT = pathlib.Path("scripts/qa/hwp-vocab.json")


def load_converter():
    if not TESTCHANGER.exists():
        raise SystemExit(
            "정본 저장소가 없다: %s\n"
            "hwp-vocab.json 은 커밋되어 있으니 그대로 쓰면 된다. "
            "다시 만들려면 이 경로가 필요하다." % TESTCHANGER
        )
    sys.path.insert(0, str(TESTCHANGER))
    from core import hwpeq_to_latex as h2l  # noqa: E402
    from core.latex_to_hwpeq import LaTeXToHWPConverter as Conv  # noqa: E402

    return h2l, Conv


def build() -> dict:
    h2l, Conv = load_converter()

    # ── 1. HWP 쪽 토큰 전부 (맵의 **값**) ─────────────────────────────────
    # 알파벳으로만 이루어진 것만 쓴다. `->`·`<=`·`"∅"` 같은 기호 토큰은
    # 글자 잔재 판정에 쓸 수 없다(다른 규칙이 본다).
    hwp_tokens: set[str] = set()
    for mp in (Conv.SYMBOL_MAP, Conv.GREEK_MAP, Conv.FUNC_MAP, Conv.ACCENT_MAP):
        for value in mp.values():
            token = str(value).strip()
            if re.fullmatch(r"[A-Za-z]+", token):
                hwp_tokens.add(token)

    # ── 2. 역매핑(HWP → LaTeX). 변환기가 **되돌릴 수 있는** 토큰들 ────────
    reverse = {
        k: v for k, v in h2l._REV.items() if re.fullmatch(r"[A-Za-z]+", k)
    }

    # ── 3. 구조 키워드 — 되돌리려면 피연산자 경계를 알아야 하는 것들 ──────
    struct = set(h2l._STRUCT) | set(h2l._ACCENTS) | set(h2l._MATRIX)
    struct |= {s.lower() for s in Conv._ROMAN_SKIP_EXTRA}
    # `pile` 계열 — HWP 는 좌/우/중앙 정렬 변종을 쓴다. 정본 `_STRUCT` 에는
    # `pile` 만 있는데 실데이터에는 `rpile` 이 나온다(실측: `left( rpile-1&&1#0&&-3 right)`).
    # 이 변종을 못 보면 `rpile` 의 `le` 를 부등호로 오인해 행렬을 부순다.
    struct |= {"lpile", "rpile", "cpile"}

    # ── 4. 글루 접두 — HWP 는 `RMABC`·`TIMES5` 처럼 붙여 쓴다 ─────────────
    glue_prefix = sorted(h2l._GLUE_PREFIX)

    # ── 5. 정본에 **없는데 실데이터에 있는** 잔재 ─────────────────────────
    # 근거는 census 다. 여기 적는 것은 "정본이 못 되돌리는 토큰" 이라는 사실뿐이고,
    # 무엇으로 고칠지는 renderPostfixRules 가 정한다(표본을 눈으로 본 뒤에).
    outside_canon = {
        # HWP 수식편집기의 짧은꼴 부등호. 정본 SYMBOL_MAP 은 `\le`→`LEQ` 한 방향만
        # 있어 역매핑 키가 `LEQ` 뿐이다 → `le` 는 토큰째 흘러나간다.
        "le": {"latex": r"\leq", "why": "정본 역매핑에 LE 키가 없다"},
        "ge": {"latex": r"\geq", "why": "정본 역매핑에 GE 키가 없다"},
        # 🔴 아래첨자/위첨자를 **왼쪽에** 붙이는 HWP 키워드. 정본 `core` 어디에도
        #    없다(grep 0). 순열·조합·중복조합이 전부 이 모양이라 실데이터에 많다 —
        #    실측 **97문항 · 203자리**. 지면에는 `₁₀C₂` 가 `LSUB10C_2` 로 나간다.
        #
        #    이것을 여기 적기 전까지 **잔재 지표가 두 겹으로 눈이 멀어 있었다**:
        #    ㉠ 정본 어휘에 없어 `residueRuns` 가 0을 냈고,
        #    ㉡ 결과가 `\mathrm{LSUB}nC` 라 **라벨 명령 안**으로 들어가
        #       발견기의 「모르는 것」 목록에서도 빠졌다.
        #    그래서 이 부류는 「고쳤다」고 세어지면서 그대로 지면에 나갔다.
        "lsub": {"latex": "", "why": "왼쪽 아래첨자 — 정본에 없다(순열·조합)"},
        "rsub": {"latex": "", "why": "오른쪽 아래첨자 — 정본에 없다"},
        "lsup": {"latex": "", "why": "왼쪽 위첨자 — 정본에 없다"},
        "rsup": {"latex": "", "why": "오른쪽 위첨자 — 정본에 없다"},
    }

    return {
        "_generated_by": "scripts/qa/build-hwp-vocab.py",
        "_source": str(TESTCHANGER),
        "_note": "손으로 고치지 마라. 정본이 바뀌면 이 스크립트를 다시 돌려라.",
        "hwpTokens": sorted(hwp_tokens),
        "reverse": dict(sorted(reverse.items())),
        "struct": sorted(struct),
        "gluePrefix": glue_prefix,
        "outsideCanon": outside_canon,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()

    vocab = build()
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    # Windows 리다이렉트로 JSON 을 쓰면 BOM 으로 깨진다(tracks/README §5) — 직접 쓴다.
    out.write_text(
        json.dumps(vocab, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        "HWP 토큰 %d · 역매핑 %d · 구조 %d · 글루접두 %d · 정본밖 %d → %s"
        % (
            len(vocab["hwpTokens"]),
            len(vocab["reverse"]),
            len(vocab["struct"]),
            len(vocab["gluePrefix"]),
            len(vocab["outsideCanon"]),
            out,
        )
    )


if __name__ == "__main__":
    main()
