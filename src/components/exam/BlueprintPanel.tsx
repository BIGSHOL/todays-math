import type { Blueprint } from "@/contracts/predictor.contract";

import {
  blueprintSizeText,
  confidenceText,
  difficultyMixText,
  formatScore,
  typeMixText,
  unavailableText,
  unitMixText,
  type Judgement,
} from "./viewModel";

/**
 * 예측 | 실측 한쪽 기둥 (D-40 확정 — 좌우 대조).
 *
 * 두 기둥이 **같은 항목을 같은 순서로** 적는다. 그래야 눈으로 바로 대조된다.
 * 보정 루프가 화면 골격 그 자체이므로 "예측이 얼마나 맞았는지"가 항상 보여야 한다.
 *
 * 🔴 `judgement.available === false` 면 청사진 숫자를 **한 줄도 내지 않는다.**
 *    근거가 부족한 채로 "24문항 / 100점"을 적으면 원장님은 그걸 사실로 읽는다.
 */
type Props = {
  label: "예측" | "실측";
  blueprint: Blueprint | null;
  /** 예측 기둥에만 준다. 실측은 관측값이라 판정 대상이 아니다. */
  judgement?: Judgement;
  /** 청사진이 없을 때 적을 말. 비워 두지 않는다. */
  emptyText: string;
  /** 근거·신뢰도 한 줄. 예측 기둥에만 적는다. */
  basisText?: string | null;
};

function Field({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex gap-3 border-b border-divider py-2 text-[13px]">
      <dt className="w-[52px] shrink-0 text-[11.5px] font-bold text-muted">
        {name}
      </dt>
      <dd className="min-w-0 tabular-nums">{value}</dd>
    </div>
  );
}

export function BlueprintPanel({
  label,
  blueprint,
  judgement,
  emptyText,
  basisText,
}: Props) {
  const blocked = judgement !== undefined && !judgement.available;

  return (
    <section aria-label={label} className="min-w-0">
      <h2 className="border-b-2 border-ink pb-1.5 text-[11.5px] font-black tracking-[0.08em] text-muted uppercase">
        {label}
      </h2>

      {blocked ? (
        <div className="py-3">
          <p className="text-[15px] font-black text-g-red-text">
            {unavailableText(judgement)}
          </p>
          {basisText ? (
            <p className="mt-1 text-[12.5px] text-muted tabular-nums">
              {basisText}
            </p>
          ) : null}
          <p className="mt-2 text-[12.5px] text-muted">
            과거 회차가 쌓이면 예측을 냅니다. 지금은 숫자를 내지 않습니다.
          </p>
        </div>
      ) : !blueprint ? (
        <p className="py-3 text-[13px] text-muted">{emptyText}</p>
      ) : (
        <>
          <dl className="mt-1">
            <Field name="규모" value={blueprintSizeText(blueprint)} />
            <Field name="유형" value={typeMixText(blueprint)} />
            <Field name="난이도" value={difficultyMixText(blueprint)} />
            <Field name="단원" value={unitMixText(blueprint, 3)} />
            <Field
              name="평균"
              value={
                blueprint.expectedMean === null
                  ? "산출 안 됨"
                  : blueprint.expectedMeanInterval
                    ? `${formatScore(blueprint.expectedMean)} (${formatScore(
                        blueprint.expectedMeanInterval.lower,
                      )}~${formatScore(blueprint.expectedMeanInterval.upper)})`
                    : formatScore(blueprint.expectedMean)
              }
            />
          </dl>
          {basisText ? (
            <p className="pt-2 text-[12.5px] text-muted tabular-nums">
              {basisText}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** 예측 기둥의 근거 한 줄 — `근거 4회차 · 신뢰도 보통 0.62`. */
export function basisLine(
  evidenceCount: number,
  confidence: number | null,
): string {
  return `근거 ${evidenceCount}회차 · ${confidenceText(confidence)}`;
}
