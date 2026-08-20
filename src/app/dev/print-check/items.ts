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
    id: "figure-raster-300dpi",
    title: "그림 1,344장을 **300dpi 재크롭본**으로 바꿨다",
    changed:
      "원본 시험지 PDF 에서 그림을 **다시 오려** 픽셀을 촘촘하게 만들었다(대체로 1.5배). " +
      "**지면 크기는 안 바뀐다** — 앞서 물리 폭(mm)을 넣어 두었기 때문에 픽셀이 늘어도 " +
      "그리는 크기가 그대로다(실측 1,641자리 전부 0px 변화). 바뀌는 것은 **또렷함뿐**이다. " +
      "이 무리의 150dpi 미만이 879 → 418 로 줄었다. " +
      "파일을 바꾸면서 DB 의 픽셀 치수(`figure_dims`)도 같은 실행에서 고쳤다 — " +
      "하나만 하면 넘침 판정이 옛 픽셀로 재고 지면은 새 파일을 그린다.",
    look:
      "① 바뀐 그림의 **선·글자·눈금이 종전보다 또렷한가.** 이게 이 변경의 유일한 목적이다. " +
      "② 그림이 종전과 **같은 크기**로 나오는가 — 커지거나 작아졌으면 그건 결함이다(0건이어야 한다). " +
      "③ 다시 오리면서 **가장자리가 잘리거나** 옆 문항 글자가 딸려 들어오지 않았는가. " +
      "④ 안 바꾼 그림(가로가 안 늘어 그대로 둔 11,383장)과 **한 지면에 섞여** 있을 때 " +
      "또렷함 차이가 눈에 거슬리지 않는가. " +
      "⑤ 사진처럼 흐릿한 그림이 남아 있는가 — 그건 원본이 스캔이라 다시 오려도 안 나아진다(벡터가 다음 수다).",
    lookFromSource: false,
    evidence: [
      "scripts/qa/swap-figure-files.ts (고르는 규칙 · 되돌리기)",
      "scripts/qa/survey-figure-swap.py (계획 만들기)",
      "src/__tests__/unit/swapFigureFiles.test.ts",
      "scripts/qa/mutate-swap.sh (가드 5개 · 5개 다 빨강)",
      "scripts/qa/reports/figure-swap-ledger.json (되돌리기 원장 1,344행)",
      "docs/planning/tracks/report-figure-apply.md",
    ],
    scale:
      "계획 13,911장 중 **1,344장**만 바꿨다(문항 1,249건). 나머지는 사유를 다 세어 두었다 — " +
      "가로가 안 늘어 이득이 0 인 것 11,383 · **아무 문항도 안 쓰는 고아 파일 1,172** " +
      "(371개 시험지 폴더가 통째로 고아다) · 확장자가 달라져 URL 을 바꿔야 하는 것 11 · " +
      "지면 폭이 달라지는 것 1(mm 를 몰라 폭이 아직 픽셀에서 나오는 그림이라 뺐다).",
    status: "대기",
    needs: "실물 출력",
    changedOn: "2026-08-20",
  },
  {
    id: "figure-print-size-mm",
    title: "그림 크기를 **픽셀이 아니라 물리 크기(mm)** 로 정한다",
    changed:
      "종전 규칙은 「픽셀 폭이 264.567(=70mm)을 넘으면 70mm 로 줄이고, 아니면 픽셀 그대로(96dpi)」뿐이었다. " +
      "**「얼마로 그린다」가 없다** — 원본 가로가 41~7,343px(중앙 425)이라 같은 삼각형이 문항마다 다른 크기로 인쇄된다. " +
      '이제 그림마다 「원본 지면에서 차지하던 물리 폭(mm)」을 알면 `<img style="width: Xmm">` 로 그리고, ' +
      "넘침 판정도 **같은 함수**로 그 크기를 잰다. **모르면 종전과 한 글자도 다르지 않다**(회귀 0). " +
      "원장님 지시 2026-08-19 「모든 그림이나 도형 크기가 일관성이 있어야 하니까」.",
    look:
      "① 같은 종류의 도형(삼각형·수직선·좌표평면)이 문항마다 **같은 크기**로 나오는가 — 이게 이 변경의 목적이다. " +
      "② 작아진 그림의 글자·눈금이 **읽히는가.** 물리 크기를 따르면 종전보다 작아지는 그림이 생긴다(종전에 70mm 로 확대되던 것). " +
      "③ 그림이 문항 열(약 96mm)을 넘어 옆 칸을 침범하지 않는가 — 어떤 그림도 70mm 를 넘으면 안 된다. " +
      "④ 그림 아래 보기·정답란이 밀려 다음 문항과 겹치지 않는가(넘침은 잘림이 아니라 **겹침**으로 나타난다). " +
      "⑤ mm 를 모르는 그림과 아는 그림이 **한 지면에 섞여** 있을 때 어색하지 않은가.",
    lookFromSource: false,
    evidence: [
      "src/lib/figurePrintSize.ts (규칙 한 곳 — 자와 지면이 같이 부른다)",
      "src/lib/printOverflow.ts `estimateFigureBlockPx`",
      "src/components/math/ProblemContent.tsx (인라인 `width: Xmm`)",
      "src/__tests__/unit/figurePrintSize.test.ts · printFigureHeight.test.ts · problemFigures.test.tsx",
      "scripts/qa/mutate-figure-print-size.mjs (변이 20 · 잡힘 18 · 동치 2 · 안 잡힘 0)",
      "docs/planning/tracks/figure-quality-brief.md §9 · §14",
      "docs/planning/tracks/report-figure-print-size.md",
      "docs/planning/tracks/report-figure-apply.md (적재 전후 실측 · 새로 넘치는 3문항)",
      "scripts/qa/reports/figure-source-mm-apply.json (되돌리기 원장 8,238행)",
    ],
    scale:
      "🔴 **값이 들어왔다 (2026-08-20, 원장님 확정 「끝까지 — 지면·출제까지」).** " +
      "`figure_source_mm` 에 **8,238문항 · 그림 9,312장**을 적재했고 조회·인쇄 배선까지 넣었다 — " +
      "**이 항목은 이제 실제로 종이가 바뀐다.** 그림은 대체로 **작아진다**(문항 높이 중앙 −75px). " +
      "그림이 있는데 mm 를 모르는 1,490문항은 **종전과 한 픽셀도 같다**(회귀 0)  — ⑤ 가 보는 자리다. " +
      "넘침 판정 2,655 → 1,034 이고, **3문항이 새로 넘친다**(원본에서 크던 그림이 제 크기를 되찾아서다): " +
      "중2 다항식의 덧셈과 뺄셈 · 중2 여러 가지 경우의 수(그림 두 장이 나란히 94mm 라 접힌다) · 공통수학2 무리함수(1). " +
      "바닥값(최소 mm)은 **두지 않기로** 확정했다 — 원본 시험지에 실린 크기 그대로 간다.",
    status: "대기",
    needs:
      "값이 DB 에 들어오기 전에는 `/dev/figure-print-size` 에서 **전후 비교 지면**으로 본다 " +
      "(같은 문항을 종전 규칙 / 새 규칙으로 나란히 그린다). " +
      "그 화면은 실측 원장(`scripts/qa/reports/figure-rect-ledger.json`)을 읽는다. " +
      "원장이 없으면 가정값으로 내려가지 않고 「원장이 없다」고 적고 멈춘다. " +
      "값이 컬럼에 들어오면 실제 인쇄 화면이 바뀌고 그때 이 항목이 실물 검수 대상이 된다.",
    changedOn: "2026-08-19",
  },
  {
    id: "figure-blend-multiply",
    title: "그림의 **흰 배경**을 지면 종이색에 녹인다 (곱셈 혼합)",
    changed:
      "오려 온 그림은 배경이 **순백(#FFFFFF)** 인데 지면은 `--paper-warm`(#FCFCF8) 이라, " +
      "그림 자리마다 **더 밝은 사각형**이 떠 보였다(원장님 2026-08-20: 「그림은 배경이 흰색인데, " +
      "문제지는 배경이 흰색이 아니라 좀 이상한건 있긴하네」). " +
      "그림에 `mix-blend-multiply` 를 걸어 흰 배경이 종이색에 녹게 했다 — 흰색을 곱하면 바탕이 " +
      "그대로 남고 검은 획·글자는 진하게 남는다. **그림 파일은 하나도 안 건드린다.** " +
      "화면(흰 배경)에서는 곱셈이 아무 일도 안 하므로 문제은행·검수 화면은 종전 그대로다.",
    look:
      "🔴 ① **그림 둘레의 밝은 사각형이 사라졌는가** — 이 변경의 목적이다. " +
      "② 그림 안의 **검은 선·글자가 옅어지지 않았는가.** 곱셈은 진한 쪽을 남기므로 그대로여야 한다. " +
      "③ **색 있는 그림**(노란 바탕 삽화·빨간 도형)의 색이 탁해지지 않았는가 — 종이색이 곱해진다. " +
      "④ 그림 안에 **원래 흰색으로 칠한 부분**(가림·지우개 역할)이 있으면 그 자리가 비쳐 보이지 않는가. " +
      "🔴 ⑤ **프린터가 혼합을 제대로 찍는가** — 브라우저·드라이버마다 다르게 나올 수 있는 부류다. " +
      "화면 미리보기가 멀쩡해도 종이에서 회색 사각형으로 나오는 일이 있는지 반드시 확인한다.",
    lookFromSource: false,
    evidence: [
      "src/components/math/ProblemContent.tsx `FIGURE_BLEND_CLASS`",
      "src/__tests__/unit/problemFigures.test.tsx (「흰 배경을 지면 색에 녹인다」)",
      "src/components/print/TestPrint.module.css `--paper-warm` = #FCFCF8",
    ],
    scale:
      "그림이 붙은 문항 **전량**이 대상이다(그림 16,000여 장). 되돌리기는 상수 한 줄을 지우는 것이다.",
    status: "대기",
    needs:
      "혼합은 **인쇄에서만 눈에 띄는** 변경이다(화면은 배경이 흰색이라 아무 일도 안 한다). " +
      "그래서 미리보기로는 판정이 안 되고 실물 출력이 필요하다. " +
      "특히 색 있는 그림 한 장과 흰색으로 가린 부분이 있는 그림 한 장을 같은 지면에 넣어 본다.",
    changedOn: "2026-08-20",
  },
  {
    id: "inline-choice-repair-r2",
    title:
      "R2 — 한 줄에 붙어 있던 보기 다섯이 **처음 지면에 서는** 문항 (D-58)",
    changed:
      "`parseProblemContent` 가 줄 중간 보기 마커를 보기 경계로 본다. 그 전까지 이 문항들은 " +
      "**보기가 0칸**이라 발문만 찍히고 학생이 고를 칸이 아예 없었다. 이제 보기 다섯 칸이 " +
      "새로 생기므로 **문항 높이가 커진다** — 칸을 넘치거나 다음 문항을 밀 수 있다. " +
      "실측: 옛 파서와 전량 대조에서 판정이 바뀐 것은 2건뿐이고(둘 다 개선), 잠금이 풀리면 32건이 지면에 새로 선다.",
    look:
      "① 보기 다섯이 문항 칸 안에 다 들어가는가 — 다섯째 보기가 잘리거나 다음 장으로 넘어가지 않는가. " +
      "② 보기가 두 열로 앉을 때 좌우가 겹치지 않는가(원본이 두 열이던 문항들이다). " +
      "③ 보기 번호 ①②③④⑤ 가 빠짐없이 차례로 찍히는가. " +
      "④ 발문 끝에 보기 글자가 **남아 있지 않은가** — 잘라 낸 자리가 발문에 다시 보이면 불합격이다.",
    lookFromSource: false,
    evidence: [
      "src/lib/problem/choiceRepairRules.ts (규칙 한 벌)",
      "src/lib/problem/parseProblemContent.ts (가드: 1..n 이고 n>=4 일 때만 받는다)",
      "src/__tests__/unit/inlineChoiceRepair.test.ts",
      "docs/planning/tracks/reports/hwp-rescue.md §2",
    ],
    scale:
      "판정이 바뀌는 문항 32건(현재 전량 `directUseAllowed=false` 로 잠겨 있어 지면에 안 나간다). " +
      "잠금이 풀리는 순간부터 종이에 나간다 — 그전에 검수해야 한다.",
    status: "대기",
    needs:
      "보기가 한 줄에 붙어 있던 문항이 시험지에 들어가야 한다. 잠금이 풀리기 전에는 " +
      "`/dev/print-check` 표본이나 mock 문항(`…000002`·`…000025`)으로 봐야 한다 — " +
      "그 둘이 R2 로 보기 0칸 → 4칸이 된 실제 사례다.",
    changedOn: "2026-08-19",
  },
  {
    id: "figure-svg-inline",
    title:
      "AI 변형이 새로 그린 도형(SVG)의 지면 배치 — 처음 종이에 나가는 갈래",
    changed:
      "`Problem.figureSvg` 가 계약·직렬화·지면에 처음 이어졌다(D-55). 그 전까지는 DB 컬럼만 있고 0건이라 **한 번도 인쇄된 적이 없다.** 스캔 그림(`figureUrls`, `<img>`)과 달리 이쪽은 inline `<svg>` 이고 폭 규칙도 따로다 — 큰 도형 360px / 70mm, 중간(각·상자 연쇄) 240px / 64mm, 위젯 140px / 37mm. `sanitize_svg` 가 width/class 를 버리므로 판정은 viewBox 만 본다.",
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
    id: "figure-svg-adopt",
    title:
      "그림 716문항을 **벡터 SVG 로** 바꿨다 — 종이에서 선이 연하지 않은가",
    changed:
      "래스터 그림을 벡터 SVG 로 갈아 끼웠다(716문항 · 727자리). " +
      "인쇄 폭(mm)은 안 바꿨고, 높이는 비율을 따라 최대 1.85% 움직인다.",
    look:
      "화면에서 벡터가 또렷한 것은 확인했다. 종이에서는 **선이 너무 가늘어 " +
      "흐릴 수 있다** — 래스터보다 일관되게 가늘고 연했다. 특히 눈금·해칭·점선이 " +
      "학생 자리에서 보이는지. 그림 높이가 조금 변했으니 칸을 넘치는 문항이 " +
      "생겼는지도 같이 본다.",
    lookFromSource: false,
    evidence: [
      "scripts/qa/adopt-figure-svg.ts",
      "scripts/qa/reports/svg-whitelist.txt",
      "scripts/qa/reports/figure-svg-adopt.json",
    ],
    scale:
      "716문항 / 727자리. 채택 후보 1,576자리 중 **눈으로 본 810자리**에서만 골랐다 " +
      "— 나머지 766자리는 아직 래스터다(검수 미완).",
    needs:
      "그림이 붙은 문항이 여러 개 든 시험지. 가는 선(눈금·해칭)이 있는 도형을 일부러 넣을 것",
    status: "대기",
    changedOn: "2026-08-20",
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
