import { MathText } from "@/components/math/MathText";
import { A4Page } from "@/components/print/A4Page";
import type { TestPrintProblem } from "@/components/print/types";

import styles from "./TestPrint.module.css";

interface PrintAnswerKeyPageProps {
  allProblems: TestPrintProblem[];
  pageProblems: TestPrintProblem[];
  page: number;
  startingNumber: number;
  testTitle: string;
  totalPages: number;
}

export function PrintAnswerKeyPage({
  allProblems,
  pageProblems,
  page,
  startingNumber,
  testTitle,
  totalPages,
}: PrintAnswerKeyPageProps) {
  const isFirstPage = page === 1;

  return (
    <A4Page className={styles.answerPage} kind="answers" pageNumber={page}>
      <header className={styles.answerHeader}>
        <div>
          <div className={styles.answerEyebrow}>오늘의수학 · ANSWER KEY</div>
          <h2>{testTitle}</h2>
        </div>
        <span>
          정답 및 해설 · {page} / {totalPages}
        </span>
      </header>

      {isFirstPage ? (
        <section className={styles.quickAnswerBox}>
          <h3>빠른 정답</h3>
          <div className={styles.quickAnswerGrid}>
            {allProblems.map((problem, index) => (
              <div
                className={styles.quickAnswerCell}
                data-testid={`quick-answer-${index + 1}`}
                key={problem.id}
              >
                <strong>문 {index + 1}</strong>
                <MathText as="span" text={problem.answer} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div
        className={styles.answerSolutions}
        data-testid="answer-solutions"
        style={{ columnCount: 2 }}
      >
        {pageProblems.map((problem, index) => {
          const problemNumber = startingNumber + index;
          return (
            <article className={styles.solutionItem} key={problem.id}>
              <div
                className={styles.solutionHeading}
                data-testid={`answer-heading-${problemNumber}`}
              >
                문 {problemNumber} ·{" "}
                <MathText as="span" text={problem.answer} />
              </div>
              <div className={styles.solutionBody}>
                <MathText
                  as="div"
                  text={problem.solution ?? "해설이 등록되지 않았습니다."}
                />
              </div>
            </article>
          );
        })}
      </div>

      <footer className={styles.answerFooter}>오늘의수학 · p. {page}</footer>
    </A4Page>
  );
}
