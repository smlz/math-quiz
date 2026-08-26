// Thin wrapper around typst.ts (https://github.com/Myriad-Dreamin/typst.ts),
// the client-side Typst compiler/renderer (SPEC.md §2). There is no bundled
// npm/Vite integration here -- per the typst-experiments/browser-demo.html
// feasibility POC, we load the "lite" all-in-one bundle from jsdelivr at
// runtime (it fetches its WASM modules, fonts, and any `@preview` packages
// such as cetz from jsdelivr/packages.typst.org on demand, with no
// offline/self-hosted fallback for v1 -- SPEC.md §11).

const TYPST_SCRIPT_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst.ts/dist/esm/contrib/all-in-one-lite.bundle.js";
const COMPILER_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm";
const RENDERER_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm";

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
    script.src = TYPST_SCRIPT_URL;
    script.onload = () => {
      const typst = window.$typst;
      if (!typst) {
        reject(new Error("typst.ts script loaded but window.$typst was not found"));
        return;
      }
      typst.setCompilerInitOptions({ getModule: () => COMPILER_WASM_URL });
      typst.setRendererInitOptions({ getModule: () => RENDERER_WASM_URL });
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
 * own), so it's wrapped in an auto-sized, margin-trimmed page here --
 * otherwise typst.ts's default A4 page would render as a mostly-blank SVG. */
export function renderTypst(source: string): Promise<string> {
  const wrapped = `#set page(width: auto, height: auto, margin: 0.4em)\n#set text(size: 11pt)\n${source}`;

  const run = async () => {
    const typst = await loadTypst();
    return typst.svg({ mainContent: wrapped });
  };

  const result = renderQueue.then(run);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
