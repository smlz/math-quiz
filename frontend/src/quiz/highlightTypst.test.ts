import { describe, expect, it } from "vitest";
import { highlightTypst } from "./highlightTypst";
import { MINIMAL_QUIZ } from "./sampleQuiz";
import mathQuiz from "../../../typst/math-quiz.typ?raw";
import imagesQuiz from "../../../typst/images-quiz.typ?raw";

/** The source text back out of the highlighted HTML. */
function plainText(html: string): string {
  return html
    .replace(/<span class="tok-[a-z-]+">|<\/span>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Every highlighted token as [class, text], in order. */
function tokens(source: string): [string, string][] {
  return [...highlightTypst(source).matchAll(/<span class="tok-([a-z-]+)">([^<]*)<\/span>/g)].map((m) => [
    m[1],
    plainText(m[2]),
  ]);
}

describe("highlightTypst", () => {
  it.each([
    ["the minimal quiz", MINIMAL_QUIZ],
    ["the math quiz", mathQuiz],
    ["the images quiz", imagesQuiz],
    ["unbalanced brackets", "#question(prompt: [a $b, options: ("],
    ["stray closers", ") ] } $ ] ) #"],
    ["an unterminated comment and string", '/* a /* b */ #let x = "abc'],
  ])("keeps every character of %s, in order", (_, source) => {
    expect(plainText(highlightTypst(source))).toBe(source);
  });

  it("escapes HTML in the source", () => {
    const html = highlightTypst('<img src=x onerror="alert(1)"> & #let x = "<script>"');
    expect(html).not.toMatch(/<(?!\/?span)/);
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("colours a question call", () => {
    expect(tokens('#question(\n  correct: "C",\n  prompt: [Was ist $sqrt(x^2)$?],\n)')).toEqual([
      ["function", "#question"],
      ["key", "correct"],
      ["string", '"C"'],
      ["key", "prompt"],
      ["math-delimiter", "$"],
      ["math-function", "sqrt"],
      ["math", "(x"],
      ["math-operator", "^"],
      ["constant", "2"],
      ["math", ")"],
      ["math-delimiter", "$"],
    ]);
  });

  it("ends a #let statement with its line but not inside brackets", () => {
    expect(tokens("#let f(x) = {\n  x\n}\nlet")).toEqual([
      ["keyword", "#let"],
      ["function", "f"],
    ]);
  });

  it("ends an embedded call at the first character that can't continue it", () => {
    expect(tokens("#plot.add(1pt)[in] if")).toEqual([
      ["function", "#plot"],
      ["function", "add"],
      ["constant", "1pt"],
    ]);
  });

  it("returns to markup after a content block nested in code", () => {
    expect(tokens('#f([a [b] c], "s") "t"')).toEqual([
      ["function", "#f"],
      ["string", '"s"'],
    ]);
  });

  it("colours comments, nested block comments and escapes", () => {
    expect(tokens("a // b\n/* c /* d */ e */ \\# f")).toEqual([
      ["comment", "// b"],
      ["comment", "/* c /* d */ e */"],
      ["escape", "\\#"],
    ]);
  });

  it("leaves URLs alone rather than reading // as a comment", () => {
    expect(tokens("See https://typst.app/docs here")).toEqual([]);
  });
});
