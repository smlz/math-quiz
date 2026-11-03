import { request, test as base, type Route } from "@playwright/test";

export * from "@playwright/test";

// typst.ts loads its WASM, fonts and @preview packages from these at runtime
// (SPEC.md §11), at versions that never change under the same URL.
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|packages\.typst\.org)\//;

interface CdnFile {
  status: number;
  contentType: string;
  body: Buffer;
}

/** `test`, with every browser context of a worker sharing one copy of the CDN
 * files. Contexts share no HTTP cache, so each would otherwise download them
 * again: 13.6 MB for a single quiz. Each run still gets them from the CDN. */
export const test = base.extend<object, object>({
  browser: [
    async ({ browser }, use) => {
      // Not `route.fetch()`: a context closed mid-download must not take the
      // others waiting for the same file down with it.
      const cdn = await request.newContext();
      const files = new Map<string, Promise<CdnFile>>();

      const download = async (url: string): Promise<CdnFile> => {
        const response = await cdn.get(url);
        return {
          status: response.status(),
          contentType: response.headers()["content-type"] ?? "application/octet-stream",
          body: await response.body(),
        };
      };

      const serve = async (route: Route) => {
        const url = route.request().url();
        let file = files.get(url);
        if (!file) {
          file = download(url);
          files.set(url, file);
        }
        try {
          const { status, contentType, body } = await file;
          // A failure may pass, so only a success is kept.
          if (status !== 200) files.delete(url);
          await route.fulfill({ status, contentType, body, headers: { "Access-Control-Allow-Origin": "*" } });
        } catch {
          files.delete(url);
          // The page is gone already if this fails too.
          await route.abort().catch(() => {});
        }
      };

      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const context = await newContext(options);
        await context.route(CDN, serve);
        return context;
      };
      await use(browser);
      await cdn.dispose();
    },
    { scope: "worker" },
  ],
});
