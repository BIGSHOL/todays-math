# -*- coding: utf-8 -*-
"""트랙 D-1 — 완료본 **HWP 전량 추출**. LLM 토큰 0 · 외부 API 0.

`extract-final-batch.py` 는 본문을 PDF 텍스트 레이어에서 뽑고 HWP 는 정답만 썼다.
그런데 `hwp_extract.parse_exam` 은 `stem`·`choices`·`answer`·`topic`·`score`·`type`
·`solution` 을 **전부** 준다(docs/planning/tracks/track-d-hwp.md).
D-2 의 교체 판정에 쓸 정본을 만들기 위해 HWP 를 통째로 다시 뽑는다.

  출력: scripts/qa/reports/hwp/<examId>.json     (성공)
        scripts/qa/reports/hwp/_fail/<examId>.txt (실패 사유 — 재시도 시 건너뜀)

재개 가능하다 — 이미 있는 산출물은 건너뛰므로 같은 명령 재실행이 곧 이어달리기다.
병렬은 `--offset` 을 갈라 여러 프로세스를 띄운다(HWP COM 단일 인스턴스 우려는
2026-08-15 B단계에서 4프로세스로 실측 반증됨).

사용:
  python scripts/qa/extract-hwp-all.py --limit 10            # 소요 측정
  python scripts/qa/extract-hwp-all.py --limit 3000 --offset 0
"""
import argparse
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time

sys.path.append(str(pathlib.Path(__file__).parent))

PAIRS = "scripts/qa/reports/final-pairs.json"
DEFAULT_OUT = "scripts/qa/reports/hwp"
# 이 횟수만큼 실패해야 포기한다 (일시 오류가 영구 누락이 되지 않게 — main() 주석 참조).
MAX_ATTEMPTS = 3

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# `.hwpx` 변환은 이 작업에서 가장 비싼 단계다(편당 약 12.8초). 트랙 A 가 그림을
# HWPX BinData 에서 읽으려면 같은 변환이 또 필요하므로 **중간산출물을 남긴다**.
# 벤더링 원본은 임시 폴더에 만들고 지우므로 보존판 래퍼를 쓴다.
HWPX_KEEP = "scripts/qa/reports/hwpx"


def resolve_extractor() -> tuple[pathlib.Path, pathlib.Path]:
    p = pathlib.Path("scripts/qa/hwp_extract_keep.py").resolve()
    return p, pathlib.Path(".").resolve()


# N: 은 네이버 MYBOX 라 작업 도중 끊긴다(10-handoff §5).
def wait_mount(timeout: int = 900) -> bool:
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


PAIRS_EXTRA = "scripts/qa/reports/final-pairs-extra.json"


