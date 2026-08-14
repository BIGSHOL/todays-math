import { readFile } from "node:fs/promises";
import path from "node:path";

import { notFound } from "next/navigation";
import { connection } from "next/server";

import { MathText } from "@/components/math/MathText";
import {
  convertPastExamQuestion,
  normalizePastExamPaper,
  type PastExamAnswer,
  type PastExamPaper,
} from "@/lib/import/convertPastExam";
import { TESTCHANGER_CONTRACT_VERSION } from "@/lib/testchanger/contracts";
import { buildMathCorpusInventory } from "@/lib/testchanger/mathCorpusInventory";
import { buildMathRenderQa } from "@/lib/testchanger/mathRenderQa";
import { runTestchangerEngine } from "@/lib/testchanger/serverClient";

import styles from "./transferQa.module.css";

const REQUIRED_CASES = [
  ["산술", "사칙연산 $12-3\\times2\\div3=10$"],
  ["관계", "$a\\le b$, $b\\ge c$, $a\\ne c$, $x\\equiv y$"],
  ["집합", "$A\\cap B\\subseteq A\\cup B$, $x\\in A$, $y\\notin B$"],
  ["논리", "$p\\Rightarrow q$, $p\\Leftrightarrow q$, $\\neg p\\lor q$"],
  [
    "그리스 문자",
    "$\\alpha+\\beta=\\gamma$, $\\theta,\\lambda,\\mu,\\sigma,\\phi,\\omega$",
  ],
  ["분수·근호·첨자", "$x_1^2+\\dfrac{1}{\\sqrt{2}}=a_{n+1}$"],
  [
    "극한·미적분",
    "$\\lim_{x\\to0}\\dfrac{\\sin x}{x}=1$, $\\int_0^1x^2\\,dx=\\dfrac13$",
  ],
  [
    "벡터·행렬",
    "$\\vec{v}=\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}\\begin{bmatrix}x\\\\y\\end{bmatrix}$",
  ],
  [
    "기하 라벨",
    "점 $A$, 선분 $\\overline{AB}$, 각 $\\angle ABC=90^\\circ$, $\\triangle ABC$",
  ],
  ["한글 혼합식", "함수 $f(x)=x^2+1$의 최솟값은 $1$이고, $x=0$에서 얻는다."],
] as const;

interface Fixture {
  id: string;
  title: string;
  svg: string;
  sanitized: boolean;
}

function resultRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("시험지변환기 응답 result가 객체가 아닙니다.");
  }
  return value as Record<string, unknown>;
}

function fixtureList(value: unknown): Fixture[] {
  const fixtures = resultRecord(value).fixtures;
  if (!Array.isArray(fixtures)) throw new Error("SVG fixture 응답이 없습니다.");
  return fixtures.map((fixture) => {
    const item = resultRecord(fixture);
    if (
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      typeof item.svg !== "string" ||
      item.sanitized !== true
    ) {
      throw new Error("SVG fixture가 계약을 위반했습니다.");
    }
    return item as unknown as Fixture;
  });
}

function svgFromResult(value: unknown): string {
  const result = resultRecord(value);
  if (typeof result.svg !== "string" || result.sanitized !== true) {
    throw new Error("sanitize_svg를 통과한 SVG가 아닙니다.");
  }
  return result.svg;
}

