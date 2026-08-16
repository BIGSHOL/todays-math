# -*- coding: utf-8 -*-
"""HWP 추출본에서 **수식 캡션에 박힌 base64 덩어리**를 걷어낸다.

## 무엇이 새는가 (2026-08-16, 트랙 E 가 발견 · 트랙 D 가 원인 규명)

HWPX 문서의 수식 객체는 `caption` 을 갖는데, 이 시험지들에서는 그 캡션에 **base64
덩어리**가 들어 있다. XML 경로로 세어 보면 압도적으로 한 곳이다:

    530  p/run/equation/caption/subList/p/run/t
    116  p/run/tbl/tr/tc/subList/p/run/equation/caption/subList/p/run/t
     19  p/run/ctrl/endNote/subList/p/run/equation/caption/subList/p/run/t
     16  p/run/pic/caption/subList/p/run/t

`hwp_extract._walk` 는 `header`/`footer` 만 건너뛰고 나머지 `hp:t` 를 전부 본문으로
긁어 오므로, 캡션의 base64 가 **발문 한가운데** 섞여 들어간다:

    "다음은 연립방정식 <base64 100자> 의 …"

⚠️ 진짜 수식은 `hp:script` 로 따로 나와 `$...$` 로 붙는다 — **base64 는 덤이지 대체물이
아니다.** 그래서 지워도 식을 잃지 않는다.

## 왜 캡션을 통째로 버려도 되나

표본 300편의 캡션 텍스트 조각 **351개가 100% base64** 였다. 한글이 든 캡션은 0건이다.
잃을 실제 내용이 없다.

## 왜 여기서 막는가

`scripts/vendor/testchanger/hwp_extract.py` 는 testchanger 벤더링본이고 원본 저장소는
**읽기 전용**이다(tracks/README §3). 벤더링본을 고치면 상류와 갈라져 다음 재벤더링 때
조용히 사라진다. 그래서 우리 계층에서 지운다. **상류에도 알려야 할 결함이다** —
`_SKIP_CTRL` 에 `hp:caption` 을 넣는 것이 근본 수정이다.

임계값 60자는 트랙 E·코디네이터가 쓴 탐지 기준과 같다. 숫자를 서로 대조할 수 있게
일부러 맞췄다. 수학 지문에서 base64 문자만 60자 연속으로 나오는 일은 없다.
"""
import re

BASE64_RUN = re.compile(r"[A-Za-z0-9+/]{60,}={0,2}")


def strip_base64(text):
    """본문에서 base64 덩어리를 지우고 그 자리에 생긴 공백을 정리한다."""
    if not text:
        return text
    out = BASE64_RUN.sub(" ", text)
    if out == text:
        return text
    # 지운 자리에 남는 군더더기 정리 — 줄이 통째로 base64 였으면 빈 줄이 된다.
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"^[ \t]+$", "", out, flags=re.M)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def clean_question(q):
    """`parse_exam` 이 낸 문항 하나를 제자리에서 청소한다."""
    for key in ("stem", "solution"):
        if q.get(key):
            q[key] = strip_base64(q[key])
    if q.get("choices"):
        q["choices"] = [strip_base64(c) for c in q["choices"]]
    return q


def clean_exam(data):
    """`parse_exam` 산출물 전체를 청소하고 몇 군데를 고쳤는지 돌려준다."""
    n = 0
    for q in data.get("questions") or []:
        before = (q.get("stem") or "") + "\x00" + "\x00".join(q.get("choices") or [])
        clean_question(q)
        after = (q.get("stem") or "") + "\x00" + "\x00".join(q.get("choices") or [])
        if before != after:
            n += 1
    return n
