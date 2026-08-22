"""해설 생성 — codex CLI 로 GPT 호출 (2026-08-22, 원장님 지시: "코덱스에게도 할당할것.
모델은 소넷과 비슷한 수준의 5.6 모델로" — CODEX_HOME/config.toml 기본 모델이 이미
gpt-5.6-sol(xhigh) 이라 그대로 쓴다). Claude 토큰을 전혀 안 쓴다(별도 프로세스·별도 과금).

apply-ai-solutions.ts 가 읽는 것과 같은 형식 {id,finalAnswer,solution}|{id,skip}
을 낸다 — 정답 대조 문지기는 그대로다(이 스크립트는 답을 안 본다).

    python scripts/qa/gen-solutions-codex.py <todo.json> <out.json> [모델]

프롬프트는 gemini-solution-prompt.txt 를 그대로 재사용한다(같은 지시문, 채널만 다름).
프롬프트는 stdin 으로 넘긴다 — Windows 명령줄 길이 한도를 피한다.
`--approve-for-me` 로 워크스페이스 자동 승인(계산 검산용 셸 호출이 막혀 빈 출력이
나는 것을 막는다 — 2026-08-22 agy 채널에서 겪은 것과 같은 함정). `-o` 로 마지막
메시지만 파일로 받는다 — stdout 에는 hook 로그·배너가 섞여 있어 파싱하면 깨진다.
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

PROMPT_FILE = Path(__file__).parent / "gemini-solution-prompt.txt"
CODEX = r"C:\Users\user\AppData\Roaming\npm\codex.cmd"


def call_codex(items, model: str, cwd: Path, timeout_s: int) -> list:
    prompt = PROMPT_FILE.read_text(encoding="utf-8") + json.dumps(
        items, ensure_ascii=False, indent=1
    )
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", delete=False, encoding="utf-8"
    ) as tf:
        out_path = tf.name
    try:
        proc = subprocess.run(
            [
                CODEX,
                "exec",
                "-m",
                model,
                "--approve-for-me",
                "--skip-git-repo-check",
                "-o",
                out_path,
                "-",
            ],
            input=prompt,
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=cwd,
            timeout=timeout_s,
        )
        out = Path(out_path).read_text(encoding="utf-8").strip()
        out = re.sub(r"^```(?:json)?\s*\n?", "", out)
        out = re.sub(r"\n?```\s*$", "", out)
        if not out:
            raise RuntimeError(
                f"빈 출력 (exit={proc.returncode}): {proc.stdout[-500:]} {proc.stderr[:500]}"
            )
        # codex 가 LaTeX(\binom, \frac 등)를 JSON 문자열 안에서 \\ 로 이중
        # 이스케이프하지 않고 그냥 낼 때가 있다. \b·\f 는 마침 유효한 JSON
        # 이스케이프(백스페이스·폼피드)라 json.loads 가 에러 없이 조용히
        # 삼켜 "\binom"→(제어문자)+"inom" 으로 깨진다(2026-08-23 b69-10 실측,
        # 20개 중 16개 렌더실패). \n 은 해설 줄바꿈으로 실제 의도된 값이라
        # 손대지 않는다 — \b·\f 만 선제 이중 이스케이프한다.
        out = re.sub(r"(?<!\\)\\([bf])", lambda m: "\\\\" + m.group(1), out)
        return json.loads(out)
    finally:
        Path(out_path).unlink(missing_ok=True)


def main():
    todo_path, out_path = sys.argv[1], sys.argv[2]
    model = sys.argv[3] if len(sys.argv) > 3 else "gpt-5.6-sol"
    items = json.loads(Path(todo_path).read_text(encoding="utf-8"))
    ids_in = {x["id"] for x in items}

    result = call_codex(
        items, model, cwd=Path(__file__).resolve().parents[2], timeout_s=max(300, len(items) * 45)
    )

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
