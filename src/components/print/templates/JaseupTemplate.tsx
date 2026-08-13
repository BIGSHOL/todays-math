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
}

function formatPrintDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : date;
}

export function JaseupTemplate({
  meta,
  page,
  problems,
  startingNumber,
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
          return (
            <article
              className={styles.problemItem}
              data-problem-number={problemNumber}
              key={problem.id}
            >
              <div className={styles.questionArea}>
                <div className={styles.questionNumber}>문 {problemNumber}</div>
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
}
