# testchanger 벤더링 사본 — 완료 HWP 정답 추출

**출처**: `시험지 한글화`(testchanger) 저장소. 같은 원장님 소유 코드다.
**복사 시점**: 2026-08-15 · 복사 원본: `D:\시험지 한글화`

| 파일 | 원본 경로 | 줄 |
|---|---|---|
| `hwp_extract.py` | `scripts/hwp_extract.py` | 287 |
| `core/hwp_com.py` | `core/hwp_com.py` | 741 |

## 왜 저장소에 넣었나

B단계(N드라이브 완료본 추출)에서 **정답·해설은 완료 HWP 에서만 나온다**
(완료 PDF 에는 정답면이 없다 — `08-import-ledger.md` §5.1.2).
그런데 컴퓨터마다 testchanger 사본이 달라 이 파일이 없는 곳이 있었다
(2026-08-15, `F:\시험지변환기\scripts\` 에 없음). 없으면 **본문만 들어오고 정답이
안 붙어 출제에 못 쓴다.**

그래서 이 두 파일만 사본으로 고정했다. 나머지(textlayer·pua_table 등)는
`tc_paths.py` 가 찾아 주는 실제 testchanger 저장소를 그대로 쓴다.

## 쓰는 법

```bash
# .hwp → 문항 JSON(정답·해설·소단원·난이도 포함)
python scripts/vendor/testchanger/hwp_extract.py "<완료본.hwp>" -o out.json
```

`scripts/qa/extract-final-batch.py` 가 이걸 부른다. 실제 testchanger 저장소가
있으면 그쪽을 먼저 쓰고, 없을 때 이 사본으로 떨어진다.

## ⚠️ 전제 — 한컴오피스(HWP COM)

`.hwp` → `.hwpx` 변환에 **한컴오피스가 설치돼 있어야 한다**(`core/hwp_com.py` 가
`HWPFrame.HwpObject` COM 을 띄운다). `.hwpx` 입력은 COM 없이도 동작한다.

한컴이 없는 컴퓨터에서는 B단계 정답 추출을 돌릴 수 없다. 확인:

```python
import win32com.client as w
w.Dispatch("HWPFrame.HwpObject")   # 예외 없으면 설치돼 있다
```

## 동기화

원본이 바뀌면 이 사본도 갱신해야 한다. 사본을 **여기서 고치지 말 것** —
고쳐야 하면 testchanger 원본을 고치고 다시 복사한다.
