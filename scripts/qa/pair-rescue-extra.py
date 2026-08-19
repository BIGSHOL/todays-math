# -*- coding: utf-8 -*-
"""트랙 «HWP 회수» — **대장에 없는 편의 HWP 를 드라이브에서 직접 찾는다.**

`final-pairs.json`(페어 대장)에 **없는** 편이 20편 있었다. 브리프는 그것을
「대장에 없다」고만 적어 두었는데, 대장은 파생물이다 — **드라이브를 직접 훑으면
20편 모두 `(완료).hwp` 가 살아 있다**(2026-08-18 교훈: 「없다」의 근거가
파생물이면 그 파생물이 무엇을 담기로 한 물건인지부터 물어라).

대장이 놓친 이유는 **디렉터리 규약이 해마다 다르기** 때문이다:

    2025:  …/2025년 1학기 기말고사 모음/pdf/중3/[학교][3][25-1-기말][비상] (완료).PDF
           …/2025년 1학기 기말고사 모음/워드/중3/[학교][3][25-1-기말][비상] (완료).hwp
    2024:  …/2024년 2학기 중간 고사 모음/#워드/고1/…                      (`#워드`)

PDF 쪽 폴더 이름이 `PDF`/`pdf` 로도 갈리고 워드 쪽은 `워드`/`#워드` 로 갈린다.
그래서 경로 규칙으로 짝을 짓지 않고 **파일명(확장자 제외)이 같은 hwp** 를
드라이브 전수 스캔 결과에서 찾는다. 파일명은 학교·학년·차수·출판사를 다 담고 있어
편을 유일하게 가른다(실측: 20/20 유일 일치).

    python scripts/qa/pair-rescue-extra.py --scan scripts/qa/_hwprescue/nscan-hwp.txt

  입력  scripts/qa/reports/hwp-rescue-ledger.json  (missReason='추출본 없는 편')
        --scan  `find /n/개인 -iname '*.hwp' -o -iname '*.hwpx'` 의 출력
  출력  scripts/qa/reports/final-pairs-extra.json  (extract-hwp-all.py 가 덧붙여 읽는다)
"""
import argparse
import collections
import io
import json
import os
import pathlib
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

LEDGER = "scripts/qa/reports/hwp-rescue-ledger.json"
POOL = "scripts/qa/reports/rescue-pool.jsonl"
OUT = "scripts/qa/reports/final-pairs-extra.json"


def base(p):
    return os.path.splitext(os.path.basename(p))[0]


def win(p):
    """`/n/...` → `N:\\...`. Node·pywin32 둘 다 Windows 경로를 그대로 읽는다
    (앞 트랙이 `N:\\` 를 `/n/` 로 바꿔 읽어 251건을 «파일 없음» 으로 찍은 적이 있다)."""
    if p.startswith("/n/"):
        return "N:" + chr(92) + p[3:].replace("/", chr(92))
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", required=True, help="드라이브 전수 스캔 결과 (한 줄에 한 경로)")
    a = ap.parse_args()

    scan = [l.strip() for l in io.open(a.scan, encoding="utf-8") if l.strip()]
    byname = collections.defaultdict(list)
    for p in scan:
        byname[base(p)].append(p)

    led = json.load(io.open(LEDGER, encoding="utf-8"))
    want = {
        str(r["examId"])
        for r in led["rows"]
        if r.get("missReason") == "추출본 없는 편" and r.get("examId")
    }
    # RPM 이관본은 원본 HWP 자체가 없다 — 여기서 뺀다.
    want = {e for e in want if not e.startswith("rpm-")}

    # 그 편들의 sourceFile 을 풀 스냅샷에서 얻는다.
    src = {}
    school = {}
    for line in io.open(POOL, encoding="utf-8"):
        r = json.loads(line)
        eid = str(r.get("examId") or "")
        if eid in want and r.get("sourceFile"):
            src[eid] = r["sourceFile"]
            school[eid] = r.get("school")

    pairs, missing = [], []
    for eid in sorted(want):
        pdf = src.get(eid)
        if not pdf:
            missing.append((eid, "sourceFile 없음"))
            continue
        hits = byname.get(base(pdf)) or []
        # 확장자가 여럿이면 .hwp 를 앞세운다.
        hits.sort(key=lambda p: (0 if p.lower().endswith(".hwp") else 1, p))
        if not hits:
            missing.append((eid, f"드라이브에 같은 이름의 hwp 없음: {base(pdf)}"))
            continue
        if len({base(h) for h in hits}) != 1:
            missing.append((eid, "이름이 여럿 — 사람이 봐야 한다"))
            continue
        hwp = win(hits[0])
        size = None
        try:
            size = os.path.getsize(hwp)
        except OSError:
            missing.append((eid, f"경로는 찾았으나 stat 실패: {hwp}"))
            continue
        pairs.append({
            "examId": eid,
            "hwp": hwp,
            "pdf": pdf,
            "school": school.get(eid),
            "_hwpSize": size,
            "_foundBy": "파일명 일치 (드라이브 전수 스캔)",
        })

    pathlib.Path(OUT).parent.mkdir(parents=True, exist_ok=True)
    io.open(OUT, "w", encoding="utf-8").write(
        json.dumps({"pairs": pairs, "_note": "대장 밖 편 — 드라이브 직접 스캔으로 찾음"},
                   ensure_ascii=False, indent=1)
    )
    print(f"대장 밖 편 {len(want)} — hwp 를 찾은 것 **{len(pairs)}** · 못 찾은 것 {len(missing)}")
    for eid, why in missing:
        print(f"   ✗ {eid}: {why}")
    print(f"→ {OUT}")


if __name__ == "__main__":
    main()
