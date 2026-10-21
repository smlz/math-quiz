// Syntax highlighting for the host's quiz editor. This is a single linear scan
// that tracks Typst's three modes (markup, math, code) with a stack of open
// brackets. That is enough to colour real quizzes correctly. It is not a full
// parse: input that doesn't compile may come out coloured oddly, but never
// with text lost or out of place.
//
// The result is inserted as HTML, so every piece of source text goes through
// `escapeHtml` and the only markup added is `<span class="tok-...">` with a
// class name from this file.

type TokenClass =
  | "comment"
  | "string"
  | "keyword"
  | "constant"
  | "function"
  | "key"
  | "math"
  | "math-delimiter"
  | "math-function"
  | "math-operator"
  | "escape"
  | "heading"
  | "label"
  | "raw";

type Frame =
  // `closer` is null for the file itself, "]" for a `[...]` content block;
  // `depth` counts plain `[` `]` pairs in the text, which Typst balances.
  | { mode: "markup"; closer: "]" | null; depth: number }
  | { mode: "math" }
  // "\n" is a `#let ...`-style statement in markup, which ends with the line.
  | { mode: "code"; closer: ")" | "}" | "\n" }
  // `#name` in markup or math: continues with `.field`, `(args)` and `[body]`.
  | { mode: "expression" };

// Statements that run to the end of the line when embedded with `#`.
const STATEMENT_KEYWORDS = new Set([
  "let",
  "set",
  "show",
  "import",
  "include",
  "if",
  "for",
  "while",
  "break",
  "continue",
  "return",
  "context",
]);
const KEYWORDS = new Set([...STATEMENT_KEYWORDS, "else", "in", "as", "and", "or", "not"]);
const CONSTANTS = new Set(["none", "auto", "true", "false"]);

const IDENTIFIER = /[\p{L}_][\p{L}\p{N}_-]*/uy;
const MATH_IDENTIFIER = /\p{L}{2,}(?:\.\p{L}+)*/uy;
const NUMBER = /(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(?:pt|mm|cm|in|em|deg|rad|fr|%)?/y;
const STRING = /"(?:[^"\\\n]|\\.)*"?/y;
const LINE_COMMENT = /\/\/[^\n]*/y;
const RAW = /(`{3,})[\s\S]*?(?:\1|$)|`[^`]*`?/y;
const URL = /https?:\/\/[^\s\]\)>]+/y;
const LABEL = /<[\p{L}\p{N}_:.-]+>|@[\p{L}\p{N}_:.-]+/uy;
const HEADING = /([ \t]*)(=+)(?=[ \t])/y;
const ESCAPE = /\\(?:u\{[0-9a-fA-F]+\}|.)?/y;
const KEY_COLON = /\s*:(?!:)/y;

