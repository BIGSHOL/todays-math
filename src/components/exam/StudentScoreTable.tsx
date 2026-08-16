import { ActualScoreCell } from "./ActualScoreCell";
import type { ExamStudentRow } from "./examScreen.contract";
import { ScoreIntervalBar } from "./ScoreIntervalBar";
import {
  INTERVAL_SCALE_MAX,
  INTERVAL_SCALE_MIN,
  formatScore,
  residualView,
  studentJudgement,
  unavailableText,
} from "./viewModel";

/**
 * 학생 표 — 예상 → 구간 → 실제 → 잔차 (D-40 · D-42 확정).
 *
 * 왼쪽에서 오른쪽으로 읽으면 그대로 "예측이 얼마나 맞았나"가 된다.
 *
 * 🔴 숫자를 못 내는 학생은 **빈칸이 아니라 이유**를 적는다 — `미응시` / `예측 불가 — 응답 부족`.
 *    빈칸은 "0점"이나 "아직 로딩 중"으로 오해된다.
 * 🔴 잔차는 색과 함께 **말**을 병기한다(`적중` / `빗나감`).
 * 🔴 D-30 — 표 행에 hover 배경이나 손가락 커서를 주지 않는다. 행은 눌리지 않는다.
 */
const HEAD =
  "border-b border-ink px-0 py-1.5 pr-2.5 text-left text-[11.5px] font-bold whitespace-nowrap text-muted";
const CELL = "border-b border-divider px-0 py-2 pr-2.5 whitespace-nowrap";

type Props = {
  students: ExamStudentRow[];
  roundAvailable: boolean;
  caption: string;
  /** 회차 id = `PredictionRun.id`. 실점수 저장에 쓴다. */
  runId: string;
  onActualSaved: (studentId: string, actualScore: number) => void;
};

export function StudentScoreTable({
  students,
  roundAvailable,
  caption,
  runId,
  onActualSaved,
}: Props) {
  if (students.length === 0) {
    return (
      <p className="mt-5 text-[13px] text-muted">
        이 회차에 배정된 학생이 없습니다
      </p>
    );
  }

  return (
    <table className="mt-5 w-full border-collapse text-[13px] tabular-nums">
      <caption className="pb-2 text-left text-[11.5px] font-black tracking-[0.08em] text-muted uppercase">
        {caption}
      </caption>
      <thead>
        <tr>
          <th scope="col" className={HEAD}>
            학생
          </th>
          <th scope="col" className={`${HEAD} text-right`}>
            예상
          </th>
          <th scope="col" className={HEAD}>
            구간 {INTERVAL_SCALE_MIN} — {INTERVAL_SCALE_MAX}
          </th>
          <th scope="col" className={`${HEAD} text-right`}>
            실제
          </th>
          <th scope="col" className={HEAD}>
            잔차
          </th>
        </tr>
      </thead>
      <tbody>
        {students.map((row) => {
          const judgement = studentJudgement(row, roundAvailable);
          const residual =
            judgement.available && row.prediction
              ? residualView(
                  row.prediction.expectedScore,
                  row.prediction.interval,
                  row.actualScore,
                )
              : null;

          return (
            <tr key={row.studentId}>
              <th scope="row" className={`${CELL} text-left font-bold`}>
                {row.studentName}
              </th>

              {judgement.available && row.prediction ? (
                <>
                  <td className={`${CELL} text-right`}>
                    {formatScore(row.prediction.expectedScore)}
                  </td>
                  <td className={CELL}>
                    <ScoreIntervalBar
                      interval={row.prediction.interval}
                      expectedScore={row.prediction.expectedScore}
                    />
                  </td>
                </>
              ) : (
                <>
                  <td className={`${CELL} text-right text-ghost`}>—</td>
                  <td className={`${CELL} text-ghost`}>
                    {unavailableText(judgement)}
                  </td>
                </>
              )}

              {/* 실측 — 보정 루프의 입력구.
                  🔴 응시하지 않은 학생에게는 입력 자리를 주지 않는다. 붙일 예측이 없어
                     서버가 422 로 거절할 요청을 화면이 만들어 내지 않는다. */}
              <td className={`${CELL} text-right`}>
                {row.absent ? (
                  // 확정 시안은 미응시 학생의 실측 칸을 **비워** 둔다.
                  // 사유("미응시")는 같은 행 예측 쪽에 이미 적혀 있다 — 두 번 쓰면 잡음이다.
                  <span className="text-ghost" />
                ) : (
                  <ActualScoreCell
                    actualScore={row.actualScore}
                    onSaved={onActualSaved}
                    runId={runId}
                    studentId={row.studentId}
                    studentName={row.studentName}
                  />
                )}
              </td>

              <td
                className={`${CELL} ${
                  residual === null
                    ? "text-ghost"
                    : residual.hit
                      ? "font-bold text-g-green"
                      : "font-bold text-g-red-text"
                }`}
              >
                {residual === null ? "—" : residual.text}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
