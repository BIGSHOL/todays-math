/**
 * 🔴→🟢 Phase 3, T3.2 (DeepSeek API 래퍼 — 문제 생성/변형 RED→GREEN).
 *
 * 대응 구현: src/lib/ai/generator.ts, src/lib/ai/transformer.ts, src/lib/ai/client.ts,
 *           src/lib/ai/jsonRepair.ts, src/lib/ai/retry.ts, src/lib/ai/prompts/{generate,transform}.ts
 * 대응 계약: src/contracts/problem.contract.ts (problemGenerateRequestSchema/transformRequestSchema)
 *
 * ⚠️ 이 파일은 `openai` SDK(= DeepSeek OpenAI 호환 엔드포인트)를 항상 `vi.mock`으로 모킹한다 —
 * 실제 AI API를 호출하지 않는다(07-coding-convention.md §5, CLAUDE.md 절대 규칙 7). 고정 픽스처는
 * src/mocks/data/aiProblems.ts(T0.5.2 산출물)를 재사용한다.
 *
 * `src/lib/ai/**`는 DB/Route Handler와 분리된 순수 래퍼이므로 이 파일도 인메모리로만
 * 검증한다 — T3.1(문제 CRUD API)의 RED 파일(src/__tests__/api/problem.test.ts)은 건드리지 않는다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => ({
  // Vitest 4에서는 `new`로 호출되는 mock 구현도 실제 constructor 함수여야 한다.
  default: vi.fn().mockImplementation(function OpenAIMock() {
    return {
      chat: { completions: { create: mockCreate } },
    };
  }),
}));

import { generateProblems } from "@/lib/ai/generator";
import {
  transformProblem,
  verifiesOriginalReproduction,
} from "@/lib/ai/transformer";
import { AiGenerationError } from "@/lib/ai/errors";
import {
  normalizeLatex,
  parseAiJsonArray,
  repairJsonString,
} from "@/lib/ai/jsonRepair";

import {
  MOCK_AI_GENERATED_PROBLEMS,
  MOCK_AI_TRANSFORMED_PROBLEMS,
  MOCK_EMPTY_PROBLEM_UNIT,
  MOCK_PROBLEMS,
} from "@/mocks/data";
import { z } from "zod";

/** DeepSeek(OpenAI 호환) `chat.completions.create` 응답 형태로 감싼다. */
function aiTextResponse(text: string) {
  return {
    choices: [{ message: { content: text }, finish_reason: "stop" }],
  };
}

const GENERATE_UNIT_ID = MOCK_EMPTY_PROBLEM_UNIT.id;
const GENERATE_FIXTURES = MOCK_AI_GENERATED_PROBLEMS.slice(0, 3).map((p) => ({
  problemType: p.problemType,
  content: p.content,
  answer: p.answer,
  solution: p.solution,
}));

const ORIGIN = MOCK_PROBLEMS[0]!; // "$\frac{7}{25}$를 유한소수로 나타내어라." / answer "0.28"

beforeEach(() => {
  mockCreate.mockReset();
  vi.unstubAllEnvs();
  vi.stubEnv("DEEPSEEK_API_KEY", "test-api-key");
});

