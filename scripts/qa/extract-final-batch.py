# -*- coding: utf-8 -*-
"""완료본 시험지 배치 추출 — **LLM 토큰 0 · OCR API 0**.

본문은 완료 PDF 텍스트 레이어에서, 정답·해설·소단원·난이도는 완료 HWP 에서 가져와
문항 번호로 합친다(08-import-ledger.md §5.1.2). 두 도구 모두 testchanger 것을 그대로 부른다.

  본문 : db/textlayer.py       (PUA 되돌리기 + 좌표 기반 분수/첨자 조립)
  정답 : scripts/hwp_extract.py (HWPX XML 직독)

출력은 우리 이관 파이프라인(`convertPastExamPaper`)이 그대로 먹는 모양이다:
  { meta:{exam_id, school, grade, subject, level, unit}, _sourceFile,
    questions:[...], _answers:[{number, answer, solution, topic, difficulty}] }

사용: python scripts/qa/extract-final-batch.py --limit 30 [--out DIR] [--offset N]
화면 출력은 집계와 실패 사유뿐 — 문항 본문은 절대 찍지 않는다(토큰 절약 원칙 §4).
"""
import argparse
import collections
import json
import pathlib
import subprocess
import sys
import tempfile
import time

TC = pathlib.Path(r"D:\시험지 한글화")
sys.path.append(str(TC))
sys.path.append(str(TC / "db"))

import textlayer  # noqa: E402

sys.path.append(str(pathlib.Path(__file__).parent))
from final_meta import clean_answer, unit_grade  # noqa: E402

PAIRS = "scripts/qa/reports/final-pairs.json"
DEFAULT_OUT = "scripts/qa/reports/final-batch"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# N: 은 네이버 MYBOX 네트워크 드라이브라 **작업 도중 끊긴다**(2026-08-15 실제 발생).
# 끊긴 채로 계속 돌면 전 편이 FileNotFoundError 로 타 버리므로, 매 편 앞에서 확인하고
# 돌아올 때까지 기다린다. 이미 만든 산출물은 건너뛰므로 재실행이 곧 이어달리기다.
def wait_mount(timeout: int = 600) -> bool:
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


def hwp_answers(hwp: str, work: pathlib.Path) -> list[dict]:
    """완료 HWP → [{number, answer, solution, topic, difficulty}]"""
    out = work / "a.json"
    if out.exists():
        out.unlink()
    r = subprocess.run(
        [sys.executable, "scripts/hwp_extract.py", hwp, "-o", str(out)],
        cwd=str(TC),
        capture_output=True,
        timeout=600,
    )
    if not out.exists():
        raise RuntimeError(
            (r.stderr or b"").decode("utf-8", "replace").strip().splitlines()[-1:]
            or "hwp_extract 산출 없음"
        )
    qs = json.loads(out.read_text(encoding="utf-8")).get("questions") or []
    return [
        {
            "number": q.get("number"),
            "answer": clean_answer(q.get("answer")),
            "solution": (q.get("solution") or "").strip() or None,
            "topic": (q.get("topic") or "").strip() or None,
            "difficulty": (q.get("difficulty") or "").strip() or None,
        }
        for q in qs
    ]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--out", default=DEFAULT_OUT)
    a = ap.parse_args()

    outdir = pathlib.Path(a.out)
    outdir.mkdir(parents=True, exist_ok=True)
    work = pathlib.Path(tempfile.mkdtemp(prefix="fb_"))

    pairs = [
        p
        for p in json.load(open(PAIRS, encoding="utf-8"))["pairs"]
        if p["pdf"] and p["hwp"]
    ][a.offset : a.offset + a.limit]

    stat = collections.Counter()
    fails: list[str] = []
    t0 = time.time()

    for p in pairs:
        eid = p["examId"]
        target = outdir / f"{eid}.json"
        if target.exists():
            stat["건너뜀:이미추출"] += 1
            continue
        if not wait_mount():
            print("N드라이브가 돌아오지 않아 중단합니다. 연결 후 같은 명령을 다시 실행하세요.")
            break
        try:
            doc = textlayer.extract(pathlib.Path(p["pdf"]))
        except Exception as exc:  # noqa: BLE001
            fails.append(f"{eid} 본문: {type(exc).__name__} {exc}"[:150])
            stat["실패:본문"] += 1
            continue
        try:
            answers = hwp_answers(p["hwp"], work)
        except Exception as exc:  # noqa: BLE001
            fails.append(f"{eid} 정답: {type(exc).__name__} {exc}"[:150])
            answers = []
            stat["실패:정답"] += 1

        qs = doc.get("questions") or []
        paper = {
            "meta": {
                "exam_id": eid,
                "school": p.get("school"),
                "grade": unit_grade(p.get("level"), p.get("grade"), p.get("subject")),
                "subject": p.get("subject"),
                "level": p.get("level"),
                "raw_grade": p.get("grade"),
            },
            "_sourceFile": p["pdf"],
            "_answerFile": p["hwp"],
            "questions": qs,
            "_answers": answers,
        }
        target.write_text(
            json.dumps(paper, ensure_ascii=False), encoding="utf-8"
        )

        by_no = {x["number"]: x for x in answers}
        stat["편"] += 1
        stat["문항"] += len(qs)
        stat["정답"] += sum(
            1 for q in qs if (by_no.get(q.get("number"), {}).get("answer") or "")
        )
        stat["해설"] += sum(
            1 for q in qs if (by_no.get(q.get("number"), {}).get("solution") or "")
        )
        stat["소단원"] += sum(
            1 for q in qs if (by_no.get(q.get("number"), {}).get("topic") or "")
        )
        stat["그림포함"] += sum(
            1
            for q in qs
            if any(b.get("type") == "figure" for b in (q.get("contents") or []))
        )
        if paper["meta"]["grade"] is None:
            stat["학년미상"] += 1

    q = max(1, stat["문항"])
    print("── 완료본 배치 추출 (LLM 토큰 0) ──")
    print("편 %d · 문항 %d · %.0fs" % (stat["편"], stat["문항"], time.time() - t0))
    for k in ("정답", "해설", "소단원", "그림포함"):
        print("  %-6s %5d (%4.1f%%)" % (k, stat[k], stat[k] * 100.0 / q))
    for k in ("학년미상", "건너뜀:이미추출", "실패:본문", "실패:정답"):
        if stat[k]:
            print("  %-12s %d" % (k, stat[k]))
    for f in fails[:5]:
        print("  ! " + f)
    print("→", outdir)


if __name__ == "__main__":
    main()
