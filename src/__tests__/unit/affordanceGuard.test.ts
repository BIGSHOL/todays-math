/**
 * D-30 — 마우스 어포던스 가드.
 * 클릭되지 않는 카드/행에 손가락·hover를 두면 커밋이 실패해야 한다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  scanButtonContract,
  scanCss,
  scanGlobalsContract,
  scanProject,
  scanTsx,
} from "../../lint/scanAffordance.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");

describe("[D-30] 스니펫 — 거짓 손가락/호버를 잡는다", () => {
  it("article에 cursor-pointer를 두면 false-pointer다 (원래 반 카드 버그)", () => {
    const findings = scanTsx(
      "ClassCard.tsx",
      `export function ClassCard() {
        return <article aria-label="테스트반" className="cursor-pointer grid">테스트반</article>;
      }`,
    );
    expect(findings.map((f) => f.rule)).toContain("false-pointer");
  });

  it("상수로 뺀 cursor-pointer를 article에 써도 잡는다", () => {
    const findings = scanTsx(
      "ClassCard.tsx",
      `const CARD = "grid cursor-pointer";
      export function ClassCard() {
        return <article className={CARD}>테스트반</article>;
      }`,
    );
    expect(findings.map((f) => f.rule)).toContain("false-pointer");
  });

  it("버튼·링크의 cursor-pointer는 허용한다", () => {
    const findings = scanTsx(
      "Ok.tsx",
      `import Link from "next/link";
      export function Ok() {
        return (
          <>
            <button type="button" className="cursor-pointer">출제</button>
            <Link href="/classes" className="cursor-pointer">반</Link>
          </>
        );
      }`,
    );
    expect(findings).toEqual([]);
  });

  it("클릭되지 않는 tr hover 배경은 row-hover-lie다", () => {
    const findings = scanTsx(
      "Ledger.tsx",
      `export function Ledger() {
        return <tr className="hover:bg-white"><td>테스트반</td></tr>;
      }`,
    );
    expect(findings.map((f) => f.rule)).toContain("row-hover-lie");
  });

  it("article hover 배경도 surface-hover-lie다", () => {
    const findings = scanTsx(
      "Card.tsx",
      `export function Card() {
        return <article className="hover:bg-white">본문</article>;
      }`,
    );
    expect(findings.map((f) => f.rule)).toContain("surface-hover-lie");
  });

  it("div onClick에 role=button이 없으면 div-click이다", () => {
    const findings = scanTsx(
      "Row.tsx",
      `export function Row() {
        return <div onClick={() => undefined}>반</div>;
      }`,
    );
    expect(findings.map((f) => f.rule)).toContain("div-click");
  });

  it("div onClick + role=button은 허용한다", () => {
    const findings = scanTsx(
      "Row.tsx",
      `export function Row() {
        return (
          <div role="button" tabIndex={0} onClick={() => undefined}>
            반
          </div>
        );
      }`,
    );
    expect(findings).toEqual([]);
  });
});

describe("[D-30] CSS — 컨트롤이 아닌 선택자에 pointer 금지", () => {
  it("article { cursor: pointer } 를 잡는다", () => {
    const findings = scanCss("x.css", "article { cursor: pointer; }");
    expect(findings.map((f) => f.rule)).toContain("css-false-pointer");
  });

  it("button 선택자의 pointer는 허용한다", () => {
    expect(
      scanCss("x.css", "button:not(:disabled) { cursor: pointer; }"),
    ).toEqual([]);
  });
});

describe("[D-30] 계약 — 전역 CSS와 Button이 규칙을 유지한다", () => {
  it("globals.css에 손가락/금지 커서 규칙이 있다", () => {
    const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    expect(scanGlobalsContract(css)).toEqual([]);
  });

  it("Button.tsx는 활성 손가락·비활성 금지를 명시한다", () => {
    const src = readFileSync(
      path.join(ROOT, "src/components/ui/Button.tsx"),
      "utf8",
    );
    expect(scanButtonContract(src)).toEqual([]);
  });
});

describe("[D-30] 저장소 — 현재 src UI에 거짓 어포던스가 없다", () => {
  it("src 컴포넌트/스타일 스캔 결과가 비어 있다", () => {
    const findings = scanProject(ROOT);
    expect(findings).toEqual([]);
  });
});
