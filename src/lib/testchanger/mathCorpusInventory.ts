import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Bracket/parenthesis delimiters are excluded from the one-character command
// set. The corpus contains Windows paths like `N:\\...\\[school]`, where `\\[`
// is not a LaTeX command.
const LATEX_COMMAND_RE = /\\(?:[A-Za-z]+|[{},.;:!%#$&_ |\\])/gu;
const DELIMITED_MATH_RE =
  /\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\$([^$\r\n]+?)\$|\\\(([\s\S]*?)\\\)/gu;

const EXTRA_MATH_SYMBOLS = new Set([
  "°",
  "℃",
  "℉",
  "π",
  "θ",
  "α",
  "β",
  "γ",
  "δ",
  "ε",
  "λ",
  "μ",
  "σ",
  "φ",
  "ω",
  "△",
  "□",
  "○",
]);

export interface CorpusTokenInventoryItem {
  token: string;
  occurrences: number;
  fileCount: number;
  mathContextCount: number;
  examples: string[];
  codePoint?: string;
}

export interface CorpusMathCandidate {
  id: string;
  file: string;
  jsonPath: string;
  renderText: string;
  isMath: boolean;
  commands: string[];
  unicodeSymbols: string[];
}

export interface MathCorpusInventory {
  sourceDir: string;
  files: number;
  stringsScanned: number;
  unicodeSymbols: CorpusTokenInventoryItem[];
  latexCommands: CorpusTokenInventoryItem[];
  candidates: CorpusMathCandidate[];
}

interface MutableToken {
  occurrences: number;
  files: Set<string>;
  mathContexts: Set<string>;
  examples: Set<string>;
}

function isUnicodeMathSymbol(character: string): boolean {
  const point = character.codePointAt(0);
  if (point === undefined || point <= 0x7f) return false;
  if (/\p{Sm}/u.test(character) || EXTRA_MATH_SYMBOLS.has(character)) {
    return true;
  }
  return (
    (point >= 0x370 && point <= 0x3ff) ||
    (point >= 0x2070 && point <= 0x209f) ||
    (point >= 0x2100 && point <= 0x214f) ||
    (point >= 0x2150 && point <= 0x218f) ||
    (point >= 0x2190 && point <= 0x23ff) ||
    (point >= 0x2460 && point <= 0x24ff) ||
    (point >= 0x25a0 && point <= 0x25ff) ||
    (point >= 0x1d400 && point <= 0x1d7ff) ||
    [0x338f, 0x339c, 0x339d, 0x339e, 0x33a1, 0x33a5].includes(point)
  );
}

function compactExample(value: string): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length <= 220 ? compact : `${compact.slice(0, 217)}…`;
}

function addToken(
  map: Map<string, MutableToken>,
  token: string,
  file: string,
  example: string,
  mathContextId?: string,
) {
  const item = map.get(token) ?? {
    occurrences: 0,
    files: new Set<string>(),
    mathContexts: new Set<string>(),
    examples: new Set<string>(),
  };
  item.occurrences += 1;
  item.files.add(file);
  if (mathContextId) item.mathContexts.add(mathContextId);
  if (item.examples.size < 3) item.examples.add(compactExample(example));
  map.set(token, item);
}

function markMathContext(
  map: Map<string, MutableToken>,
  token: string,
  file: string,
  example: string,
  mathContextId: string,
) {
  const item = map.get(token);
  if (!item) return;
  item.files.add(file);
  item.mathContexts.add(mathContextId);
  if (item.examples.size < 3) item.examples.add(compactExample(example));
}

function tokenSets(value: string) {
  return {
    commands: [...new Set(value.match(LATEX_COMMAND_RE) ?? [])],
    unicodeSymbols: [...new Set([...value].filter(isUnicodeMathSymbol))],
  };
}

function wrapMath(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.startsWith("$") ||
    trimmed.startsWith("\\[") ||
    trimmed.startsWith("\\(")
  ) {
    return trimmed;
  }
  return `$${trimmed}$`;
}

function syntheticCommandContext(token: string): string {
  if (["\\begin", "\\end", "\\hline", "\\\\"].includes(token)) {
    return "\\begin{array}{c}a\\\\\\hline b\\end{array}";
  }
  if (["\\left", "\\middle", "\\right"].includes(token)) {
    return "\\left\\{x\\middle|x>0\\right\\}";
  }
  if (["\\{", "\\}"].includes(token)) return "\\{x\\}";
  if (token === "\\big") return "\\big(x\\big)";
  if (token === "\\frac") return "\\frac{1}{2}";
  if (token === "\\sqrt") return "\\sqrt{x}";
  if (token === "\\underbrace") return "\\underbrace{x+1}_{n}";
  if (token === "\\bigstar") return "A^{\\bigstar}";
  if (token === "\\not") return "x\\not=y";
  if (token === "\\text") return "\\text{표본}";
  if (token === "\\%") return "50\\%";
  if (["\\ ", "\\,", "\\;", "\\!", "\\quad", "\\qquad"].includes(token)) {
    return `a${token}b`;
  }
  if (
    [
      "\\bar",
      "\\dot",
      "\\overline",
      "\\overrightarrow",
      "\\phantom",
      "\\mathrm",
      "\\boxed",
      "\\underline",
    ].includes(token)
  ) {
    return `${token}{AB}`;
  }
  return `${token} x`;
}

