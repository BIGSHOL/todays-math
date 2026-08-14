import path from "node:path";

import { scanTsx } from "./scanAffordance.mjs";

/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  meta: {
    name: "affordance",
  },
  rules: {
    "no-false-affordance": {
      meta: {
        type: "problem",
        docs: {
          description:
            "D-30: 클릭되지 않는 요소에 손가락 커서·행 hover·div onClick을 금지한다.",
        },
        schema: [],
        messages: {
          affordance: "[D-30 {{rule}}] {{detail}}",
        },
      },
      create(context) {
        return {
          Program() {
            const filename = context.filename;
            if (!/\.tsx$/.test(filename)) return;
            if (filename.split(path.sep).includes("__tests__")) return;
            const source = context.sourceCode.text;
            for (const finding of scanTsx(filename, source)) {
              context.report({
                loc: { line: finding.line, column: 0 },
                messageId: "affordance",
                data: { rule: finding.rule, detail: finding.message },
              });
            }
          },
        };
      },
    },
  },
};

export default plugin;
