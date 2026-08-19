/**
 * 문제은행 계약 — FEAT-1, FEAT-5.
 *
 * 대응 API 경로:
 *   POST   /api/problems                    — 문제 등록 (수동 자작/기출 직접 입력)
 *   GET    /api/problems                     — 문제 목록 조회 (필터: unitId/grade/chapter/chapterPrefix/difficulty/problemType/source/reviewStatus)
 *   GET    /api/problems/{id}                — 문제 단건 조회
 *   PATCH  /api/problems/{id}                — 문제 수정 (본문/정답/풀이 등)
 *   DELETE /api/problems/{id}                — 문제 삭제
 *   PATCH  /api/problems/{id}/review-status  — 검수 승격 (pending → approved 등, D-22)
 *   POST   /api/problems/generate            — AI 문제 생성 (unitId, difficulty, count)
 *   POST   /api/problems/transform           — 기존 문제 변형 → **후보만** 반환(DB 미적재)
 *   POST   /api/problems/transform/adopt     — 미리보기에서 채택한 후보만 DB 적재
 *
 * Problem.directUseAllowed — T3.0/D-26. RPM 원본은 false, 그 외 기본 true.
 * Problem.pool — D-31. 기본 shared. 특별 지시가 없으면 전부 공용 풀.
 *
 * ⚠️ reviewStatus는 등록/수정 요청에 포함하지 않는다 — 검수 승격은 반드시 전용 엔드포인트
 *    (PATCH /api/problems/{id}/review-status)를 통하도록 강제해 클라이언트가 등록과 동시에
 *    스스로 승인 처리하는 경로를 원천 차단한다(D-22 품질 리스크 완화).
 *
 * 참조: docs/planning/04-database-design.md §2.3 (PROBLEM)
 *       docs/planning/07-coding-convention.md §2.3 (problemType: 계산/개념/활용/서술형)
 */
import { z } from "zod";

import type { Difficulty } from "./common.contract";
import { problemCodeSchema } from "./problemCode.contract";
import {
  dataResponseSchema,
  difficultySchema,
  isoDateTimeSchema,
  listResponseSchema,
  paginationParamsSchema,
  problemPoolSchema,
  problemSourceSchema,
  reviewStatusSchema,
  uuidSchema,
} from "./common.contract";

// 07-coding-convention.md §2.3 — 확장 가능성 고려해 prisma는 자유 문자열이지만,
// 앱(계약) 레벨에서는 아래 4종으로 제한한다.
export const problemTypeSchema = z.enum(["계산", "개념", "활용", "서술형"], {
  error: "문제 유형은 계산/개념/활용/서술형 중 하나여야 합니다.",
});
export type ProblemType = z.infer<typeof problemTypeSchema>;

// content/answer/solution — TEXT(무제한)이지만 비정상적으로 큰 입력을 막기 위한 상한.
const problemTextSchema = (label: string) =>
  z
    .string()
    .min(1, { error: `${label}을(를) 입력해주세요.` })
    .max(10_000, { error: `${label}은(는) 10,000자를 초과할 수 없습니다.` });

// ── 등록 ────────────────────────────────────────────────
export const problemCreateRequestSchema = z.strictObject({
  unitId: uuidSchema,
  /** 화면(S-08) 직접 등록은 manual/past_exam만 허용 — ai_generated/transformed는 전용 엔드포인트가 서버에서 부여 */
  source: z.enum(["manual", "past_exam"], {
    error: "등록 출처는 manual 또는 past_exam이어야 합니다.",
  }),
  difficulty: difficultySchema,
  problemType: problemTypeSchema,
  content: problemTextSchema("문제 본문"),
  answer: problemTextSchema("정답"),
  solution: problemTextSchema("풀이").optional(),
  /** 생략 시 공용 풀 (D-31). private는 명시할 때만. */
  pool: problemPoolSchema.optional().default("shared"),
});
export type ProblemCreateRequest = z.infer<typeof problemCreateRequestSchema>;

export const problemUpdateRequestSchema = z
  .strictObject({
    unitId: uuidSchema.optional(),
    difficulty: difficultySchema.optional(),
    problemType: problemTypeSchema.optional(),
    content: problemTextSchema("문제 본문").optional(),
    answer: problemTextSchema("정답").optional(),
    solution: problemTextSchema("풀이").optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: "수정할 값이 없습니다." });
export type ProblemUpdateRequest = z.infer<typeof problemUpdateRequestSchema>;

