import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";

function argAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function captureSection(
  page: Page,
  selector: string,
  outputDir: string,
  name: string,
) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  await target.screenshot({ path: path.join(outputDir, `${name}.png`) });
}

async function captureVerticalChunks(
  page: Page,
  selector: string,
  outputDir: string,
  name: string,
): Promise<number> {
  const target = page.locator(selector);
  const box = await target.boundingBox();
  const documentTop = await target.evaluate(
    (element) => element.getBoundingClientRect().top + window.scrollY,
  );
  const viewport = page.viewportSize();
  if (!box || !viewport)
    throw new Error(`${selector}의 capture 범위를 얻지 못했습니다.`);
  const overlap = 120;
  const step = viewport.height - overlap;
  const chunks = Math.max(1, Math.ceil((box.height - overlap) / step));
  for (let index = 0; index < chunks; index += 1) {
    const offset = Math.min(
      index * step,
      Math.max(0, box.height - viewport.height),
    );
    await page.evaluate((y) => window.scrollTo(0, y), documentTop + offset);
    await page.screenshot({
      path: path.join(
        outputDir,
        `${name}-${String(index + 1).padStart(2, "0")}.png`,
      ),
    });
  }
  return chunks;
}

async function inspectDom(page: Page) {
  return page.evaluate(() => {
    const all = (selector: string) => [...document.querySelectorAll(selector)];
    const visibleRawLatex = all("[class*='renderOutput']")
      .map((element) => (element as HTMLElement).innerText)
      .filter((text) => /\\[A-Za-z]+/u.test(text))
      .slice(0, 10);
    const visibleCaretMath = all("[class*='renderOutput']")
      .map((element) => (element as HTMLElement).innerText)
      .filter((text) => /[A-Za-z0-9]\^[A-Za-z0-9{]/u.test(text))
      .slice(0, 10);
    const bodyOverflow =
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth;
    const overflowingCards = all(
      "[class*='card'], [class*='specimen'], [class*='problemCard']",
    )
      .filter(
        (element) =>
          (element as HTMLElement).scrollWidth >
          (element as HTMLElement).clientWidth + 1,
      )
      .map((element) => ({
        className: element.className,
        overflow:
          (element as HTMLElement).scrollWidth -
          (element as HTMLElement).clientWidth,
      }))
      .slice(0, 20);
    const svgIssues = all("[data-qa-svg='sanitized'] svg").flatMap(
      (element, svgIndex) => {
        const svg = element as SVGSVGElement;
        const viewBox = svg.viewBox.baseVal;
        return [...svg.querySelectorAll("text")].flatMap((label) => {
          const box = label.getBBox();
          const outside =
            box.x < viewBox.x - 1 ||
            box.y < viewBox.y - 1 ||
            box.x + box.width > viewBox.x + viewBox.width + 1 ||
            box.y + box.height > viewBox.y + viewBox.height + 1;
          return outside
            ? [
                {
                  svgIndex,
                  label: label.textContent ?? "",
                  box: {
                    x: box.x,
                    y: box.y,
                    width: box.width,
                    height: box.height,
                  },
                },
              ]
            : [];
        });
      },
    );
    return {
      viewport: { width: innerWidth, height: innerHeight },
      unicodeCards: all("[data-token]").length,
      latexSpecimens: all("[data-render-safe]").length,
      unsafeSpecimens: all("[data-render-safe='false']").length,
      sanitizedSvgs: all("[data-qa-svg='sanitized'] svg").length,
      katexErrors: all(".katex-error").length,
      mathRawFallbacks: all(".math-raw").length,
      replacementCharacters: document.body.innerText.match(/�/gu)?.length ?? 0,
      visibleRawLatex,
      visibleCaretMath,
      bodyOverflow,
      overflowingCards,
      forbiddenSvgNodes: all(
        "[data-qa-svg='sanitized'] script, [data-qa-svg='sanitized'] foreignObject, [data-qa-svg='sanitized'] image, [data-qa-svg='sanitized'] [onload], [data-qa-svg='sanitized'] [filter], [data-qa-svg='sanitized'] [href^='http']",
      ).length,
      svgIssues,
    };
  });
}

async function main() {
  const url = argAfter("--url") ?? "http://127.0.0.1:3107/dev/transfer-qa";
  const outputDir = path.resolve(argAfter("--out-dir") ?? ".qa-artifacts");
  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    // tsx/esbuild may annotate functions serialized into page.evaluate with
    // __name(); make that harmless helper available in the browser realm.
    await page.addInitScript({
      content: "globalThis.__name = (target) => target;",
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 180_000 });
    await page.locator("[data-qa-page='transfer']").waitFor();

    const desktop = await inspectDom(page);
    await page.locator("[data-qa-page='transfer'] > header").screenshot({
      path: path.join(outputDir, "desktop-summary.png"),
    });
    await captureSection(
      page,
      "[data-qa-section='required-cases']",
      outputDir,
      "desktop-required-cases",
    );
    await captureSection(
      page,
      "[data-qa-section='unicode-inventory']",
      outputDir,
      "desktop-unicode-inventory",
    );
    await captureSection(
      page,
      "[data-qa-section='latex-inventory']",
      outputDir,
      "desktop-latex-inventory",
    );
    const desktopLatexChunks = await captureVerticalChunks(
      page,
      "[data-qa-section='latex-inventory']",
      outputDir,
      "desktop-latex-chunk",
    );
    await captureSection(
      page,
      "[data-qa-section='svg-fixtures']",
      outputDir,
      "desktop-svg-fixtures",
    );
    await captureSection(
      page,
      "[data-qa-section='ocr-pipeline']",
      outputDir,
      "desktop-ocr-pipeline",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    const narrow = await inspectDom(page);
    await captureSection(
      page,
      "[data-qa-section='required-cases']",
      outputDir,
      "narrow-required-cases",
    );
    await captureSection(
      page,
      "[data-qa-section='unicode-inventory']",
      outputDir,
      "narrow-unicode-inventory",
    );
    await captureSection(
      page,
      "[data-qa-section='latex-inventory']",
      outputDir,
      "narrow-latex-inventory",
    );
    await captureSection(
      page,
      "[data-qa-section='svg-fixtures']",
      outputDir,
      "narrow-svg-fixtures",
    );
    await captureSection(
      page,
      "[data-qa-section='ocr-pipeline']",
      outputDir,
      "narrow-ocr-pipeline",
    );

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ media: "print" });
    const print = await inspectDom(page);
    await captureSection(
      page,
      "[data-qa-section='required-cases']",
      outputDir,
      "print-required-cases",
    );
    await captureSection(
      page,
      "[data-qa-section='svg-fixtures']",
      outputDir,
      "print-svg-fixtures",
    );
    await captureSection(
      page,
      "[data-qa-section='ocr-pipeline']",
      outputDir,
      "print-ocr-pipeline",
    );

    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "80%";
    });
    const zoom80 = await inspectDom(page);
    await captureSection(
      page,
      "[data-qa-section='required-cases']",
      outputDir,
      "zoom80-required-cases",
    );
    await captureSection(
      page,
      "[data-qa-section='ocr-pipeline']",
      outputDir,
      "zoom80-ocr-pipeline",
    );

    const report = {
      generatedAt: new Date().toISOString(),
      browser: await browser.version(),
      url,
      desktop,
      desktopLatexChunks,
      narrow,
      print,
      zoom80,
    };
    const failures = [desktop, narrow, print, zoom80].flatMap((mode) => [
      ...(mode.unicodeCards === 98
        ? []
        : [`Unicode cards=${mode.unicodeCards}`]),
      ...(mode.latexSpecimens > 0 ? [] : ["LaTeX specimen이 없습니다."]),
      ...(mode.unsafeSpecimens === 0 ? [] : [`unsafe=${mode.unsafeSpecimens}`]),
      ...(mode.sanitizedSvgs === 5 ? [] : [`SVG=${mode.sanitizedSvgs}`]),
      ...(mode.katexErrors === 0 ? [] : [`katex-error=${mode.katexErrors}`]),
      ...(mode.mathRawFallbacks === 0
        ? []
        : [`math-raw=${mode.mathRawFallbacks}`]),
      ...(mode.replacementCharacters === 0
        ? []
        : [`replacement=${mode.replacementCharacters}`]),
      ...(mode.visibleRawLatex.length === 0 ? [] : ["visible raw LaTeX"]),
      ...(mode.visibleCaretMath.length === 0 ? [] : ["visible caret math"]),
      ...(mode.bodyOverflow <= 1 ? [] : [`body overflow=${mode.bodyOverflow}`]),
      ...(mode.forbiddenSvgNodes === 0
        ? []
        : [`forbidden SVG=${mode.forbiddenSvgNodes}`]),
      ...(mode.svgIssues.length === 0
        ? []
        : [`SVG label outside=${mode.svgIssues.length}`]),
    ]);
    await writeFile(
      path.join(outputDir, "visual-qa.json"),
      `${JSON.stringify({ ...report, failures }, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(
      `${JSON.stringify({ ...report, failures }, null, 2)}\n`,
    );
    if (failures.length > 0) process.exitCode = 2;
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
