# Quiz Template and Samples

Use the file [`quiz.typ`](./quiz.typ) to author your quiz in your favorite editor. The other files here are
sample content, not real quizzes.

## Samples

* [`minimal-quiz.typ`](https://quiz.smlz.ch/create?src=gh:smlz/math-quiz/typst/minimal-quiz.typ): a minimal quiz
  with two almost empty questions. It is prefilled on the host setup screen when the app is opened without a quiz
  link, and is a good starting point for a new quiz.
* [`math-quiz.typ`](https://quiz.smlz.ch/create?src=gh:smlz/math-quiz/typst/math-quiz.typ): demonstrates formulas,
  function graphs with `cetz-plot`, and `cetz` drawings (Venn diagrams with `cetz-venn`), in prompts and as answer
  options.
* [`images-quiz.typ`](https://quiz.smlz.ch/create?src=gh:smlz/math-quiz/typst/images-quiz.typ): demonstrates
  images from the [`images/`](./images) folder, in prompts and as answer options. Images only work when the quiz is
  loaded from a link, since the app fetches them relative to the quiz file.
