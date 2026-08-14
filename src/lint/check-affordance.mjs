import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { formatFindings, scanProject } from "./scanAffordance.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const requested = process.argv
  .slice(2)
  .filter((file) => /\.(tsx|jsx|css)$/.test(file));

const findings = scanProject(root, requested.length > 0 ? requested : undefined);

if (findings.length > 0) {
  process.stderr.write(
    `[D-30] 마우스 어포던스 위반 ${findings.length}건\n${formatFindings(findings)}\n`,
  );
  process.exit(1);
}
