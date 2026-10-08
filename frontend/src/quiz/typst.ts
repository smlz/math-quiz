// Thin wrapper around typst.ts (https://github.com/Myriad-Dreamin/typst.ts),
// the client-side Typst compiler/renderer (SPEC.md §2). There is no bundled
// npm/Vite integration here, we load the "lite" all-in-one bundle from
// jsdelivr at runtime (it fetches its WASM modules, fonts, and any `@preview`
// packages such as cetz from jsdelivr/packages.typst.org on demand, with no
// offline/self-hosted fallback for v1 -- SPEC.md §11).

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
  svg(options: { mainContent: string }): Promise<string>;
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
// it (same precaution as the TikZJax wrapper this replaces).
let renderQueue: Promise<unknown> = Promise.resolve();

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

  const run = async () => {
    const typst = await loadTypst();
    // The source may come from a stranger's `?src=` link and the result is
    // mounted with v-html, so it is sanitized before anyone sees it.
    return sanitizeSvg(await typst.svg({ mainContent: wrapped }));
  };

  const result = renderQueue.then(run);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
