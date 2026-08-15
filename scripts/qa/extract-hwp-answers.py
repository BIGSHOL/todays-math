# -*- coding: utf-8 -*-
"""정답 대조에 필요한 시험지만 **HWP 원본에서 정답을 뽑는다** (트랙 B-1).

왜 따로 도나: 트랙 D 가 2,944편 전량을 뽑고 있지만 examId 오름차순이라
내가 판정해야 할 구간(2640~5885)까지 오는 데 오래 걸린다. 3자 대조는
「DB ↔ PDF 정답면 ↔ HWP」 셋이 있어야 서므로, 필요한 편만 먼저 뽑는다.

**트랙 D 의 산출 디렉터리(`reports/hwp/`)를 건드리지 않는다.** 내 것은
`reports/hwp-b/` 에 쌓고, 겹치는 편은 D 것을 먼저 읽는다(`--skip-dir`).

  python scripts/qa/extract-hwp-answers.py --ids scripts/qa/_need-exams.txt
  python scripts/qa/extract-hwp-answers.py --ids ... --limit 10   먼저 소요 재기

이미 만든 파일은 건너뛴다 — **같은 명령 재실행이 곧 이어달리기**다.
N드라이브는 도중에 끊긴다(10-handoff.md §5). 끊기면 재연결을 기다린다.
"""
import argparse
import collections
import json
import pathlib
import subprocess
import sys
import tempfile
import time

sys.path.append(str(pathlib.Path(__file__).parent))
from tc_paths import testchanger_dir  # noqa: E402

TC = testchanger_dir()
PAIRS = "scripts/qa/reports/final-pairs.json"
OUTDIR = pathlib.Path("scripts/qa/reports/hwp-b")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def wait_mount(timeout: int = 600) -> bool:
    """N드라이브가 붙을 때까지 기다린다. 끊긴 채로 돌면 전 편이 실패한다."""
    if pathlib.Path("N:\\").exists():
        return True
    print("  … N드라이브 끊김 — 재연결 대기", flush=True)
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(10)
        if pathlib.Path("N:\\").exists():
            print("  … 재연결됨, 계속", flush=True)
            return True
    return False


def hwp_script() -> tuple[pathlib.Path, pathlib.Path]:
    """testchanger 원본을 먼저, 없으면 저장소 벤더링본."""
    script = TC / "scripts" / "hwp_extract.py"
    if script.exists():
        return script, TC
    script = pathlib.Path("scripts/vendor/testchanger/hwp_extract.py").resolve()
    return script, script.parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", required=True, help="examId 를 줄마다 적은 파일")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument(
        "--skip-dir",
        default=None,
        help="이미 뽑혀 있는 다른 디렉터리(트랙 D). 있으면 건너뛴다.",
    )
    a = ap.parse_args()

    ids = [
        line.strip()
        for line in pathlib.Path(a.ids).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if a.limit:
        ids = ids[a.offset : a.offset + a.limit]

    pairs = {
        str(p["examId"]): p
        for p in json.load(open(PAIRS, encoding="utf-8"))["pairs"]
    }
    OUTDIR.mkdir(parents=True, exist_ok=True)
    (OUTDIR / "_fail").mkdir(exist_ok=True)
    skip_dir = pathlib.Path(a.skip_dir) if a.skip_dir else None
    script, cwd = hwp_script()

    stat = collections.Counter()
    started = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        work = pathlib.Path(tmp)
        for i, exam_id in enumerate(ids, 1):
            dest = OUTDIR / f"{exam_id}.json"
            if dest.exists():
                stat["이미 있음"] += 1
                continue
            if skip_dir and (skip_dir / f"{exam_id}.json").exists():
                stat["트랙D에 있음"] += 1
                continue
            pair = pairs.get(exam_id)
            if not pair or not pair.get("hwp"):
                stat["HWP 없음"] += 1
                continue
            if not wait_mount():
                print("N드라이브가 안 돌아온다 — 중단")
                break
            out = work / "a.json"
            if out.exists():
                out.unlink()
            try:
                run = subprocess.run(
                    [sys.executable, str(script), pair["hwp"], "-o", str(out)],
                    cwd=str(cwd),
                    capture_output=True,
                    timeout=600,
                )
            except subprocess.TimeoutExpired:
                stat["시간초과"] += 1
                continue
            if not out.exists():
                stat["실패"] += 1
                tail = (run.stderr or b"").decode("utf-8", "replace").strip()
                (OUTDIR / "_fail" / f"{exam_id}.txt").write_text(
                    tail[-2000:], encoding="utf-8"
                )
                continue
            doc = json.loads(out.read_text(encoding="utf-8"))
            doc["_examId"] = int(exam_id)
            doc["_hwpFile"] = pair["hwp"]
            dest.write_text(
                json.dumps(doc, ensure_ascii=False), encoding="utf-8"
            )
            stat["성공"] += 1
            stat["문항"] += len(doc.get("questions") or [])
            stat["정답 있음"] += sum(
                1 for q in (doc.get("questions") or []) if q.get("answer")
            )
            if i % 20 == 0:
                rate = (time.time() - started) / max(1, stat["성공"])
                print(
                    f"  {i}/{len(ids)}편 · 성공 {stat['성공']} · 편당 {rate:.1f}초",
                    flush=True,
                )

    print("\n── HWP 정답 추출 ──")
    for key, n in stat.most_common():
        print(f"  {key} {n}")
    print(f"→ {OUTDIR}")


if __name__ == "__main__":
    main()
