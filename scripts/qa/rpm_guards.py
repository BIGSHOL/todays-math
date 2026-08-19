# -*- coding: utf-8 -*-
"""되살린 값을 **쓸지 말지** 가르는 가드. 두 계획이 **같은 것**을 쓴다.

쓰는 쪽: `plan-rpm-square-repair.py` · `plan-rpm-content-repair.py`

## 왜 한곳에 두나

같은 규칙이 두 벌이 되면 한쪽만 고쳐도 아무도 모른다(CLAUDE.md 2026-08-18
「규칙이 옳아도 배선이 한쪽만 되면 그쪽 지표만 좋아진다」). 발문과 해설은 같은
책에서 같은 방식으로 읽어 오므로 **같은 실패를 한다.**

## 무엇을 막나 — 전부 **눈으로 보고** 찾은 것이다

되살린 31건을 전량 대조했더니 9건이 나빴다. 렌더러는 이것들을 통과시킨다 —
LaTeX 로는 멀쩡하기 때문이다. **틀린 줄 아무도 모르는 값**이라 반드시 막아야 한다.

| 무엇 | 실측 |
|---|---|
| 근호가 `=` 를 삼켰다 | `\\sqrt{3^2+\\sqrt{(-12)^2}=-9}` (3-1 #87) |
| 근호가 연산자로 끝난다 | `2\\sqrt{0.75\\times} \\frac{20}{3}` (3-1 #279) |
| 괄호가 안 맞는다 | `\\sqrt{- 1} )^{2}` (3-1 #86·#95 — 원래 $(-\\frac14)^2$) |
| 근호 표식이 낱개로 남았다 | `1.4<' x<2.5` (3-1 #149) |
| 근호가 **줄었다** | 지금 `\\surd` 5개 → 책 `\\sqrt` 4개 (3-1 #93·#173) |
| 수를 잃었다 | `① 64의 제곱근 8` → `① 64의 제곱근` |
"""
from __future__ import annotations

import collections
import re

#: 근호 안에 있으면 안 되는 글자 — 등식·부등식은 근호를 넘어선다.
IN_ROOT_BAD = set("=<>")
#: 근호가 이걸로 끝나면 무리가 잘린 것이다.
ROOT_TAIL_BAD = ("\\times", "\\div", "\\pm", "+", "-", "\\cdot")
#: 못 옮긴 근호 표식. 이름 뒤의 프라임(`H'`)과 달리 **홀로** 선다.
LONE_MARK = re.compile(r"(?<![A-Za-z0-9])['\"](?![A-Za-z0-9'])|['\"]\s")
#: 본문에 든 수. 되살린 값이 지금 값의 수를 하나라도 잃으면 안 된다.
NUMS = re.compile(r"\d+(?:\.\d+)?")
#: 근호의 개수 — 지금 값은 `\surd` 로 흩어져 있고 되살린 값은 `\sqrt` 다.
SURD = re.compile(r"\\surd|\\sqrt")
SQRT = re.compile(r"\\sqrt")


def _root_bodies(s: str) -> list[str]:
    """`\\sqrt{…}` 의 알맹이를 모두 꺼낸다(겹친 것 포함)."""
    out = []
    for m in re.finditer(r"\\sqrt\{", s):
        i, depth = m.end(), 1
        while i < len(s) and depth:
            if s[i] == "{":
                depth += 1
            elif s[i] == "}":
                depth -= 1
            i += 1
        if depth == 0:
            out.append(s[m.end(): i - 1])
    return out


def balanced(s: str) -> bool:
    """괄호가 맞나. 중괄호는 명령이 만드는 것이라 세지 않는다."""
    depth = 0
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def check(value: str, current: str | None) -> str | None:
    """쓰면 안 되는 이유. 없으면 `None`."""
    for body in _root_bodies(value):
        if any(c in IN_ROOT_BAD for c in body):
            return "근호가 등호·부등호를 삼켰다"
        t = body.rstrip()
        if t.endswith(ROOT_TAIL_BAD):
            return "근호가 연산자로 끝난다 — 무리가 잘렸다"
        if not t.strip():
            return "근호가 비었다"
    if not balanced(value):
        return "괄호가 안 맞는다"
    if LONE_MARK.search(value):
        return "근호 표식이 낱개로 남았다"
    if current:
        # ⚠️ **개수가 아니라 종류**로 센다. 깨진 값은 조각이 나면서 같은 수를 여러 번
        #    되풀이한다(`$5$ $5$ $5$`) — 겹침 개수로 세면 멀쩡한 되살림이 「수를 잃는다」
        #    로 막힌다(실측 3-1 #134 등 해설 9건이 그렇게 막혔다).
        lost = set(NUMS.findall(current)) - set(NUMS.findall(value))
        if lost:
            return f"수를 잃는다 ({' '.join(sorted(lost))[:20]})"
        # 지금 값의 근호가 흩어져 있어도 **개수는** 그 문항이 쓰는 근호 수다.
        if len(SQRT.findall(value)) < len(SURD.findall(current)):
            return "근호가 줄었다"
    return None