function toItems(
  map: Map<string, MutableToken>,
  includeCodePoint: boolean,
): CorpusTokenInventoryItem[] {
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([token, value]) => ({
      token,
      occurrences: value.occurrences,
      fileCount: value.files.size,
      mathContextCount: value.mathContexts.size,
      examples: [...value.examples],
      ...(includeCodePoint
        ? {
            codePoint: `U+${token
              .codePointAt(0)!
              .toString(16)
              .toUpperCase()
              .padStart(4, "0")}`,
          }
        : {}),
    }));
}

export async function buildMathCorpusInventory(
  sourceDir: string,
): Promise<MathCorpusInventory> {
  const files = (await readdir(sourceDir))
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "en"));
  const unicode = new Map<string, MutableToken>();
  const commands = new Map<string, MutableToken>();
  const candidates = new Map<string, CorpusMathCandidate>();
  let stringsScanned = 0;

  const addCandidate = (
    file: string,
    jsonPath: string,
    renderText: string,
    isMath: boolean,
  ) => {
    const trimmed = renderText.trim();
    if (!trimmed || trimmed.length > 4_000) return;
    const sets = tokenSets(trimmed);
    if (sets.commands.length === 0 && sets.unicodeSymbols.length === 0) return;
    const id = `${file}:${jsonPath}:${candidates.size + 1}`;
    const key = `${isMath ? "math" : "text"}\0${trimmed}`;
    if (candidates.has(key)) return;
    candidates.set(key, {
      id,
      file,
      jsonPath,
      renderText: isMath ? wrapMath(trimmed) : trimmed,
      isMath,
      ...sets,
    });
  };

  const visit = (
    value: unknown,
    file: string,
    jsonPath: string,
    parentType?: string,
  ) => {
    if (typeof value === "string") {
      stringsScanned += 1;
      const foundCommands = value.match(LATEX_COMMAND_RE) ?? [];
      const foundUnicode = [...value].filter(isUnicodeMathSymbol);
      for (const token of foundCommands) addToken(commands, token, file, value);
      for (const token of foundUnicode) addToken(unicode, token, file, value);

      let delimited = false;
      for (const match of value.matchAll(DELIMITED_MATH_RE)) {
        const inner = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
        const candidatePath = `${jsonPath}#math-${match.index ?? 0}`;
        addCandidate(file, candidatePath, inner, true);
        const sets = tokenSets(inner);
        for (const token of sets.commands)
          markMathContext(commands, token, file, inner, candidatePath);
        for (const token of sets.unicodeSymbols)
          markMathContext(unicode, token, file, inner, candidatePath);
        delimited = true;
      }

      if (parentType === "equation" || parentType === "equation_block") {
        addCandidate(file, jsonPath, value, true);
        const sets = tokenSets(value);
        for (const token of sets.commands)
          markMathContext(commands, token, file, value, jsonPath);
        for (const token of sets.unicodeSymbols)
          markMathContext(unicode, token, file, value, jsonPath);
      } else if (
        !delimited &&
        (foundCommands.length > 0 || foundUnicode.length > 0)
      ) {
        addCandidate(file, jsonPath, value, false);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        visit(item, file, `${jsonPath}[${index}]`, parentType),
      );
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    const nextType = typeof record.type === "string" ? record.type : parentType;
    for (const [key, child] of Object.entries(record)) {
      visit(child, file, `${jsonPath}.${key}`, nextType);
    }
  };

  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(sourceDir, file), "utf8"));
    visit(raw, file, "$", undefined);
  }

  // 모든 고유 항목은 실패 여부와 무관하게 specimen에 반드시 등장해야 한다.
  for (const token of commands.keys()) {
    // 실제 문맥이 malformed이거나 여러 한글 구간과 섞여도, 코퍼스에서 발견된
    // 명령 자체의 렌더 지원 여부는 최소 유효식으로 반드시 별도 확인한다.
    addCandidate(
      "<synthetic>",
      `command:${token}`,
      syntheticCommandContext(token),
      true,
    );
  }
  for (const token of unicode.keys()) {
    if (
      ![...candidates.values()].some((item) =>
        item.unicodeSymbols.includes(token),
      )
    ) {
      addCandidate("<synthetic>", `unicode:${token}`, token, false);
    }
  }

  return {
    sourceDir,
    files: files.length,
    stringsScanned,
    unicodeSymbols: toItems(unicode, true),
    latexCommands: toItems(commands, false),
    candidates: [...candidates.values()],
  };
}
