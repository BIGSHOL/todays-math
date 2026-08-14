export type AffordanceFinding = {
  file: string;
  line: number;
  rule: string;
  message: string;
};

export function scanTsx(
  fileName: string,
  sourceText: string,
): AffordanceFinding[];

export function scanCss(
  fileName: string,
  sourceText: string,
): AffordanceFinding[];

export function scanGlobalsContract(sourceText: string): AffordanceFinding[];

export function scanButtonContract(sourceText: string): AffordanceFinding[];

export function scanProject(
  rootDir: string,
  onlyFiles?: string[],
): AffordanceFinding[];

export function formatFindings(findings: AffordanceFinding[]): string;
