// Images next to a quiz file loaded from a link (SPEC.md §3.5). Typst reads
// files synchronously from inside its WASM compiler, so it cannot fetch an
// image when it gets to one. Instead the source is scanned for `image("...")`
// calls up front, and each file is fetched relative to the quiz file and
// handed to the compiler's virtual file system before anything is compiled.

import { stripComments } from "./parseQuiz";
import type { SourceLocation } from "./remoteSource";

// Only literal paths are found: a path a macro builds at compile time is not,
// and Typst reports it as a missing file.
const IMAGE_RE = /\bimage\(\s*"((?:[^"\\]|\\.)*)"/g;

// The link may come from a stranger, and everything is fetched by the
// teacher's browser, so a quiz can't make it download without bound.
export const MAX_IMAGES = 50;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

/** Resolves `path` the way Typst does from inside the file at `fromFile`: a
 * leading "/" starts at the project root, anything else at the file's own
 * directory. `..` stops at the root, so no path leaves the repo or origin. */
export function resolveTypstPath(fromFile: string, path: string): string {
  const segments = path.startsWith("/") ? [] : fromFile.split("/").slice(0, -1);
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return "/" + segments.filter((segment) => segment !== "").join("/");
}

/** The absolute paths of all images the quiz source at `quizPath` refers to. */
export function findImagePaths(source: string, quizPath: string): string[] {
  const paths = new Set<string>();
  for (const match of stripComments(source).matchAll(IMAGE_RE)) {
    const literal = match[1].replace(/\\(["\\])/g, "$1");
    // Other escapes (`\u{..}`) in a file name are too unusual to bother with.
    if (literal.includes("\\") || literal === "") continue;
    paths.add(resolveTypstPath(quizPath, literal));
  }
  return [...paths];
}

export class QuizImageError extends Error {}

/** Fetches one file of the quiz's root as bytes. */
export async function fetchQuizImage(location: SourceLocation, path: string): Promise<Uint8Array> {
  const url = location.urlFor(path);
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-cache",
      credentials: "omit",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new QuizImageError(`${url} konnte nicht geladen werden (Netzwerkfehler, Zeitüberschreitung oder CORS)`);
  }
  if (!response.ok) {
    throw new QuizImageError(`${url} konnte nicht geladen werden (HTTP ${response.status})`);
  }
  const announced = Number(response.headers.get("Content-Length"));
  if (announced > MAX_IMAGE_BYTES) {
    throw new QuizImageError(`${url} ist zu gross (höchstens ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new QuizImageError(`${url} ist zu gross (höchstens ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`);
  }
  return bytes;
}
