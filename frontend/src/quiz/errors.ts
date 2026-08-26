/** Raised when a quiz Markdown file fails validation (SPEC.md §3.2, last bullet). */
export class QuizParseError extends Error {
  issues: string[];

  constructor(issues: string[]) {
    super(issues.join("\n"));
    this.name = "QuizParseError";
    this.issues = issues;
  }
}
