import { memo } from "react";

import { A4Page } from "@/components/print/A4Page";
import type {
  JaseupPrintMeta,
  TestPrintProblem,
} from "@/components/print/types";

import styles from "../TestPrint.module.css";
import { BodyContainer } from "./BodyContainer";
import { ProblemBody } from "./ProblemBody";

interface JaseupTemplateProps {
  meta: JaseupPrintMeta;
  page: number;
  problems: TestPrintProblem[];
  startingNumber: number;
  /**
   * 문항 id → 서술형 지면 순번. 장 단위로 못 세는 이유는 번호가 **시험지 전체**를
   * 가로지르기 때문이다(2장 첫 문항이 서술형 3일 수 있다). `TestPrint` 가
   * `useMemo` 로 한 번 만들어 넘긴다 — 매 렌더 새 Map 을 만들면 이 memo 가 죽는다.
   */
  essayLabels?: ReadonlyMap<string, number>;
}

function formatPrintDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : date;
}

/**
 * `memo` 인 이유: 한 장은 문항 두 개의 KaTeX 조판이고, 30문항이면 15장이다.
 * 모드 전환(문제지↔정답지)·인쇄 진행 상태·오류 문구 때문에 전 장을 다시
 * 조판할 이유가 없다. props 는 TestPrint 가 `useMemo` 로 고정해 준다
 * (`meta` 를 매 렌더 새 객체로 만들면 이 memo 가 통째로 죽는다).
 */
export const JaseupTemplate = memo(function JaseupTemplate({
  meta,
  page,
  problems,
  startingNumber,
  essayLabels,
}: JaseupTemplateProps) {
  const isFirstPage = page === 1;

  return (
    <A4Page
      className={isFirstPage ? styles.jaseupFirst : styles.jaseupContinuation}
      kind="questions"
      pageNumber={page}
    >
      {isFirstPage ? (
        <header className={styles.firstHeader}>
          <div>
            <div className={styles.academyName}>{meta.academyName}</div>
            <div className={styles.englishLabel}>SELF-STUDY</div>
            <h1 className={styles.testTitle}>{meta.title}</h1>
            <div className={styles.todayGoal}>
              오늘의 목표 · {meta.todayGoal}
            </div>
          </div>
          <div className={styles.studentMeta}>
            <div className={styles.dateLabel}>학습일</div>
            <div className={styles.dateValue}>
              {formatPrintDate(meta.examDate)}
            </div>
            <div className={styles.nameLine}>이름 ________ · 반 ______</div>
          </div>
        </header>
      ) : (
        <header className={styles.continuationHeader}>
          <span>
            {meta.academyName} · {meta.title}
          </span>
          <span>p. {page}</span>
        </header>
      )}

      {isFirstPage ? (
        <section className={styles.conceptBox}>
          <h2 className={styles.conceptTitle}>◆ 핵심 개념 정리</h2>
          <div className={styles.conceptText}>{meta.conceptNote}</div>
        </section>
      ) : null}

      <BodyContainer>
        {problems.map((problem, index) => {
          const problemNumber = startingNumber + index;
          const essayNumber = essayLabels?.get(problem.id);
          return (
            <article
              className={styles.problemItem}
              data-problem-number={problemNumber}
              key={problem.id}
            >
              <div className={styles.questionArea}>
                <div className={styles.questionNumber}>
                  문 {problemNumber}
                  {essayNumber ? (
                    <span className={styles.essayBadge}>
                      서술형 {essayNumber}
                    </span>
                  ) : null}
                </div>
                <ProblemBody problem={problem} />
                <div className={styles.answerBlank}>
                  <strong>내 정답</strong>
                  <span aria-hidden className={styles.answerLine} />
                  <span>채점</span>
                  <span aria-hidden className={styles.checkBox} />
                </div>
              </div>
              <div
                aria-label={`문 ${problemNumber} 풀이 공간`}
                className={styles.scratchPad}
              >
                <span>SCRATCH PAD</span>
              </div>
            </article>
          );
        })}
      </BodyContainer>

      <footer className={styles.pageFooter}>
        <strong>오늘의 메모</strong>
        <span aria-hidden className={styles.memoLine} />
        <span>p. {page}</span>
      </footer>
    </A4Page>
  );
});
