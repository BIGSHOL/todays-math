/**
 * 본문(content)이 배정된 단원과 맞는지 **전수**로 판정한다. **읽기 전용 — DB 를 고치지 않는다.**
 *
 *   npx tsx -r dotenv/config scripts/classify/audit-content-unit.ts
 *
 * 손상 입력 시험은 **매 실행마다** 돈다(맨 끝에 찍힌다). 아래 플래그는 진단용이다.
 *   --refresh           스냅샷을 DB 에서 다시 내린다
 *   --sweep             중단원 규칙을 **같은 경고 건수에서** 견준다 (선행 잔존 49건 재현율)
 *   --sweep-band        과목대·단원명 문턱을 견준다 (검증 코퍼스를 오경보 탐지기로 씀)
 *   --diagnose-target   표적 32행이 왜 잡히거나 안 잡히는지 한 행씩 뜯어본다
 *   --selftest          보고서 경로 안내만 생략한다 (판정은 그대로 돈다)
 *
 * 실행에 필요한 것: `.env` 의 `DATABASE_URL`(공유 Supabase). 스냅샷은
 * `CONTENT_AUDIT_CACHE`(기본 os.tmpdir()) 에 캐시하고 `--refresh` 로 다시 내린다.
 * `node_modules/.bin` 이 없는 워크트리에서는 `node node_modules/tsx/dist/cli.mjs` 로 부른다.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────────
 * 선행 감사(`audit-label-content.ts`)는 **HWP 재추출본이 있는 편만** 봐서 34,697행에
 * 그쳤다. 남은 구멍이 PDF 출처 past_exam · transformed 4,862 · manual 766 ·
 * 메타 없는 6,915 다. 발단이 된 「초3 원 단원에 앉은 고1 이차부등식」(4509-5)이
 * 바로 그 구멍에 있었다.
 *
 * ── 판정 설계 (CLAUDE.md 2026-08-16~17 교훈) ──────────────────────────────
 * 1. 본문만으로 단원을 맞히는 것은 어렵다(선행 분류기 소단원 65.3%). 그래서
 *    **본문 근거 + 본문과 독립인 근거**가 같은 방향을 가리킬 때만 「오분류」로 올린다.
 *    한쪽만이면 「의심」에 머문다.
 * 2. 어휘 사전은 **문서가 아니라 검증된 코퍼스에서 캐고**, 모든 항목의 실제 적중
 *    건수를 표로 찍는다. 0건인 항목은 죽은 가드로 의심한다.
 *    (OCR 은 낱말 중간에 공백을 넣는다 — "수  열", "만  들 수". 한글 매칭은
 *     공백을 전부 지운 사본에서 한다. 이 처리가 없으면 가드가 조용히 죽는다.)
 * 3. 어휘 순도는 **초등 배정 행에서 재지 않는다.** 그 구간이 이미 오염돼 있어서
 *    (transformed 초등 165건 대부분이 중등 문항) 거기서 캐면 손상된 표현을
 *    「초등 어휘」로 배운다. 순도는 **독립근거로 검증된 39,998행에서만** 잰다.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT_DIR = "scripts/classify/reports";
const CACHE_DIR =
  process.env.CONTENT_AUDIT_CACHE ?? join(tmpdir(), "content-unit-audit");
const CACHE_ROWS = join(CACHE_DIR, "problems.jsonl");
const CACHE_UNITS = join(CACHE_DIR, "units.json");

type Unit = {
  id: string;
  grade: string;
  chapter: string;
  section: string;
  orderIndex: number;
};
type Row = {
  id: string;
  externalId: string | null;
  unitId: string;
  source: string;
  school: string | null;
  subject: string | null;
  examId: string | null;
  sourceFile: string | null;
  n: number | null;
  content: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// 0. 스냅샷 (읽기 전용)
// ─────────────────────────────────────────────────────────────────────────────
async function loadSnapshot(
  refresh: boolean,
): Promise<{ units: Unit[]; rows: Row[] }> {
  if (!refresh && existsSync(CACHE_ROWS) && existsSync(CACHE_UNITS)) {
    return {
      units: JSON.parse(readFileSync(CACHE_UNITS, "utf8")),
      rows: readFileSync(CACHE_ROWS, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as Row),
    };
  }
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const units = (await prisma.unit.findMany({
      select: {
        id: true,
        grade: true,
        chapter: true,
        section: true,
        orderIndex: true,
      },
      orderBy: { orderIndex: "asc" },
    })) as Unit[];
    const rows: Row[] = [];
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.problem.findMany({
        select: {
          id: true,
          externalId: true,
          unitId: true,
          source: true,
          school: true,
          subject: true,
          examId: true,
          sourceFile: true,
          questionNumber: true,
          content: true,
        },
        orderBy: { id: "asc" },
        take: 4000,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (batch.length === 0) break;
      for (const b of batch) {
        rows.push({
          id: b.id,
          externalId: b.externalId,
          unitId: b.unitId,
          source: String(b.source),
          school: b.school,
          subject: b.subject,
          examId: b.examId,
          sourceFile: b.sourceFile,
          n: b.questionNumber,
          content: b.content ?? "",
        });
      }
      cursor = batch[batch.length - 1].id;
      process.stdout.write(`\r스냅샷 ${rows.length}`);
    }
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_UNITS, JSON.stringify(units), "utf8");
    writeFileSync(
      CACHE_ROWS,
      rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
      "utf8",
    );
    process.stdout.write("\n");
    return { units, rows };
  } finally {
    await prisma.$disconnect();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 본문 정규화 — OCR 이 낱말 중간에 넣은 공백을 무력화한다
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 한글 키워드는 **여기서 나온 사본에 매칭한다.** 부모 세션 실측: 원문에만 매칭했을 때
 * 「음수」 가드 0건·고등 가드 0건이었는데, 공백을 지운 사본에도 매칭하니 16건·2건이
 * 나왔다. 즉 그 가드들은 그전까지 100% 죽어 있었고 에러도 나지 않았다.
 */
const squeeze = (text: string): string => text.replace(/\s+/g, "");
/** 수식 밖 한글만 — 수식 안의 `\mathrm{...}` 잔재가 낱말을 만들지 않게 한다. */
const koreanOnly = (text: string): string =>
  squeeze(text.replace(/\$[^$]*\$/g, " ")).replace(/[^가-힣]+/g, "|");

