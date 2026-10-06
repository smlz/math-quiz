// Loading a quiz file from a `?src=` link (SPEC.md §3.5). The file is fetched
// straight from the browser, so only endpoints that send CORS headers work:
// for Codeberg and GitLab that means their APIs, not the `/raw/` web URLs.

type ShortcutResolver = (owner: string, repo: string, ref: string | undefined, path: string) => string;

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

const SHORTCUTS: Record<string, ShortcutResolver> = {
  gh: (owner, repo, ref, path) =>
    `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref ?? "HEAD")}/${encodePath(path)}`,
  // Without `ref` the API serves the default branch.
  cb: (owner, repo, ref, path) =>
    `https://codeberg.org/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/raw/${encodePath(path)}` +
    (ref ? `?ref=${encodeURIComponent(ref)}` : ""),
  // The API takes the project and file path as single, fully encoded segments.
  gl: (owner, repo, ref, path) =>
    `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref ?? "HEAD")}`,
};

// owner/repo[@ref]/path — a ref can't contain "/", so it ends at the next one.
const SHORTCUT_PATH = /^([^/@]+)\/([^/@]+)(?:@([^/]+))?\/(.+)$/;

export class RemoteSourceError extends Error {}

/** Turns a `?src=` value — a plain https:// URL or a `gh:`/`cb:`/`gl:`
 * shortcut — into the URL to fetch. */
export function resolveSourceUrl(src: string): string {
  const trimmed = src.trim();
  const shortcut = /^([a-z]+):(?!\/\/)(.*)$/.exec(trimmed);
  if (shortcut && shortcut[1] in SHORTCUTS) {
    const match = SHORTCUT_PATH.exec(shortcut[2]);
    if (!match) {
      throw new RemoteSourceError(
        `Ungültige Kurzform «${trimmed}» — erwartet wird ${shortcut[1]}:besitzer/repo/pfad/zur/datei.typ ` +
          `oder ${shortcut[1]}:besitzer/repo@branch/pfad/zur/datei.typ`,
      );
    }
    const [, owner, repo, ref, path] = match;
    return SHORTCUTS[shortcut[1]](owner, repo, ref, path);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new RemoteSourceError(`«${trimmed}» ist weder eine https://-Adresse noch eine Kurzform (gh:, gl:, cb:)`);
  }
  if (url.protocol !== "https:") {
    throw new RemoteSourceError(`Nur https://-Adressen werden unterstützt, nicht «${url.protocol}»`);
  }
  return url.href;
}

export async function fetchQuizSource(src: string): Promise<string> {
  const url = resolveSourceUrl(src);
  let response: Response;
  try {
    // Revalidate rather than reuse a cached copy: the point of a link is that
    // edits to the file show up on the next load.
    response = await fetch(url, { cache: "no-cache" });
  } catch {
    // A CORS rejection is indistinguishable from a network error here.
    throw new RemoteSourceError(
      `${url} konnte nicht geladen werden. Ist die Datei öffentlich, und erlaubt der Server den Zugriff (CORS)?`,
    );
  }
  if (!response.ok) {
    throw new RemoteSourceError(`${url} konnte nicht geladen werden (HTTP ${response.status})`);
  }
  return response.text();
}
