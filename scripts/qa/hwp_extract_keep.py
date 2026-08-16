# -*- coding: utf-8 -*-
"""완료본 HWP → 문항 JSON + **`.hwpx` 중간산출물 보존**.

벤더링된 `hwp_extract.py` 는 `.hwpx` 를 임시 폴더에 만들고 끝나면 지운다
(`main()` 의 `finally: shutil.rmtree(work, ...)`). 그런데 그 변환이 이 작업에서
가장 비싼 단계다 — 한컴 COM 은 단일 인스턴스라 편당 약 12.8초, 2,944편이면
10.5시간이다. **트랙 A 가 그림을 HWPX `BinData` 에서 읽으려면 같은 변환이 또
필요하다**(코디네이터 2026-08-16). 두 번 돌릴 이유가 없으므로 여기서 남긴다.

용량 실측(표본 3편): `.hwpx` 는 ZIP 이라 BMP 를 이미 deflate 한다 —
BinData 원본 28.8MB 인 편이 압축 후 4.6MB. **편당 평균 1.7MB · 2,944편 약 5GB**다.
(트랙 A 가 말한 편당 27MB 는 압축을 푼 뒤 크기다. 풀지 않으면 그 비용은 안 든다.)
그래서 png 재인코딩 없이 통째로 남긴다 — 트랙 A 는 XML 좌표까지 같이 얻는다.

사용: python scripts/qa/hwp_extract_keep.py <입력.hwp> -o <출력.json> --keep <디렉터리> --id <examId>
"""
import argparse
import json
import pathlib
import shutil
import sys
import tempfile

_HERE = pathlib.Path(__file__).resolve().parent
_VENDOR = _HERE.parent / "vendor" / "testchanger"
sys.path.insert(0, str(_VENDOR))

from hwp_extract import parse_exam, to_hwpx  # noqa: E402

sys.path.insert(0, str(_HERE))
from hwp_text_clean import clean_exam  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--keep", required=True, help="`.hwpx` 를 남길 디렉터리")
    ap.add_argument("--id", required=True, help="파일명으로 쓸 examId")
    a = ap.parse_args()

    keep = pathlib.Path(a.keep)
    keep.mkdir(parents=True, exist_ok=True)
    target = keep / f"{a.id}.hwpx"

    src = pathlib.Path(a.src)
    if target.exists():
        # 이미 변환해 둔 것이 있으면 COM 을 다시 부르지 않는다(재개 시 12.8초 절약).
        hx = target
        work = None
    elif src.suffix.lower() == ".hwpx":
        shutil.copy2(src, target)
        hx = target
        work = None
    else:
        work = pathlib.Path(tempfile.mkdtemp(prefix="hwpxk_"))
        hx = to_hwpx(src, work)
        shutil.move(str(hx), str(target))
        hx = target

    try:
        data = parse_exam(hx)
    finally:
        # 변환용으로 복사한 `.hwp` 원본만 지운다. `.hwpx` 는 keep 으로 옮겨 뒀다.
        if work is not None:
            shutil.rmtree(work, ignore_errors=True)

    # 수식 캡션의 base64 덩어리를 걷어낸다(hwp_text_clean.py 참조).
    data["_b64Cleaned"] = clean_exam(data)
    data["_hwpx"] = str(target)
    pathlib.Path(a.out).write_text(
        json.dumps(data, ensure_ascii=False), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
