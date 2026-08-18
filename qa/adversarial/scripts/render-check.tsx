/** 적대적 리뷰 — 문항 하나를 **지면과 같은 렌더**로 그려 HTML 을 본다. 읽기 전용. */
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownRenderer } from "../../../src/components/math/MarkdownRenderer";
import { parseProblemContent } from "../../../src/lib/problem/parseProblemContent";

const raw = process.argv[2] ?? "";
const { question } = parseProblemContent(raw);
console.log("QUESTION:", JSON.stringify(question));
const html = renderToStaticMarkup(<MarkdownRenderer content={question} />);
console.log("\nHTML(발췌):");
console.log(
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 900),
);
