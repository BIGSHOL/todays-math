/**
 * 실물 프린터 출력 검수 대기 목록 — **CLAUDE.md 절대 규칙 6 의 미결 잔고.**
 *
 * 「인쇄 관련 변경은 실물 프린터 출력 검수까지가 완료 조건」인데, 2026-08-17~18 이틀
 * 동안 지면이 바뀌는 변경이 대량으로 main 에 들어갔고 **그중 종이로 확인된 것은 하나도
 * 없다.** 어디에 무엇이 밀려 있는지 한 장에 모은다.
 *
 * ## 이 파일이 SSOT 다
 *
 * 항목을 추가·해제할 때는 이 파일을 고친다. 화면(`page.tsx`)은 여기 적힌 것만 그린다.
 * 검수를 마쳤으면 `status` 를 `"통과"` 로 바꾸고 `verifiedOn` 에 날짜를 적는다 —
 * 체크박스 표시는 브라우저에만 남는 진행 메모라, **완료 기록은 여기 코드에 남겨야 한다.**
 *
 * ## 「무엇을 봐야 하나」를 반드시 적는다
 *
 * 「인쇄해 보세요」만으로는 아무도 판정할 수 없다. 종이에서 **무엇이 보이면 불합격인지**를
 * 적는다. 근거 문서에 그 지시가 있으면 그대로 옮기고, 없으면 `제안` 으로 표시한다 —
 * 남이 쓴 것과 내가 지어낸 것을 섞지 않는다.
 */

export type CheckStatus = "대기" | "통과" | "형태미확정";

export interface PrintCheckItem {
  id: string;
  /** 무엇을 검수하는가 — 짧은 이름 */
  title: string;
  /** 지면이 어떻게 바뀌었나 */
  changed: string;
  /** 종이에서 무엇을 보면 되나. `fromSource` 가 false 면 근거 문서에 없는 **제안**이다. */
  look: string;
  lookFromSource: boolean;
  /** 근거 위치 (파일:줄 또는 커밋) */
  evidence: string[];
  /** 규모 — 몇 문항이 영향을 받나 */
  scale?: string;
  status: CheckStatus;
  verifiedOn?: string;
  /** 이 항목이 드러나려면 시험지에 무엇이 들어가야 하나 */
  needs?: string;
  changedOn: string;
}

/** 검수는 전부 이 화면에서 뽑는다. 시험지 id 는 출제할 때마다 다르다. */
export const PRINT_ROUTE = "/tests/{시험지id}/print";