export const problemSchema = z.strictObject({
  id: uuidSchema,
  /**
   * 문항 코드 — 원장님이 문항을 지목하는 값 (D-53). 예: `J31402-K7M2`.
   *
   * ⚠️ **저장이지 파생이 아니다.** 뜻 부분(학교급·학년·대단원·소단원)은 **부여 당시의
   *    스냅샷**이라 지금 `unitId` 와 다를 수 있다 — 단원 재배정이 실제로 149건 있었다.
   *    그래서 화면은 코드 옆에 **현재 단원·출처를 항상 같이** 보여야 한다(D-53).
   *    코드로 단원을 읽지 마라. 단원은 `unitId` 가 진실이다.
   */
  problemCode: problemCodeSchema,
  userId: uuidSchema,
  unitId: uuidSchema,
  source: problemSourceSchema,
  originProblemId: uuidSchema.nullable(),
  difficulty: difficultySchema,
  problemType: problemTypeSchema,
  content: problemTextSchema("문제 본문"),
  answer: problemTextSchema("정답"),
  solution: problemTextSchema("풀이").nullable(),
  reviewStatus: reviewStatusSchema,
  /** RPM 원본은 false — 출제 풀에서 제외 (D-26). 응답에 없으면 true로 본다. */
  directUseAllowed: z.boolean().default(true),
  /** 공용 풀이 기본 (D-31). 응답에 없으면 shared로 본다. */
  pool: problemPoolSchema.default("shared"),
  /**
   * 원본 시험지에서 오려 온 그림 경로들 (`/figures/<examId>/qNN.jpg`).
   * 선택지마다 그림인 문항이 있어 배열이다. 없으면 빈 배열(널 금지).
   * 참조: docs/planning/09-figure-engine-guide.md §5
   */
  figureUrls: z.array(z.string()).default([]),
  /**
   * 도형 SVG (testchanger figure engine 산출물, inline 렌더). 없으면 null.
   *
   * `figureUrls`(스캔 오려낸 래스터)와 **다른 갈래**다. 이쪽은 벡터라 화면·인쇄가
   * 같은 것을 쓰고 해상도 손실이 없다. AI 변형이 만드는 도형이 여기로 들어온다
   * (원장님 지시 2026-08-19 "도형 변형이 필요한 부분은 svg 엔진을 이용해 새로 만들 것").
   *
   * ⚠️ **서버만 이 값을 만든다** — `src/lib/figure/renderFigureSpec.ts` 가 유일한 생산자다.
   *    화면에 inline 으로 들어가는 마크업이라 클라이언트가 실어 보내는 경로를 두지 않는다.
   */
  figureSvg: z.string().nullable().default(null),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ProblemEntity = z.infer<typeof problemSchema>;

export const problemResponseSchema = dataResponseSchema(problemSchema);
export const problemListResponseSchema = listResponseSchema(problemSchema);

// ── 조회 필터 ────────────────────────────────────────────
export const problemFilterQuerySchema = z.strictObject({
  unitId: uuidSchema.optional(),
  /**
   * 계단식 단원 필터(S-08) — Unit relation 기준으로 거른다.
   * grade: 학년("초1"·"중2"·고등 과목명). chapter: 중단원 정확 일치.
   * chapterPrefix: 중단원 접두 일치("1-" = 초등 1학기) — chapter가 있으면 무시.
   */
  grade: z.string().min(1).optional(),
  chapter: z.string().min(1).optional(),
  chapterPrefix: z.string().min(1).optional(),
  difficulty: difficultySchema.optional(),
  problemType: problemTypeSchema.optional(),
  source: problemSourceSchema.optional(),
  reviewStatus: reviewStatusSchema.optional(),
  pool: problemPoolSchema.optional(),
  /**
   * 그림이 있는 문항만 보기(S-08). 켤 때만 `"true"` 를 보낸다 — 끄면 아예 안 붙인다.
   *
   * ⚠️ `z.coerce.boolean()` 을 쓰면 `"false"` 도 **참**이 된다(빈 문자열만 거짓).
   * 쿼리스트링은 전부 문자열이라 그 함정에 그대로 걸린다. 그래서 리터럴로 받는다.
   */
  hasFigure: z.literal("true").optional(),
  page: paginationParamsSchema.shape.page,
  pageSize: paginationParamsSchema.shape.pageSize,
});
export type ProblemFilterQuery = z.infer<typeof problemFilterQuerySchema>;

// ── 검수 승격 ────────────────────────────────────────────
export const problemReviewStatusUpdateRequestSchema = z.strictObject({
  reviewStatus: reviewStatusSchema,
});
export type ProblemReviewStatusUpdateRequest = z.infer<
  typeof problemReviewStatusUpdateRequestSchema
>;

// ── AI 생성 ─────────────────────────────────────────────
export const problemGenerateRequestSchema = z.strictObject({
  unitId: uuidSchema,
  difficulty: difficultySchema,
  /** 업무상 합리적 상한 — 1회 AI 호출로 과도한 생성을 막는다(문서에 명시된 상한 없음). */
  count: z
    .number()
    .int()
    .min(1, { error: "생성 개수는 1개 이상이어야 합니다." })
    .max(10, { error: "생성 개수는 10개를 초과할 수 없습니다." })
    .default(1),
});
export type ProblemGenerateRequest = z.infer<
  typeof problemGenerateRequestSchema
>;

export const problemGenerateResponseSchema = dataResponseSchema(
  z.array(problemSchema),
);

// ── 변형 ────────────────────────────────────────────────

/**
 * 변형 방식 (원장님 확정 2026-08-19).
 * - `numbers`: 숫자만 바꾼다. 문장 구조를 그대로 두므로 가장 안전하다.
 * - `conditions`: 조건·문맥까지 바꾼다. 개념과 유형은 유지한다.
 */
export const transformModeSchema = z.enum(["numbers", "conditions"]);
export type TransformMode = z.infer<typeof transformModeSchema>;

/**
 * 난이도 조정 (원장님 확정 2026-08-19). 원본 난이도에서 한 단계 올리거나 내린다.
 * 끝(hard 에서 up, easy 에서 down)은 제자리다 — `shiftDifficulty` 가 SSOT.
 */
export const difficultyShiftSchema = z.enum(["keep", "up", "down"]);
export type DifficultyShift = z.infer<typeof difficultyShiftSchema>;

/** 난이도 사다리 — 오름차순. `shiftDifficulty` 만 쓴다. */
const DIFFICULTY_LADDER = ["easy", "mid", "hard"] as const;

/**
 * 난이도 한 단계 이동 — **여기가 유일한 구현**이다.
 *
 * 계약에 두는 이유: 후보를 만들 때(프롬프트에 실을 난이도)와 채택해 저장할 때(DB 에 넣을
 * 난이도)가 **다른 모듈**이라, 각자 손으로 사다리를 적으면 한쪽만 고쳐도 아무도 모른다
 * (2026-08-18 「규칙이 옳아도 배선이 한쪽만 되면 그쪽 지표만 좋아진다」와 같은 자리).
 */
export function shiftDifficulty(
  difficulty: Difficulty,
  shift: DifficultyShift,
): Difficulty {
  if (shift === "keep") return difficulty;
  const at = DIFFICULTY_LADDER.indexOf(difficulty);
  const next = at + (shift === "up" ? 1 : -1);
  return DIFFICULTY_LADDER[next] ?? difficulty;
}

export const problemTransformRequestSchema = z.strictObject({
  originProblemId: uuidSchema,
  count: z
    .number()
    .int()
    .min(1, { error: "변형 개수는 1개 이상이어야 합니다." })
    .max(10, { error: "변형 개수는 10개를 초과할 수 없습니다." })
    .default(1),
  mode: transformModeSchema.default("numbers"),
  difficultyShift: difficultyShiftSchema.default("keep"),
});
export type ProblemTransformRequest = z.infer<
  typeof problemTransformRequestSchema
>;

/**
 * 변형 후보 — **아직 DB 에 없다** (원장님 확정 2026-08-19 "미리보기 후 채택").
 * `id` 가 없는 것이 그 뜻이다. 채택한 것만 `POST /api/problems/transform/adopt` 가 넣는다.
 *
 * ⚠️ **원본 재현 검사에 떨어진 후보도 그대로 담는다**(`verified: false`). 걸러서 보내면
 * 화면은 「3개 요청했는데 2개만 왔다」는 사실만 보고 **왜인지를 못 본다** — 실패가 침묵하는
 * 자리다. 화면은 떨어진 후보를 「폐기」로 표시하고 `originalAnswerRecomputed` 를 사유로 쓴다.
 */
/** FigureSpec v2 — 엔진(`core.figure_scene`)이 허용 키를 강제한다. 여기서 또 좁히지 않는다. */
export const figureSpecSchema = z.record(z.string(), z.unknown());

export const transformCandidateSchema = z.strictObject({
  content: z.string().min(1),
  answer: z.string().min(1),
  solution: z.string().nullable(),
  /** 원본 재현 검사 통과 여부. false 인 후보는 화면에서 채택할 수 없다. */
  verified: z.boolean(),
  /** AI 가 제 변형 규칙을 원본 숫자에 되돌려 적용한 값 — 불일치 사유를 그대로 보여 준다. */
  originalAnswerRecomputed: z.string(),
  /**
   * AI 가 낸 도형 스펙. 원본이 그림에 기대는 문항일 때만 요구한다.
   * 채택할 때 이것이 서버로 되돌아가고, **서버가 다시 그려서** 저장한다 —
   * 아래 `figureSvg` 는 미리보기용이지 저장되는 값이 아니다.
   */
  figureSpec: figureSpecSchema.nullable(),
  /** 서버가 그려 본 결과(미리보기). 못 그렸으면 null 이고 사유는 `figureError` 에 있다. */
  figureSvg: z.string().nullable(),
  /** 도형을 못 그린 사유. 원장님이 읽고 판단하므로 문구 그대로 싣는다. */
  figureError: z.string().nullable(),
});
export type TransformCandidate = z.infer<typeof transformCandidateSchema>;

/**
 * 변형 응답 — 후보와 **이 원본을 채택할 수 있는가**를 같이 싣는다.
 *
 * `figureBlockedReason` 이 문자열이면 화면은 후보를 보여 주되 **저장을 막는다**
 * (원장님 확정 2026-08-19). 변형은 본문 글자만 오가고 그림은 따라가지 않아서,
 * 그림에 기대는 문항을 변형하면 「본문은 그림을 가리키는데 그림이 없는」 문항이
 * 태어난다 — 이 저장소가 856건 잠그며 정리한 그 부류다.
 *
 * 사유를 **문구 그대로** 싣는 이유: 화면이 사유를 다시 짓지 않게 하려는 것이다.
 * 「막혔다」는 사실만 보내면 왜인지가 화면에서 사라진다.
 */
export const problemTransformResponseSchema = z.strictObject({
  data: z.array(transformCandidateSchema),
  meta: z.strictObject({
    /**
     * 이 원본이 **그림에 기대는 문항인가**. 참이면 후보마다 도형이 있어야 채택할 수 있다
     * (`figureSvg !== null`). 변형은 본문 글자만 오가서 원본 그림이 따라가지 않기 때문이다.
     */
    figureRequired: z.boolean(),
  }),
});

/**
 * 채택 저장 — 미리보기에서 고른 후보만 DB 에 넣는다.
 *
 * ⚠️ `source` / `originProblemId` / `reviewStatus` 는 **요청에 없다**. 서버가 강제한다.
 * `originProblemId` 가 NULL 인지 아닌지가 RPM 교재 이관본과 AI 변형본을 가르는 **유일한
 * 판별자**이고(D-51), `composePredictedPaper` 의 `SOURCE_RANK` 가 그 값에 기댄다.
 * 클라이언트가 정하게 두면 출제 등급이 조용히 어긋난다.
 */
export const problemTransformAdoptRequestSchema = z.strictObject({
  originProblemId: uuidSchema,
  difficultyShift: difficultyShiftSchema.default("keep"),
  items: z
    .array(
      z.strictObject({
        content: z.string().min(1),
        answer: z.string().min(1),
        solution: z.string().nullable(),
        /**
         * 원본 재현 검사값을 **되돌려 보낸다.** 서버가 원본 정답과 다시 대 본다.
         *
         * 없으면 검사가 브라우저에만 남는다 — 종전 구현은 변형기가 탈락 후보를 걸러
         * **서버가** 저장을 거부했는데, 미리보기로 갈라지며 그 문지기가 사라졌다.
         * (적대적 리뷰 2026-08-19). 클라이언트가 값을 지어낼 수는 있지만, **정상 흐름에서
         * 탈락 후보가 저장되는 경로**는 이것으로 서버에서 닫힌다.
         */
        originalAnswerRecomputed: z.string().min(1),
        /**
         * 미리보기에서 본 도형의 **스펙**. SVG 가 아니라 스펙을 되돌려 받는 이유는
         * 서버가 유일한 SVG 생산자이기 때문이다 — 브라우저가 준 마크업을 그대로 저장하면
         * 지면과 화면에 남는 주입 통로가 된다.
         */
        figureSpec: figureSpecSchema.nullable().default(null),
      }),
    )
    .min(1, { error: "채택할 변형을 하나 이상 골라주세요." })
    .max(10, { error: "한 번에 10개를 초과해 채택할 수 없습니다." }),
});
export type ProblemTransformAdoptRequest = z.infer<
  typeof problemTransformAdoptRequestSchema
>;

export const problemTransformAdoptResponseSchema = dataResponseSchema(
  z.array(problemSchema),
);
