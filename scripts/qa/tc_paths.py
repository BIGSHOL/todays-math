# -*- coding: utf-8 -*-
"""testchanger(시험지 한글화) 저장소 경로 해석.

컴퓨터마다 위치가 다르다(`D:\시험지 한글화` / `F:\시험지변환기`).
그래서 스크립트마다 경로를 하드코딩하지 않고 여기서 한 번만 정한다.

우선순위: 환경변수 `TESTCHANGER_DIR` → 알려진 후보 중 실재하는 첫 경로.
"""
import os
import pathlib

CANDIDATES = (
    r"F:\시험지변환기",
    r"D:\시험지 한글화",
)


def testchanger_dir() -> pathlib.Path:
    env = os.environ.get("TESTCHANGER_DIR")
    if env:
        p = pathlib.Path(env)
        if not p.exists():
            raise SystemExit(f"TESTCHANGER_DIR 경로 없음: {p}")
        return p
    for c in CANDIDATES:
        p = pathlib.Path(c)
        if p.exists():
            return p
    raise SystemExit(
        "testchanger 저장소를 찾을 수 없다. TESTCHANGER_DIR 을 설정하라. "
        f"(후보: {', '.join(CANDIDATES)})"
    )


def exam_index_db() -> str:
    p = testchanger_dir() / "db" / "exam_index.db"
    if not p.exists():
        raise SystemExit(
            f"exam_index.db 없음: {p}\n"
            "gitignore 대상이라 클론에 안 따라온다. 다른 컴퓨터에서 복사할 것."
        )
    return str(p)