function matchAt(pattern: RegExp, source: string, index: number): string | null {
  pattern.lastIndex = index;
  return pattern.exec(source)?.[0] ?? null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlightTypst(source: string): string {
  let html = "";
  let pending = "";
  let pendingClass: TokenClass | null = null;

  // Adjacent text of the same class is merged into one span.
  function emit(text: string, tokenClass: TokenClass | null) {
    if (tokenClass !== pendingClass) {
      flush();
      pendingClass = tokenClass;
    }
    pending += text;
  }
  function flush() {
    if (!pending) return;
    const text = escapeHtml(pending);
    html += pendingClass ? `<span class="tok-${pendingClass}">${text}</span>` : text;
    pending = "";
  }

  const stack: Frame[] = [{ mode: "markup", closer: null, depth: 0 }];
  let i = 0;

  // Typst block comments nest.
  function blockCommentEnd(start: number): number {
    let depth = 0;
    let j = start;
    while (j < source.length) {
      if (source.startsWith("/*", j)) {
        depth++;
        j += 2;
      } else if (source.startsWith("*/", j)) {
        depth--;
        j += 2;
        if (depth === 0) return j;
      } else {
        j++;
      }
    }
    return j;
  }

  /** Comments look the same in every mode; returns whether one was consumed. */
  function comment(): boolean {
    const line = matchAt(LINE_COMMENT, source, i);
    if (line) {
      emit(line, "comment");
      i += line.length;
      return true;
    }
    if (source.startsWith("/*", i)) {
      const end = blockCommentEnd(i);
      emit(source.slice(i, end), "comment");
      i = end;
      return true;
    }
    return false;
  }

  /** `#` in markup or math, switching into code. */
  function embeddedCode() {
    const name = matchAt(IDENTIFIER, source, i + 1);
    const next = source[i + 1];
    if (name && STATEMENT_KEYWORDS.has(name)) {
      emit("#" + name, "keyword");
      i += 1 + name.length;
      stack.push({ mode: "code", closer: "\n" });
    } else if (name && CONSTANTS.has(name)) {
      emit("#" + name, "constant");
      i += 1 + name.length;
    } else if (name) {
      emit("#" + name, "function");
      i += 1 + name.length;
      stack.push({ mode: "expression" });
    } else if (next === "(") {
      emit("#", "function");
      i++;
      stack.push({ mode: "expression" });
    } else if (next === "{") {
      emit("#{", "function");
      i += 2;
      stack.push({ mode: "code", closer: "}" });
    } else if (next === "[") {
      emit("#[", "function");
      i += 2;
      stack.push({ mode: "markup", closer: "]", depth: 0 });
    } else {
      emit("#", null);
      i++;
    }
  }

  /** An identifier in code, coloured by what it is and what follows it. */
  function codeIdentifier(name: string) {
    const after = source[i + name.length];
    let tokenClass: TokenClass | null = null;
    if (KEYWORDS.has(name)) tokenClass = "keyword";
    else if (CONSTANTS.has(name)) tokenClass = "constant";
    else if (after === "(" || after === "[") tokenClass = "function";
    else if (matchAt(KEY_COLON, source, i + name.length)) tokenClass = "key";
    emit(name, tokenClass);
    i += name.length;
  }

  function markup(frame: Extract<Frame, { mode: "markup" }>) {
    const c = source[i];
    if (comment()) return;
    if (i === 0 || source[i - 1] === "\n") {
      HEADING.lastIndex = i;
      const heading = HEADING.exec(source);
      if (heading) {
        emit(heading[1], null);
        emit(heading[2], "heading");
        i += heading[0].length;
        return;
      }
    }
    if (c === "#") return embeddedCode();
    if (c === "$") {
      emit(c, "math-delimiter");
      i++;
      stack.push({ mode: "math" });
      return;
    }
    if (c === "[") frame.depth++;
    if (c === "]" && frame.closer) {
      if (frame.depth === 0) stack.pop();
      else frame.depth--;
    }
    const token =
      (c === "\\" && matchAt(ESCAPE, source, i)) ||
      (c === "`" && matchAt(RAW, source, i)) ||
      ((c === "<" || c === "@") && matchAt(LABEL, source, i)) ||
      (c === "h" && matchAt(URL, source, i));
    if (token) {
      emit(token, c === "\\" ? "escape" : c === "`" ? "raw" : c === "h" ? null : "label");
      i += token.length;
      return;
    }
    emit(c, null);
    i++;
  }

  function math() {
    const c = source[i];
    if (comment()) return;
    if (c === "$") {
      emit(c, "math-delimiter");
      i++;
      stack.pop();
      return;
    }
    if (c === "#") return embeddedCode();
    const token =
      (c === "\\" && matchAt(ESCAPE, source, i)) ||
      (c === '"' && matchAt(STRING, source, i));
    if (token) {
      emit(token, c === "\\" ? "escape" : "string");
      i += token.length;
      return;
    }
    const name = matchAt(MATH_IDENTIFIER, source, i);
    if (name) {
      emit(name, "math-function");
      i += name.length;
      return;
    }
    const number = matchAt(NUMBER, source, i);
    if (number) {
      emit(number, "constant");
      i += number.length;
      return;
    }
    emit(c, "^_/&".includes(c) ? "math-operator" : "math");
    i++;
  }

  function code(frame: Extract<Frame, { mode: "code" }>) {
    const c = source[i];
    if (comment()) return;
    if (frame.closer === "\n" && c === "\n") {
      stack.pop();
      return;
    }
    if (c === frame.closer || (frame.closer === "\n" && c === ";")) {
      emit(c, null);
      i++;
      stack.pop();
      return;
    }
    // A closing bracket that isn't ours belongs to an enclosing frame.
    if (")]}".includes(c)) {
      stack.pop();
      return;
    }
    if (c === "(" || c === "{") {
      emit(c, null);
      i++;
      stack.push({ mode: "code", closer: c === "(" ? ")" : "}" });
      return;
    }
    if (c === "[") {
      emit(c, null);
      i++;
      stack.push({ mode: "markup", closer: "]", depth: 0 });
      return;
    }
    if (c === "$") {
      emit(c, "math-delimiter");
      i++;
      stack.push({ mode: "math" });
      return;
    }
    const string = c === '"' && matchAt(STRING, source, i);
    if (string) {
      emit(string, "string");
      i += string.length;
      return;
    }
    const name = matchAt(IDENTIFIER, source, i);
    if (name) return codeIdentifier(name);
    const number = matchAt(NUMBER, source, i);
    if (number) {
      emit(number, "constant");
      i += number.length;
      return;
    }
    emit(c, null);
    i++;
  }

  function expression() {
    const c = source[i];
    if (c === "(") {
      emit(c, null);
      i++;
      stack.push({ mode: "code", closer: ")" });
      return;
    }
    if (c === "[") {
      emit(c, null);
      i++;
      stack.push({ mode: "markup", closer: "]", depth: 0 });
      return;
    }
    const field = c === "." && matchAt(IDENTIFIER, source, i + 1);
    if (field) {
      emit(".", null);
      i++;
      const after = source[i + field.length];
      emit(field, after === "(" || after === "[" ? "function" : null);
      i += field.length;
      return;
    }
    stack.pop();
  }

  while (i < source.length) {
    const frame = stack[stack.length - 1];
    if (frame.mode === "markup") markup(frame);
    else if (frame.mode === "math") math();
    else if (frame.mode === "code") code(frame);
    else expression();
  }
  flush();
  return html;
}
