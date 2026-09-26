// math-quiz — quiz authoring template (SPEC.md §3).
//
// A quiz file is an ordinary Typst document with a fixed structure:
//
//   #import "quiz.typ": *      // 1. template import (required, first line)
//   #show: quiz                // 2. template show rule (required, second line)
//
//   ...additional imports and #let macros...   // 3. preamble (optional)
//
//   #question(                                 // 4. one or more questions
//     correct: "C",
//     prompt: [...],
//     options: ([...], [...], [...], [...]),
//   )
//
// Compiling it with any standard Typst tool (CLI, VS Code Tinymist, ...)
// produces one 16:9 page per question, laid out like the live host screen,
// with the correct option highlighted.

#let option-labels = ("A", "B", "C", "D")

// Fixed per-option colors, identical to the web app (SPEC.md §8).
#let option-colors = (
  rgb("#EF476F"),
  rgb("#118AB2"),
  rgb("#C79B33"),
  rgb("#06D6A0"),
)
#let correct-ring = rgb("#FFD600")

// The host screen's canonical resolution, so 1pt here is 1 CSS px there.
#let page-width = 1280pt
#let page-height = 720pt
#let page-margin = 24pt
#let gutter = 12pt

#let content-width = page-width - 2 * page-margin
#let content-height = page-height - 2 * page-margin

#let quiz(body) = {
  set page(width: page-width, height: page-height, margin: page-margin, fill: white)
  set text(size: 22pt, fill: rgb("#1a1a1a"))
  body
}

// Scales `body` up (or down) to fill a width x height box while keeping its
// aspect ratio -- the same thing the web app does with `object-fit: contain`,
// and the reason a one-line prompt does not render as tiny text on a 1280pt
// page. The 0.4em pad matches the page margin the web renderer bakes into
// each snippet, so both scale the same content-to-whitespace ratio.
// `reflow: false` keeps the scaled content out of the layout.
#let _fit(body, size: (0pt, 0pt)) = context {
  let (width, height) = size
  let padded = pad(0.4em, body)
  let natural = measure(padded)
  let factor = if natural.width > 0pt and natural.height > 0pt {
    calc.min(width / natural.width, height / natural.height)
  } else {
    1.0
  }

  box(
    width: width,
    height: height,
    align(
      center + horizon,
      scale(factor * 100%, origin: center + horizon, reflow: false, padded),
    ),
  )
}

#let _prompt-box(body, height: 0pt) = block(
  width: 100%,
  height: height,
  fill: white,
  stroke: 1pt + rgb("#dddddd"),
  radius: 8pt,
  inset: (x: 16pt, y: 12pt),
  _fit(body, size: (content-width - 32pt, height - 24pt)),
)

#let _option-cell(index, body, correct: false, size: (0pt, 0pt)) = {
  let (width, height) = size
  let color = option-colors.at(index)
  let inset = 10pt
  let content-inset = (x: 10pt, y: 8pt)
  let label-height = 34pt
  let box-height = height - 2 * inset - label-height

  block(
    width: width,
    height: height,
    fill: if correct { color } else { color.transparentize(55%) },
    stroke: if correct { 3pt + correct-ring } else { none },
    radius: 8pt,
    inset: inset,
    stack(
      dir: ttb,
      block(
        height: label-height,
        text(fill: white, weight: 600, size: 26pt, option-labels.at(index)),
      ),
      block(
        width: 100%,
        height: box-height,
        fill: white,
        radius: 6pt,
        inset: content-inset,
        _fit(
          body,
          size: (
            width - 2 * inset - 2 * content-inset.x,
            box-height - 2 * content-inset.y,
          ),
        ),
      ),
    ),
  )
}

#let _option-grid(options, correct-index, height: 0pt) = {
  let cell-width = (content-width - gutter) / 2
  let cell-height = (height - gutter) / 2

  grid(
    columns: (cell-width, cell-width),
    rows: (cell-height, cell-height),
    column-gutter: gutter,
    row-gutter: gutter,
    ..options
      .enumerate()
      .map(((index, body)) => _option-cell(
        index,
        body,
        correct: index == correct-index,
        size: (cell-width, cell-height),
      )),
  )
}

#let question(
  correct: none,
  answer-area-fraction: 0.5,
  prompt: none,
  options: (),
) = {
  assert(
    correct in option-labels,
    message: "question: `correct` must be one of \"A\", \"B\", \"C\", \"D\", got " + repr(correct),
  )
  assert(
    options.len() == 4,
    message: "question: expected exactly 4 options, got " + str(options.len()),
  )
  assert(
    answer-area-fraction > 0.0 and answer-area-fraction < 1.0,
    message: "question: `answer-area-fraction` must be in (0, 1), got " + repr(answer-area-fraction),
  )

  let prompt-height = (content-height - gutter) * (1.0 - answer-area-fraction)
  let answers-height = (content-height - gutter) * answer-area-fraction

  // Weak, so the first question does not emit a leading blank page.
  pagebreak(weak: true)
  stack(
    dir: ttb,
    spacing: gutter,
    _prompt-box(prompt, height: prompt-height),
    _option-grid(options, option-labels.position(l => l == correct), height: answers-height),
  )
}
