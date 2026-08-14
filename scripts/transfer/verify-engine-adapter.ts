import { createHash } from "node:crypto";
import path from "node:path";

import {
  TESTCHANGER_CONTRACT_VERSION,
  type TestchangerEngineRequest,
} from "../../src/lib/testchanger/contracts";
import { runTestchangerEngine } from "../../src/lib/testchanger/cliClient";

function argAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function objectResult(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("엔진 result가 객체가 아닙니다.");
  }
  return value as Record<string, unknown>;
}

async function run(request: TestchangerEngineRequest) {
  const sourceRoot = argAfter("--source-root") ?? process.env.TESTCHANGER_ROOT;
  if (!sourceRoot) {
    throw new Error("--source-root 또는 TESTCHANGER_ROOT가 필요합니다.");
  }
  const pythonExecutable =
    argAfter("--python") ??
    process.env.TESTCHANGER_PYTHON ??
    path.join(sourceRoot, ".venv", "Scripts", "python.exe");
  return runTestchangerEngine(request, { sourceRoot, pythonExecutable });
}

async function main() {
  const health = objectResult(
    (
      await run({
        contractVersion: TESTCHANGER_CONTRACT_VERSION,
        operation: "health",
      })
    ).result,
  );
  const fixturesResult = objectResult(
    (
      await run({
        contractVersion: TESTCHANGER_CONTRACT_VERSION,
        operation: "figure.qaFixtures",
      })
    ).result,
  );
  const fixtures = fixturesResult.fixtures;
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw new Error("SVG QA fixture가 생성되지 않았습니다.");
  }
  const fixtureSummary = fixtures.map((fixture) => {
    const item = objectResult(fixture);
    if (typeof item.svg !== "string" || item.sanitized !== true) {
      throw new Error("sanitize_svg를 통과하지 않은 SVG fixture가 있습니다.");
    }
    return {
      id: item.id,
      bytes: Buffer.byteLength(item.svg, "utf8"),
      sha256: createHash("sha256").update(item.svg).digest("hex"),
    };
  });
  const security = objectResult(
    (
      await run({
        contractVersion: TESTCHANGER_CONTRACT_VERSION,
        operation: "figure.securityProbe",
      })
    ).result,
  );
  if (
    !Array.isArray(security.accepted) ||
    security.accepted.length !== 0 ||
    !Array.isArray(security.rejected) ||
    security.rejected.length !== security.probeCount
  ) {
    throw new Error("SVG sanitizer 보안 probe가 실패했습니다.");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        contractVersion: TESTCHANGER_CONTRACT_VERSION,
        sourceCommit: health.sourceCommit,
        releaseVersion: health.releaseVersion,
        sourceLicense: health.sourceLicense,
        hashesVerified: health.hashesVerified,
        fixtureCount: fixtureSummary.length,
        fixtures: fixtureSummary,
        sanitizerSecurityProbe: security,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
