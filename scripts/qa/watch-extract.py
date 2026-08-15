# -*- coding: utf-8 -*-
"""B단계 추출 진행상황 — Orca 터미널에 띄워 두고 본다.

    python scripts/qa/watch-extract.py [목표편수]

산출물 디렉토리를 세면서 속도·남은 시간·품질(정답/소단원 보유율)을 갱신한다.
추출 프로세스와 무관하게 읽기만 하므로 언제 켜고 꺼도 된다.
"""
import collections
import json
import pathlib
import subprocess
import sys
import time

OUT = pathlib.Path("scripts/qa/reports/final-batch")
TARGET = int(sys.argv[1]) if len(sys.argv) > 1 else 1396
INTERVAL = 10

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def alive() -> int:
    """돌고 있는 추출 프로세스 수."""
    try:
        out = subprocess.run(
            ["wmic", "process", "where",
             "name='python.exe'", "get", "CommandLine"],
            capture_output=True, text=True, timeout=15,
        ).stdout
    except Exception:
        return -1
    return sum(1 for ln in out.splitlines() if "extract-final-batch" in ln)


def quality(files: list[pathlib.Path]) -> tuple[int, float, float]:
    """표본(최근 60편)의 문항 수·정답률·소단원률."""
    q = a = t = 0
    for f in files[-60:]:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        for item in d.get("questions", []):
            q += 1
        for item in d.get("_answers", []) or []:
            if (item.get("answer") or "").strip():
                a += 1
            if (item.get("topic") or "").strip():
                t += 1
    if q == 0:
        return 0, 0.0, 0.0
    return q, a * 100 / q, t * 100 / q


def bar(pct: float, width: int = 32) -> str:
    n = int(pct * width / 100)
    return "█" * n + "·" * (width - n)


def main() -> None:
    start = time.time()
    base = len(list(OUT.glob("*.json"))) if OUT.exists() else 0
    print(f"── B단계 추출 진행상황 (목표 {TARGET}편) ──")
    print(f"시작 시점 산출물 {base}편 · {INTERVAL}초마다 갱신 · Ctrl+C 로 종료\n")
    while True:
        files = sorted(OUT.glob("*.json")) if OUT.exists() else []
        done = len(files)
        pct = min(100.0, done * 100 / max(1, TARGET))
        el = time.time() - start
        made = done - base
        rate = made / el if el > 0 else 0
        left = TARGET - done
        eta = left / rate if rate > 0 else 0
        procs = alive()
        n, ans, top = quality(files)
        print(
            f"\r[{bar(pct)}] {done}/{TARGET} ({pct:5.1f}%)  "
            f"프로세스 {procs if procs >= 0 else '?'}  "
            f"{rate * 60:4.1f}편/분  남은시간 {eta / 60:5.1f}분  "
            f"최근표본 정답 {ans:4.1f}% · 소단원 {top:4.1f}%   ",
            end="", flush=True,
        )
        if procs == 0 and made > 0:
            print("\n\n추출 프로세스가 모두 끝났습니다.")
            print(f"산출물 {done}편 (이번 실행에서 {made}편 추가)")
            return
        time.sleep(INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n중단(추출 자체는 계속 돕니다)")