export const ITEMS: PrintCheckItem[] = [
  {
    id: "figure-svg-inline",
    title:
      "AI 변형이 새로 그린 도형(SVG)의 지면 배치 — 처음 종이에 나가는 갈래",
    changed:
      "`Problem.figureSvg` 가 계약·직렬화·지면에 처음 이어졌다(D-55). 그 전까지는 DB 컬럼만 있고 0건이라 **한 번도 인쇄된 적이 없다.** 스캔 그림(`figureUrls`, `<img>`)과 달리 이쪽은 inline `<svg>` 이고 폭 규칙도 따로다 — 화면 360px / 인쇄 70mm, `[&>svg]:w-full` 로 폭에 맞춰 늘린다.",
    look: "① 도형이 문항 칸 안에 들어가는가(넘쳐서 다음 문항을 밀거나 겹치지 않는가). ② 선 굵기가 인쇄에서 사라지거나 뭉개지지 않는가 — 벡터라 화면에서 멀쩡해도 종이에서 다르다. ③ 도형 안 글자(꼭짓점 이름·치수)가 읽히는 크기인가. ④ 스캔 그림과 같은 문항에 함께 있을 때 두 그림이 나란히 서는가.",
    lookFromSource: false,
    evidence: [
      "src/components/math/ProblemContent.tsx (figureSvg 블록)",
      "docs/planning/09-figure-engine-guide.md §0.1",
      "docs/planning/07-coding-convention.md D-55",
    ],
    scale:
      "지금은 0건 — AI 변형으로 채택한 문항에서만 생긴다. 원본 후보는 그림 문항 9,419건(출제 가능의 20.2%)",
    needs:
      "그림 문항을 변형해 도형이 그려진 후보를 채택하고, 그 문항을 시험지에 넣어야 드러난다",
    status: "대기",
    changedOn: "2026-08-19",
  },
  {
    id: "figures-multi",
    title: "그림 회수 590건 — 다장 문항의 지면 배치",
    changed:
      "그림이 없던 1,420문항에서 기출 그림을 되붙였다(기출 745 → 174). 매퍼가 그림을 「바로 앞 문항」에 붙이므로 옆 문항 그림이 딸려 온 경우가 있다. **현재 수치는 문서 16 §2 를 볼 것** — 여기 적힌 숫자는 낡는다.",
    look: "한 문항에 그림이 2장 이상 붙은 문항이 칸을 넘겨 다음 문항을 밀거나 겹치는지, 남의 그림이 섞여 있지 않은지. 그림 폭은 인쇄 70mm 고정이다.",
    lookFromSource: true,
    evidence: [
      "docs/planning/16-figure-recovery-ledger.md §3.3",
      "커밋 4681cf43",
    ],
    scale: "새로 생긴 다장 문항 78건",
    needs: "그림이 2장 이상 붙은 문항을 일부러 포함시켜야 드러난다",
    status: "대기",
    changedOn: "2026-08-18",
  },
  {
    id: "body-typeset",
    title: "본문 조판 8건 — 세부 문항 줄바꿈·다단 등식·조건 상자",
    changed:
      "세부 문항(⑴⑵⑶) 앞에서 줄을 바꾸고, 계산 과정 등식을 단계마다 나누고, 「다음 조건」을 상자로 만들었다. 지면이 세로로 길어져 넘침 경고가 폭 605 → 709건, 줄 수 474 → 623건이 됐다.",
    look: "① ⑴⑵ 가 각각 새 줄에서 시작하는지 ② 등식이 단계마다 끊기되 끊긴 줄이 들뜨지 않는지 ③ 「□」 뒤 공백이 사라졌는지 ④ 한 장에 2문항이 들어가되 아래 문항과 겹치지 않는지 — 넘침은 잘림이 아니라 겹침이다.",
    lookFromSource: false,
    evidence: [
      "docs/planning/tracks/reports/body-typeset.md:42",
      "커밋 1faea81b (1,783문항) 외 6건",
    ],
    scale: "1,988문항 (합산치 — 근거 문서에 이 숫자가 그대로 적혀 있지는 않다)",
    status: "대기",
    changedOn: "2026-08-18",
  },
  {
    id: "two-column",
    title: "보기 2열 → 1열 707문항",
    changed:
      "표시폭 계산이 연산자 여백을 세기 시작해 1열로 내려가는 문항이 6.0%(2,063건) → 8.0%(2,770건)이 됐다. 지면 세로 배분이 바뀐다.",
    look: "1열로 내려간 문항에서 보기가 3줄 → 5줄이 되며 칸 밖으로 밀리는지. 반대로 2열로 남은 문항에서 보기가 한 칸 안에서 두 줄로 접히는지(원장님이 처음 지적한 증상).",
    lookFromSource: false,
    evidence: ["src/lib/math/displayWidth.ts:161", "커밋 9f6814e4"],
    scale: "707문항 증가",
    status: "대기",
    changedOn: "2026-08-18",
  },
  {
    id: "math-residue",
    title: "수식 잔재 후보정 — 본문 1,706행 직접 변경",
    changed:
      "지면에 날 글자로 나가던 `le` `ge` `3times5` `\\overarc` 를 고쳤다. content 1,185행 · answer 17행 · solution 504행. 붉게 나가는 문항 671 → 619.",
    look: "① 부등호 ≤ ≥ 가 제대로 그려지는지(`le`/`ge` 가 남아 있지 않은지) ② 붉은 글씨가 흑백 인쇄에서 회색이 되어 「안 보이는 오류」가 되지 않는지 ③ 호 기호 ⌒ 와 순환마디 점이 12.5px 지면에서 실제로 보이는지.",
    lookFromSource: false,
    evidence: [
      "docs/planning/tracks/reports/render-d-math-residue.md:294",
      "커밋 5172b238 외",
    ],
    scale: "1,706행",
    status: "대기",
    changedOn: "2026-08-18",
  },
  {
    id: "box-card",
    title: "〈보기〉·〈조건〉 상자 카드 3,573문항",
    changed:
      "상자에 테두리 1px + 안쪽 여백을 줬다. 상자가 있던 문항의 세로 높이가 대략 2줄분 늘어난다. 보기 2,065문항도 1열로 내려갔다.",
    look: "① 상자 테두리가 흑백 인쇄에서 나오는지 ② 상자가 페이지 경계에서 잘리지 않는지 ③ 2줄 증가분 때문에 문항이 칸을 넘치는지 — 자습 지면은 고정 높이라 넘치면 조용히 잘린다.",
    lookFromSource: false,
    evidence: [
      "docs/planning/tracks/reports/render-b-box.md:196",
      "src/components/math/ProblemContent.tsx (2열 판정 주석)",
    ],
    scale: "상자 3,573 + 1열 2,065",
    status: "대기",
    changedOn: "2026-08-17",
  },
  {
    id: "essay-badge",
    title: "서술형 배지 — 1px 금색 테두리 + 10px 글자",
    changed:
      "본문에 박혀 있던 `[서술형 3]` 을 DB 에서 8,436행 걷어내고 그 자리를 조판이 배지로 채운다.",
    look: "배지 테두리가 **1px 금색 실선**이고 글자가 10px 다(`TestPrint.module.css:301`). 근거 문서는 「10px 테두리」라 적었지만 실물은 1px 이다 — 흑백 레이저에서 그 얇은 선이 아예 안 나오거나 회색으로 뭉개지지 않는지. 그리고 배지가 붙은 문항이 정말 서술형인지 — 단답형↔서술형 275행이 뒤바뀌어 있던 것을 고친 뒤 종이 확인이 없다.",
    lookFromSource: true,
    evidence: [
      "docs/planning/tracks/reports/render-c-body-postfix.md:185",
      "src/components/print/TestPrint.module.css:301",
    ],
    scale: "8,436행",
    needs: "서술형 문항이 포함돼야 배지가 찍힌다",
    status: "대기",
    changedOn: "2026-08-17",
  },
  {
    id: "multi-answer",
    title: "복수정답 지면 표기 `③, ④` (D-50)",
    changed:
      "학교가 두 답을 모두 정답 처리한 문항 15건을 원문자 + 쉼표 + 한 칸으로 인쇄한다.",
    look: "정답지 「빠른 정답」 그리드 칸에서 `③, ④` 두 글자가 한 칸 안에서 줄바꿈되거나 잘리지 않는지. 원문자는 KaTeX 없이 평문으로 흐른다.",
    lookFromSource: false,
    evidence: [
      "docs/planning/07-coding-convention.md D-50",
      "track-b-report.md:255",
    ],
    scale: "15건",
    status: "대기",
    changedOn: "2026-08-16",
  },
  {
    id: "paper-parity",
    title: "PaperProblemView 신설 — 화면·지면 통일",
    changed:
      "「모든 문제를 인쇄와 같은 뷰로」 지시에 따라 문제은행·검수·인쇄를 한 컴포넌트로 통일하면서 인쇄 템플릿과 A4Page 의 마크업·CSS 변수가 실제로 바뀌었다. 커밋은 화면 통일만 근거로 들고 지면 검수를 언급하지 않았다.",
    look: "화면(`/problems`)에서 본 문항과 종이에 인쇄된 같은 문항의 줄바꿈 위치가 글자 단위로 같은지. 어긋나면 통일 자체가 깨진 것이다.",
    lookFromSource: false,
    evidence: ["커밋 2c3c6d0d", "src/components/print/PaperProblemView.tsx"],
    status: "대기",
    changedOn: "2026-08-17",
  },
  {
    id: "perf-lazy",
    title: "성능 변경 — 그림 지연 로딩·KaTeX 지연 import",
    changed:
      "그림 지연 로딩과 KaTeX 406KB dynamic import 를 넣으며 「인쇄 지면은 종전 그대로」를 설계 제약으로 삼았으나, 빌드 산출물로만 검증했다.",
    look: "인쇄 미리보기에서 Ctrl+P 를 즉시 눌렀을 때 ① 수식이 이미 다 그려져 있는지(늦으면 빈 자리로 인쇄된다) ② 그림이 빠진 문항이 없는지 — 지연 로딩이 지면에 새면 학생이 못 푸는 시험지가 나간다.",
    lookFromSource: false,
    evidence: [
      "docs/planning/tracks/reports/perf-c-bundle.md:258",
      "커밋 cebddecd 외",
    ],
    status: "대기",
    changedOn: "2026-08-17",
  },
  {
    id: "t52-base",
    title: "T5.2 인쇄 미리보기 + 인쇄 CSS 전체 (태스크 자체가 미완)",
    changed:
      "Mathgen 자습 템플릿 일체를 이식했다. 태스크 제목이 「코드 GREEN, 실물 검수 대기」다. T5.1 은 시안 선택용 출력이었고 제품 지면은 아직 한 번도 종이로 검수되지 않았다.",
    look: "명조 가독성 · 모눈 농도 · 여백 · 수식 깨짐 · 4장 스테이플 — 05 문서가 T5.2 로 넘긴 다섯 가지.",
    lookFromSource: true,
    evidence: [
      "docs/planning/06-tasks.md:713",
      "docs/planning/05-design-system.md:337",
    ],
    status: "대기",
    changedOn: "2026-08-14",
  },
  {
    id: "overflow-first-page",
    title: "첫 장 정원 · 정답지 1쪽 정원 (현상 확인)",
    changed:
      "넘침 판정 트랙이 경고만 고치고 지면은 안 바꿨다. 다만 고치면 지면이 바뀌는 현상 두 가지를 제안으로 남겼다 — 첫 장 칸이 79px 좁은데도 2문항을 넣고(첫 장에서만 넘치는 것 3,216건), 정답지 1쪽은 「빠른 정답」 상자가 자리를 먹는다(잘린 134장 중 95장이 1쪽).",
    look: "① 문제지 첫 장의 2번 문항이 하단 「오늘의 메모」를 뚫고 나가는지 ② 정답지 1쪽 마지막 문항 해설이 통째로 사라지는지.",
    // 근거 문서는 «현상»과 «고칠 방법»만 적었고 종이에서 무엇을 보라는 지시는 없다.
    lookFromSource: false,
    evidence: ["docs/planning/tracks/reports/fix-overflow.md §7"],
    needs: "정답지 1쪽 정원은 25문항짜리로 뽑아야 드러난다",
    status: "대기",
    changedOn: "2026-08-18",
  },
  {
    id: "d07-align",
    title: "다단 등식 정렬 · 나열 상자 정렬 (D-07 형태 미확정)",
    changed:
      "다단 등식을 문단으로 쌓을지 등호를 세로로 맞출지(align), 나열 상자를 왼쪽 정렬로 둘지 가운데로 둘지가 아직 정해지지 않았다.",
    look: "검수가 아니라 **선택**이다. 종이에서 어느 쪽이 읽기 좋은지 보고 정하면 된다.",
    lookFromSource: true,
    evidence: ["docs/planning/tracks/reports/body-typeset.md:261, :352"],
    status: "형태미확정",
    changedOn: "2026-08-18",
  },
  {
    id: "d07-box-label",
    title: "〈보기〉 라벨 위치 (D-07 형태 미확정)",
    changed:
      "상자 라벨을 왼쪽 위 굵게 둘지 가운데 둘지 등 3건이 확정 전 시안 상태다.",
    look: "검수가 아니라 **선택**이다.",
    lookFromSource: true,
    evidence: ["docs/planning/tracks/reports/render-b-box.md:215"],
    status: "형태미확정",
    changedOn: "2026-08-17",
  },
  {
    id: "d07-score",
    title: "예측 문제지 배점의 지면 위치·서체 (D-07 형태 미확정)",
    changed:
      "D-41 로 「예측 문제지에는 배점을 지면에 찍는다」가 확정됐으나 위치·서체가 미정이고, 예측 문제지에는 아직 인쇄 화면 자체가 없다.",
    look: "아직 인쇄할 것이 없다. 인쇄 시안이 나오면 그때 정한다.",
    lookFromSource: true,
    evidence: ["docs/planning/05-design-system.md:493"],
    status: "형태미확정",
    changedOn: "2026-08-16",
  },
  {
    id: "short-answer-badge",
    title: "「단답형 n」 배지 — 서술형과 **다른 말**이 찍힌다",
    changed:
      "종전에는 `questionType` 이 서술형인 문항에만 「서술형 n」을 붙였고 단답형은 아무 표시가 없었다. 원장님 확정(2026-08-19)으로 단답형에는 「단답형 n」을 붙이고, 번호는 유형마다 **따로** 센다(서술형 1·2 / 단답형 1·2).",
    look: "배지 모양(1px 금색 테두리·10px)은 그대로다. 볼 것은 ㉠ 「단답형」 네 글자가 배지 폭 안에서 안 넘치는가 — 「서술형」보다 글자가 길지 않으니 괜찮아야 한다, ㉡ 한 시험지에 둘이 섞였을 때 번호가 각각 1부터 이어지는가.",
    lookFromSource: false,
    evidence: [
      "src/lib/tests/essayLabels.ts",
      "src/components/print/templates/JaseupTemplate.tsx:99",
    ],
    scale: "questionType='단답형' 763건 (전체 47,152 중 1.6%)",
    needs: "단답형 문항과 서술형 문항이 **함께** 든 시험지",
    status: "대기",
    changedOn: "2026-08-19",
  },
  {
    id: "prod-print",
    title: "프로덕션 실물 인쇄 최종 검수 (T6.2)",
    changed: "배포 태스크의 인수 조건. 배포 자체가 미완이라 착수 전이다.",
    look: "로컬과 Vercel 프로덕션의 폰트 폴백이 다를 수 있다. 프로덕션에서 뽑은 종이가 로컬과 같은 글꼴인지 대조.",
    lookFromSource: false,
    evidence: ["docs/planning/06-tasks.md:798"],
    status: "대기",
    changedOn: "미착수",
  },
];

/** 한 번에 다 보려면 어떤 시험지를 뽑아야 하나. */
export const SAMPLING_PLAN = [
  "8문항짜리 일일테스트 1건(문제지 4장 + 정답지)이면 대부분 한 번에 검증된다.",
  "그림이 2장 이상 붙은 문항을 일부러 넣어야 다장 배치가 드러난다.",
  "정답지 1쪽 정원은 25문항짜리로 뽑아야 「빠른 정답」 상자가 커져 해설이 사라진다.",
  "서술형 문항과 **단답형 문항이 함께** 들어가야 배지 두 갈래가 다 찍힌다.",
];
