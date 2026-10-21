// Thin wrapper around typst.ts (https://github.com/Myriad-Dreamin/typst.ts),
// the client-side Typst compiler/renderer (SPEC.md §2). There is no bundled
// npm/Vite integration here, we load the "lite" all-in-one bundle from
// jsdelivr at runtime (it fetches its WASM modules, fonts, and any `@preview`
// packages such as cetz from jsdelivr/packages.typst.org on demand, with no
// offline/self-hosted fallback for v1 -- SPEC.md §11).

import { fetchQuizImage, findImagePaths, MAX_IMAGES, resolveTypstPath } from "./quizImages";
import type { SourceLocation } from "./remoteSource";
import { sanitizeSvg } from "./sanitizeSvg";

// Version-pinned CDN URLs plus the script's integrity hash, injected at build
// time from the installed `@myriaddreamin/*` devDependencies (vite.config.ts).
declare const __TYPST_TS__: {
  scriptUrl: string;
  scriptIntegrity: string;
  compilerWasmUrl: string;
  rendererWasmUrl: string;
};
const TYPST_TS = __TYPST_TS__;

interface TypstGlobal {
  setCompilerInitOptions(options: { getModule: () => string }): void;
  setRendererInitOptions(options: { getModule: () => string }): void;
  svg(options: { mainFilePath: string }): Promise<string>;
  addSource(path: string, content: string): Promise<void>;
  mapShadow(path: string, content: Uint8Array): Promise<void>;
  unmapShadow(path: string): Promise<void>;
}

declare global {
  interface Window {
    $typst?: TypstGlobal;
  }
}

let loadPromise: Promise<TypstGlobal> | null = null;

function loadTypst(): Promise<TypstGlobal> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = TYPST_TS.scriptUrl;
    // The browser refuses to run the script if a single byte differs.
    script.integrity = TYPST_TS.scriptIntegrity;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      const typst = window.$typst;
      if (!typst) {
        reject(new Error("typst.ts script loaded but window.$typst was not found"));
        return;
      }
      typst.setCompilerInitOptions({ getModule: () => TYPST_TS.compilerWasmUrl });
      typst.setRendererInitOptions({ getModule: () => TYPST_TS.rendererWasmUrl });
      resolve(typst);
    };
    script.onerror = () => reject(new Error("Failed to load typst.ts from jsdelivr"));
    document.head.appendChild(script);
  });

  return loadPromise;
}

// Compiles/renders are serialized: the shared WASM compiler/renderer state
// is mutated across `await` boundaries, so concurrent calls risk corrupting
// it (same precaution as the TikZJax wrapper this replaces). Loading images
// goes through the same queue, so a render queued after it sees them.
let renderQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(task);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// Each snippet is compiled as a file next to the quiz file, so the paths in
// it resolve exactly as they do when the author compiles the file locally.
const SNIPPET_NAME = ".math-quiz-snippet.typ";
let snippetPath = "/" + SNIPPET_NAME;

// The quiz file whose images are mapped into the compiler, and what became
// of every path tried for it: absent from `imageFailures` means it loaded.
let imageLocation: SourceLocation | null = null;
const imagesTried = new Set<string>();
const imageFailures = new Map<string, string>();

/** Makes the images `source` refers to available to every later render,
 * fetching them relative to the quiz file at `location` (SPEC.md §3.5).
 * Images already fetched for the same location are not fetched again, so
 * this is cheap to call on every edit. A failed image is not an error here:
 * the render that needs it fails, and says why. */
export function loadQuizImages(source: string, location: SourceLocation | null): Promise<void> {
  return enqueue(async () => {
    if (location?.url !== imageLocation?.url) {
      // A different quiz file: none of the old images belong to it.
      if (imagesTried.size > 0) {
        const typst = await loadTypst();
        for (const path of imagesTried) if (!imageFailures.has(path)) await typst.unmapShadow(path);
      }
      imagesTried.clear();
      imageFailures.clear();
      imageLocation = location;
      snippetPath = location ? resolveTypstPath(location.path, SNIPPET_NAME) : "/" + SNIPPET_NAME;
    }
    if (!location) return;

    const fresh = findImagePaths(source, location.path).filter((path) => !imagesTried.has(path));
    if (fresh.length === 0) return;
    const typst = await loadTypst();
    await Promise.all(
      fresh.map(async (path) => {
        if (imagesTried.size >= MAX_IMAGES) {
          imageFailures.set(path, `Zu viele Bilder (höchstens ${MAX_IMAGES})`);
          return;
        }
        imagesTried.add(path);
        try {
          await typst.mapShadow(path, await fetchQuizImage(location, path));
          imageFailures.delete(path);
        } catch (e) {
          imageFailures.set(path, e instanceof Error ? e.message : String(e));
        }
      }),
    );
  });
}

/** typst.ts only says *a* file could not be loaded, not which one, so this
 * adds the reasons for the images `source` refers to that failed to load. */
function explainMissingFile(error: unknown, source: string): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (!/failed to load file|file not found/i.test(message)) return error;
  if (!imageLocation) {
    return new Error(`${message} — Bilder gibt es nur in Quiz-Dateien, die per Link (?src=) geladen werden`);
  }
  const reasons = findImagePaths(source, imageLocation.path).flatMap((path) => imageFailures.get(path) ?? []);
  return reasons.length ? new Error(`${message} — ${reasons.join("; ")}`) : error;
}

/** Compiles Typst `source` and resolves to a self-contained SVG string.
 * Quiz authors write bare content (SPEC.md §3.2, no page setup of their
 * own), so it's wrapped in an auto-sized page here -- otherwise typst.ts's
 * default A4 page would render as a mostly-blank SVG. The page margin is
 * zero on purpose: the SVG is scaled with `object-fit: contain` to fill its
 * box, so any margin baked into the image is dead space that shrinks the
 * content (a 0.4em margin made a single digit render at under half size).
 * Padding around the content is the surrounding CSS box's job. */
export function renderTypst(source: string): Promise<string> {
  // previous version
  //const wrapped = `#set page(width: auto, height: auto, margin: 0mm)\n#set text(size: 11pt)\n${source}`;
  const wrapped = `#set page(width: auto, height: auto, margin: 0.4em)\n#set text(size: 11pt)\n${source}`;

  return enqueue(async () => {
    const typst = await loadTypst();
    await typst.addSource(snippetPath, wrapped);
    let svg: string;
    try {
      svg = await typst.svg({ mainFilePath: snippetPath });
    } catch (e) {
      throw explainMissingFile(e, source);
    }
    // The source may come from a stranger's `?src=` link and the result is
    // mounted with v-html, so it is sanitized before anyone sees it.
    return sanitizeSvg(svg);
  });
}
