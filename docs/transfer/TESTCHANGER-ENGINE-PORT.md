# 시험지변환기 엔진 포팅 기반

## 선택한 경계

원본 Python 구현은 복사하지 않고 버전 고정 JSON stdin/stdout CLI 어댑터로
참조한다. 원본 저장소에는 LICENSE/COPYING/NOTICE 및 파일별 라이선스 표기가
없어서 재배포 권한이 명확하지 않고, 오늘의수학의 Next 런타임에 Python 모듈을
직접 결합하면 배포 경계도 불명확해지기 때문이다.

고정 원본:

- repository: `BIGSHOL/testchange`
- commit: `d95a6bee593832c6907d7e9b458e06ea65b5c7d9`
- release: `0.1.26`
- 파일별 SHA-256: `config/testchanger-engine.json`

어댑터는 실행할 때 네 엔진 파일의 해시를 모두 검증한다. 해시가 다르면
`engine_version_mismatch`로 중단한다.

## 구성

- `scripts/transfer/engine_bridge.py`: 고정 Python 엔진 로더와 bounded JSON 계약
- `config/testchanger-engine.json`: 원본 commit/release/file hash/runtime 고정
- `src/lib/testchanger/contracts.ts`: 엄격한 Zod v1 요청/응답 타입
- `src/lib/testchanger/cliClient.ts`: timeout, 출력 상한, 비밀 redaction을 둔 spawn
- `src/lib/testchanger/serverClient.ts`: `server-only` 경계
- `scripts/transfer/verify-engine-adapter.ts`: 해시, fixture, sanitizer 보안 probe 검증

지원 operation은 `health`, `figure.render`, `figure.qaFixtures`,
`figure.securityProbe`, `ocr.validate`, `ocr.recognize`다. 요청 최대 30MiB, OCR
디코딩 이미지 최대 20MiB, stdout 최대 32MiB이다.

## SVG 불변식

도형 생성은 원본 `core.figure_svg`와 `core.figure_solid`만 사용한다. 모든 SVG는
반환 직전에 반드시 `core.figure_quality.sanitize_svg`를 거친다. 생성 SVG는
KaTeX/`MathText`에 전달하지 않고 별도 SVG DOM 계층에서만 렌더한다.

```powershell
npm run transfer:verify-engine -- `
  --source-root "F:\시험지변환기" `
  --python "F:\시험지변환기\.venv\Scripts\python.exe"
```

fixture는 좌표축/점/선분/화살표/곡선, 원/접선/각도호/각 라벨, `View`
직육면체/숨은선, `Camera` 구/평면/공간 원을 포함한다. 보안 probe는 `script`,
event attribute, 외부 `href`, `foreignObject`, `filter`가 모두 거부되는지 별도로
확인한다.

## OCR 경계와 비용

`core.ocr_engine`은 Pillow, Anthropic SDK, httpx, Google GenAI에 의존하고
`core.pdf_handler`를 import하므로 이미지 OCR만 써도 PyMuPDF import 경계가
생긴다. 조사한 원본 venv는 Python 3.13.13이며 manifest에 다음 버전을 고정했다.

| 패키지       |     버전 | 확인된 라이선스 메타데이터 |
| ------------ | -------: | -------------------------- |
| Pillow       |   12.2.0 | MIT-CMU                    |
| anthropic    |  0.105.2 | MIT                        |
| httpx        |   0.28.1 | BSD-3-Clause               |
| google-genai |    2.7.0 | Apache-2.0                 |
| PyMuPDF      | 1.27.2.3 | AGPL-3.0 또는 상용         |
| resvg_py     |    0.3.2 | 패키지 메타데이터에 미표기 |

PyMuPDF의 배포 방식과 원본 프로젝트 자체의 미표기 라이선스는 법무/소유자 확인이
필요하다. 이것이 해결되기 전에는 엔진 파일을 이 저장소로 복사하지 않는다.

OCR 호출 키는 `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, 또는 서버 전용
`TESTCHANGER_OCR_API_KEY`로만 자식 프로세스에 전달한다. 원본 GUI config 파일은
읽지 않는다. 에러의 알려진 키 값과 DB URL은 redaction한다. 브라우저 bundle이나
Client Component에서 `serverClient`를 import하면 안 된다.

기존 OCR 결과 검증에는 `ocr.validate`만 사용하므로 비용이 들지 않는다. 실제
`ocr.recognize`는 외부 비용과 데이터 전송이 생기며, 명시적인 사용자 승인 후에만
호출한다. 이번 QA에서는 호출하지 않았다.

## 배포 경계

로컬/worker 환경에서는 다음 서버 환경만 설정한다.

```text
TESTCHANGER_ROOT=<고정 commit의 원본 checkout>
TESTCHANGER_PYTHON=<고정 venv의 python executable>
```

일반적인 Vercel 함수 런타임에는 이 로컬 Python checkout과 장기 spawn을 기대할
수 없다. 배포 시에는 같은 계약/manifest hash 검증을 유지한 별도 private worker
또는 job service로 옮기고, 오늘의수학 서버가 인증된 내부 요청만 보내도록 한다.
브라우저에서 worker를 직접 호출하거나 OCR 키를 전달하면 안 된다.
