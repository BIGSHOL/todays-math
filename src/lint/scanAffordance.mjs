import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

/** @typedef {{ file: string, line: number, rule: string, message: string }} AffordanceFinding */

const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "select",
  "summary",
  "label",
  "input",
  "textarea",
  "option",
]);

const CONTROL_NAME =
  /Button|Link|Select|Input|Control|Picker|Checkbox|Radio|Switch|Tab|MenuItem/;

const ACTIVATION_ROLES =
  /button|link|menuitem|tab|option|switch|checkbox|radio/;

const SURFACE_TAGS = new Set([
  "article",
  "li",
  "section",
  "aside",
  "header",
  "footer",
  "main",
]);

const PASSIVE_TAGS = new Set([
  "div",
  "span",
  "article",
  "tr",
  "td",
  "th",
  "li",
  "section",
  "aside",
  "p",
  "header",
  "footer",
  "main",
  "nav",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "__tests__",
  "mocks",
  "coverage",
]);

/**
 * @param {string} tag
 * @returns {boolean}
 */
function isControlTag(tag) {
  if (INTERACTIVE_TAGS.has(tag)) return true;
  const last = tag.includes(".") ? tag.split(".").pop() : tag;
  if (last && INTERACTIVE_TAGS.has(last)) return true;
  return CONTROL_NAME.test(tag) || (last ? CONTROL_NAME.test(last) : false);
}

/**
 * @param {import("typescript").JsxOpeningLikeElement} node
 * @returns {Map<string, string>}
 */
function getAttrs(node) {
  const map = new Map();
  for (const prop of node.attributes.properties) {
    if (!ts.isJsxAttribute(prop)) continue;
    const name = ts.isIdentifier(prop.name)
      ? prop.name.text
      : prop.name.getText();
    map.set(name, prop.initializer ? prop.initializer.getText() : "true");
  }
  return map;
}

/**
 * @param {import("typescript").SourceFile} sf
 * @returns {Map<string, string>}
 */
function collectConsts(sf) {
  /** @type {Map<string, string>} */
  const consts = new Map();
  /**
   * @param {import("typescript").Node} node
   */
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        consts.set(node.name.text, node.initializer.getText());
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return consts;
}

/**
 * @param {string} raw
 * @param {Map<string, string>} consts
 * @param {Set<string>} [seen]
 * @returns {string}
 */
function expandClass(raw, consts, seen = new Set()) {
  let out = raw;
  for (const [name, text] of consts) {
    if (seen.has(name)) continue;
    if (new RegExp(`\\b${name}\\b`).test(raw)) {
      seen.add(name);
      out += ` ${expandClass(text, consts, seen)}`;
    }
  }
  return out;
}

/**
 * @param {Map<string, string>} attrs
 * @returns {boolean}
 */
function hasActivation(attrs) {
  if (attrs.has("onClick") || attrs.has("href") || attrs.has("to")) return true;
  return ACTIVATION_ROLES.test(attrs.get("role") ?? "");
}

/**
 * @param {string} selector
 * @returns {boolean}
 */
