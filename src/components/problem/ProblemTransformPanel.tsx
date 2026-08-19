"use client";

import { useState } from "react";

import { MathText } from "@/components/math/MathText";
import { Button } from "@/components/ui/Button";
import type {
  DifficultyShift,
  ProblemEntity,
  TransformCandidate,
  TransformMode,
} from "@/contracts/problem.contract";
import { adoptTransformed, transformProblems } from "@/lib/problem/problemApi";

import { FieldSelect } from "./FieldSelect";

/**
 * 변형 패널 — **문제 카드 안**에서 열린다 (원장님 확정 2026-08-19).
 *
 * 종전에는 화면 위쪽에 드롭다운 하나로 원본을 골랐다. 그런데 네이티브 `<select>` 는
 * KaTeX 를 못 그려서 옵션 글자가 순수 텍스트뿐인데, 종전 구현은 거기에 더해 `$...$` 를
 * **통째로 지우고** 28자에서 잘랐다. 수학 문제는 수식이 본체라 「이차함수 의 그래프를
 * 축의 방향으로 만큼 평행이동」처럼 뼈대만 남아 무엇을 고르는지 알 수 없었다.
 * 그래서 고르는 자리를 **이미 수식이 렌더된 카드**로 옮겼다 — 보고 있는 것이 곧 고른 것이다.
 *
 * 결과는 바로 저장하지 않는다. 후보를 먼저 보여 주고 **채택한 것만** 적재한다.
 * 원본 재현 검사에 떨어진 후보도 사유와 함께 그대로 보여 준다 — 걸러 보내면
 * 「3개 요청했는데 1개」라는 사실만 남고 왜인지가 사라진다.
 */

const MICRO = "text-[10px] font-extrabold tracking-[1.2px]";

/**
 * 채택할 수 있는 후보인가 — **한 곳에서만 판단한다.**
 * 체크박스·개수·저장 목록이 각자 조건을 적으면 한쪽만 고쳐도 아무도 모른다.
 */
function isAdoptable(
  candidate: TransformCandidate,
  figureRequired: boolean,
): boolean {
  if (!candidate.verified) return false;
  // 그림 문항인데 도형을 못 그렸으면 못 쓴다 — 본문이 그림을 가리키는 채로 나간다.
  return !figureRequired || candidate.figureSvg !== null;
}

type Props = {
  origin: ProblemEntity;
  /** 채택분이 저장되면 목록 갱신을 위해 알린다. */
  onAdopted: (created: ProblemEntity[]) => void;
  onClose: () => void;
};

type Stage =
  | { name: "설정" }
  | {
      name: "결과";
      candidates: TransformCandidate[];
      /** 이 원본이 그림에 기대는 문항인가 — 참이면 도형이 있는 후보만 채택할 수 있다. */
      figureRequired: boolean;
    };