function SanitizedSvg({ svg, label }: { svg: string; label: string }) {
  return (
    <div
      aria-label={label}
      className={styles.svgCanvas}
      data-qa-svg="sanitized"
      // The bridge returns SVG only after figure_quality.sanitize_svg succeeds.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default async function TransferQaPage() {
  await connection();

  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_TESTCHANGER_QA !== "1"
  ) {
    notFound();
  }

  const sourceRoot = process.env.TESTCHANGER_ROOT;
  if (!sourceRoot) {
    throw new Error(
      "TESTCHANGER_ROOT를 설정해야 전수 QA를 실행할 수 있습니다.",
    );
  }

  const corpusDir = path.join(sourceRoot, "db", "ocr_pilot");
  const sampleDir = path.join(
    sourceRoot,
    "corpus",
    "[경원고][2][기하][25-2-중간] (원본)",
  );
  const sampleJsonPath = path.join(sampleDir, "ocr", "p1_merged.json");
  const sampleImagePath = path.join(sampleDir, "pages", "p3.png");

  const [inventory, fixtureResponse, securityResponse, rawJson, image] =
    await Promise.all([
      buildMathCorpusInventory(corpusDir),
      runTestchangerEngine({
        contractVersion: TESTCHANGER_CONTRACT_VERSION,
        operation: "figure.qaFixtures",
      }),
      runTestchangerEngine({
        contractVersion: TESTCHANGER_CONTRACT_VERSION,
        operation: "figure.securityProbe",
      }),
      readFile(sampleJsonPath, "utf8"),
      readFile(sampleImagePath),
    ]);

  const rawPaper = JSON.parse(rawJson) as PastExamPaper & {
    questions?: Array<
      NonNullable<PastExamPaper["questions"]>[number] & { answer?: string }
    >;
  };
  const inlineAnswers = new Map(
    (rawPaper.questions ?? []).map((question) => [
      question.number,
      (question as typeof question & { answer?: string }).answer,
    ]),
  );
  const paper = normalizePastExamPaper(rawPaper, "visual-qa-sample");
  const selected = (paper.questions ?? []).slice(0, 2);
  const drafts = selected.map((question) =>
    convertPastExamQuestion(
      question,
      {
        number: question.number,
        answer: inlineAnswers.get(question.number),
      } satisfies PastExamAnswer,
      paper,
    ),
  );

  const [validationResponse, sampleFigureResponse] = await Promise.all([
    runTestchangerEngine({
      contractVersion: TESTCHANGER_CONTRACT_VERSION,
      operation: "ocr.validate",
      result: JSON.parse(rawJson) as Record<string, unknown>,
    }),
    runTestchangerEngine({
      contractVersion: TESTCHANGER_CONTRACT_VERSION,
      operation: "figure.render",
      width: 400,
      height: 280,
      elements: [
        { kind: "line", start: [58, 24], end: [58, 246], width: 2 },
        {
          kind: "polyline",
          points: Array.from({ length: 45 }, (_, index) => {
            const y = 25 + index * 5;
            return [100 + 0.0055 * (y - 135) ** 2, y] as [number, number];
          }),
          width: 2,
        },
        { kind: "line", start: [115, 64], end: [275, 220], width: 2 },
        { kind: "line", start: [135, 84], end: [58, 84], width: 1.3 },
        { kind: "line", start: [246, 192], end: [58, 192], width: 1.3 },
        { kind: "dot", point: [135, 84], radius: 3 },
        { kind: "dot", point: [246, 192], radius: 3 },
        { kind: "dot", point: [170, 118], radius: 3 },
        {
          kind: "label",
          point: [46, 28],
          text: "준선 ℓ",
          anchor: "end",
          fontSize: 14,
        },
        {
          kind: "label",
          point: [145, 76],
          text: "P",
          anchor: "start",
          fontSize: 14,
        },
        {
          kind: "label",
          point: [256, 207],
          text: "Q",
          anchor: "start",
          fontSize: 14,
        },
        {
          kind: "label",
          point: [177, 111],
          text: "F",
          anchor: "start",
          fontSize: 14,
        },
        {
          kind: "label",
          point: [52, 80],
          text: "H",
          anchor: "end",
          fontSize: 14,
        },
        {
          kind: "label",
          point: [52, 188],
          text: "H′",
          anchor: "end",
          fontSize: 14,
        },
        {
          kind: "label",
          point: [210, 265],
          text: "OCR 도형 설명의 결정론적 QA 해석",
          fontSize: 14,
        },
      ],
    }),
  ]);

  const qa = buildMathRenderQa(inventory);
  const fixtures = fixtureList(fixtureResponse.result);
  const security = resultRecord(securityResponse.result);
  const validation = resultRecord(validationResponse.result);
  const sampleSvg = svgFromResult(sampleFigureResponse.result);
  const imageData = `data:image/png;base64,${image.toString("base64")}`;

  return (
    <main className={styles.page} data-qa-page="transfer">
      <header className={styles.hero}>
        <p className={styles.eyebrow}>DEV · TESTCHANGER TRANSFER QA</p>
        <h1>OCR · 수식 · 결정론적 SVG 시각 검수</h1>
        <p>
          실제 프로덕션 <code>MathText</code>/KaTeX 경로와 버전 고정 Python
          어댑터를 함께 검수한다. 이 페이지는 DB를 읽거나 쓰지 않는다.
        </p>
        <dl className={styles.metrics} data-qa="summary">
          <div>
            <dt>JSON 파일</dt>
            <dd>{inventory.files}</dd>
          </div>
          <div>
            <dt>문자열</dt>
            <dd>{inventory.stringsScanned.toLocaleString("ko-KR")}</dd>
          </div>
          <div>
            <dt>Unicode</dt>
            <dd>
              {qa.renderedUnicodeSymbols}/{inventory.unicodeSymbols.length}
            </dd>
          </div>
          <div>
            <dt>LaTeX</dt>
            <dd>
              {qa.renderedLatexCommands}/{inventory.latexCommands.length}
            </dd>
          </div>
          <div>
            <dt>표본 묶음</dt>
            <dd>{qa.specimens.length}</dd>
          </div>
          <div>
            <dt>SVG sanitize</dt>
            <dd>
              {fixtures.length}/{fixtures.length}
            </dd>
          </div>
        </dl>
        <p className={styles.pass} data-qa="automated-status">
          누락: Unicode {qa.missingUnicodeSymbols.length} · LaTeX{" "}
          {qa.missingLatexCommands.length} · 금지 SVG 허용{" "}
          {Array.isArray(security.accepted) ? security.accepted.length : "?"}
        </p>
      </header>

      <section className={styles.section} data-qa-section="required-cases">
        <h2>필수 수식 범주</h2>
        <div className={styles.caseGrid}>
          {REQUIRED_CASES.map(([title, text]) => (
            <article className={styles.card} key={title}>
              <h3>{title}</h3>
              <MathText as="div" className={styles.renderOutput} text={text} />
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section} data-qa-section="unicode-inventory">
        <h2>Unicode 전수 인벤토리 · {inventory.unicodeSymbols.length}개</h2>
        <p>
          코퍼스에서 발견한 각 고유 기호를 실제 MathText 경로에 한 번씩 넣었다.
        </p>
        <div className={styles.tokenGrid}>
          {inventory.unicodeSymbols.map((item) => (
            <article
              className={styles.tokenCard}
              key={item.token}
              data-token={item.codePoint}
            >
              <MathText
                as="div"
                className={styles.tokenGlyph}
                text={item.token}
              />
              <code>{item.codePoint}</code>
              <small>
                {item.occurrences.toLocaleString("ko-KR")}회 · {item.fileCount}
                파일
              </small>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section} data-qa-section="latex-inventory">
        <h2>LaTeX 전수 표본 · {inventory.latexCommands.length}개</h2>
        <p>
          77개 명령을 모두 덮는 최소 greedy cover다. 각 표본은 실제 코퍼스
          문맥을 프로덕션 렌더러로 다시 그린다.
        </p>
        <div className={styles.specimenList}>
          {qa.specimens.map((specimen, index) => (
            <article
              className={styles.specimen}
              data-render-safe={specimen.safe ? "true" : "false"}
              key={specimen.id}
            >
              <div className={styles.specimenMeta}>
                <strong>#{index + 1}</strong>
                <span>
                  {specimen.file} · {specimen.jsonPath}
                </span>
                <code>
                  {specimen.coveredKeys
                    .map((key) => key.replace(/^\w+:/u, ""))
                    .join(" ")}
                </code>
              </div>
              <MathText
                as="div"
                className={styles.renderOutput}
                text={specimen.renderText}
              />
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section} data-qa-section="svg-fixtures">
        <h2>sanitize_svg 통과 SVG fixture · {fixtures.length}종</h2>
        <p>
          KaTeX 계층과 분리해 직접 SVG로 렌더한다. 보안 probe는
          {` ${String(security.probeCount)}개 모두 거부: ${
            Array.isArray(security.rejected)
              ? security.rejected.join(", ")
              : "응답 오류"
          }`}
          .
        </p>
        <div className={styles.svgGrid}>
          {fixtures.map((fixture) => (
            <article
              className={styles.card}
              key={fixture.id}
              data-fixture={fixture.id}
            >
              <h3>{fixture.title}</h3>
              <SanitizedSvg svg={fixture.svg} label={fixture.title} />
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section} data-qa-section="ocr-pipeline">
        <h2>기존 OCR 결과 → 정규화 → 수식/SVG → 화면</h2>
        <p>
          외부 OCR은 재호출하지 않았다. 기존 결과{" "}
          {String(validation.questionCount)}문항을 원본 이미지와 비교하며,
          아래는 첫 2문항의 실제 변환 결과다.
        </p>
        <div className={styles.compareGrid}>
          <figure className={styles.sourceFigure}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local QA data URI; no artifact is copied */}
            <img
              alt="경원고 기하 시험 원본 페이지"
              height={2336}
              src={imageData}
              width={1640}
            />
            <figcaption>원본 p3.png (로컬에서만 읽음)</figcaption>
          </figure>
          <div className={styles.normalizedColumn}>
            {drafts.map((draft) => (
              <article className={styles.problemCard} key={draft.externalId}>
                <h3>{draft.externalId}</h3>
                <MathText
                  as="div"
                  className={styles.renderOutput}
                  text={draft.content}
                />
                <p>
                  <strong>정답</strong> <MathText text={draft.answer} />
                </p>
              </article>
            ))}
            <article className={styles.problemCard}>
              <h3>문항 2 도형 설명 → SVG 어댑터 QA 해석</h3>
              <SanitizedSvg
                svg={sampleSvg}
                label="포물선 OCR 설명을 이용한 결정론적 SVG"
              />
            </article>
            <details>
              <summary>구조화 OCR 원문(첫 2문항)</summary>
              <pre>{JSON.stringify(selected, null, 2)}</pre>
            </details>
          </div>
        </div>
      </section>
    </main>
  );
}
