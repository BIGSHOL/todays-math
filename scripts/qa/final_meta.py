# -*- coding: utf-8 -*-
"""완료본 추출 공용 유틸 — 메타 매핑·정답 정규화.

`extract-final-batch.py` 와 `pilot-to-batch.py` 가 같이 쓴다.
(파일명에 하이픈이 있으면 import 가 안 되므로 이 모듈만 밑줄 이름이다.)
"""
import re

# 완료본 정답은 `"정답 ②"` · `"[정답] 3"` 꼴로 들어 있다 — 접두어를 뗀다.
_ANS_PREFIX = re.compile(r"^\s*[\[(]?\s*정\s*답\s*[\])]?\s*[:：.]?\s*")

# ⚠️ 고등 과목명 → 2022 개정 교육과정 명칭 대응.
#    수Ⅰ→대수 · 수Ⅱ→미적분Ⅰ · 미적분→미적분Ⅱ 는 **원장님 확인 대상**이다.
HIGH_SUBJECT = {
    "수상": "공통수학1",
    "공수1": "공통수학1",
    "고등수학상": "공통수학1",
    "상1": "공통수학1",
    "수하": "공통수학2",
    "공수2": "공통수학2",
    "수1": "대수",
    "심화 수1": "대수",
    "수2": "미적분1",
    "문과수2": "미적분1",
    "미적분": "미적분2",
    "미적분1": "미적분2",  # 인덱스의 '미적분1'은 과거 명칭의 미적분(=미적분Ⅱ)이다
    "확통": "확률과 통계",
    "기하": "기하",
    "기벡": "기하",
}


def clean_answer(raw) -> str:
    return _ANS_PREFIX.sub("", str(raw or "")).strip()


def unit_grade(level, grade, subject):
    """시험지 메타 → 우리 교육과정 트리의 `Unit.grade` 라벨(없으면 None)."""
    s = (subject or "").strip()
    if level == "중":
        # '중2-1' 처럼 과목칸에 학년이 들어온 경우를 우선 본다.
        m = re.match(r"^중([123])", s)
        if m:
            return f"중{m.group(1)}"
        return f"중{grade}" if grade in (1, 2, 3) else None
    return HIGH_SUBJECT.get(s)