export function ProblemTransformPanel({ origin, onAdopted, onClose }: Props) {
  const [count, setCount] = useState("1");
  const [mode, setMode] = useState<TransformMode>("numbers");
  const [difficultyShift, setDifficultyShift] =
    useState<DifficultyShift>("keep");
  const [stage, setStage] = useState<Stage>({ name: "설정" });
  // 채택 표시는 후보 **위치**로 잡는다 — 본문이 같은 후보가 나올 수 있어 내용은 열쇠가 못 된다.
  const [adopted, setAdopted] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runTransform() {
    setPending(true);
    setError(null);
    try {
      const body = await transformProblems({
        originProblemId: origin.id,
        count: Number(count),
        mode,
        difficultyShift,
      });
      setStage({
        name: "결과",
        candidates: body.data,
        figureRequired: body.meta.figureRequired,
      });
      // 통과한 후보는 기본으로 채택 표시 — 떨어진 것은 애초에 고를 수 없다.
      // 그림 때문에 막힌 경우는 하나도 고르지 않는다.
      setAdopted(
        new Set(
          body.data.flatMap((candidate, at) =>
            isAdoptable(candidate, body.meta.figureRequired) ? [at] : [],
          ),
        ),
      );
    } catch (caught) {
      // 서버가 보낸 사유를 그대로 보여 준다(problemApi.failWithServerReason).
      setError(caught instanceof Error ? caught.message : "변형에 실패했습니다");
    } finally {
      setPending(false);
    }
  }

  async function saveAdopted() {
    if (stage.name !== "결과") return;
    const items = stage.candidates
      .filter(
        (candidate, at) =>
          isAdoptable(candidate, stage.figureRequired) && adopted.has(at),
      )
      .map((candidate) => ({
        content: candidate.content,
        answer: candidate.answer,
        solution: candidate.solution,
        // 서버가 원본 정답과 다시 대 본다 — 검사를 브라우저에만 두지 않는다.
        originalAnswerRecomputed: candidate.originalAnswerRecomputed,
        // SVG 가 아니라 **스펙**을 돌려보낸다. 서버가 다시 그린다(주입 통로를 두지 않는다).
        figureSpec: candidate.figureSpec,
      }));
    if (items.length === 0) return;

    setPending(true);
    setError(null);
    try {
      const body = await adoptTransformed({
        originProblemId: origin.id,
        difficultyShift,
        items,
      });
      onAdopted(body.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "채택에 실패했습니다");
      setPending(false);
    }
  }

  function toggleAdopted(at: number) {
    setAdopted((current) => {
      const next = new Set(current);
      if (next.has(at)) next.delete(at);
      else next.add(at);
      return next;
    });
  }

  const figureRequired = stage.name === "결과" ? stage.figureRequired : false;
  const adoptedCount =
    stage.name === "결과"
      ? stage.candidates.filter(
          (c, at) => isAdoptable(c, figureRequired) && adopted.has(at),
        ).length
      : 0;

  return (
    <section
      aria-label="변형"
      className="mt-4 border border-divider bg-side p-4 print:hidden"
    >
      {/* 원본 본문은 **바로 위 카드에 이미 있다** — 다시 그리지 않는다. 다만 정답은
          카드에서 접혀 있어(정답·해설 토글) 결과와 견줄 수 없으므로 그것만 펼쳐 둔다. */}
      <p className="flex flex-wrap items-baseline gap-2">
        <span className={`${MICRO} text-text-2`}>원본 정답</span>
        <MathText className="text-[12.5px] font-bold text-ink" text={origin.answer} />
      </p>

      {stage.name === "설정" ? (
        <>
          <div className="mt-3 flex flex-wrap gap-3">
            <FieldSelect
              label="개수"
              value={count}
              onChange={(event) => setCount(event.target.value)}
            >
              {Array.from({ length: 10 }, (_, at) => String(at + 1)).map(
                (value) => (
                  <option key={value} value={value}>
                    {`${value}개`}
                  </option>
                ),
              )}
            </FieldSelect>
            <FieldSelect
              label="방식"
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as TransformMode)
              }
            >
              <option value="numbers">숫자만</option>
              <option value="conditions">조건까지</option>
            </FieldSelect>
            <FieldSelect
              label="난이도"
              value={difficultyShift}
              onChange={(event) =>
                setDifficultyShift(event.target.value as DifficultyShift)
              }
            >
              <option value="keep">원본 유지</option>
              <option value="up">한 단계 위</option>
              <option value="down">한 단계 아래</option>
            </FieldSelect>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              취소
            </Button>
            <Button variant="ink" onClick={runTransform} disabled={pending}>
              {pending ? "변형하는 중" : "변형하기"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <h3 className={`mt-4 ${MICRO} text-ink`}>
            {`변형 결과 ${stage.candidates.length}건`}
          </h3>
          {/* 그림 문항이라는 사실을 **먼저** 말한다. 도형이 왜 붙어 있는지,
              왜 어떤 후보는 못 쓰는지가 그 다음 줄들에서 이어진다. */}
          {figureRequired ? (
            <p
              role="status"
              className="mt-2 border-l-[3px] border-ink bg-surface p-3 text-[12.5px] text-ink"
            >
              그림이 있어야 풀리는 문항입니다 — 변형본의 도형을 새로 그렸습니다. 도형까지
              확인하고 채택해주세요.
            </p>
          ) : null}
          <ol className="mt-2 space-y-2">
            {stage.candidates.map((candidate, at) => (
              <li
                // 후보는 순서가 곧 신원이다(같은 본문이 나올 수 있다).
                key={at}
                className="border border-divider bg-surface p-4"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={`${MICRO} text-text-2`}>{at + 1}</span>
                  {isAdoptable(candidate, figureRequired) ? (
                    <label className="ml-auto flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={adopted.has(at)}
                        onChange={() => toggleAdopted(at)}
                        className="h-4 w-4 cursor-pointer accent-[var(--blue)]"
                      />
                      <span className={`${MICRO} text-ink`}>채택</span>
                    </label>
                  ) : (
                    <span className={`ml-auto ${MICRO} text-g-red-text`}>
                      폐기
                    </span>
                  )}
                </div>
                <MathText
                  as="div"
                  className="mt-2 text-[13px] text-ink"
                  text={candidate.content}
                />
                {/* 도형은 **서버가 그린 것**만 그린다 — 엔진(`render_figure_spec`)이 만들고
                    `sanitize_svg` 를 통과한 마크업이다. 클라이언트가 SVG 를 만들거나 실어
                    보내는 경로는 없다(계약: 채택 시 되돌아가는 것은 스펙뿐). */}
                {figureRequired && candidate.figureSvg ? (
                  <div
                    data-figure-preview
                    className="mt-3 max-w-[280px] [&>svg]:h-auto [&>svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: candidate.figureSvg }}
                  />
                ) : null}
                {figureRequired && candidate.figureError ? (
                  <p className={`mt-2 ${MICRO} text-g-red-text`}>
                    {`도형 없음 — ${candidate.figureError}`}
                  </p>
                ) : null}
                <p className="mt-2 flex flex-wrap items-baseline gap-2">
                  <span className={`${MICRO} text-text-2`}>정답</span>
                  <MathText
                    className="text-[12.5px] font-bold text-ink"
                    text={candidate.answer}
                  />
                </p>
                {/* 검사 결과는 통과·탈락 **양쪽 다** 적는다. 탈락만 적으면 통과가
                    「검사를 안 한 것」과 구분되지 않는다. */}
                {candidate.verified ? (
                  <p className={`mt-2 ${MICRO} text-g-green`}>
                    원본 재현 검사 통과
                  </p>
                ) : (
                  <p className={`mt-2 ${MICRO} text-g-red-text`}>
                    {`원본 재현 검사 실패 — 재현값 ${candidate.originalAnswerRecomputed} ≠ 원본 정답 ${origin.answer}`}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <span className={`mr-auto ${MICRO} text-text-2`}>
              {`채택 ${adoptedCount}건`}
            </span>
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              전부 버림
            </Button>
            <Button
              variant="ink"
              onClick={saveAdopted}
              disabled={pending || adoptedCount === 0}
            >
              {pending ? "저장하는 중" : "채택분 저장"}
            </Button>
          </div>
        </>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] font-bold text-g-red-text">
          {error}
        </p>
      ) : null}
    </section>
  );
}
