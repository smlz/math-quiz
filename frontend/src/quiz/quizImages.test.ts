import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchQuizImage, findImagePaths, MAX_IMAGE_BYTES, QuizImageError, resolveTypstPath } from "./quizImages";
import { resolveSource } from "./remoteSource";

describe("resolveTypstPath", () => {
  it("resolves relative paths from the file's directory", () => {
    expect(resolveTypstPath("/typst/q.typ", "img/a.png")).toBe("/typst/img/a.png");
    expect(resolveTypstPath("/typst/q.typ", "./a.png")).toBe("/typst/a.png");
    expect(resolveTypstPath("/typst/q.typ", "../img/a.png")).toBe("/img/a.png");
  });

  it("resolves absolute paths from the root", () => {
    expect(resolveTypstPath("/typst/q.typ", "/img/a.png")).toBe("/img/a.png");
  });

  it("never leaves the root", () => {
    expect(resolveTypstPath("/typst/q.typ", "../../../etc/a.png")).toBe("/etc/a.png");
    expect(resolveTypstPath("/q.typ", "..//a.png")).toBe("/a.png");
  });
});

describe("findImagePaths", () => {
  it("finds every literal image path once", () => {
    const source = `#let logo = image("logo.svg", width: 2cm)
#question(prompt: [#image( "img/a.png" ) #image("logo.svg")])`;
    expect(findImagePaths(source, "/typst/q.typ")).toEqual(["/typst/logo.svg", "/typst/img/a.png"]);
  });

  it("skips commented-out images", () => {
    expect(findImagePaths(`// #image("old.png")\n/* #image("older.png") */`, "/q.typ")).toEqual([]);
  });

  it("unescapes quotes in the path", () => {
    expect(findImagePaths(`#image("say \\"hi\\".png")`, "/q.typ")).toEqual(['/say "hi".png']);
  });

  it("ignores images whose path is computed", () => {
    expect(findImagePaths(`#image(name + ".png")`, "/q.typ")).toEqual([]);
  });
});

describe("fetchQuizImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const location = resolveSource("gh:o/r/typst/q.typ");

  it("fetches the file from the quiz's repo, without credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchQuizImage(location, "/typst/a.png")).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/o/r/HEAD/typst/a.png",
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it("reports HTTP errors with the URL and status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));

    await expect(fetchQuizImage(location, "/typst/a.png")).rejects.toThrow(/typst\/a\.png.*HTTP 404/);
  });

  it("refuses files that are too large", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(MAX_IMAGE_BYTES + 1))));

    await expect(fetchQuizImage(location, "/typst/a.png")).rejects.toThrow(QuizImageError);
  });

  it("reports network and CORS failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(fetchQuizImage(location, "/typst/a.png")).rejects.toThrow(/CORS/);
  });
});
