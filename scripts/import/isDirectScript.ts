import path from "node:path";
import { pathToFileURL } from "node:url";

export function isDirectScript(metaUrl: string): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return pathToFileURL(path.resolve(invoked)).href === metaUrl;
}
