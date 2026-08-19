# -*- coding: utf-8 -*-
"""완료본 HWP 를 **PDF 로 찍어낸다** (한글 COM). 토큰 0 · API 0.

    python scripts/figure/hwp-to-pdf.py            # 계획만
    python scripts/figure/hwp-to-pdf.py --write    # 실제 변환

입력: `scripts/qa/reports/hwp-topdf-rows.json`  (`편: [{e, hwp}]`)
출력: `.hwp-pdf/<examId>.pdf`   (저장소에 넣지 않는다)

## 왜 PDF 로 한 번 더 찍나 — **그림이 `<hp:pic>` 이 아닐 때가 있다**

`recover-hwp-figures.py` 는 HWPX 의 `<hp:pic>`(끼워 넣은 그림)만 꺼낸다. 그런데 한글은
도형을 **그리기 개체**(선·다각형·글상자의 묶음)로도 그린다. 그건 `<hp:pic>` 이 아니라
꺼낼 이미지 자체가 없다 — 실측으로 남은 기출 34행이 전부 이 부류다.

그리기 개체는 **인쇄하면 보인다.** 그래서 한글에게 PDF 로 찍게 하면 벡터로 나오고,
그 다음은 기출 PDF 와 똑같이 `crop-pdf-by-stem.py` 로 오려 낼 수 있다.

⚠️ 원본(N드라이브)은 **읽기만** 한다. 변환은 로컬 사본으로 하고, 원본 파일은 열지 않는다
   — 한글이 원본을 여는 순간 잠금·자동복구 파일이 생긴다.

⚠️ **편마다 하위 프로세스로 돌리고 시간제한을 건다.** 한글은 파일에 따라 대화상자를
   띄우고 COM 호출이 거기서 멈춘다 — 실측으로 한 편에서 20분을 붙잡혀 있었다.
   한 프로세스로 쭉 돌리면 그 한 편이 전체를 세운다. `SetMessageBoxMode` 로 대화상자를
   자동으로 넘기되, 그것으로도 안 되는 것은 시간제한이 끊는다.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import re
import shutil
import sys
import time
import tempfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROWS = pathlib.Path("scripts/qa/reports/hwp-topdf-rows.json")
OUT = pathlib.Path(".hwp-pdf")


#: 한 편에 허용하는 시간(초). 넘으면 그 편은 포기하고 다음으로 간다.
#: 환경변수 `HWP_PDF_TIMEOUT` 으로 올릴 수 있다 — 90초는 큰 편에서 **변환 중**인 것도
#: 「대화상자에 걸렸다」로 몰아 버린다(2026-08-19 실측: 16편이 여기서 떨어졌다).
PER_FILE_TIMEOUT = int(os.environ.get("HWP_PDF_TIMEOUT", "90"))


def hwp_pids() -> set[int]:
    """지금 살아 있는 한글 프로세스 PID.

    ⚠️ **`taskkill /IM Hwp.exe` 를 쓰면 안 된다.** 이 저장소는 오르카 다중 세션이
    기본이고(CLAUDE.md 9), 다른 세션이 같은 시각에 `extract-hwp-all.py` 로 한글 COM 을
    쓰고 있다(2026-08-19 실측). 이름으로 죽이면 **남의 배치를 통째로 끊는다** —
    그쪽은 실패 표시만 남고 이유는 어디에도 안 남는다.
    그래서 이 실행이 **새로 띄운 것만** 골라 죽인다.
    """
    r = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq Hwp.exe", "/FO", "CSV", "/NH"],
        capture_output=True, text=True,
    )
    pids = set()
    for line in (r.stdout or "").splitlines():
        parts = [p.strip('" ') for p in line.split('","')]
        if len(parts) >= 2 and parts[1].isdigit():
            pids.add(int(parts[1]))
    return pids


def convert(app, src: pathlib.Path, dest: pathlib.Path, work: pathlib.Path) -> None:
    """원본을 건드리지 않도록 **사본**을 열어 PDF 로 저장한다."""
    local = work / re.sub(r"[^\w.\-]", "_", src.name)
    shutil.copy2(src, local)
    app.Open(str(local), "HWP", "forceopen:true")
    app.SaveAs(str(dest), "PDF")
    app.Clear(1)  # 저장 안 함
    local.unlink(missing_ok=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--one", nargs=2, metavar=("HWP", "DEST"),
                    help="한 편만 변환한다 (배치가 하위 프로세스로 부른다)")
    a = ap.parse_args()

    if a.one:
        import tempfile as _t
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        app = win32com.client.Dispatch("HWPFrame.HwpObject")
        try:
            app.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        except Exception:  # noqa: BLE001
            pass
        try:
            # 대화상자를 자동으로 넘긴다. 그래도 뜨는 것은 배치의 시간제한이 끊는다.
            #
            # ⚠️ 예전 값 `0x20000` 은 **「예/아니오」 대화상자 하나**만 덮는다
            # (0x00020000 = MB_YESNO → 아니오). 한글이 실제로 띄우는 것은 그것만이
            # 아니다 — 확인(MB_OK)·확인/취소·예/아니오/취소·다시시도 가 각각 다른
            # 비트라, 하나만 켜 두면 나머지는 **그대로 멈춘다.** 2026-08-19 에
            # 16편이 여기서 시간제한에 걸렸고 「어떤 대화상자인지 사람이 봐야 한다」로
            # 남아 있었다. 종류를 하나씩 알아내는 대신 **전부** 켠다.
            app.SetMessageBoxMode(
                0x00000001  # MB_OK          → 확인
                | 0x00000010  # MB_OKCANCEL    → 확인
                | 0x00000400  # MB_ABORTRETRYIGNORE → 무시
                | 0x00001000  # MB_YESNOCANCEL → 예
                | 0x00010000  # MB_YESNO       → 예
                | 0x00100000  # MB_RETRYCANCEL → 재시도
            )
        except Exception:  # noqa: BLE001
            pass
        w = pathlib.Path(_t.mkdtemp(prefix="hwppdf1_"))
        try:
            convert(app, pathlib.Path(a.one[0]), pathlib.Path(a.one[1]), w)
        finally:
            try:
                app.Quit()
            except Exception:  # noqa: BLE001
                pass
            shutil.rmtree(w, ignore_errors=True)
        return

    plan = json.loads(ROWS.read_text(encoding="utf-8"))["편"]
    if a.limit:
        plan = plan[: a.limit]
    # ⚠️ **「파일이 있다」를 「변환됐다」로 읽으면 안 된다.** 변환이 중간에 죽으면 0바이트
    #    파일이 남고, 그러면 다음 실행이 그 편을 «이미 됨» 으로 건너뛴다 — 에러가 아니라
    #    숫자만 조용히 줄어든다(2026-08-19 실측: `5049.pdf` 0바이트가 그렇게 남아 있었다).
    def done(e: str) -> bool:
        f = OUT / f"{e}.pdf"
        return f.exists() and f.stat().st_size > 0

    todo = [p for p in plan if not done(p["e"])]
    print(f"편 {len(plan)} · 이미 변환됨 {len(plan) - len(todo)} · 할 것 {len(todo)}")
    if not a.write:
        print("드라이런이다. 실제로 찍으려면 --write 를 붙여라.")
        return

    OUT.mkdir(exist_ok=True)

    ok = fail = 0
    stuck: list[str] = []
    for i, p in enumerate(todo, 1):
        dest = (OUT / f"{p['e']}.pdf").resolve()
        before = hwp_pids()
        try:
            subprocess.run(
                [sys.executable, __file__, "--one", p["hwp"], str(dest)],
                timeout=PER_FILE_TIMEOUT, capture_output=True,
            )
        except subprocess.TimeoutExpired:
            print(f"  ✗ {p['e']}: {PER_FILE_TIMEOUT}초 초과 — 포기", flush=True)
            stuck.append(p["e"])
            for pid in hwp_pids() - before:
                subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True)
        if dest.exists() and dest.stat().st_size > 0:
            ok += 1
        else:
            fail += 1
            # 죽인 직후에는 한글이 아직 손잡이를 놓지 않았다. 몇 번 기다렸다 지운다.
            for _ in range(6):
                try:
                    dest.unlink(missing_ok=True)
                    break
                except PermissionError:
                    time.sleep(1)
        if i % 5 == 0:
            print(f"  {i}/{len(todo)} · 성공 {ok} 실패 {fail}", flush=True)
    print(f"── HWP → PDF ── 성공 {ok} · 실패 {fail} → {OUT}")
    if stuck:
        print(f"  시간제한에 걸린 편 {len(stuck)}: {','.join(stuck)}")


if __name__ == "__main__":
    main()
