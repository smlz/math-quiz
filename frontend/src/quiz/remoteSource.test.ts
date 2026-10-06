import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchQuizSource, RemoteSourceError, resolveSourceUrl } from "./remoteSource";

describe("resolveSourceUrl", () => {
  it("passes plain https URLs through", () => {
    expect(resolveSourceUrl("https://example.com/quizzes/mengen.typ")).toBe(
      "https://example.com/quizzes/mengen.typ",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(resolveSourceUrl("  https://example.com/q.typ\n")).toBe("https://example.com/q.typ");
  });

  it("rejects non-https URLs", () => {
    expect(() => resolveSourceUrl("http://example.com/q.typ")).toThrow(RemoteSourceError);
    expect(() => resolveSourceUrl("file:///C:/q.typ")).toThrow(RemoteSourceError);
  });

  it("rejects things that are neither a URL nor a shortcut", () => {
    expect(() => resolveSourceUrl("quiz.typ")).toThrow(RemoteSourceError);
  });

  it("rejects shortcuts without a file path", () => {
    expect(() => resolveSourceUrl("gh:smlz/math-quiz")).toThrow(RemoteSourceError);
    expect(() => resolveSourceUrl("gh:smlz/math-quiz@main")).toThrow(RemoteSourceError);
    expect(() => resolveSourceUrl("gl:smlz")).toThrow(RemoteSourceError);
  });

  describe("gh:", () => {
    it("uses the default branch when no ref is given", () => {
      expect(resolveSourceUrl("gh:smlz/math-quiz/typst/example-quiz.typ")).toBe(
        "https://raw.githubusercontent.com/smlz/math-quiz/HEAD/typst/example-quiz.typ",
      );
    });

    it("uses an explicit ref", () => {
      expect(resolveSourceUrl("gh:smlz/math-quiz@v2/typst/example-quiz.typ")).toBe(
        "https://raw.githubusercontent.com/smlz/math-quiz/v2/typst/example-quiz.typ",
      );
    });

    it("encodes each path segment but keeps the slashes", () => {
      expect(resolveSourceUrl("gh:o/r/Quiz 1/Brüche.typ")).toBe(
        "https://raw.githubusercontent.com/o/r/HEAD/Quiz%201/Br%C3%BCche.typ",
      );
    });
  });

  describe("cb:", () => {
    it("uses the API, leaving out ref for the default branch", () => {
      expect(resolveSourceUrl("cb:smlz/math-quiz/typst/example-quiz.typ")).toBe(
        "https://codeberg.org/api/v1/repos/smlz/math-quiz/raw/typst/example-quiz.typ",
      );
    });

    it("passes an explicit ref as a query parameter", () => {
      expect(resolveSourceUrl("cb:smlz/math-quiz@main/typst/example-quiz.typ")).toBe(
        "https://codeberg.org/api/v1/repos/smlz/math-quiz/raw/typst/example-quiz.typ?ref=main",
      );
    });
  });

  describe("gl:", () => {
    it("encodes project and file path as single segments", () => {
      expect(resolveSourceUrl("gl:smlz/math-quiz/typst/example-quiz.typ")).toBe(
        "https://gitlab.com/api/v4/projects/smlz%2Fmath-quiz/repository/files/typst%2Fexample-quiz.typ/raw?ref=HEAD",
      );
    });

    it("uses an explicit ref", () => {
      expect(resolveSourceUrl("gl:smlz/math-quiz@v2/q.typ")).toBe(
        "https://gitlab.com/api/v4/projects/smlz%2Fmath-quiz/repository/files/q.typ/raw?ref=v2",
      );
    });
  });
});

describe("fetchQuizSource", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the resolved URL and returns its text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("#import \"quiz.typ\": *"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchQuizSource("gh:smlz/math-quiz/q.typ")).resolves.toBe("#import \"quiz.typ\": *");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/smlz/math-quiz/HEAD/q.typ",
      expect.anything(),
    );
  });

  it("reports HTTP errors with the status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 })));

    await expect(fetchQuizSource("https://example.com/q.typ")).rejects.toThrow(/HTTP 404/);
  });

  it("reports network and CORS failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(fetchQuizSource("https://example.com/q.typ")).rejects.toThrow(/CORS/);
  });

  it("never fetches an invalid source", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchQuizSource("http://example.com/q.typ")).rejects.toThrow(RemoteSourceError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
