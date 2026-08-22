"""해설 생성 — agy CLI(Antigravity) 로 Gemini 3.1 Pro 호출. Claude 토큰을 전혀
안 쓴다(별도 프로세스·별도 과금). 2026-08-22 원장님 지시: "claude 토큰을
소모하지 말란 소리는 아니니까. 말그대로 아낄 수 있으면 병행 소모."

apply-ai-solutions.ts 가 읽는 것과 같은 형식 {id,finalAnswer,solution}|{id,skip}
을 낸다 — 정답 대조 문지기는 그대로다(이 스크립트는 답을 안 본다).

    python scripts/qa/gen-solutions-gemini.py <todo.json> <out.json> [모델]

주의(실측 2026-08-22):
  · --json-schema 는 이 버전에서 즉시 실패(0 토큰) — 쓰지 않는다.
  · --output-format json 은 agy 자체가 부수적으로 report.md 를 쓰려다
    같은 경로 충돌로 실패할 수 있다 — 기본(text) 출력을 쓰고 이쪽에서 파싱한다.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

AGY = r"C:\Users\user\AppData\Local\agy\bin\agy.exe"
PROMPT_FILE = Path(__file__).parent / "gemini-solution-prompt.txt"


def call_agy(items, model: str, timeout_s: int) -> list:
    prompt = PROMPT_FILE.read_text(encoding="utf-8") + json.dumps(
        items, ensure_ascii=False, indent=1
    )
    proc = subprocess.run(
        [
            AGY,
            "-p",
            prompt,
            "--model",
            model,
            "--print-timeout",
            f"{timeout_s // 60}m",
            # agy 의 내부 "cortex" 에이전트가 가끔 도구 호출(계산 검산용 셸 등)을
            # 시도하는데, headless 모드에는 승인 프롬프트가 없어 자동 거부되고
            # 그러면 출력이 통째로 빈다(2026-08-22 실측, b7-16). 이 작업은
            # 수학 문제를 풀어 JSON 만 내놓는 것이라 도구 실행에 위험이 없다.
            "--dangerously-skip-permissions",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=timeout_s + 30,
    )
    out = proc.stdout.strip()
    out = re.sub(r"^```(?:json)?\s*\n?", "", out)
    out = re.sub(r"\n?```\s*$", "", out)
    if not out:
        raise RuntimeError(f"빈 출력 (exit={proc.returncode}): {proc.stderr[:500]}")
    # \binom·\frac 등이 JSON 안에서 이중 이스케이프 안 된 채로 오면 \b·\f 가
    # 유효한 JSON 이스케이프(백스페이스·폼피드)라 조용히 삼켜진다(2026-08-23
    # codex 채널 실측 — 같은 위험이 이쪽에도 있어 선제 방어). \n 은 해설
    # 줄바꿈이라 손대지 않는다.
    out = re.sub(r"(?<!\\)\\([bf])", lambda m: "\\\\" + m.group(1), out)
    return json.loads(out)


def main():
    todo_path, out_path = sys.argv[1], sys.argv[2]
    model = sys.argv[3] if len(sys.argv) > 3 else "gemini-3.1-pro-high"
    items = json.loads(Path(todo_path).read_text(encoding="utf-8"))
    ids_in = {x["id"] for x in items}

    result = call_agy(items, model, timeout_s=max(180, len(items) * 25))

    ids_out = {x["id"] for x in result if "id" in x}
    missing = ids_in - ids_out
    if missing:
        raise RuntimeError(f"응답에서 {len(missing)}건 누락 — 재시도 필요: {list(missing)[:5]}")

    Path(out_path).write_text(
        json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    solved = sum(1 for x in result if "skip" not in x)
    print(f"푼 {solved} · 건너뜀 {len(result) - solved} → {out_path}")


if __name__ == "__main__":
    main()
