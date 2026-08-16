# -*- coding: utf-8 -*-
"""`hwp-latex` corpus 의 **지문**을 찍는다 — 다른 트랙이 같은 판을 보고 있는지 확인용.

트랙 F 가 이 corpus 를 원본으로 신규 적재를 돌린다. 내가 재생성하면 대상 수가 움직여
F 의 집계가 흔들린다(실측 5,816 → 6,042). 그래서 **얼린 시점의 지문**을 서로 맞춘다.

해시 방식을 여러 개 찍는 이유: 상대가 어떤 방식으로 쟀는지 모르면 값이 달라도
"판이 다른 것" 인지 "재는 법이 다른 것" 인지 못 가른다. 셋 다 찍어 놓고 맞춰 본다.

  python scripts/qa/fingerprint-corpus.py
"""
import hashlib
import json
import pathlib
import sys

DIR = pathlib.Path("scripts/qa/reports/hwp-latex")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> None:
    files = sorted(DIR.glob("*.json"), key=lambda p: p.name)
    n_files = len(files)
    total = 0
    n_q = 0

    # ① 파일 내용만 이어 붙인 sha256 (이름 제외)
    h_content = hashlib.sha256()
    # ② "파일명:내용해시" 를 이어 붙인 sha256 (이름 포함 — 이름이 바뀌어도 잡힌다)
    h_named = hashlib.sha256()
    # ③ 문항 본문만 정규화해 이어 붙인 sha256 (포맷·키 순서 변화에 둔감)
    h_body = hashlib.sha256()

    for f in files:
        raw = f.read_bytes()
        total += len(raw)
        h_content.update(raw)
        h_named.update(f.name.encode("utf-8"))
        h_named.update(hashlib.sha256(raw).digest())
        try:
            doc = json.loads(raw.decode("utf-8"))
        except Exception:  # noqa: BLE001
            continue
        for q in doc.get("questions") or []:
            n_q += 1
            h_body.update(str(q.get("number")).encode("utf-8"))
            h_body.update((q.get("stem") or "").encode("utf-8"))
            for c in q.get("choices") or []:
                h_body.update((c or "").encode("utf-8"))

    print("── hwp-latex corpus 지문 ──")
    print(f"편 {n_files} · 문항 {n_q} · 바이트 {total}")
    print(f"  ① 내용 sha256        {h_content.hexdigest()[:16]}  (전체 {h_content.hexdigest()})")
    print(f"  ② 파일명+내용 sha256 {h_named.hexdigest()[:16]}  (전체 {h_named.hexdigest()})")
    print(f"  ③ 문항 본문 sha256   {h_body.hexdigest()[:16]}  (전체 {h_body.hexdigest()})")


if __name__ == "__main__":
    main()