def build_queue() -> list[dict]:
    """HWP 를 가진 완료본 전량. **DB 행이 있는 쪽(PDF 짝이 있는 2,257편)을 앞에 둔다** —
    D-2 판정이 그 편들부터 필요하기 때문. 뒤쪽 687편은 PDF 가 없어 애초에 적재된 적이 없다.

    ⚠️ 뒤에 `final-pairs-extra.json`(358편)을 **덧붙이기만** 한다. 앞부분 2,944편의
    순서를 건드리면 이미 돌고 있는 병렬 워커의 `--offset` 이 어긋난다.
    이 358편은 `pair-final-sources.py` 가 '이미추출'로 뺀 A단계분인데 DB 행 6,399개를
    갖고 있어 D-2 판정 대상이다(`pair-hwp-extra.py` 참조).
    """
    pairs = json.load(open(PAIRS, encoding="utf-8"))["pairs"]
    withhwp = [p for p in pairs if p.get("hwp")]
    withhwp.sort(key=lambda p: (0 if p.get("pdf") else 1, str(p["examId"])))
    extra_path = pathlib.Path(PAIRS_EXTRA)
    if extra_path.exists():
        seen = {str(p["examId"]) for p in withhwp}
        extra = [
            p
            for p in json.load(open(PAIRS_EXTRA, encoding="utf-8"))["pairs"]
            if p.get("hwp") and str(p["examId"]) not in seen
        ]
        extra.sort(key=lambda p: str(p["examId"]))
        withhwp += extra
    return withhwp


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--retry-failed", action="store_true")
    ap.add_argument("--tag", default="", help="진행 로그 구분용 라벨")
    ap.add_argument(
        "--exams",
        help="이 편들만 (쉼표로 구분한 examId). 그림 회수처럼 **특정 편만** 필요할 때 쓴다 — "
        "전량 큐를 돌면 3천 편을 도는 데 몇 시간이 걸린다. `--offset` 은 무시된다.",
    )
    ap.add_argument(
        "--keep",
        default=HWPX_KEEP,
        help="`.hwpx` 중간산출물을 남길 디렉터리 (트랙 A 가 그림을 여기서 읽는다)",
    )
    a = ap.parse_args()

    outdir = pathlib.Path(a.out)
    faildir = outdir / "_fail"
    outdir.mkdir(parents=True, exist_ok=True)
    faildir.mkdir(parents=True, exist_ok=True)

    script, cwd = resolve_extractor()
    work = pathlib.Path(tempfile.mkdtemp(prefix="hwpall_"))

    if a.exams:
        want = {e.strip() for e in a.exams.split(",") if e.strip()}
        queue = [p for p in build_queue() if str(p["examId"]) in want]
        missing = want - {str(p["examId"]) for p in queue}
        if missing:
            print(f"⚠️ 페어 목록에 없는 편 {len(missing)}: {sorted(missing)}", flush=True)
    else:
        queue = build_queue()[a.offset : a.offset + a.limit]
    tag = f"[{a.tag}] " if a.tag else ""

    ok = skip = fail = give_up = 0
    nq = na = nt = nsol = nsc = 0
    t0 = time.time()

    for i, p in enumerate(queue, 1):
        eid = str(p["examId"])
        target = outdir / f"{eid}.json"
        failmark = faildir / f"{eid}.txt"
        if target.exists():
            skip += 1
            continue
        # ⚠️ 실패 표시를 **한 번 났다고 영구 건너뜀**으로 쓰면 안 된다.
        # 2026-08-16 실측: 코드 교체·프로세스 종료 창에서 4초 만에 1,065편이 한꺼번에
        # "산출 없음" 으로 떨어졌는데, 재시도하니 전부 성공했다. 그대로 뒀으면 재개 실행이
        # 그 1,065편을 조용히 빼고 "완료" 라고 보고했을 것이다 — 에러가 아니라 숫자만 줄었다.
        # 그래서 횟수를 세고 MAX_ATTEMPTS 번 실패한 것만 포기한다.
        attempts = 0
        if failmark.exists():
            head = failmark.read_text(encoding="utf-8").splitlines()[:1]
            if head and head[0].startswith("attempts="):
                attempts = int(head[0].split("=")[1])
            else:
                attempts = 1
            if attempts >= MAX_ATTEMPTS and not a.retry_failed:
                skip += 1
                give_up += 1
                continue
        if not wait_mount():
            print(f"{tag}N드라이브가 돌아오지 않아 중단. 연결 후 같은 명령을 재실행.", flush=True)
            break

        tmp = work / f"{eid}.json"
        if tmp.exists():
            tmp.unlink()
        t1 = time.time()
        try:
            r = subprocess.run(
                [
                    sys.executable, str(script), p["hwp"],
                    "-o", str(tmp),
                    "--keep", a.keep,
                    "--id", eid,
                ],
                cwd=str(cwd),
                capture_output=True,
                timeout=a.timeout,
            )
            if not tmp.exists():
                msg = (r.stderr or b"").decode("utf-8", "replace").strip()
                raise RuntimeError(msg.splitlines()[-1] if msg else "산출 없음")
            data = json.loads(tmp.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            fail += 1
            failmark.write_text(
                (f"attempts={attempts + 1}\n" + f"{type(exc).__name__}: {exc}")[:600],
                encoding="utf-8",
            )
            print(f"{tag}FAIL {eid} :: {type(exc).__name__} {str(exc)[:100]}", flush=True)
            continue

        qs = data.get("questions") or []
        data["meta"] = {
            "exam_id": p["examId"],
            "school": p.get("school"),
            "level": p.get("level"),
            "grade": p.get("grade"),
            "subject": p.get("subject"),
            "year": p.get("year"),
            "semester": p.get("semester"),
            "round": p.get("round"),
        }
        data["_hwpFile"] = p["hwp"]
        data["_pdfFile"] = p.get("pdf")
        data["_elapsed"] = round(time.time() - t1, 2)
        target.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

        if failmark.exists():
            failmark.unlink()   # 되살아났으면 표시를 지운다 — 다음 집계가 거짓말하지 않게
        ok += 1
        nq += len(qs)
        na += sum(1 for q in qs if q.get("answer"))
        nt += sum(1 for q in qs if q.get("topic"))
        nsol += sum(1 for q in qs if q.get("solution"))
        nsc += sum(1 for q in qs if q.get("score") is not None)

        if ok % 25 == 0:
            el = time.time() - t0
            print(
                f"{tag}진행 {i}/{len(queue)} · 성공 {ok} 실패 {fail} 건너뜀 {skip} · "
                f"문항 {nq} · {el:.0f}s ({el/max(1,ok):.1f}s/편)",
                flush=True,
            )

    el = time.time() - t0
    q = max(1, nq)
    print(f"{tag}── HWP 전량 추출 ──", flush=True)
    print(
        f"{tag}성공 {ok} · 실패 {fail} · 건너뜀 {skip} (그중 {MAX_ATTEMPTS}회 실패로 포기 {give_up})"
        f" · {el:.0f}s ({el/max(1,ok):.2f}s/편)",
        flush=True,
    )
    print(f"{tag}문항 {nq} · 정답 {na} ({na*100.0/q:.1f}%) · 소단원 {nt} ({nt*100.0/q:.1f}%) · "
          f"해설 {nsol} ({nsol*100.0/q:.1f}%) · 배점 {nsc} ({nsc*100.0/q:.1f}%)", flush=True)
    print(f"{tag}→ {outdir}  (.hwpx 보존: {a.keep})", flush=True)


if __name__ == "__main__":
    main()