function isInteractiveSelector(selector) {
  return /(^|[\s,#.>+~:[])((a|button|select|summary|label|input)\b|\[href|\[role\s*=)/i.test(
    selector,
  ) || /button/i.test(selector);
}

/**
 * @param {string} fileName
 * @param {string} sourceText
 * @returns {AffordanceFinding[]}
 */
export function scanTsx(fileName, sourceText) {
  const sf = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const consts = collectConsts(sf);
  /** @type {AffordanceFinding[]} */
  const findings = [];

  /**
   * @param {import("typescript").Node} node
   */
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText();
      const attrs = getAttrs(node);
      const cls = expandClass(
        attrs.get("className") ?? attrs.get("class") ?? "",
        consts,
      );
      const line =
        sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const control = isControlTag(tag);
      const active = hasActivation(attrs);

      if (/cursor-pointer/.test(cls) && !control && !active) {
        findings.push({
          file: fileName,
          line,
          rule: "false-pointer",
          message: `cursor-pointer는 <${tag}>처럼 클릭되지 않는 요소에 쓸 수 없다. 버튼/링크에만 두거나 onClick과 role="button"을 함께 둔다.`,
        });
      }

      if (tag === "tr" && /hover:bg-/.test(cls) && !active) {
        findings.push({
          file: fileName,
          line,
          rule: "row-hover-lie",
          message:
            "클릭되지 않는 <tr>에 hover 배경을 두면 행 전체가 눌리는 것처럼 보인다. hover는 실제 컨트롤에만 둔다.",
        });
      }

      if (SURFACE_TAGS.has(tag) && /hover:bg-/.test(cls) && !active) {
        findings.push({
          file: fileName,
          line,
          rule: "surface-hover-lie",
          message: `클릭되지 않는 <${tag}>에 hover 배경을 두면 카드가 눌리는 것처럼 보인다.`,
        });
      }

      if (attrs.has("onClick") && PASSIVE_TAGS.has(tag)) {
        const role = attrs.get("role") ?? "";
        if (!ACTIVATION_ROLES.test(role)) {
          findings.push({
            file: fileName,
            line,
            rule: "div-click",
            message: `<${tag} onClick>은 마우스 오해를 만든다. <button>을 쓰거나 role="button"을 명시한다.`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return findings;
}

/**
 * @param {string} fileName
 * @param {string} sourceText
 * @returns {AffordanceFinding[]}
 */
export function scanCss(fileName, sourceText) {
  const cleaned = sourceText.replace(/\/\*[\s\S]*?\*\//g, "");
  /** @type {AffordanceFinding[]} */
  const findings = [];
  const ruleRe = /([^{}]+)\{([^{}]+)\}/g;
  let match = ruleRe.exec(cleaned);
  while (match) {
    const selector = match[1].trim();
    const body = match[2];
    if (/cursor\s*:\s*pointer/i.test(body) && !isInteractiveSelector(selector)) {
      const before = cleaned.slice(0, match.index);
      const line = before.split(/\r?\n/).length;
      findings.push({
        file: fileName,
        line,
        rule: "css-false-pointer",
        message: `cursor: pointer는 실제 컨트롤 선택자에만 허용한다. 현재 선택자: ${selector.slice(0, 80)}`,
      });
    }
    match = ruleRe.exec(cleaned);
  }
  return findings;
}

/**
 * @param {string} sourceText
 * @returns {AffordanceFinding[]}
 */
export function scanGlobalsContract(sourceText) {
  /** @type {Array<[string, string]>} */
  const required = [
    ['a[href]:not([aria-disabled="true"])', "링크 손가락 규칙"],
    ["button:not(:disabled)", "버튼 손가락 규칙"],
    [":disabled", "비활성 선택자"],
    ["cursor: not-allowed", "비활성 금지 커서"],
    ["cursor: pointer", "활성 손가락 커서"],
  ];
  /** @type {AffordanceFinding[]} */
  const findings = [];
  for (const [needle, label] of required) {
    if (!sourceText.includes(needle)) {
      findings.push({
        file: "src/app/globals.css",
        line: 1,
        rule: "globals-contract",
        message: `globals.css에서 ${label}(${needle})이 빠졌다.`,
      });
    }
  }
  return findings;
}

/**
 * @param {string} sourceText
 * @returns {AffordanceFinding[]}
 */
export function scanButtonContract(sourceText) {
  /** @type {Array<[RegExp, string]>} */
  const required = [
    [/cursor-pointer/, "활성 손가락 커서"],
    [/disabled:cursor-not-allowed/, "비활성 금지 커서"],
    [/hover:enabled:/, "비활성 호버 차단"],
  ];
  /** @type {AffordanceFinding[]} */
  const findings = [];
  for (const [pattern, label] of required) {
    if (!pattern.test(sourceText)) {
      findings.push({
        file: "src/components/ui/Button.tsx",
        line: 1,
        rule: "button-contract",
        message: `Button.tsx에서 ${label} 클래스가 빠졌다.`,
      });
    }
  }
  return findings;
}

/**
 * @param {string} dir
 * @param {string[]} acc
 */
function walkUiFiles(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkUiFiles(full, acc);
      continue;
    }
    if (/\.(tsx|jsx|css)$/.test(entry.name)) acc.push(full);
  }
}

/**
 * @param {string} rootDir
 * @param {string[]} [onlyFiles]
 * @returns {AffordanceFinding[]}
 */
export function scanProject(rootDir, onlyFiles) {
  const srcRoot = path.join(rootDir, "src");
  /** @type {string[]} */
  const files = [];
  if (onlyFiles && onlyFiles.length > 0) {
    for (const file of onlyFiles) {
      if (/\.(tsx|jsx|css)$/.test(file)) files.push(path.resolve(file));
    }
  } else {
    walkUiFiles(srcRoot, files);
  }

  /** @type {AffordanceFinding[]} */
  const findings = [];
  const globalsPath = path.join(srcRoot, "app", "globals.css");
  const buttonPath = path.join(srcRoot, "components", "ui", "Button.tsx");

  if (fs.existsSync(globalsPath)) {
    findings.push(
      ...scanGlobalsContract(fs.readFileSync(globalsPath, "utf8")),
    );
  } else {
    findings.push({
      file: globalsPath,
      line: 1,
      rule: "globals-contract",
      message: "src/app/globals.css 가 없다.",
    });
  }

  if (fs.existsSync(buttonPath)) {
    findings.push(...scanButtonContract(fs.readFileSync(buttonPath, "utf8")));
  } else {
    findings.push({
      file: buttonPath,
      line: 1,
      rule: "button-contract",
      message: "src/components/ui/Button.tsx 가 없다.",
    });
  }

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (file.endsWith(".css")) {
      findings.push(...scanCss(file, text));
    } else {
      findings.push(...scanTsx(file, text));
    }
  }
  return findings;
}

/**
 * @param {AffordanceFinding[]} findings
 * @returns {string}
 */
export function formatFindings(findings) {
  return findings
    .map(
      (f) =>
        `${f.file}:${f.line} [${f.rule}] ${f.message}`,
    )
    .join("\n");
}