describe("[T3.2] generateProblems — AI 문제 생성", () => {
  it("요청받은 count만큼 draft를 만들고 unitId/difficulty/source/reviewStatus/originProblemId를 서버가 부여한다", async () => {
    mockCreate.mockResolvedValueOnce(
      aiTextResponse(JSON.stringify(GENERATE_FIXTURES)),
    );

    const drafts = await generateProblems({
      unitId: GENERATE_UNIT_ID,
      unitLabel: "일차부등식의 활용(농도)",
      difficulty: "easy",
      count: 3,
    });

    expect(drafts).toHaveLength(3);
    for (const draft of drafts) {
      expect(draft.unitId).toBe(GENERATE_UNIT_ID);
      expect(draft.difficulty).toBe("easy");
      expect(draft.source).toBe("ai_generated");
      expect(draft.originProblemId).toBeNull();
      expect(draft.reviewStatus).toBe("pending");
      expect(draft.content.length).toBeGreaterThan(0);
      expect(draft.answer.length).toBeGreaterThan(0);
    }
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("AI가 응답에 다른 unitId/difficulty를 끼워 넣어도 무시하고 서버 요청값을 그대로 쓴다", async () => {
    mockCreate.mockResolvedValueOnce(
      aiTextResponse(
        JSON.stringify([
          {
            problemType: "계산",
            content: "AI가 준 문제",
            answer: "AI가 준 답",
            solution: null,
            // 계약에 없는 필드를 끼워 넣어도(z.strictObject) 검증에서 걸러진다 — 별도 테스트에서 확인.
          },
        ]),
      ),
    );

    const [draft] = await generateProblems({
      unitId: GENERATE_UNIT_ID,
      unitLabel: "일차부등식의 활용(농도)",
      difficulty: "hard",
      count: 1,
    });

    expect(draft!.unitId).toBe(GENERATE_UNIT_ID);
    expect(draft!.difficulty).toBe("hard");
  });

  it("응답이 마크다운 코드펜스 + LaTeX 백슬래시가 깨진 형태로 와도 salvage해 파싱한다", async () => {
    // 실제 모델이 흔히 저지르는 손상: ```json 펜스로 감싸고, \frac 등 LaTeX 백슬래시를
    // JSON 이스케이프 없이 그대로 흘려보낸다(F:\mathlab-lab-p1\...\problem-gen.ts 알려진 함정).
    const broken =
      "여기 결과입니다:\n```json\n" +
      '[{"problemType":"계산","content":"$\\frac{1}{2}+\\frac{1}{3}$을 계산하여라.","answer":"$\\frac{5}{6}$","solution":null}]' +
      "\n```";

    mockCreate.mockResolvedValueOnce(aiTextResponse(broken));

    const drafts = await generateProblems({
      unitId: GENERATE_UNIT_ID,
      unitLabel: "이차방정식",
      difficulty: "mid",
      count: 1,
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.content).toContain("\\frac{1}{2}");
    expect(drafts[0]!.answer).toContain("\\frac{5}{6}");
  });

  it("\\dfrac을 \\frac으로 정규화한다", async () => {
    mockCreate.mockResolvedValueOnce(
      aiTextResponse(
        JSON.stringify([
          {
            problemType: "계산",
            content: "$\\dfrac{3}{4}$를 소수로 나타내어라.",
            answer: "0.75",
            solution: "$\\dfrac{3}{4}=0.75$",
          },
        ]),
      ),
    );

    const [draft] = await generateProblems({
      unitId: GENERATE_UNIT_ID,
      unitLabel: "유리수와 소수",
      difficulty: "easy",
      count: 1,
    });

    expect(draft!.content).not.toContain("\\dfrac");
    expect(draft!.content).toContain("\\frac{3}{4}");
    expect(draft!.solution).toBe("$\\frac{3}{4}=0.75$");
  });

  it("1차 응답이 파싱 불가능하면 1회 재시도하고, 재시도 응답이 유효하면 성공한다", async () => {
    mockCreate
      .mockResolvedValueOnce(aiTextResponse("이건 JSON이 아닙니다."))
      .mockResolvedValueOnce(
        aiTextResponse(JSON.stringify(GENERATE_FIXTURES.slice(0, 1))),
      );

    const drafts = await generateProblems({
      unitId: GENERATE_UNIT_ID,
      unitLabel: "일차부등식의 활용(농도)",
      difficulty: "easy",
      count: 1,
    });

    expect(drafts).toHaveLength(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("재시도 후에도 파싱에 실패하면 AiGenerationError를 던지고 정확히 2회만 호출한다", async () => {
    mockCreate
      .mockResolvedValueOnce(aiTextResponse("이건 JSON이 아닙니다."))
      .mockResolvedValueOnce(aiTextResponse("여전히 JSON이 아닙니다."));

    await expect(
      generateProblems({
        unitId: GENERATE_UNIT_ID,
        unitLabel: "일차부등식의 활용(농도)",
        difficulty: "easy",
        count: 1,
      }),
    ).rejects.toBeInstanceOf(AiGenerationError);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("요청 개수보다 적은 배열도 불완전 응답으로 보고 1회 재시도한다", async () => {
    const shortResponse = aiTextResponse(
      JSON.stringify(GENERATE_FIXTURES.slice(0, 1)),
    );
    mockCreate
      .mockResolvedValueOnce(shortResponse)
      .mockResolvedValueOnce(shortResponse);

    await expect(
      generateProblems({
        unitId: GENERATE_UNIT_ID,
        unitLabel: "일차부등식의 활용(농도)",
        difficulty: "easy",
        count: 2,
      }),
    ).rejects.toBeInstanceOf(AiGenerationError);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("스키마를 위반하는 응답(problemType 오타)도 파싱 실패로 취급해 재시도한다", async () => {
    mockCreate
      .mockResolvedValueOnce(
        aiTextResponse(
          JSON.stringify([
            {
              problemType: "객관식", // 계약이 허용하지 않는 값
              content: "잘못된 유형",
              answer: "x",
              solution: null,
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        aiTextResponse(JSON.stringify(GENERATE_FIXTURES.slice(0, 1))),
      );

    const drafts = await generateProblems({
      unitId: GENERATE_UNIT_ID,
      unitLabel: "일차부등식의 활용(농도)",
      difficulty: "easy",
      count: 1,
    });

    expect(drafts).toHaveLength(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("DEEPSEEK_API_KEY가 없으면 AI를 호출하지 않고 AiGenerationError를 던진다", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");

    await expect(
      generateProblems({
        unitId: GENERATE_UNIT_ID,
        unitLabel: "일차부등식의 활용(농도)",
        difficulty: "easy",
        count: 1,
      }),
    ).rejects.toBeInstanceOf(AiGenerationError);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("transformProblem — AI 문제 변형(후보 반환, 2026-08-19 고도화)", () => {
  it("후보만 돌려준다 — 분류/출처/검수 필드는 담지 않는다(저장 시점에 서버가 부여)", async () => {
    mockCreate.mockResolvedValueOnce(
      aiTextResponse(
        JSON.stringify([
          {
            content: "$\frac{11}{40}$을 유한소수로 나타내어라.",
            answer: "0.275",
            solution: "$\frac{11}{40} = \frac{275}{1000} = 0.275$",
            // 원본(7/25=0.28) 규칙을 되돌려 적용한 값 — 원본 정답과 일치해야 통과.
            originalAnswerRecomputed: "0.28",
          },
        ]),
      ),
    );

    const [candidate] = await transformProblem({ origin: ORIGIN, count: 1 });

    expect(candidate!.verified).toBe(true);
    expect(candidate!.answer).toBe("0.275");
    // originProblemId 가 NULL 인지 아닌지가 RPM 이관본과 AI 변형본을 가르는 유일한
    // 판별자다(D-51). 변형기가 흘리면 그 판별이 무너지므로 여기서 못 박는다.
    expect(candidate).not.toHaveProperty("source");
    expect(candidate).not.toHaveProperty("originProblemId");
    expect(candidate).not.toHaveProperty("reviewStatus");
    expect(candidate).not.toHaveProperty("difficulty");
  });

  it("원본 재현 검사에 떨어진 후보도 사유를 달아 **버리지 않고** 돌려준다", async () => {
    mockCreate.mockResolvedValueOnce(
      aiTextResponse(
        JSON.stringify([
          {
            content: "잘못된 변형(재현 실패)",
            answer: "9.99",
            solution: null,
            originalAnswerRecomputed: "완전히 다른 값", // origin.answer("0.28")와 불일치
          },
          {
            content: "$\frac{11}{40}$을 유한소수로 나타내어라.",
            answer: "0.275",
            solution: null,
            originalAnswerRecomputed: "0.28", // origin.answer와 일치 → 통과
          },
        ]),
      ),
    );

    const candidates = await transformProblem({ origin: ORIGIN, count: 2 });

    // v1 은 여기서 1개만 남겼다. 그러면 화면은 「2개 요청했는데 1개」만 알고 이유를 못 본다.
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.verified).toBe(false);
    expect(candidates[0]!.originalAnswerRecomputed).toBe("완전히 다른 값");
    expect(candidates[1]!.verified).toBe(true);
  });

  it("전부 검사에 떨어져도 던지지 않는다 — 사유를 봐야 하기 때문이다", async () => {
    mockCreate.mockResolvedValueOnce(
      aiTextResponse(
        JSON.stringify([
          {
            content: "재현 실패 변형",
            answer: "9.99",
            solution: null,
            originalAnswerRecomputed: "완전히 다른 값",
          },
        ]),
      ),
    );

    const candidates = await transformProblem({ origin: ORIGIN, count: 1 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.verified).toBe(false);
  });

  it("응답에서 후보를 하나도 읽지 못하면 AiGenerationError를 던진다", async () => {
    // 재시도까지 두 번 다 빈 배열 — 파싱은 됐지만 후보가 0개다.
    mockCreate
      .mockResolvedValueOnce(aiTextResponse("[]"))
      .mockResolvedValueOnce(aiTextResponse("[]"));

    await expect(
      transformProblem({ origin: ORIGIN, count: 1 }),
    ).rejects.toBeInstanceOf(AiGenerationError);
  });

  it("변형 방식·난이도 조정이 프롬프트에 실제로 실린다", async () => {
    mockCreate.mockResolvedValueOnce(
      aiTextResponse(
        JSON.stringify([
          {
            content: "조건까지 바꾼 변형",
            answer: "0.275",
            solution: null,
            originalAnswerRecomputed: "0.28",
          },
        ]),
      ),
    );

    await transformProblem({
      origin: ORIGIN,
      count: 1,
      mode: "conditions",
      difficultyShift: "up",
    });

    const sent = mockCreate.mock.calls[0]![0]!.messages[1]!.content as string;
    expect(sent).toContain("조건과 상황 설정까지");
    expect(sent).toContain("한 단계 어렵게");
    expect(sent).not.toContain("숫자만** 바꾸십시오");
  });

  it("기본값은 가장 안전한 쪽 — 숫자만 바꾸고 난이도는 원본을 유지한다", async () => {
    mockCreate.mockResolvedValueOnce(
      aiTextResponse(
        JSON.stringify([
          {
            content: "기본 변형",
            answer: "0.275",
            solution: null,
            originalAnswerRecomputed: "0.28",
          },
        ]),
      ),
    );

    await transformProblem({ origin: ORIGIN, count: 1 });

    const sent = mockCreate.mock.calls[0]![0]!.messages[1]!.content as string;
    expect(sent).toContain("숫자만");
    expect(sent).toContain("원본과 같은 수준을 유지");
  });

  it("E2E_MOCK_AI=1 이면 AI 를 부르지 않고 모의 후보를 만든다 — 마지막 하나는 탈락", async () => {
    vi.stubEnv("E2E_MOCK_AI", "1");

    const candidates = await transformProblem({ origin: ORIGIN, count: 3 });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(candidates).toHaveLength(3);
    expect(candidates.map((c) => c.verified)).toEqual([true, true, false]);
    // 「폐기」 표시와 사유 경로가 모의에서도 반드시 한 번은 밟힌다.
    expect(candidates[2]!.originalAnswerRecomputed).not.toBe(ORIGIN.answer);
  });

  it("픽스처(MOCK_AI_TRANSFORMED_PROBLEMS)의 변형 결과 형태와 정합적인 후보를 만든다", async () => {
    const fixture = MOCK_AI_TRANSFORMED_PROBLEMS[0]!;
    mockCreate.mockResolvedValueOnce(
      aiTextResponse(
        JSON.stringify([
          {
            content: fixture.content,
            answer: fixture.answer,
            solution: fixture.solution,
            originalAnswerRecomputed: ORIGIN.answer, // 원본 재현 성공 케이스로 구성
          },
        ]),
      ),
    );

    const [candidate] = await transformProblem({ origin: ORIGIN, count: 1 });

    expect(candidate!.content).toBe(fixture.content);
    expect(candidate!.answer).toBe(fixture.answer);
    expect(candidate!.verified).toBe(true);
  });
});

describe("[T3.2] verifiesOriginalReproduction — 원본 재현 검사 단위 동작", () => {
  it("공백/개행 차이는 무시하고 값이 같으면 통과한다", () => {
    expect(
      verifiesOriginalReproduction(
        { answer: "0.28" },
        { originalAnswerRecomputed: "  0.28\n" },
      ),
    ).toBe(true);
  });

  it("\\dfrac과 \\frac 표기 차이는 같은 값으로 취급한다", () => {
    expect(
      verifiesOriginalReproduction(
        { answer: "$\\dfrac{1}{2}$" },
        { originalAnswerRecomputed: "$\\frac{1}{2}$" },
      ),
    ).toBe(true);
  });

  it("값이 다르면 실패한다", () => {
    expect(
      verifiesOriginalReproduction(
        { answer: "0.28" },
        { originalAnswerRecomputed: "0.30" },
      ),
    ).toBe(false);
  });
});

describe("[T3.2] jsonRepair — AI 응답 salvage 유틸", () => {
  it("normalizeLatex: \\dfrac을 \\frac으로 바꾼다", () => {
    expect(normalizeLatex("$\\dfrac{1}{2} + \\dfrac{3}{4}$")).toBe(
      "$\\frac{1}{2} + \\frac{3}{4}$",
    );
  });

  it("repairJsonString: 코드펜스를 제거한다", () => {
    const raw = '```json\n[{"a":"b"}]\n```';
    expect(JSON.parse(repairJsonString(raw))).toEqual([{ a: "b" }]);
  });

  it("repairJsonString: 앞뒤 잡담을 제거하고 JSON 구간만 남긴다", () => {
    const raw = '여기 결과입니다: [{"a":1}] 이상입니다.';
    expect(JSON.parse(repairJsonString(raw))).toEqual([{ a: 1 }]);
  });

  it("repairJsonString: 문자열 안의 LaTeX 백슬래시를 이중 백슬래시로 보정한다", () => {
    const raw = '[{"content":"$\\frac{1}{2}$"}]';
    const repaired = repairJsonString(raw);
    const parsed = JSON.parse(repaired) as { content: string }[];
    expect(parsed[0]!.content).toBe("$\\frac{1}{2}$");
  });

  it("parseAiJsonArray: JSON.parse가 통과하는 \\frac 손상도 LaTeX로 복구한다", () => {
    const schema = z.strictObject({ content: z.string() });
    const raw = '[{"content":"$\\frac{1}{2}$"}]';

    expect(parseAiJsonArray(raw, schema)).toEqual([
      { content: "$\\frac{1}{2}$" },
    ]);
  });

  it("repairJsonString: 정상 JSON의 줄바꿈과 유니코드 이스케이프는 보존한다", () => {
    const raw = '[{"content":"첫 줄\\n둘째 줄 \\uAC00"}]';
    const repaired = repairJsonString(raw);

    expect(JSON.parse(repaired)).toEqual([{ content: "첫 줄\n둘째 줄 가" }]);
  });

  it("repairJsonString: 문자열 안의 리터럴 줄바꿈을 \\n으로 치환한다", () => {
    const raw = '[{"content":"1번째 줄\n2번째 줄"}]';
    const repaired = repairJsonString(raw);
    const parsed = JSON.parse(repaired) as { content: string }[];
    expect(parsed[0]!.content).toBe("1번째 줄\n2번째 줄");
  });

  it("repairJsonString: 끝 콤마(trailing comma)를 제거한다", () => {
    const raw = '[{"a":1},{"b":2},]';
    expect(JSON.parse(repairJsonString(raw))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("parseAiJsonArray: 유효한 JSON은 1차 시도에서 바로 통과한다", () => {
    const schema = z.strictObject({ a: z.number() });
    expect(parseAiJsonArray(JSON.stringify([{ a: 1 }]), schema)).toEqual([
      { a: 1 },
    ]);
  });

  it("parseAiJsonArray: 배열이 아니면 AiParseError를 던진다", () => {
    const schema = z.strictObject({ a: z.number() });
    expect(() => parseAiJsonArray(JSON.stringify({ a: 1 }), schema)).toThrow();
  });

  it("parseAiJsonArray: 스키마를 위반하면 AiParseError를 던진다", () => {
    const schema = z.strictObject({ a: z.number() });
    expect(() =>
      parseAiJsonArray(JSON.stringify([{ a: "숫자아님" }]), schema),
    ).toThrow();
  });
});
