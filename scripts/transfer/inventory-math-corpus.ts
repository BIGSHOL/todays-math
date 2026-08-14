import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildMathCorpusInventory } from "../../src/lib/testchanger/mathCorpusInventory";
import { buildMathRenderQa } from "../../src/lib/testchanger/mathRenderQa";

function argAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const sourceDir = path.resolve(
    argAfter("--source-dir") ?? "F:\\시험지변환기\\db\\ocr_pilot",
  );
  const qa = buildMathRenderQa(await buildMathCorpusInventory(sourceDir));
  const report = {
    generatedAt: new Date().toISOString(),
    sourceDir,
    files: qa.inventory.files,
    stringsScanned: qa.inventory.stringsScanned,
    unicodeSymbolCount: qa.inventory.unicodeSymbols.length,
    latexCommandCount: qa.inventory.latexCommands.length,
    renderedUnicodeSymbols: qa.renderedUnicodeSymbols,
    renderedLatexCommands: qa.renderedLatexCommands,
    missingUnicodeSymbols: qa.missingUnicodeSymbols,
    missingLatexCommands: qa.missingLatexCommands,
    specimenCount: qa.specimens.length,
    unicodeSymbols: qa.inventory.unicodeSymbols,
    latexCommands: qa.inventory.latexCommands,
    specimenCoverage: qa.specimens.map((item) => ({
      id: item.id,
      file: item.file,
      jsonPath: item.jsonPath,
      safe: item.safe,
      coveredKeys: item.coveredKeys,
    })),
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const outFile = argAfter("--out");
  if (outFile) {
    const resolved = path.resolve(outFile);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, json, "utf8");
  }
  process.stdout.write(json);
  if (qa.missingUnicodeSymbols.length || qa.missingLatexCommands.length) {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