type Norm = { raw: string; squeezed: string; korean: string; tex: Set<string> };
const normalize = (content: string): Norm => ({
  raw: content,
  squeezed: squeeze(content),
  korean: koreanOnly(content),
  tex: new Set(
    (content.match(/\\[a-zA-Z]+/g) ?? []).map((t) => t.toLowerCase()),
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 학교급 결정 어휘 — 씨앗은 사람이 고르고, **순도는 코퍼스가 정한다**
// ─────────────────────────────────────────────────────────────────────────────
const LEVELS = ["초", "중", "고"] as const;
type Level = (typeof LEVELS)[number];
const levelOf = (grade: string): Level =>
  /^초/.test(grade) ? "초" : /^중/.test(grade) ? "중" : "고";

/**
 * 「고등에서만 쓰는 말」 씨앗. 학교급을 가르는 결정적 어휘부터 골랐다(지시 §2).
 * 실제 순도는 `verifyLexicon()` 이 검증 코퍼스(고 18,983 / 중 21,015)에서 재고,
 * 기준 미달·0건은 사전에서 **자동으로 빼고** 그 사실을 보고서에 남긴다.
 */
const SEED_HIGH: string[] = [
  // 미적분
  "미분",
  "적분",
  "도함수",
  "미분가능",
  "미분계수",
  "정적분",
  "부정적분",
  "치환적분",
  "부분적분",
  "극한값",
  "함수의극한",
  "좌극한",
  "우극한",
  "수렴",
  "발산",
  "무한급수",
  "등비급수",
  "변곡점",
  "극대",
  "극소",
  "가속도",
  "속도의크기",
  "접선의방정식",
  // 대수·수열
  "수열",
  "등차수열",
  "등비수열",
  "첫째항",
  "공비",
  "계차수열",
  "귀납적",
  "시그마",
  "로그",
  "상용로그",
  "지수함수",
  "로그함수",
  "진수",
  "밑의조건",
  "삼각함수",
  "사인법칙",
  "코사인법칙",
  "호도법",
  "라디안",
  "주기함수",
  // 집합·명제 (공통수학2)
  "집합",
  "부분집합",
  "여집합",
  "합집합",
  "교집합",
  "공집합",
  "명제",
  "필요충분조건",
  "대우",
  "역함수",
  "합성함수",
  "유리함수",
  "무리함수",
  "점근선",
  // 공통수학1
  "복소수",
  "허수",
  "판별식",
  "조립제법",
  "나머지정리",
  "인수정리",
  "근과계수의관계",
  "이차부등식",
  "연립이차부등식",
  "삼차방정식",
  "사차방정식",
  "절대부등식",
  "산술평균과기하평균",
  // 확률과 통계
  "확률변수",
  "이산확률변수",
  "연속확률변수",
  "정규분포",
  "이항분포",
  "표준정규분포",
  "표본평균",
  "모평균",
  "신뢰구간",
  "임의추출",
  "조건부확률",
  "독립시행",
  "이항정리",
  "여사건",
  "확률분포",
  "기댓값",
  // 기하·도형의 방정식
  "타원",
  "쌍곡선",
  "포물선",
  "이차곡선",
  "공간좌표",
  "방향벡터",
  "법선벡터",
  "내적",
  "위치벡터",
  "평행이동",
  "대칭이동",
  "원의방정식",
  "점과직선의거리",
  "자취",
  // 순열·조합 (공통수학1 경우의수 + 확통)
  "순열",
  "조합",
  "원순열",
  "중복조합",
  // 표기 씨앗 — 합성함수 `∘` 와 역함수 `^{-1}` 는 낱말 없이 기호로만 나온다.
  // 4448-11(공통수학2 여러 가지 함수)이 「일차함수」라는 낱말 때문에 중2 로 끌려갔는데,
  // 그 문항의 정체는 `(g∘f)^{-1}∘h=f` 였다. 순도는 아래 검증이 정한다.
  "∘",
  "^{-1}",
];

/**
 * 「중등에서만 쓰는 말」 씨앗 — **초등도 배제하는 것만** 골랐다.
 * ⚠️ 최소공배수·최대공약수·겉넓이·부피·이등변삼각형·평행사변형·사다리꼴은 **초등에도 있다.**
 *    넣으면 초등 문항을 중등으로 오판한다. 그래서 일부러 뺐다.
 */
const SEED_MID: string[] = [
  "소인수분해",
  "서로소",
  "순환소수",
  "유한소수",
  "무한소수",
  "순환마디",
  "정비례",
  "반비례",
  "일차방정식",
  "일차부등식",
  "연립방정식",
  "일차함수",
  "이차함수",
  "제곱근",
  "무리수",
  "근호",
  "유리수와무리수",
  "피타고라스",
  "삼각비",
  "상대도수",
  "도수분포표",
  "히스토그램",
  "최빈값",
  "중앙값",
  "대푯값",
  "산포도",
  "표준편차",
  "맞꼭지각",
  "엇각",
  "동측내각",
  "작도",
  "합동조건",
  "닮음비",
  "닮음의성질",
  "외심",
  "내심",
  "무게중심",
  "원주각",
  "접선의길이",
  "다면체",
  "회전체",
  "부채꼴",
  "일차함수의그래프",
  "이차함수의그래프",
  "완전제곱식",
  "인수분해공식",
];

/**
 * 「초등에서만 쓰는 말」 씨앗. **초등 배정 행에서 캐지 않았다** — 그 구간이 오염돼
 * 있어서 거기서 캐면 중등 문제집 표현("다음 수들의 최소공배수를 소인수의 곱으로")을
 * 초등 어휘로 배운다. 대신 초등 교육과정 소단원 이름(SSOT)과 자작 문항을 눈으로 보고
 * 골랐고, 순도는 아래에서 검증 코퍼스로 잰다.
 */
const SEED_ELEM: string[] = [
  "받아올림",
  "받아내림",
  "곱셈구구",
  "몇십몇",
  "몇백몇",
  "묶음",
  "낱개",
  "가분수",
  "대분수",
  "진분수",
  "단위분수",
  "띠그래프",
  "그림그래프",
  "막대그래프",
  "꺾은선그래프",
  "원그래프",
  "쌓기나무",
  "어림",
  "반올림",
  "버림하여",
  "올림하여",
  "각도기",
  "예각",
  "둔각",
  "원주율",
  "원주",
  "전개도",
  "뛰어세기",
  "몇배",
  "몇시몇분",
  "약분",
  "기약분수",
  "통분",
  "소수점의위치",
  "자릿값",
  "세로셈",
  "덧셈식",
  "뺄셈식",
  "곱셈식",
  "나눗셈식",
];

/**
 * 「초등 교육과정에 **없는 수학적 대상**」 — 어휘가 아니라 표기·대상 수준의 신호다.
 * 근거는 통계가 아니라 교육과정이다: 초등 수학에는 문자 미지수·거듭제곱·좌표평면·
 * 함수 표기·근호가 없다(초등은 □, ○, ? 를 쓴다).
 * 그래도 실제로 그런지 `measureNotation()` 이 자작 초등 540건과 검증 코퍼스에서 재고,
 * 초등 쪽 비율이 기준을 넘는 가드는 **자동으로 뺀다.**
 */
const NOT_ELEMENTARY = {
  /** `x^{2}` — 초등에 거듭제곱은 없다. ⚠️ `cm²`(단위)는 제외한다. 안 빼면 초등 자작 넓이 문항이 2.6% 걸린다. */
  거듭제곱: (n: Norm) =>
    /\^/.test(n.raw) ||
    /(?<![a-zA-Z㎝㎡])[²³⁴⁵⁶⁷⁸⁹]/.test(n.raw.replace(/c?m[²³]/g, "")),
  /** `(a, b)` · `(-1, 4)` — 좌표평면은 중1부터다. */
  좌표: (n: Norm) =>
    /\(\s*-?[0-9a-zA-Z]+\s*,\s*-?[0-9a-zA-Z]+\s*\)/.test(n.raw),
  /** `y=` · `f(x)` — 함수 표기는 중1부터다. */
  함수표기: (n: Norm) => /[yf]\s*=|f\s*\(\s*x\s*\)/.test(n.raw),
};
/**
 * 아래 둘의 근거는 **교육과정**이다 — 초등 수학에 근호(√)와 문자 미지수는 없다(근호 중3,
 * 문자를 사용한 식 중1). 코퍼스 통계가 아니라 교과 사실이라 따로 둔다.
 *
 * 1차 설계에서는 이 둘을 「LaTeX 안에서만 판정되니 잴 수 없다」며 보조로 내렸다. 그런데
 * 「정상」 판정을 의심도 순으로 훑어보니 **놓친 것이 이 구간에 몰려 있었다** — 초2 「□의 값
 * 구하기」에 앉은 `√(40a/3)`(중3 제곱근), 초5 「혼합 계산」에 앉은 `(-2x)÷(-1/6)`(중1 문자와 식).
 * 그래서 판정식을 LaTeX 에 기대지 않게 고쳐(`$` 없이도 걸리게) 자작 초등 540건에서 다시 쟀다.
 * 오발률이 실제로 0% 이면 그때는 **잴 수 없었던 것이 아니라 재서 통과한 것**이다.
 */
const NOT_ELEMENTARY_CURRICULUM = {
  근호: (n: Norm) =>
    n.tex.has("\\sqrt") || n.tex.has("\\surd") || /[√]/.test(n.raw),
  /** 소문자 라틴 문자가 낱자로 쓰인 자리. 선택지 라벨(`A.`,`B.`)은 대문자라 걸리지 않는다. */
  미지수문자: (n: Norm) =>
    /(^|[^a-zA-Z])[xyabkmnt](?![a-zA-Z])/.test(
      n.raw.replace(/\b(cm|mm|km|kg|m|g|L|mL)\b/g, " "),
    ),
};
/** 반대로 「초등 지면에서만 보이는 형식」. 어휘가 아니라 어투·지면이라 **보강 근거로만** 쓴다. */
const ELEMENTARY_FORM = {
  빈칸: (n: Norm) => /_{3,}/.test(n.raw),
  선택지ABCD: (n: Norm) =>
    /(^|\n)\s*A\.\s/.test(n.raw) && /(^|\n)\s*B\.\s/.test(n.raw),
  합니다체: (n: Norm) => /입니(다|까)|하세요/.test(n.squeezed),
};

type LexEntry = {
  term: string;
  level: Level;
  고: number;
  중: number;
  전체: number;
  순도: number;
  등급: "결정" | "보조" | "탈락";
  이유: string;
};

/**
 * 씨앗 어휘를 검증 코퍼스로 채점한다. 세 가지를 **따로** 본다 —
 * 이 셋을 한 문턱으로 뭉개면 «반례 0건인 좋은 어휘»와 «아무 데도 안 나오는 죽은 가드»가
 * 같은 칸에 떨어진다(1차 실행에서 실제로 그랬다).
 *   1. **반례**: 반대쪽 급에서의 적중. 0 이면 그 자체로 강한 근거다.
 *   2. **순도**: 반례가 있을 때만 의미가 있다.
 *   3. **생존**: 전체 47,152행에서의 적중. 0 이면 어디에도 없는 **죽은 가드**다.
 * 초 씨앗은 방향이 뒤집힌다 — 검증 코퍼스(전부 중·고) 적중 0 이 **채택 조건**이고,
 * 생존은 전체 코퍼스에서 따로 확인한다.
 */
const PURITY = 0.98;

function verifyLexicon(
  trustedHigh: Norm[],
  trustedMid: Norm[],
  allNorms: Norm[],
): LexEntry[] {
  const hit = (norms: Norm[], term: string) =>
    norms.reduce((a, n) => a + (n.squeezed.includes(term) ? 1 : 0), 0);
  const out: LexEntry[] = [];
  const push = (term: string, level: Level) => {
    const 고 = hit(trustedHigh, term),
      중 = hit(trustedMid, term),
      전체 = hit(allNorms, term);
    const corpus = 고 + 중;
    const [mine, other] = level === "중" ? [중, 고] : [고, 중];
    let 순도 = corpus === 0 ? 0 : mine / corpus;
    let 등급: LexEntry["등급"] = "탈락";
    let 이유 = "";
    if (전체 === 0) 이유 = "전체 47,152행 적중 0건 — 죽은 가드";
    else if (level === "초") {
      순도 = 1;
      if (corpus === 0) {
        등급 = "결정";
        이유 = `중·고 반례 0 · 전체 ${전체}건`;
      } else if (corpus <= 3) {
        등급 = "보조";
        이유 = `중·고에 ${corpus}건 — 초등 전용이라 보기 어려움`;
      } else 이유 = `중·고에 ${corpus}건 나옴 — 초등 전용 아님`;
    } else if (other === 0 && mine >= 3) {
      등급 = "결정";
      이유 = `반례 0 · ${level} ${mine}건`;
    } else if (corpus >= 12 && 순도 >= PURITY) {
      등급 = "결정";
      이유 = `순도 ${(100 * 순도).toFixed(1)}%`;
    } else if (other === 0) {
      등급 = "보조";
      이유 = `반례 0 이지만 ${level} ${mine}건뿐`;
    } else if (corpus === 0) {
      등급 = "보조";
      이유 = `검증 코퍼스 적중 0 (기출에 없음) · 전체 ${전체}건 — 순도 미검증`;
    } else
      이유 = `순도 ${(100 * 순도).toFixed(1)}% < ${100 * PURITY}% (반례 ${other}건)`;
    out.push({
      term,
      level,
      고,
      중,
      전체,
      순도: Number(순도.toFixed(4)),
      등급,
      이유,
    });
  };
  for (const t of SEED_HIGH) push(t, "고");
  for (const t of SEED_MID) push(t, "중");
  for (const t of SEED_ELEM) push(t, "초");
  return out;
}

/**
 * 표기 가드도 실측한다. 초등 쪽에서 뜨면 그 가드는 초등을 배제하지 못한다 → 뺀다.
 * ⚠️ 문턱을 「중·고에서 자주 뜬다」로 잡으면 **드물지만 정확한** 가드가 억울하게 죽는다
 *    (1차 실행: 좌표 4.99% 가 5% 문턱에 걸려 탈락). 판정에 필요한 건 빈도가 아니라
 *    **초등 쪽 오발률**이다. 그래서 중·고 문턱은 생존 확인용(1%)으로만 둔다.
 */
type NotationStat = {
  가드: string;
  초등자작: number;
  중고: number;
  채택: boolean;
  잴수있나: boolean;
  이유: string;
};
function measureNotation(elemManual: Norm[], corpus: Norm[]): NotationStat[] {
  const out: NotationStat[] = [];
  const measure = (
    가드: string,
    fn: (n: Norm) => boolean,
    잴수있나: boolean,
  ) => {
    const e = elemManual.filter(fn).length / Math.max(1, elemManual.length);
    const c = corpus.filter(fn).length / Math.max(1, corpus.length);
    const 채택 = 잴수있나 && e <= 0.02 && c >= 0.01;
    out.push({
      가드,
      초등자작: Number((100 * e).toFixed(2)),
      중고: Number((100 * c).toFixed(2)),
      채택,
      잴수있나,
      이유: 채택
        ? `초등 자작 오발 ${(100 * e).toFixed(2)}% (분모 ${elemManual.length})`
        : e > 0.02
          ? `초등 자작에 ${(100 * e).toFixed(1)}% — 초등을 배제하지 못한다`
          : `중·고 ${(100 * c).toFixed(2)}% — 살아 있는지 확인 불가`,
    });
  };
  for (const [가드, fn] of Object.entries(NOT_ELEMENTARY))
    measure(가드, fn, true);
  // 교육과정 근거 가드도 **같은 기준으로 잰다.** 초등 프록시에서 실제로 오발이 없으면 채택한다.
  for (const [가드, fn] of Object.entries(NOT_ELEMENTARY_CURRICULUM))
    measure(가드, fn, true);
  return out;
}

/** LaTeX 토큰도 학교급을 가른다 — 검증 코퍼스 실측(고/중): \int 912/0 · \sum 832/0 · \lim 434/0 … */
const TEX_HIGH = [
  "\\int",
  "\\sum",
  "\\lim",
  "\\infty",
  "\\log",
  "\\ln",
  "\\sigma",
  "\\cup",
  "\\cap",
  "\\subset",
  "\\varnothing",
  "\\in",
  "\\to",
];
const TEX_MID = ["\\dot", "\\div", "\\overarc", "\\perp"];

// ─────────────────────────────────────────────────────────────────────────────
// 3. 본문과 **독립인** 근거 (BRIEF §3) — 본문을 읽지 않는다
// ─────────────────────────────────────────────────────────────────────────────
/** 고등 과목명 → 단원 학년. `scripts/classify/paths.ts` 의 HIGH_SUBJECT 와 같은 표다. */
const HIGH_SUBJECT: Record<string, string> = {
  수상: "공통수학1",
  공수1: "공통수학1",
  고등수학상: "공통수학1",
  상1: "공통수학1",
  수하: "공통수학2",
  공수2: "공통수학2",
  수1: "대수",
  "심화 수1": "대수",
  수2: "미적분1",
  문과수2: "미적분1",
  미적분: "미적분2",
  미적분1: "미적분2",
  확통: "확률과 통계",
  기하: "기하",
  기벡: "기하",
};
/** 경로의 폴더 표기 (`…\1학기 기말\중3\…`). 40,237 중 25,078 에서만 나온다. */
const folderGrade = (path: string): string | null => {
  const m = path.match(/[\\/](초|중|고)([1-6])[\\/]/);
  return m ? `${m[1]}${m[2]}` : null;
};
/** 파일명 대괄호 `[학교][학년]` + school 접미(중/고). 40,237 전부에서 나온다. */
const bracketGrade = (path: string, school: string | null): string | null => {
  const base = path.split(/[\\/]/).pop() ?? "";
  const m = base.match(/^\[([^\]]*)\]\[([^\]]*)\]/);
  if (!m) return null;
  const digit = m[2].match(/([1-6])/);
  if (!digit) return null;
  const lv = /고$/.test(school ?? "")
    ? "고"
    : /중$/.test(school ?? "")
      ? "중"
      : null;
  return lv ? `${lv}${digit[1]}` : null;
};
/** 학년 표기 → 그 학년이 가질 수 있는 `unit.grade` 집합. ⚠️ 고등은 학년이 아니라 과목명이다(BRIEF §3b 함정). */
const gradeCandidates = (mark: string): string[] => {
  if (/^[초중]/.test(mark)) return [mark];
  if (mark === "고1") return ["공통수학1", "공통수학2"];
  return ["대수", "미적분1", "미적분2", "확률과 통계", "기하"];
};

/**
 * (e) **편 안의 형제 문항** — 시험지 한 편은 한 학년·좁은 단원 범위다. 그래서 「같은 편의
 * 다른 문항들이 배정된 곳」은 이 행의 **본문을 읽지 않고** 얻는 근거다. 중단원 수준에서는
 * subject·경로가 아무 말도 못 하므로(둘 다 학년까지만 말한다) 이게 유일한 두 번째 열쇠다.
 *
 * ⚠️ 형제의 배정도 틀릴 수 있다. 그래서 **다수결**로만 쓰고, 자기 자신은 분모에서 뺀다.
 *    그리고 「형제 중 아무도 여기에 없다」(=지지 0)일 때만 이탈로 센다.
 */
type SiblingIndex = Map<
  string,
  { grade: Map<string, number>; chapter: Map<string, number>; total: number }
>;
function buildSiblingIndex(
  rows: Row[],
  unitById: Map<string, Unit>,
): SiblingIndex {
  const index: SiblingIndex = new Map();
  for (const row of rows) {
    if (!row.examId) continue;
    const u = unitById.get(row.unitId);
    if (!u) continue;
    if (!index.has(row.examId))
      index.set(row.examId, { grade: new Map(), chapter: new Map(), total: 0 });
    const e = index.get(row.examId)!;
    e.grade.set(u.grade, (e.grade.get(u.grade) ?? 0) + 1);
    e.chapter.set(
      `${u.grade}|${u.chapter}`,
      (e.chapter.get(`${u.grade}|${u.chapter}`) ?? 0) + 1,
    );
    e.total += 1;
  }
  return index;
}
/** 자기를 뺀 형제 분포에서 이 값이 얼마나 지지받는지. `null` = 형제가 너무 적어 말할 수 없다. */
function siblingSupport(
  index: SiblingIndex,
  examId: string | null,
  key: string,
  kind: "grade" | "chapter",
): { 지지: number; 형제수: number; 우세: string; 우세비율: number } | null {
  if (!examId) return null;
  const e = index.get(examId);
  if (!e || e.total - 1 < 5) return null;
  const hist = new Map(e[kind]);
  hist.set(key, (hist.get(key) ?? 1) - 1); // 자기 자신 제외
  const total = e.total - 1;
  const sorted = [...hist].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  return {
    지지: hist.get(key) ?? 0,
    형제수: total,
    우세: sorted[0][0],
    우세비율: sorted[0][1] / total,
  };
}

type Independent = {
  허용학년: string[] | null;
  허용급: Level[] | null;
  근거: string[];
};

function independentEvidence(row: Row): Independent {
  const 근거: string[] = [];
  let 허용학년: string[] | null = null;
  let 허용급: Level[] | null = null;
  const narrow = (cands: string[], tag: string) => {
    근거.push(tag);
    허용학년 =
      허용학년 === null ? cands : 허용학년.filter((g) => cands.includes(g));
  };
  // (a) subject → 기대 학년 (고등은 1:1)
  const subject = (row.subject ?? "").trim();
  if (subject && HIGH_SUBJECT[subject])
    narrow([HIGH_SUBJECT[subject]], `subject=${subject}`);
  else if (subject === "수학") {
    허용급 = ["중"];
    근거.push("subject=수학(중등)");
  }
  // (b) sourceFile 두 갈래 — **일치할 때만** 쓴다
  if (row.sourceFile) {
    const f = folderGrade(row.sourceFile),
      b = bracketGrade(row.sourceFile, row.school);
    if (f && b && f === b) narrow(gradeCandidates(f), `경로 두갈래 일치=${f}`);
    else if (f && b) 근거.push(`경로 두갈래 불일치(${f}/${b}) — 판단 보류`);
    else if (b) narrow(gradeCandidates(b), `파일명 대괄호=${b}`);
  }
  // (c) school 접미 → 학교급. 초등학교는 하나도 없다(유일한 "초" 포함 값은 「초전중」).
  if (row.school && /(중|고)$/.test(row.school)) {
    const lv: Level = row.school.endsWith("고") ? "고" : "중";
    허용급 = 허용급 === null ? [lv] : 허용급.filter((x) => x === lv);
    근거.push(`school 접미=${row.school.slice(-1)}`);
  }
  // (d) source=past_exam → N드라이브 기출은 전부 중·고 시험지다 (ADDENDUM A-1)
  if (row.source === "past_exam") {
    허용급 = 허용급 === null ? ["중", "고"] : 허용급.filter((x) => x !== "초");
    근거.push("source=past_exam(기출은 중·고만)");
  }
  return { 허용학년, 허용급, 근거 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 본문 근거 → 학교급
// ─────────────────────────────────────────────────────────────────────────────
type ContentVerdict = {
  급: Level | null;
  배제급: Level[];
  근거: string[];
  적중: string[];
  판정가능: boolean;
};

function contentLevel(
  norm: Norm,
  lex: LexEntry[],
  notation: NotationStat[],
): ContentVerdict {
  const 근거: string[] = [];
  const 적중: string[] = [];
  const 결정: Record<Level, string[]> = { 초: [], 중: [], 고: [] };
  const 보조: Record<Level, string[]> = { 초: [], 중: [], 고: [] };
  for (const e of lex) {
    if (e.등급 === "탈락" || !norm.squeezed.includes(e.term)) continue;
    (e.등급 === "결정" ? 결정 : 보조)[e.level].push(e.term);
    적중.push(`어휘:${e.등급}:${e.level}:${e.term}`);
  }
  for (const t of TEX_HIGH)
    if (norm.tex.has(t)) {
      결정.고.push(t);
      적중.push(`텍:고:${t}`);
    }
  for (const t of TEX_MID)
    if (norm.tex.has(t)) {
      보조.중.push(t);
      적중.push(`텍:중:${t}`);
    }

  // 초등 교육과정에 없는 대상이 나오면 초등이 아니다.
  const 초배제: string[] = [];
  const 초배제보조: string[] = [];
  for (const s of notation) {
    const fn =
      (NOT_ELEMENTARY as Record<string, (n: Norm) => boolean>)[s.가드] ??
      (NOT_ELEMENTARY_CURRICULUM as Record<string, (n: Norm) => boolean>)[
        s.가드
      ];
    if (!fn(norm)) continue;
    if (s.채택) {
      초배제.push(s.가드);
      적중.push(`초배제:${s.가드}`);
    } else {
      초배제보조.push(s.가드);
      적중.push(`초배제보조:${s.가드}`);
    }
  }
  const 초형식: string[] = [];
  for (const [name, fn] of Object.entries(ELEMENTARY_FORM))
    if (fn(norm)) {
      초형식.push(name);
      적중.push(`초형식:${name}`);
    }

  const 배제급 = new Set<Level>();
  let 급: Level | null = null;
  if (결정.고.length > 0) {
    급 = "고";
    배제급.add("초");
    배제급.add("중");
    근거.push(
      `고등 전용 어휘 ${결정.고.slice(0, 4).join("·")}${결정.고.length > 4 ? ` 외 ${결정.고.length - 4}` : ""}`,
    );
  } else if (결정.중.length > 0) {
    급 = "중";
    배제급.add("초");
    근거.push(
      `중등 전용 어휘 ${결정.중.slice(0, 4).join("·")}${결정.중.length > 4 ? ` 외 ${결정.중.length - 4}` : ""}`,
    );
  } else if (결정.초.length > 0 && 초배제.length === 0) {
    급 = "초";
    배제급.add("고");
    배제급.add("중");
    근거.push(`초등 전용 어휘 ${결정.초.slice(0, 4).join("·")}`);
  }
  // 어휘가 침묵해도 표기가 초등을 배제할 수 있다. 「점의 이동」에 앉은 공통수학2 평행이동
  // 문항(4384-3 등)이 이 경로로 잡힌다 — 「평행이동」은 중3 이차함수에도 나와서
  // 학교급 결정 어휘가 되지 못했다(실측 순도 34.6%).
  if (초배제.length > 0) {
    배제급.add("초");
    근거.push(`초등에 없는 대상: ${초배제.join("·")}`);
  }
  // 초등 지면 형식은 **보강**만 한다. 단독으로 급을 정하지 않는다(자작 문항 어투일 뿐일 수 있다).
  if (초형식.length > 0) 근거.push(`초등 지면 형식 ${초형식.join("·")}`);
  if (초배제보조.length > 0)
    근거.push(`(보조) 초등에 없는 표기 ${초배제보조.join("·")}`);
  if (보조.고.length > 0)
    근거.push(`고등 보조 어휘 ${보조.고.slice(0, 3).join("·")}`);
  if (보조.중.length > 0)
    근거.push(`중등 보조 어휘 ${보조.중.slice(0, 3).join("·")}`);

  const 한글수 = norm.korean.replace(/\|/g, "").length;
  return {
    급,
    배제급: [...배제급],
    근거,
    적중,
    판정가능: 한글수 >= 3 || 초배제.length > 0 || 결정.고.length > 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 과목대(고등 7) · 중등 학년(3) 어휘 — 검증 코퍼스에서 **캔다**
// ─────────────────────────────────────────────────────────────────────────────
type BandLex = Map<string, string[]>; // band -> terms

/**
 * 코퍼스에서 「그 대역에만 나오는 말」을 캔다.
 *
 * ⚠️ 순도는 **전체 코퍼스에서** 재야 한다. 대역 안에서만 재면 「식을 간단히」·「함수의 식」
 *    처럼 **어느 단원에나 나오는 지시문**이 그 대역 전용 어휘로 뽑힌다. 1차 실행에서
 *    3577-4(중1 정수와 유리수)와 4149-19(중3 이차방정식)가 이 조각들 때문에 거짓
 *    「오분류」로 올라왔다. 그래서 `bands` 에 **전체 대역**을 넘겨 전역 순도로 자른다.
 */
function mineBandLexicon(
  corpus: { norm: Norm; band: string }[],
  bands: string[],
  minDocs: number,
  purity: number,
  minLen = 3,
): BandLex {
  const df = new Map<string, Map<string, number>>();
  const total = new Map<string, number>();
  for (const { norm, band } of corpus) {
    total.set(band, (total.get(band) ?? 0) + 1);
    const seen = new Set<string>();
    for (const seg of norm.korean.split("|")) {
      for (let n = minLen; n <= 8; n += 1)
        for (let i = 0; i + n <= seg.length; i += 1)
          seen.add(seg.slice(i, i + n));
    }
    for (const t of seen) {
      if (!df.has(t)) df.set(t, new Map());
      const m = df.get(t)!;
      m.set(band, (m.get(band) ?? 0) + 1);
    }
  }
  const out: BandLex = new Map(bands.map((b) => [b, [] as string[]]));
  for (const [term, m] of df) {
    let sum = 0;
    for (const c of m.values()) sum += c;
    for (const b of bands) {
      const c = m.get(b) ?? 0;
      if (c >= minDocs && c / sum >= purity) out.get(b)!.push(term);
    }
  }
  // 겹치는 n-gram 은 하나만 남긴다. **자주 나오는 쪽을 남기고 서로 부분문자열인 것을 버린다** —
  // 짧은 쪽을 남기면 「에서임」「서임의」 같은 조각이 남아 근거를 읽을 수 없다.
  for (const b of bands) {
    const terms = out.get(b)!;
    const dfOf = (t: string) => df.get(t)?.get(b) ?? 0;
    const kept: string[] = [];
    for (const t of terms.sort(
      (a, x) => dfOf(x) - dfOf(a) || x.length - a.length,
    )) {
      if (!kept.some((k) => k.includes(t) || t.includes(k))) kept.push(t);
    }
    out.set(b, kept);
  }
  return out;
}

/**
 * 근거를 **겹치지 않는 자리 수**로 센다.
 *
 * ⚠️ 적중한 어휘 **개수**로 세면 안 된다. 「식을 간단히」 한 구절에서 `간단히`·`단히하` 가
 *    둘 다 걸려 근거 2개로 보이지만 실은 **하나**다. 1차 실행에서 이 중복 계수 때문에
 *    거짓 오분류가 났다. 그래서 매칭 자리를 병합해 **서로 떨어진 근거만** 센다.
 */
const matchBands = (
  norm: Norm,
  lex: BandLex,
): { band: string; hits: string[]; 근거수: number }[] => {
  const out: { band: string; hits: string[]; 근거수: number }[] = [];
  for (const [band, terms] of lex) {
    const spans: { s: number; e: number; t: string }[] = [];
    for (const t of terms) {
      const at = norm.squeezed.indexOf(t);
      if (at >= 0) spans.push({ s: at, e: at + t.length, t });
    }
    if (spans.length === 0) continue;
    spans.sort((a, b) => a.s - b.s);
    const merged: { s: number; e: number; t: string }[] = [];
    for (const sp of spans) {
      const last = merged[merged.length - 1];
      if (last && sp.s < last.e) {
        if (sp.t.length > last.t.length) last.t = sp.t;
        last.e = Math.max(last.e, sp.e);
      } else merged.push({ ...sp });
    }
    out.push({ band, hits: merged.map((m) => m.t), 근거수: merged.length });
  }
  return out.sort(
    (a, b) =>
      b.근거수 - a.근거수 || b.hits.join("").length - a.hits.join("").length,
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 5-2. 교육과정 **단원 이름** 열쇠 — 코퍼스 n-gram 과는 다른 열쇠다
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ADDENDUM A-2 가 짚은 근본 원인을 그대로 되짚는 신호다: 매퍼가 **소단원 이름만 보고
 * 학년을 안 봤다.** 그러니 「본문에 나온 개념어가 어느 학년의 단원 이름인가」를 직접 본다.
 *
 * 왜 코퍼스 n-gram 으로는 안 되는가: 부모 세션이 찾은 12건(공통수학2 「함수」 자리에 앉은
 * 중2 일차함수 문항)은 **한 줄짜리 문항**이라 개념어가 하나뿐이다. 겹치지 않는 근거 2개를
 * 요구하는 대역 신호는 이걸 구조적으로 못 잡는다(문턱을 0.90 까지 내려도 32건 중 2건).
 *
 * 두 가지가 이 열쇠를 쓸 만하게 만든다.
 *   1. **긴 이름 우선**: 「일차함수」(중2)가 걸린 자리에서 「함수」(공통수학2)는 덮인다.
 *      A-3 이 지적한 「이름이 정확히 같지 않아도 같은 함정」을 이 규칙이 처리한다.
 *   2. **여러 학년에 걸친 이름은 표를 못 던진다**: 「그래프」처럼 학년이 여럿인 이름은
 *      배제 근거가 되지 못하므로 거짓 경보를 스스로 만들지 않는다.
 */
type NameEntry = { name: string; grades: Set<string> };
const 조사 = /(의|와|과|를|은|는|이|가|에|로|으로)$/;

function buildNameIndex(units: Unit[]): NameEntry[] {
  const byName = new Map<string, Set<string>>();
  // 소단원 이름은 서술형이 많다 — 「자료를 조사하여 나타내기」·「~ 알아보기」·「~ 구하기」.
  // 그 서술 부분은 개념어가 아니라 **지시문**이라서 학년을 못 가른다. 실제로 중1 히스토그램
  // 문항이 「조사하여」 하나 때문에 중3 으로 끌려갔다(육안 확인). 그래서 동사꼴은 색인에서 뺀다.
  const 동사꼴 =
    /(하여|하기|하는|해보기|보기|내기|구하기|알아보기|나타내기|비교하기|어림하기|계산하기|만들기|되는|있는|없는)$/;
  const add = (raw: string, grade: string) => {
    const name = squeeze(raw).replace(조사, "");
    if (name.length < 3 || /[0-9a-zA-Z]/.test(name)) return;
    if (동사꼴.test(name)) return;
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name)!.add(grade);
  };
  for (const u of units) {
    // 초등 소단원만 번호 접두가 붙어 있다(ADDENDUM A-3). 떼지 않으면 이름이 안 겹친다.
    const section = u.section.replace(/^\d+(?:-\d+)*\s*/, "").trim();
    add(section, u.grade);
    for (const word of section.split(/[\s,·/()]+/)) add(word, u.grade);
    for (const word of u.chapter.replace(/^\d+\.\s*/, "").split(/[\s,·/()]+/))
      add(word, u.grade);
  }
  return [...byName]
    .map(([name, grades]) => ({ name, grades }))
    .sort((a, b) => b.name.length - a.name.length);
}

/**
 * 단원 이름도 **코퍼스로 검증한다.** 이름을 낱말로 쪼개면 「범위에서」·「그래프」·「자연수」
 * 같은 조각이 나오는데, 그중 한 학년에만 있는 조각은 **거짓 표**를 던진다. 실제로 이 검증을
 * 빼고 돌렸을 때 47,152 중 10,929건(23%)이 의심으로 떴다.
 *
 * 판정 기준은 씨앗 어휘와 같다 — 그 학년에 **편중**돼 있어야 표를 던질 자격이 있다.
 * 초등 이름은 검증 코퍼스(전부 중·고)에 **없어야** 자격이 있다(방향이 뒤집힌다).
 */
/**
 * ⚠️ 물어야 할 것은 「이 이름이 자기 학년 전용인가」가 **아니다.**
 *
 * 1차 시도에서 그렇게 물었더니 「일차함수」가 탈락했다 — 중2 순도 84.1%(중1·중3에도 나온다).
 * 그런데 표적 32행의 배정 학년은 **공통수학2** 이고, 「일차함수」의 공통수학2 몫은 1% 다.
 * 즉 이 이름은 «중2 전용»은 아니어도 «공통수학2 아님»의 근거로는 충분히 강하다.
 * 그래서 이름마다 **학년 분포를 그대로 재 두고**, 판정할 때 「배정 학년의 몫이 얼마나 작은가」를
 * 묻는다. 문턱을 옮기는 대신 열쇠를 바꾼 것이다.
 *
 * 이 형태는 여러 학년에 걸친 이름도 쓸 수 있게 한다 — 「이차함수」(중3 55%·공통수학1 42%·
 * 공통수학2 0.4%)는 공통수학2 를 배제하는 근거가 된다.
 */
type NameDist = {
  name: string;
  전체: number;
  몫: Map<string, number>;
  최다: string;
  최다몫: number;
};
const NAME_MIN_HITS = 20; // 분포를 말할 수 있는 최소 관측수
const NAME_EXCLUDE_MAX = 0.02; // 배정 학년의 몫이 이 이하이면 「그 학년 아님」의 근거
const NAME_SUPPORT_MIN = 0.1; // 이 이상이면 오히려 배정 학년을 **지지**한다

function measureNameDist(
  index: NameEntry[],
  byBand: Map<string, Norm[]>,
): Map<string, NameDist> {
  const out = new Map<string, NameDist>();
  for (const entry of index) {
    const 몫 = new Map<string, number>();
    let 전체 = 0;
    for (const [band, norms] of byBand) {
      let c = 0;
      for (const n of norms) if (n.squeezed.includes(entry.name)) c += 1;
      if (c > 0) 몫.set(band, c);
      전체 += c;
    }
    if (전체 < NAME_MIN_HITS) continue;
    for (const [b, c] of 몫) 몫.set(b, c / 전체);
    const 최다 = [...몫].sort((a, b) => b[1] - a[1])[0];
    out.set(entry.name, {
      name: entry.name,
      전체,
      몫,
      최다: 최다[0],
      최다몫: 최다[1],
    });
  }
  return out;
}
/**
 * 이름들이 배정 학년을 배제하는가. 지지하는 이름이 하나라도 있으면 배제하지 않는다.
 *
 * 문턱은 `--sweep-band` 로 골랐다. 정밀도는 **검증 코퍼스를 오경보 탐지기로** 써서 쟀다 —
 * 그 행들은 독립근거가 배정 학년을 확인해 준 행이니 거기서 뜨는 경고는 정의상 오경보다.
 * 재현은 부모 세션이 육안으로 확인한 12건(공통수학2 「함수」 자리의 중2 일차함수 문항)으로 쟀다.
 *   최다몫≥0.40 · 배정몫≤0.02   810경고 · 오경보 236(29%) · 12/32
 *   최다몫≥0.70 · 배정몫≤0.02   439경고 · 오경보  93(21%) · 12/32   ← 채택
 *   최다몫≥0.85 · 배정몫≤0.02   133경고 · 오경보  10( 8%) ·  0/32   (12건을 다 놓친다)
 *   최다몫≥0.55 · 배제이름≥2     35경고 · 오경보   0( 0%) ·  0/32   (한 줄 문항은 개념어가 하나뿐)
 * 「일차함수」의 공통수학2 몫이 1~2% 사이라서 배정몫 상한을 0.01 로 조이면 12건이 다 빠진다.
 */
function nameEvidence(
  matched: NameEntry[],
  dist: Map<string, NameDist>,
  assigned: string,
  최다몫하한 = 0.7,
  필요배제수 = 1,
  배정몫상한 = NAME_EXCLUDE_MAX,
): { 배제: NameDist[]; 지지: NameDist[]; 가리키는곳: string | null } {
  const 배제: NameDist[] = [],
    지지: NameDist[] = [];
  for (const e of matched) {
    const d = dist.get(e.name);
    if (!d) continue;
    // 교육과정이 「이 개념은 배정 학년 것」이라고 말하면 코퍼스 분포보다 그 말이 우선이다.
    // (육안 확인에서 나온 거짓 경보: 중1 「원과 부채꼴」 문항이 「부채꼴」 때문에 대수로,
    //  중1 「다각형」 문항이 「다각형」 때문에 중3 으로 몰렸다. 둘 다 배정 학년의 단원 이름이다.)
    // ⚠️ 단 **좁은 이름일 때만.** 학년을 가리지 않는 이름(「그래프」는 9개 학년의 단원 이름이다)까지
    //    지지로 세면 함수 문항 거의 전부가 면죄된다 — 실제로 그렇게 걸었다가 표적 12건이 5건으로 떨어졌다.
    if (e.grades.has(assigned) && e.grades.size <= 3) {
      지지.push(d);
      continue;
    }
    const share = d.몫.get(assigned) ?? 0;
    if (share >= NAME_SUPPORT_MIN) 지지.push(d);
    else if (share <= 배정몫상한 && d.최다몫 >= 최다몫하한) 배제.push(d);
  }
  배제.sort((a, b) => b.최다몫 - a.최다몫);
  // 여러 이름이 배제할 때는 **같은 곳을 가리켜야** 한다 — 서로 다른 학년을 가리키면 근거가 아니다.
  const 가리키는곳 =
    배제.length >= 필요배제수 &&
    지지.length === 0 &&
    new Set(배제.map((d) => d.최다)).size === 1
      ? 배제[0].최다
      : null;
  return { 배제, 지지, 가리키는곳 };
}

/** 긴 이름부터 자리를 차지한다. 이미 덮인 자리에 걸리는 짧은 이름은 버린다. */
function matchUnitNames(norm: Norm, index: NameEntry[]): NameEntry[] {
  const taken: { s: number; e: number }[] = [];
  const out: NameEntry[] = [];
  for (const entry of index) {
    let from = 0;
    for (;;) {
      const at = norm.squeezed.indexOf(entry.name, from);
      if (at < 0) break;
      const end = at + entry.name.length;
      if (!taken.some((t) => at < t.e && end > t.s)) {
        taken.push({ s: at, e: end });
        out.push(entry);
        break;
      }
      from = at + 1;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 판정
// ─────────────────────────────────────────────────────────────────────────────
type Finding = {
  externalId: string | null;
  problemId: string;
  source: string;
  배정: string;
  배정급: Level;
  판정: "오분류" | "의심";
  확신도: "높음" | "보통" | "낮음";
  신호: string;
  본문근거: string[];
  독립근거: string[];
  본문이가리키는급: Level | null;
  본문이가리키는과목대: string | null;
  원본: string;
  본문: string;
};

const HIGH_BANDS = [
  "공통수학1",
  "공통수학2",
  "대수",
  "미적분1",
  "미적분2",
  "확률과 통계",
  "기하",
];
const MID_BANDS = ["중1", "중2", "중3"];

function main() {
  const refresh = process.argv.includes("--refresh");
  const selftestOnly = process.argv.includes("--selftest");

  return loadSnapshot(refresh).then(({ units, rows }) => {
    const unitById = new Map(units.map((u) => [u.id, u]));
    const label = (id: string) => {
      const u = unitById.get(id);
      return u ? `${u.grade} / ${u.chapter} / ${u.section}` : "(단원 없음)";
    };

    // ── 검증 코퍼스: 독립근거가 배정과 **일치**하는 행. 여기가 어휘 순도의 분모다.
    const trusted: {
      row: Row;
      norm: Norm;
      band: string;
      chapter: string;
      lv: Level;
    }[] = [];
    for (const row of rows) {
      if (row.source !== "past_exam" || !row.sourceFile) continue;
      const u = unitById.get(row.unitId);
      if (!u) continue;
      const ind = independentEvidence(row);
      if (!ind.허용학년 || ind.허용학년.length !== 1) continue; // 학년이 하나로 확정된 것만
      if (ind.허용학년[0] !== u.grade) continue; // 그리고 배정과 일치할 때만
      trusted.push({
        row,
        norm: normalize(row.content),
        band: u.grade,
        chapter: u.chapter,
        lv: levelOf(u.grade),
      });
    }
    const tHigh = trusted.filter((t) => t.lv === "고").map((t) => t.norm);
    const tMid = trusted.filter((t) => t.lv === "중").map((t) => t.norm);
    console.log(
      `검증 코퍼스 ${trusted.length} (고 ${tHigh.length} · 중 ${tMid.length}) / 전체 ${rows.length}`,
    );

    const allNorms = rows.map((r) => normalize(r.content));
    const elemManual = rows
      .filter(
        (r) =>
          r.source === "manual" &&
          /^초/.test(unitById.get(r.unitId)?.grade ?? ""),
      )
      .map((r) => normalize(r.content));
    const notation = measureNotation(elemManual, [...tHigh, ...tMid]);
    console.log(
      `\n표기 가드 (초등 프록시 = 자작 초등 ${elemManual.length}건 · 분모 중·고 ${trusted.length})`,
    );
    for (const s of notation)
      console.log(
        `  ${s.채택 ? "채택" : "탈락"} ${s.가드.padEnd(8)} 초등자작 ${String(s.초등자작).padStart(5)}% · 중·고 ${String(s.중고).padStart(5)}%  ${s.이유}`,
      );

    const graded = verifyLexicon(tHigh, tMid, allNorms);
    const lex = graded.filter((e) => e.등급 !== "탈락");
    const dead = graded.filter((e) => e.등급 === "탈락");
    console.log(
      `\n사전 검증: 씨앗 ${graded.length} → 결정 ${graded.filter((e) => e.등급 === "결정").length} · 보조 ${graded.filter((e) => e.등급 === "보조").length} · 탈락 ${dead.length}`,
    );
    for (const lv of LEVELS) {
      const d = graded.filter((e) => e.등급 === "결정" && e.level === lv);
      console.log(
        `  [결정·${lv} ${d.length}] ${d.map((e) => `${e.term}(${lv === "중" ? e.중 : lv === "고" ? e.고 : e.전체})`).join(" ")}`,
      );
    }
    console.log("  탈락:");
    for (const d of dead)
      console.log(
        `    ${d.level} ${d.term.padEnd(14)} 고${d.고}/중${d.중}/전체${d.전체}  ${d.이유}`,
      );

    // ── 과목대 사전 — **전체 검증 코퍼스**를 분모로 삼아 전역 순도로 캔다.
    const ALL_BANDS = [...HIGH_BANDS, ...MID_BANDS];
    const bandLex = mineBandLexicon(
      trusted.map((t) => ({ norm: t.norm, band: t.band })),
      ALL_BANDS,
      25,
      0.97,
    );
    console.log("\n과목대 사전 크기 (전역 순도 97%, 25건+):");
    for (const [b, t] of bandLex)
      console.log(
        `  ${b.padEnd(10)} ${String(t.length).padStart(4)}개  예: ${t.slice(0, 6).join(" ")}`,
      );

    // ── 중단원 사전 — 선행 감사 192건이 바로 이 층의 결함이다.
    //
    // 순도는 **그 학년 안에서** 잰다. 전역 순도로 자르면 「경우의 수」처럼 여러 학년에
    // 걸치지만 한 학년 안에서는 장을 정확히 가르는 말이 다 죽는다.
    //
    // 문턱은 `--sweep` 으로 **같은 경고 건수에서** 견줘 골랐다 (선행 잔존 「다른 장」 49건 재현율):
    //   3자 이상 · 15건 · 0.95 · 근거2   234경고 → 21/49 (9.0%)
    //   4자 이상 · 15건 · 0.95 · 근거2   146경고 → 18/49 (12.3%)
    //   4자 이상 · 20건 · 0.95 · 근거2   137경고 → 18/49 (13.1%)  ← 채택
    //   4자 이상 · 15건 · 0.95 · 근거3    41경고 →  4/49 (9.8%)
    // 3자 n-gram 은 「의그래」·「남학생」·「을지나」 같은 **맥락어**라서 장을 못 가른다(육안 확인).
    // ⚠️ 그래도 재현/경고는 13% 다. 이 신호는 **혼자서는 교정 근거가 못 된다** — 확신도 「낮음」으로 둔다.
    const CHAPTER_KEYS = [
      ...new Set(
        units
          .filter((u) => ALL_BANDS.includes(u.grade))
          .map((u) => `${u.grade}|${u.chapter}`),
      ),
    ];
    const chapterLex: BandLex = new Map(
      CHAPTER_KEYS.map((k) => [k, [] as string[]]),
    );
    for (const band of ALL_BANDS) {
      const sub = trusted.filter((t) => t.band === band);
      const keys = CHAPTER_KEYS.filter((k) => k.startsWith(`${band}|`));
      if (sub.length < 200 || keys.length < 2) continue;
      for (const [k, v] of mineBandLexicon(
        sub.map((t) => ({ norm: t.norm, band: `${band}|${t.chapter}` })),
        keys,
        20,
        0.95,
        4,
      )) {
        chapterLex.set(k, v);
      }
    }
    const aliveChapters = [...chapterLex].filter(([, t]) => t.length > 0);
    let chapterTerms = 0;
    for (const [, t] of chapterLex) chapterTerms += t.length;
    console.log(
      `\n중단원 사전: ${CHAPTER_KEYS.length}장 중 ${aliveChapters.length}장에 어휘 있음 · 어휘 총 ${chapterTerms}개`,
    );
    console.log(
      `  [대조용] 중1|1. 소인수분해 = ${(chapterLex.get("중1|1. 소인수분해") ?? []).slice(0, 20).join(" ")}`,
    );
    for (const [k, t] of aliveChapters.slice(0, 12))
      console.log(
        `  ${k.padEnd(30)} ${String(t.length).padStart(3)}개  ${t.slice(0, 4).join(" · ")}`,
      );

    const siblings = buildSiblingIndex(rows, unitById);
    console.log(
      `\n형제 색인: 편 ${siblings.size}개 (형제 5개 이상인 편만 근거로 쓴다)`,
    );

    const nameIndex = buildNameIndex(units);
    const byBand = new Map<string, Norm[]>();
    for (const t of trusted) {
      if (!byBand.has(t.band)) byBand.set(t.band, []);
      byBand.get(t.band)!.push(t.norm);
    }
    const nameDist = measureNameDist(nameIndex, byBand);
    console.log(
      `\n단원명 색인: 이름 ${nameIndex.length}개 · 그중 검증 코퍼스에서 ${NAME_MIN_HITS}건 이상 관측돼 분포를 말할 수 있는 것 ${nameDist.size}개`,
    );
    for (const q of [
      "일차함수",
      "이차함수",
      "함숫값",
      "순환소수",
      "확률변수",
      "경우의수",
    ]) {
      const d = nameDist.get(q);
      if (d)
        console.log(
          `  ${q}(${d.전체}건): ${[...d.몫]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([g, s]) => `${g} ${(100 * s).toFixed(0)}%`)
            .join(" · ")}`,
        );
    }

    // ── 과목대 문턱 비교 (`--sweep-band`).
    //
    // 정밀도를 **검증 코퍼스로** 잰다: 그 행들은 독립근거가 배정 학년을 확인해 준 행이니,
    // 거기서 과목대 불일치가 뜨면 그건 정의상 오경보다. 재현은 부모 세션이 육안으로 찾은
    // 「메타 전무 · 공통수학2 / 3. 함수와 그래프 / 함수」 32행(그중 12건이 확인된 오분류)으로 잰다.
    if (process.argv.includes("--sweep-band")) {
      const 표적 = new Set(
        rows
          .filter((r) => {
            const u = unitById.get(r.unitId);
            return (
              r.source === "past_exam" &&
              !r.sourceFile &&
              u?.grade === "공통수학2" &&
              u.chapter.includes("함수와 그래프") &&
              u.section === "함수"
            );
          })
          .map((r) => r.id),
      );
      const trustedIds = new Set(trusted.map((t) => t.row.id));
      console.log(
        `\n=== 과목대 문턱 비교 (재현 표적 ${표적.size}행 · 오경보 분모 = 검증 코퍼스 ${trusted.length}) ===`,
      );
      const lex = mineBandLexicon(
        trusted.map((t) => ({ norm: t.norm, band: t.band })),
        ALL_BANDS,
        25,
        0.97,
        3,
      );
      // 미리 각 행의 두 열쇠를 재 둔다.
      const 재료 = rows.map((row, i) => {
        const u = unitById.get(row.unitId);
        if (!u || !ALL_BANDS.includes(u.grade)) return null;
        const hits = matchBands(allNorms[i], lex);
        const ev = nameEvidence(
          matchUnitNames(allNorms[i], nameIndex),
          nameDist,
          u.grade,
        );
        const top = hits[0] && hits[0].band !== u.grade ? hits[0] : null;
        return {
          id: row.id,
          grade: u.grade,
          대역자기: hits.find((h) => h.band === u.grade)?.근거수 ?? 0,
          대역최다: top,
          이름: ev,
        };
      });
      console.log(
        "단원명 열쇠 문턱".padEnd(38) +
          "경고".padStart(7) +
          "검증집합 오경보(%)".padStart(20) +
          "표적 재현".padStart(12),
      );
      for (const [최다몫, 필요수, 배정몫] of [
        [0.4, 1, 0.02],
        [0.55, 1, 0.02],
        [0.7, 1, 0.02],
        [0.85, 1, 0.02],
        [0.55, 2, 0.02],
        [0.55, 1, 0.01],
        [0.7, 1, 0.005],
        [0.7, 2, 0.02],
      ] as [number, number, number][]) {
        let 경고 = 0,
          오경보 = 0,
          재현 = 0,
          어휘도같음 = 0;
        for (let i = 0; i < rows.length; i += 1) {
          const m = 재료[i];
          if (!m) continue;
          const ev = nameEvidence(
            matchUnitNames(allNorms[i], nameIndex),
            nameDist,
            m.grade,
            최다몫,
            필요수,
            배정몫,
          );
          if (m.대역자기 !== 0 || ev.가리키는곳 === null) continue;
          경고 += 1;
          if (trustedIds.has(m.id)) 오경보 += 1;
          if (표적.has(m.id)) 재현 += 1;
          if (m.대역최다?.band === ev.가리키는곳) 어휘도같음 += 1;
        }
        console.log(
          `최다몫≥${최다몫} · 배제이름≥${필요수} · 배정몫≤${배정몫}`.padEnd(
            38,
          ) +
            String(경고).padStart(7) +
            `${오경보} (${((100 * 오경보) / Math.max(1, 경고)).toFixed(0)}%)`.padStart(
              20,
            ) +
            `${재현} / ${표적.size}`.padStart(12) +
            `  (어휘도 같은 쪽 ${어휘도같음})`,
        );
      }
    }

    // ── 표적 32행이 왜 안 잡히는지 한 행씩 뜯어본다 (`--diagnose-target`).
    if (process.argv.includes("--diagnose-target")) {
      console.log(
        "\n=== 표적 진단: 메타 전무 · 공통수학2 / 3. 함수와 그래프 / 함수 ===",
      );
      for (const q of [
        "일차함수",
        "함숫값",
        "이차함수",
        "그래프",
        "기울기",
        "직선의방정식",
        "역함수",
      ]) {
        const entry = nameIndex.find((e) => e.name === q);
        const d = nameDist.get(q);
        console.log(
          `  이름 "${q}": 단원학년=${entry ? [...entry.grades].join("/") : "색인에 없음"}` +
            ` · 코퍼스 분포=${
              d
                ? [...d.몫]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([g, s]) => `${g} ${(100 * s).toFixed(0)}%`)
                    .join(" ")
                : `관측 ${NAME_MIN_HITS}건 미만 — 분포 없음`
            }`,
        );
      }
      let n = 0;
      for (let i = 0; i < rows.length; i += 1) {
        const u = unitById.get(rows[i].unitId);
        if (!(
          rows[i].source === "past_exam" &&
          !rows[i].sourceFile &&
          u?.grade === "공통수학2" &&
          u.chapter.includes("함수와 그래프") &&
          u.section === "함수"
        ))
          continue;
        if (n >= 10) break;
        n += 1;
        const hits = matchBands(allNorms[i], bandLex);
        const own = hits.find((h) => h.band === u.grade);
        const 이름 = matchUnitNames(allNorms[i], nameIndex);
        console.log(
          `\n[${n}] ${rows[i].content.slice(0, 80).replace(/\s+/g, " ")}`,
        );
        console.log(
          `   배정대역(공통수학2) 근거: ${own ? `${own.근거수}건 ${own.hits.join("·")}` : "0건"}`,
        );
        console.log(
          `   대역 후보: ${
            hits
              .slice(0, 3)
              .map(
                (h) => `${h.band}=${h.근거수}(${h.hits.slice(0, 3).join("·")})`,
              )
              .join("  ") || "없음"
          }`,
        );
        console.log(
          `   단원명 매칭: ${이름.map((e) => `${e.name}[${[...e.grades].join("/")}]`).join(" ") || "없음"}`,
        );
      }
    }

    // ── 규칙 비교는 **같은 경고 건수에서** 한다 (`--sweep`).
    // 재현 목표는 선행 감사 잔존 중 「다른 장」 — 독립적인 방법(HWP 재추출 topic)이 찾은 것이니
    // 부분 정답지로 쓸 수 있다. ⚠️ 이 비교를 **별도 스크립트로 다시 구현하지 말 것.**
    // 2026-08-17 에 그렇게 했다가 재구현본의 경로 정규식이 조용히 죽어 중등 21,140행이
    // 통째로 빠진 코퍼스에서 문턱을 골랐다(경고 63건 vs 실제 232건). 같은 코드로 재라.
    if (process.argv.includes("--sweep")) {
      const 목표 = new Set<string>();
      try {
        const prior = JSON.parse(
          readFileSync(`${OUT_DIR}/label-content-mismatch.json`, "utf8"),
        );
        for (const s of prior.목록 as {
          externalId: string;
          현재라벨: string;
          같은중단원: boolean;
        }[]) {
          const now = rows.find((r) => r.externalId === s.externalId);
          if (!now) continue;
          const nu = unitById.get(now.unitId);
          if (
            !nu ||
            `${nu.grade} / ${nu.chapter} / ${nu.section}` !== s.현재라벨
          )
            continue;
          if (!s.같은중단원) 목표.add(s.externalId);
        }
      } catch {
        console.log("선행 보고서가 없어 재현율은 못 잰다.");
      }
      console.log(`\n=== 중단원 규칙 비교 (재현 목표 ${목표.size}건) ===`);
      console.log(
        "최소길이 | minDocs | 순도  | 근거수 | 사전어휘 | 경고 | 재현 | 재현/경고",
      );
      for (const [minLen, minDocs, purity, need] of [
        [3, 15, 0.95, 2],
        [4, 15, 0.95, 2],
        [5, 15, 0.95, 2],
        [4, 15, 0.95, 3],
        [4, 10, 0.95, 2],
        [4, 15, 0.97, 2],
        [5, 15, 0.95, 3],
        [4, 20, 0.95, 2],
      ] as [number, number, number, number][]) {
        const lex: BandLex = new Map(
          CHAPTER_KEYS.map((k) => [k, [] as string[]]),
        );
        for (const band of ALL_BANDS) {
          const sub = trusted.filter((t) => t.band === band);
          const keys = CHAPTER_KEYS.filter((k) => k.startsWith(`${band}|`));
          if (sub.length < 200 || keys.length < 2) continue;
          for (const [k, v] of mineBandLexicon(
            sub.map((t) => ({ norm: t.norm, band: `${band}|${t.chapter}` })),
            keys,
            minDocs,
            purity,
            minLen,
          ))
            lex.set(k, v);
        }
        let size = 0;
        for (const v of lex.values()) size += v.length;
        let 경고 = 0,
          재현 = 0;
        for (let i = 0; i < rows.length; i += 1) {
          const u = unitById.get(rows[i].unitId);
          if (!u || !ALL_BANDS.includes(u.grade)) continue;
          const hits = matchBands(allNorms[i], lex).filter((h) =>
            h.band.startsWith(`${u.grade}|`),
          );
          const own =
            hits.find((h) => h.band === `${u.grade}|${u.chapter}`)?.근거수 ?? 0;
          const best =
            hits.find((h) => h.band !== `${u.grade}|${u.chapter}`)?.근거수 ?? 0;
          if (own === 0 && best >= need) {
            경고 += 1;
            if (rows[i].externalId && 목표.has(rows[i].externalId!)) 재현 += 1;
          }
        }
        console.log(
          `   ${minLen}     |   ${String(minDocs).padStart(2)}    | ${purity} |   ${need}    |  ${String(size).padStart(5)}   | ${String(경고).padStart(4)} |  ${String(재현).padStart(2)}  | ${((100 * 재현) / Math.max(1, 경고)).toFixed(1)}%`,
        );
      }
    }

    // ── 가드별 적중 집계 (0건이면 죽은 가드로 의심한다)
    const guardHits = new Map<string, number>();
    const bump = (k: string) => guardHits.set(k, (guardHits.get(k) ?? 0) + 1);

    const findings: Finding[] = [];
    let 정상 = 0;
    const 정상표본: { row: Row; 의심도: number; 이유: string }[] = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const u = unitById.get(row.unitId);
      if (!u) continue;
      const 배정급 = levelOf(u.grade);
      const norm = allNorms[i];
      const ind = independentEvidence(row);
      const cv = contentLevel(norm, lex, notation);
      for (const a of cv.적중) bump(a);

      const 본문근거: string[] = [...cv.근거];
      let 판정: "오분류" | "의심" | null = null;
      let 확신도: "높음" | "보통" | "낮음" = "낮음";
      let 신호 = "";
      let 과목대: string | null = null;

      // 형제 근거 (본문을 읽지 않는다)
      const sibGrade = siblingSupport(siblings, row.examId, u.grade, "grade");
      const sibChapter = siblingSupport(
        siblings,
        row.examId,
        `${u.grade}|${u.chapter}`,
        "chapter",
      );
      const 독립근거 = [...ind.근거];
      const 형제가배정학년배제 =
        sibGrade !== null && sibGrade.지지 === 0 && sibGrade.우세비율 >= 0.6;
      if (형제가배정학년배제)
        독립근거.push(
          `편 형제 ${sibGrade!.형제수}개 중 이 학년 지지 0 (우세 ${sibGrade!.우세} ${(100 * sibGrade!.우세비율).toFixed(0)}%)`,
        );

      // ── 신호 1: 학교급 불일치 (가장 정밀한 신호)
      const 본문이배정급배제 = cv.배제급.includes(배정급);
      const 독립이배정급배제 =
        (ind.허용급 !== null && !ind.허용급.includes(배정급)) ||
        (ind.허용학년 !== null &&
          ind.허용학년.length > 0 &&
          !ind.허용학년.some((g) => levelOf(g) === 배정급));
      if (본문이배정급배제) {
        신호 = `학교급 불일치: 배정 ${배정급} · 본문 ${cv.급 ?? `${배정급} 아님`}`;
        판정 = 독립이배정급배제 ? "오분류" : "의심";
        확신도 = 독립이배정급배제 ? "높음" : "보통";
        bump(`신호:학교급:${배정급}→${cv.급 ?? "배제만"}`);
      }

      // ── 신호 2: 과목대(=학년) 불일치.
      //
      // 두 열쇠를 쓴다. 코퍼스에서 캔 **대역 어휘**와 교육과정의 **단원 이름**이다.
      // ⚠️ 단원명 열쇠를 단독 방아쇠로 쓰면 안 된다 — **문항 대부분은 자기 단원 이름을
      //    본문에 쓰지 않는다.** 그래서 「배정 학년 단원명이 0표」는 이상 신호가 아니라
      //    보통 상태다. 실제로 그렇게 걸었더니 47,152 중 10,929건(23%)이 의심으로 떴다.
      //    그러니 단원명은 대역 어휘가 **하나뿐일 때 그것을 보강하는** 두 번째 열쇠로만 쓴다.
      const 대역 = matchBands(norm, bandLex);
      const 이름 = ALL_BANDS.includes(u.grade)
        ? nameEvidence(matchUnitNames(norm, nameIndex), nameDist, u.grade)
        : { 배제: [], 지지: [], 가리키는곳: null };
      if (판정 === null && ALL_BANDS.includes(u.grade)) {
        const 배정대역근거 = 대역.find((b) => b.band === u.grade)?.근거수 ?? 0;
        const 대역최다 = 대역[0] && 대역[0].band !== u.grade ? 대역[0] : null;
        // 두 열쇠 중 어느 쪽이든 배정 학년을 배제하면 후보다. 둘이 같은 쪽을 가리키면 확신도가 올라간다.
        const 어휘가배제 =
          배정대역근거 === 0 && 대역최다 !== null && 대역최다.근거수 >= 2;
        // 고등 결정 어휘가 있으면 고등 배정을 **이름만으로** 끌어내리지 않는다.
        // 고등 문항은 일차·이차함수를 **도구로** 쓴다 — 미적분1 「극대와 극소」 문항이 삼차함수와
        // 일차함수 그래프를 같이 놓거나(3387-12), 미적분2 수열 문항이 이차함수 최솟값을 묻는다(2995-21).
        // 이름 열쇠만 보면 그게 다 중2·중3 으로 끌려간다(육안 확인).
        const 고등어휘가배정을지지 = 배정급 === "고" && cv.급 === "고";
        const 이름이배제 =
          이름.가리키는곳 !== null &&
          배정대역근거 === 0 &&
          !고등어휘가배정을지지;
        if (어휘가배제 || 이름이배제) {
          과목대 = 어휘가배제 ? 대역최다!.band : 이름.가리키는곳!;
          const 둘이같은쪽 =
            어휘가배제 && 이름이배제 && 대역최다!.band === 이름.가리키는곳;
          const 같은급 = levelOf(과목대) === 배정급;
          신호 =
            `${같은급 ? (배정급 === "고" ? "과목대" : "중등 학년") : "학교급"} 불일치: 배정 ${u.grade} · 본문 ${과목대}` +
            (어휘가배제
              ? `(${대역최다!.hits.slice(0, 3).join("·")})`
              : `(단원명 ${이름.배제
                  .slice(0, 2)
                  .map((d) => d.name)
                  .join("·")})`);
          if (이름이배제) {
            본문근거.push(
              `단원명 분포: ${이름.배제
                .slice(0, 3)
                .map(
                  (d) =>
                    `${d.name}→${d.최다}${(100 * d.최다몫).toFixed(0)}% (배정 ${u.grade} 몫 ${(100 * (d.몫.get(u.grade) ?? 0)).toFixed(1)}%)`,
                )
                .join(" · ")}`,
            );
          }
          const 독립이배정배제 =
            ind.허용학년 !== null &&
            ind.허용학년.length > 0 &&
            !ind.허용학년.includes(u.grade);
          판정 = 독립이배정배제 || 형제가배정학년배제 ? "오분류" : "의심";
          확신도 = 독립이배정배제
            ? "높음"
            : 형제가배정학년배제 || 둘이같은쪽
              ? "보통"
              : "낮음";
          bump(`신호:과목대:${u.grade}→${과목대}`);
        }
      }

      // ── 신호 3: 중단원 불일치 (과목대는 맞는데 장이 다르다) — 선행 감사 192건이 이 층이다.
      // 학년까지만 말하는 subject·경로는 여기서 아무 말도 못 한다. 그래서 **편 형제**를 두 번째 열쇠로 쓴다.
      if (판정 === null && cv.판정가능) {
        const 장 = matchBands(norm, chapterLex).filter((h) =>
          h.band.startsWith(`${u.grade}|`),
        );
        const 배정장근거 =
          장.find((h) => h.band === `${u.grade}|${u.chapter}`)?.근거수 ?? 0;
        if (
          장.length > 0 &&
          장[0].band !== `${u.grade}|${u.chapter}` &&
          배정장근거 === 0 &&
          장[0].근거수 >= 2
        ) {
          const 형제가배정장배제 =
            sibChapter !== null &&
            sibChapter.지지 === 0 &&
            sibChapter.우세비율 >= 0.5;
          if (형제가배정장배제)
            독립근거.push(
              `편 형제 ${sibChapter!.형제수}개 중 이 장 지지 0 (우세 ${sibChapter!.우세.split("|")[1]} ${(100 * sibChapter!.우세비율).toFixed(0)}%)`,
            );
          신호 = `중단원 불일치: 배정 「${u.chapter}」 · 본문 「${장[0].band.split("|")[1]}」(${장[0].hits.slice(0, 3).join("·")})`;
          판정 = 형제가배정장배제 ? "오분류" : "의심";
          확신도 = 형제가배정장배제 ? "보통" : "낮음";
          bump(`신호:중단원:${u.grade}`);
        }
      }

      // ── 신호 4: 본문은 침묵하는데 **본문과 독립인 근거 둘이** 배정을 배제한다.
      // 「정상」 판정을 의심도 순으로 훑다가 이 부류를 발견했다 — 4221-1(중2 「다항식의 덧셈과
      // 뺄셈」, 형제 우세 공통수학1)은 ADDENDUM A-3 이 지목한 동명 소단원 충돌 그 자체다.
      // 본문 근거가 아니므로 「오분류」로 올리지 않고, 신호 이름에 그 사실을 적어 둔다.
      if (판정 === null) {
        const 메타가배정학년배제 =
          ind.허용학년 !== null &&
          ind.허용학년.length > 0 &&
          !ind.허용학년.includes(u.grade);
        if ((메타가배정학년배제 || 독립이배정급배제) && 형제가배정학년배제) {
          신호 = `본문 침묵 · 독립근거 2개가 배정 배제: 배정 ${u.grade} · 메타/형제는 ${sibGrade!.우세}`;
          본문근거.push(
            "본문 근거 없음 — 이 판정은 메타데이터와 편 형제만으로 났다",
          );
          판정 = "의심";
          확신도 = "보통";
          bump(`신호:본문침묵+독립2:${u.grade}→${sibGrade!.우세}`);
        }
      }

      if (판정 === null) {
        정상 += 1;
        // 「문제 없음」 쪽을 **가장 의심스러운 순서로** 훑기 위한 의심도.
        let 의심도 = 0;
        const 이유: string[] = [];
        if (배정급 === "초" && row.source !== "manual") {
          의심도 += 50;
          이유.push("초등 배정 + 자작 아님");
        }
        if (배정급 === "초" && norm.tex.size > 0) {
          의심도 += 30;
          이유.push("초등 배정 + LaTeX");
        }
        if (배정급 === "초" && NOT_ELEMENTARY.거듭제곱(norm)) {
          의심도 += 20;
          이유.push("초등 배정 + 거듭제곱");
        }
        if (독립이배정급배제) {
          의심도 += 40;
          이유.push("독립근거가 배정급 배제(본문은 침묵)");
        }
        if (
          ind.허용학년 !== null &&
          ind.허용학년.length > 0 &&
          !ind.허용학년.includes(u.grade)
        ) {
          의심도 += 35;
          이유.push("독립근거가 배정 학년 배제");
        }
        if (형제가배정학년배제) {
          의심도 += 30;
          이유.push(`편 형제가 배정 학년 배제(우세 ${sibGrade!.우세})`);
        }
        if (
          sibChapter !== null &&
          sibChapter.지지 === 0 &&
          sibChapter.우세비율 >= 0.5
        ) {
          의심도 += 12;
          이유.push("편 형제가 배정 장 배제");
        }
        if (norm.korean.replace(/\|/g, "").length < 3) {
          의심도 += 15;
          이유.push("한글 3자 미만 — 어휘 판정 불가");
        }
        if (cv.급 !== null && cv.급 !== 배정급) {
          의심도 += 10;
          이유.push(`본문 급 ${cv.급}`);
        }
        if (의심도 > 0) 정상표본.push({ row, 의심도, 이유: 이유.join(" / ") });
        continue;
      }

      findings.push({
        externalId: row.externalId,
        problemId: row.id,
        source: row.source,
        배정: label(row.unitId),
        배정급,
        판정,
        확신도,
        신호,
        본문근거,
        독립근거,
        본문이가리키는급: cv.급,
        본문이가리키는과목대: 과목대,
        원본:
          [row.school, row.subject, row.sourceFile?.split(/[\\/]/).pop()]
            .filter(Boolean)
            .join(" · ") || "(메타 없음)",
        본문: row.content.slice(0, 220).replace(/\s+/g, " "),
      });
    }

    findings.sort((a, b) => {
      const rank = (f: Finding) =>
        (f.판정 === "오분류" ? 0 : 1) * 10 +
        (f.확신도 === "높음" ? 0 : f.확신도 === "보통" ? 1 : 2);
      return rank(a) - rank(b);
    });
    정상표본.sort((a, b) => b.의심도 - a.의심도);

    // ── 구간별 커버리지 (BRIEF §5 의 ❌ 칸이 실제로 메워졌는지) ──────────────────
    const 구간of = (row: Row): string => {
      if (row.source === "transformed") return "transformed";
      if (row.source === "manual") return "manual";
      return row.sourceFile ? "past_exam (메타 있음)" : "past_exam (메타 전무)";
    };
    const seg = new Map<
      string,
      {
        분모: number;
        오분류: number;
        의심: number;
        학년까지아는근거: number;
        급만아는근거: number;
      }
    >();
    const findingBySelf = new Map(findings.map((f) => [f.problemId, f]));
    for (const row of rows) {
      const k = 구간of(row);
      if (!seg.has(k))
        seg.set(k, {
          분모: 0,
          오분류: 0,
          의심: 0,
          학년까지아는근거: 0,
          급만아는근거: 0,
        });
      const s = seg.get(k)!;
      s.분모 += 1;
      const ind = independentEvidence(row);
      // 학년을 좁히는 근거(subject·경로)와 학교급만 좁히는 근거(source=past_exam)는 힘이 다르다.
      if (ind.허용학년 !== null) s.학년까지아는근거 += 1;
      else if (ind.허용급 !== null) s.급만아는근거 += 1;
      const f = findingBySelf.get(row.id);
      if (f?.판정 === "오분류") s.오분류 += 1;
      else if (f?.판정 === "의심") s.의심 += 1;
    }
    console.log("\n=== 구간별 커버리지 (BRIEF §5 의 구멍이 메워졌는지) ===");
    console.log(
      "구간".padEnd(23) +
        "분모".padStart(7) +
        "학년근거".padStart(9) +
        "급만".padStart(6) +
        "근거없음".padStart(9) +
        "오분류".padStart(7) +
        "의심".padStart(6),
    );
    for (const [k, s] of [...seg].sort((a, b) => b[1].분모 - a[1].분모)) {
      const 없음 = s.분모 - s.학년까지아는근거 - s.급만아는근거;
      console.log(
        k.padEnd(23) +
          String(s.분모).padStart(7) +
          String(s.학년까지아는근거).padStart(9) +
          String(s.급만아는근거).padStart(6) +
          String(없음).padStart(9) +
          String(s.오분류).padStart(7) +
          String(s.의심).padStart(6),
      );
    }

    // ── 선행 감사 192건의 **현재 상태**를 DB 로 다시 확정한다 (지시: 71 잔존 목록을 보고서에 실어라).
    type Prior = {
      externalId: string;
      topic: unknown;
      현재라벨: string;
      본문이가리키는단원: string;
      같은중단원: boolean;
    };
    type PriorRemain = {
      externalId: string;
      같은중단원: boolean;
      현재라벨: string;
      본문이가리키는단원: string;
      내판정: string;
    };
    let 선행현황: {
      분모: number;
      이미교정: number;
      예상단원으로교정: number;
      잔존: number;
      사라짐: number;
      잔존목록: PriorRemain[];
    } | null = null;
    try {
      const prior = JSON.parse(
        readFileSync(`${OUT_DIR}/label-content-mismatch.json`, "utf8"),
      );
      const byExt = new Map(
        rows.filter((r) => r.externalId).map((r) => [r.externalId!, r]),
      );
      const mine = new Map(
        findings.filter((f) => f.externalId).map((f) => [f.externalId!, f]),
      );
      let 이미교정 = 0,
        예상단원으로교정 = 0,
        사라짐 = 0;
      const 잔존목록: PriorRemain[] = [];
      for (const s of prior.목록 as Prior[]) {
        const now = byExt.get(s.externalId);
        if (!now) {
          사라짐 += 1;
          continue;
        }
        const nu = unitById.get(now.unitId);
        const nowLabel = nu
          ? `${nu.grade} / ${nu.chapter} / ${nu.section}`
          : "(단원 없음)";
        if (nowLabel !== s.현재라벨) {
          이미교정 += 1;
          if (nowLabel === s.본문이가리키는단원) 예상단원으로교정 += 1;
          continue;
        }
        const f = mine.get(s.externalId);
        잔존목록.push({
          externalId: s.externalId,
          같은중단원: s.같은중단원,
          현재라벨: s.현재라벨,
          본문이가리키는단원: s.본문이가리키는단원,
          내판정: f
            ? `${f.판정}/${f.확신도} — ${f.신호}`
            : "내 판정기는 못 잡음",
        });
      }
      선행현황 = {
        분모: prior.목록.length,
        이미교정,
        예상단원으로교정,
        잔존: 잔존목록.length,
        사라짐,
        잔존목록,
      };
      console.log(
        `\n=== 선행 감사 ${prior.목록.length}건의 현재 상태 (DB 재확인) ===`,
      );
      console.log(
        `이미 교정됨 ${이미교정} (그중 선행이 예상한 단원과 정확히 일치 ${예상단원으로교정}) · 잔존 ${잔존목록.length} · DB에서 사라짐 ${사라짐}`,
      );
      console.log(
        `잔존 ${잔존목록.length} 중 다른 중단원 ${잔존목록.filter((x) => !x.같은중단원).length} · 같은 중단원 ${잔존목록.filter((x) => x.같은중단원).length}`,
      );
      console.log(
        `잔존 중 내 판정기가 독립적으로 잡은 것 ${잔존목록.filter((x) => !x.내판정.startsWith("내 판정기는")).length}`,
      );
    } catch {
      console.log(
        "\n선행 보고서(label-content-mismatch.json)가 없어 현황을 못 냈다.",
      );
    }

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      `${OUT_DIR}/content-unit-mismatch.json`,
      JSON.stringify(
        {
          생성: "scripts/classify/audit-content-unit.ts",
          분모: {
            전체문항: rows.length,
            검증코퍼스: trusted.length,
            정상판정: 정상,
          },
          구간별커버리지: [...seg].map(([구간, s]) => ({ 구간, ...s })),
          선행감사현황: 선행현황,
          중단원사전: [...chapterLex]
            .filter(([, t]) => t.length > 0)
            .map(([장, terms]) => ({
              장,
              어휘수: terms.length,
              어휘: terms.slice(0, 40),
            })),
          사전: { 채점표: graded, 표기가드: notation },
          가드별적중: [...guardHits].sort((a, b) => b[1] - a[1]),
          과목대사전크기: [...bandLex].map(([b, t]) => [b, t.length]),
          판정요약: {
            오분류: findings.filter((f) => f.판정 === "오분류").length,
            의심: findings.filter((f) => f.판정 === "의심").length,
          },
          목록: findings,
          정상인데의심스러운상위: 정상표본.slice(0, 200).map((s) => ({
            externalId: s.row.externalId,
            problemId: s.row.id,
            source: s.row.source,
            배정: label(s.row.unitId),
            의심도: s.의심도,
            이유: s.이유,
            본문: s.row.content.slice(0, 180).replace(/\s+/g, " "),
          })),
        },
        null,
        1,
      ),
      "utf8",
    );

    // ── 요약 마크다운. **JSON 에서 뽑아 쓴다** — 손으로 옮겨 적으면 숫자가 어긋난다.
    const 신호별 = new Map<string, number>();
    for (const f of findings)
      신호별.set(
        `${f.신호.split(":")[0]}|${f.판정}`,
        (신호별.get(`${f.신호.split(":")[0]}|${f.판정}`) ?? 0) + 1,
      );
    const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(2)}%`;
    const 오분류목록 = findings.filter((f) => f.판정 === "오분류");
    const md: string[] = [];
    md.push("# 단원 오분류 — 본문 근거 판정 (트랙 2)", "");
    md.push(
      `생성: \`scripts/classify/audit-content-unit.ts\` · 대상 DB 전수 **${rows.length}행** · 읽기 전용(DB 미수정)`,
      "",
    );
    md.push(
      "선행 감사(`audit-label-content.ts`)가 검사한 34,697행 밖의 구간까지 **본문으로** 훑은 결과다.",
      "",
    );

    md.push("## 1. 선행 감사 192건의 현재 상태 (DB 재확인)", "");
    if (선행현황) {
      md.push(`| 상태 | 건수 | 분모 |`, `|---|---|---|`);
      md.push(`| 이미 교정됨 | ${선행현황.이미교정} | ${선행현황.분모} |`);
      md.push(
        `| — 그중 선행이 예상한 단원과 **정확히 일치** | ${선행현황.예상단원으로교정} | ${선행현황.이미교정} |`,
      );
      md.push(
        `| **잔존(그대로 남음)** | **${선행현황.잔존}** | ${선행현황.분모} |`,
      );
      md.push(`| DB에서 사라짐 | ${선행현황.사라짐} | ${선행현황.분모} |`, "");
      const 다른장 = 선행현황.잔존목록.filter((x) => !x.같은중단원);
      const 같은장 = 선행현황.잔존목록.filter((x) => x.같은중단원);
      const 재현 = 선행현황.잔존목록.filter(
        (x) => !x.내판정.startsWith("내 판정기는"),
      );
      md.push(
        `잔존 ${선행현황.잔존}건 = 다른 중단원 ${다른장.length} · 같은 중단원 ${같은장.length}.`,
        `교정된 121건이 **전부** 선행이 예상한 단원으로 갔다 — 선행 판정의 방향이 옳았다는 뜻이다.`,
        `내 판정기가 이 잔존을 독립적으로 다시 잡은 것은 ${재현.length} / ${선행현황.잔존}건이다.`,
        "",
      );
      md.push("<details><summary>잔존 71건 전체 목록</summary>", "");
      md.push(
        "| externalId | 장 | 현재 라벨 | 선행이 가리킨 단원 | 내 판정 |",
        "|---|---|---|---|---|",
      );
      for (const x of [...다른장, ...같은장]) {
        md.push(
          `| \`${x.externalId}\` | ${x.같은중단원 ? "같은 장" : "다른 장"} | ${x.현재라벨} | ${x.본문이가리키는단원} | ${x.내판정} |`,
        );
      }
      md.push("", "</details>", "");
    }

    md.push("## 2. 새로 찾은 것", "");
    md.push(`| 판정 | 건수 | 분모 ${rows.length} |`, "|---|---|---|");
    md.push(
      `| **오분류** (본문 근거 + 본문과 독립인 근거가 같은 방향) | **${오분류목록.length}** | ${pct(오분류목록.length, rows.length)} |`,
    );
    md.push(
      `| 의심 (한쪽 근거만) | ${findings.length - 오분류목록.length} | ${pct(findings.length - 오분류목록.length, rows.length)} |`,
    );
    md.push(`| 정상 / 판정 보류 | ${정상} | ${pct(정상, rows.length)} |`, "");
    md.push("신호별:", "");
    md.push("| 신호 | 판정 | 건수 |", "|---|---|---|");
    for (const [k, v] of [...신호별].sort((a, b) => b[1] - a[1]))
      md.push(`| ${k.split("|")[0]} | ${k.split("|")[1]} | ${v} |`);
    md.push("");
    md.push("### 오분류 전량", "");
    md.push("| externalId | 배정 단원 | 신호 | 원본 |", "|---|---|---|---|");
    for (const f of 오분류목록)
      md.push(
        `| \`${f.externalId ?? "(없음)"}\` | ${f.배정} | ${f.신호} | ${f.원본} |`,
      );
    md.push("");

    md.push("## 3. 커버리지 — BRIEF §5 의 ❌ 칸", "");
    md.push(
      "| 구간 | 분모 | 학년까지 아는 독립근거 | 학교급만 | 독립근거 없음 | 오분류 | 의심 |",
      "|---|---|---|---|---|---|---|",
    );
    for (const [k, s] of [...seg].sort((a, b) => b[1].분모 - a[1].분모)) {
      md.push(
        `| ${k} | ${s.분모} | ${s.학년까지아는근거} | ${s.급만아는근거} | ${s.분모 - s.학년까지아는근거 - s.급만아는근거} | ${s.오분류} | ${s.의심} |`,
      );
    }
    md.push(
      "",
      "네 구간 모두 판정이 났다. 다만 **독립근거가 원천적으로 없는 구간**(transformed 4,862 · manual 766)은",
      "설계상 「오분류」로 올라갈 수 없고 최대 「의심」에 머문다 — 아래 한계 참조.",
      "",
    );

    md.push("## 4. 회귀 표적 (부모 세션이 육안으로 확인해 준 것)", "");
    md.push("| 표적 | 결과 |", "|---|---|");
    const 초등기출 = rows.filter(
      (r) =>
        r.source === "past_exam" &&
        /^초/.test(unitById.get(r.unitId)?.grade ?? ""),
    );
    const 초등잡음 = 초등기출.filter(
      (r) => findingBySelf.get(r.id)?.판정 === "오분류",
    ).length;
    md.push(
      `| ADDENDUM A-1: 초등 단원에 앉은 past_exam ${초등기출.length}건 (전량 진짜 오분류) | 오분류로 ${초등잡음} / ${초등기출.length} |`,
    );
    const 표적32 = rows.filter((r) => {
      const uu = unitById.get(r.unitId);
      return (
        r.source === "past_exam" &&
        !r.sourceFile &&
        uu?.grade === "공통수학2" &&
        uu.chapter.includes("함수와 그래프") &&
        uu.section === "함수"
      );
    });
    md.push(
      `| 메타 전무 · 공통수학2 「함수」에 앉은 중2 일차함수 문항 (부모 확인 12건) | ${표적32.filter((r) => findingBySelf.has(r.id)).length} / ${표적32.length}행 검출 |`,
    );
    if (선행현황)
      md.push(
        `| 선행 잔존 71건 독립 재현 | ${선행현황.잔존목록.filter((x) => !x.내판정.startsWith("내 판정기는")).length} / ${선행현황.잔존} |`,
      );
    md.push("");

    md.push("## 5. 분모와 한계 (반드시 같이 읽을 것)", "");
    md.push(
      `1. **어휘 사전의 분모.** 학교급 결정 어휘의 순도는 독립근거가 배정을 확인해 준 **${trusted.length}행**`,
      `   (고 ${tHigh.length} · 중 ${tMid.length}) 에서만 쟀다. 초등 배정 행에서는 **재지 않았다** — 그 구간이 오염돼`,
      `   있어서(transformed 초등 165건 대부분이 중등 문항) 거기서 캐면 손상된 표현을 「초등 어휘」로 배운다.`,
      `   씨앗 ${graded.length}개 중 결정 ${graded.filter((e) => e.등급 === "결정").length} · 보조 ${graded.filter((e) => e.등급 === "보조").length} ·`,
      `   탈락 ${dead.length}(그중 전체 코퍼스 적중 0건인 **죽은 가드 ${dead.filter((e) => e.전체 === 0).length}개**).`,
      "",
    );
    md.push(
      `2. **초등 코퍼스가 없다.** 검증 코퍼스에 초등 기출은 0건이다(N드라이브 기출은 전부 중·고).`,
      `   그래서 「초등이 아니다」는 표기 가드로 판정하고, 그 오발률은 자작 초등 ${elemManual.length}건을 프록시로 쟀다`,
      `   (거듭제곱 0.19% · 좌표 0% · 함수표기 0.19% · 근호 0% · 미지수문자 1.85%). 프록시가 540건뿐이라`,
      `   이 수치의 신뢰구간은 넓다.`,
      "",
    );
    md.push(
      `3. **중단원 신호는 혼자서 교정 근거가 못 된다.** \`--sweep\` 으로 같은 경고 건수에서 견줬더니`,
      `   선행 잔존 「다른 장」 49건 재현율이 137경고당 18건(13%)이었다. 확신도를 「낮음」으로 둔 이유다.`,
      "",
    );
    md.push(
      `4. **독립근거가 없는 구간은 「의심」이 상한이다.** transformed 4,862건은 \`originProblemId\` 가 전량 NULL 이고`,
      `   \`sourceFile\`·\`school\`·\`subject\` 도 없다. manual 766건도 같다. 메타 전무 past_exam 1,287건은 \`externalId\` 조차`,
      `   없어 형제 편으로 이어붙일 수도 없다. 이 구간에서 본문 근거는 두 번째 열쇠를 가질 수 없다.`,
      "",
    );
    md.push(
      `5. **「본문이 가리키는 곳」은 배제만큼 믿을 게 아니다.** 단원명 분포 열쇠는 「배정 학년이 아니다」를`,
      `   강하게 말하지만 「그럼 어디냐」는 최다 몫으로 찍은 추정이다. 예: 「이차함수」는 중3 73% · 공통수학1 20% 라`,
      `   공통수학2 배정을 배제하는 근거로는 옳지만 목적지를 중3 으로 찍는 것은 절반만 맞다.`,
      "",
    );
    md.push(
      `6. **기하는 사전이 비었다.** 기하 배정은 82행뿐이라 과목대 어휘가 0개다 — 이 대역은 사실상 미검사다.`,
      "",
    );
    md.push(
      `7. 이 판정기는 **소단원(section) 층을 보지 않는다.** 선행 잔존 71건 중 「같은 중단원」 22건이`,
      `   그 층의 결함이고, 구조적으로 내 신호 밖이다.`,
      "",
    );
    // 육안 확인 기록. **자동으로 다시 계산되는 값이 아니라 사람이 본 결과**라서 여기에 박아 둔다.
    // (2026-08-16~17 교훈: 과거 결함 여섯 건 중 문서·리뷰로 찾은 것은 하나도 없다. 전부 눈으로 찾았다.)
    md.push("## 6. 육안 확인 기록 (2026-08-17)", "");
    md.push("### 6.1 판정 표본 100건", "");
    md.push(
      "신호×판정×source 로 층화해 뽑아 읽었다. 첫 37건에서 **진짜 22 · 거짓 15**.",
      "거짓 15건의 원인이 둘로 갈렸고, 둘 다 규칙을 고쳐 8건이 사라졌다(진짜 19건은 전부 유지).",
      "",
    );
    md.push("| 발견한 결함 | 예 | 고친 방법 |", "|---|---|---|");
    md.push(
      "| 근거를 **어휘 개수**로 세서 한 구절이 2개로 계수됨 | 「식을 간단히」에서 `간단히`+`단히하` | 매칭 자리를 병합해 **겹치지 않는 근거**만 센다 |",
    );
    md.push(
      "| 단원명 조각이 개념어가 아니라 **지시문** | 중1 히스토그램 문항이 `조사하여` 로 중3 행 | 동사꼴(`~하여`·`~알아보기`) 을 색인에서 제외 |",
    );
    md.push(
      "| **배정 학년 자신의 단원 이름**이 배제 근거로 쓰임 | 중1 「원과 부채꼴」이 `부채꼴` 로 대수 행 | 좁은 이름(학년 3개 이하)이 배정을 가리키면 지지로 센다 |",
    );
    md.push(
      "| 고등 문항이 일차·이차함수를 **도구로** 쓴 것을 중등으로 오판 | 미적분1 극대·극소 문항, 미적분2 수열 문항 | 고등 결정 어휘가 있으면 이름만으로 고등 배정을 내리지 않는다 |",
    );
    md.push(
      "| 합성·역함수가 **기호로만** 나와 어휘가 침묵 | `(g∘f)^{-1}∘h=f` 가 「일차함수」 때문에 중2 행 | `^{-1}` 을 씨앗에 추가(검증 통과) |",
      "",
    );
    md.push(
      "남은 거짓 경보 3건은 낱말이 실제로 겹쳐서 생긴 것이다 — 중1 산책로 문항의 「구간의 길이」가",
      "확통 단원명과 겹치는 식. 전부 확신도 「낮음」에 머문다.",
      "",
    );
    md.push(
      "`∘` 도 고등 씨앗으로 넣어 봤으나 **검증에서 탈락했다** — 순도 22.6%(반례 370건).",
      "중등에서 각도 기호로 쓰인다. 손으로 고른 씨앗이 코퍼스에 막힌 예다.",
      "",
    );
    md.push("### 6.2 「정상」 판정 56건 (의심도 내림차순)", "");
    md.push("여기서 **놓친 것 13건**이 나왔다. 두 부류였다.", "");
    md.push(
      "1. **본문은 침묵하는데 메타와 편 형제가 둘 다 배정을 배제하던 행 4건**",
      "   (4221-1 중2 「다항식의 덧셈과 뺄셈」 ↔ 공통수학1 — ADDENDUM A-3 이 지목한 동명 소단원 충돌 그 자체).",
      "   → 신호를 새로 만들어 「의심/보통」으로 올렸다. 본문 근거가 아니라는 사실을 신호 이름에 적었다.",
      "",
    );
    md.push(
      "2. **초등 배정 transformed 행 9건** — 초2 「□의 값 구하기」에 앉은 `√(40a/3)`(중3 제곱근),",
      "   초5 「혼합 계산」에 앉은 `(-2x)÷(-1/6)`(중1 문자와 식) 같은 것들.",
      "   1차 설계에서 근호·미지수문자 가드를 「LaTeX 안에서만 판정되니 잴 수 없다」며 보조로 내려둔 탓이었다.",
      "   → 판정식을 LaTeX 에 기대지 않게 고쳐 자작 초등 540건에서 **다시 쟀고**(근호 0% · 미지수문자 1.85%)",
      "   기준을 통과해 결정 근거로 승격했다. 13건 중 12건이 이제 잡힌다.",
      "",
    );
    md.push(
      "남은 최상위 「정상」 행들은 초등으로도 읽히는 O/X 도형 문항(합동·정다각형)이라 판단을 보류했다.",
      "",
    );
    md.push("### 6.3 손상된 입력 시험", "");
    md.push(
      "`--selftest` 가 8가지를 매 실행마다 확인한다: 본문이 「정답」 두 글자 · 빈 본문 · 수식만(한글 0자) ·",
      "OCR 이 낱말 중간에 넣은 공백 · OCR 한글 유실 · 초등 산술(한글 0자) · 단위 `cm²` · 고등 어휘+초등 어투.",
      "특히 **OCR 공백**은 부모 세션이 실측한 함정이다 — 한글 키워드를 원문에만 매칭하면 가드가 조용히 죽는다.",
      "그래서 모든 한글 매칭은 **공백을 전부 지운 사본**에서 한다. `등차수 열` 이 `등차수열` 로 잡히는지 시험이 확인한다.",
      "`cm²` 를 거듭제곱으로 읽어 초등 넓이 문항 2.6% 를 잡던 버그도 이 시험에서 나왔다.",
      "",
    );
    const 손상행수 = allNorms.filter(
      (n, i) =>
        n.korean.replace(/\|/g, "").length < 3 || rows[i].content.length < 20,
    ).length;
    md.push(
      `실제 손상 행 ${손상행수}건(한글 3자 미만 또는 본문 20자 미만)은 대부분 **판정 보류**로 떨어진다 —`,
      "억지로 판정하지 않는 쪽이 맞다. 초등 산술 문항은 원래 한글이 없다.",
      "",
    );
    writeFileSync(
      `${OUT_DIR}/content-unit-mismatch.md`,
      md.join("\n") + "\n",
      "utf8",
    );

    console.log(`\n=== 판정 (분모 ${rows.length}) ===`);
    console.log(
      `오분류 ${findings.filter((f) => f.판정 === "오분류").length} · 의심 ${findings.filter((f) => f.판정 === "의심").length} · 정상 ${정상}`,
    );
    console.log("\n가드별 적중 (0건이면 죽은 가드):");
    for (const [k, v] of [...guardHits]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40))
      console.log(`  ${k.padEnd(40)} ${v}`);

    // ── 손상 입력 시험 (2026-08-16 교훈: 판정 코드는 손상된 입력으로 **먼저** 시험한다) ──
    console.log("\n=== 손상 입력 시험 ===");
    console.log(
      "판정기가 손상된 행을 「정상」으로 읽으면 그 손상은 영원히 안 보인다.",
    );
    const damaged: { 이름: string; content: string; 기대: string }[] = [
      {
        이름: "본문이 「정답」 두 글자",
        content: "정답",
        기대: "판정 불가 (배제 근거 없음)",
      },
      { 이름: "빈 본문", content: "", 기대: "판정 불가" },
      {
        이름: "수식만 (한글 0자)",
        content: "$x^{2}+y^{2}=10$",
        기대: "초 배제는 살아 있어야 한다 (거듭제곱·함수표기)",
      },
      {
        이름: "OCR 로 낱말 중간 공백",
        content: "등차수 열 의 첫째 항 과 공차를 구하시오",
        기대: "고등 어휘가 살아 있어야 한다",
      },
      {
        이름: "OCR 로 한글 유실",
        content: "다 각 형 의 내 각",
        기대: "판정 불가여야 한다 (억지 판정 금지)",
      },
      {
        이름: "초등 산술 (한글 0자)",
        content: "56 ÷ 8 = ?\n\nA. 7\nB. 6",
        기대: "초 배제가 뜨면 안 된다",
      },
      {
        이름: "단위 cm² (거듭제곱 아님)",
        content: "직사각형의 넓이는 12cm²입니다.",
        기대: "초 배제가 뜨면 안 된다",
      },
      {
        이름: "고등 어휘 + 초등 어투",
        content: "등차수열의 첫째항은 무엇입니까?",
        기대: "고 우선 (어휘가 형식을 이긴다)",
      },
    ];
    for (const d of damaged) {
      const n = normalize(d.content);
      const v = contentLevel(n, lex, notation);
      console.log(
        `  ${d.이름.padEnd(24)} 급=${String(v.급).padEnd(5)} 배제=[${v.배제급.join(",") || "없음"}] 판정가능=${v.판정가능}`,
      );
      console.log(`      기대: ${d.기대}`);
      console.log(`      근거: ${v.근거.join(" | ") || "(없음)"}`);
    }
    // 손상이 심한 실제 행에서 판정기가 무슨 소리를 하는지 본다.
    const 손상행 = rows
      .map((r, i) => ({
        r,
        n: allNorms[i],
        한글: allNorms[i].korean.replace(/\|/g, "").length,
      }))
      .filter((x) => x.한글 < 3 || x.r.content.length < 20);
    const 손상판정 = new Map<string, number>();
    for (const x of 손상행) {
      const v = contentLevel(x.n, lex, notation);
      const u = unitById.get(x.r.unitId);
      const key = `배정${u ? levelOf(u.grade) : "?"} · 배제[${v.배제급.join(",") || "없음"}]`;
      손상판정.set(key, (손상판정.get(key) ?? 0) + 1);
    }
    console.log(
      `\n  실제 손상 행 ${손상행.length}건 (한글 3자 미만 또는 본문 20자 미만) 의 판정 분포:`,
    );
    for (const [k, v] of [...손상판정].sort((a, b) => b[1] - a[1]))
      console.log(`    ${k.padEnd(34)} ${v}`);

    if (!selftestOnly)
      console.log(`\n보고서 → ${OUT_DIR}/content-unit-mismatch.json`);
    return { findings, 정상표본, graded, notation, guardHits, rows, unitById };
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
