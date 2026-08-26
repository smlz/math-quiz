/** Sample quiz used to prefill the standalone preview and host "load quiz"
 * screens, adapted from SPEC.md §3.2 (prompts in Swiss-standard German). */
export const SAMPLE_QUIZ = `correct_answer: C

\`\`\`typst
Wie gross ist $x$, wenn $2x + 3 = 11$?
\`\`\`

\`\`\`typst-option
$2$
\`\`\`

\`\`\`typst-option
$3$
\`\`\`

\`\`\`typst-option
$4$
\`\`\`

\`\`\`typst-option
$5$
\`\`\`

---

correct_answer: B
answer_area_fraction: 0.8

\`\`\`typst
Welcher Graph zeigt $y = x^2$?
\`\`\`

\`\`\`typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-plot:0.1.4": plot
#canvas(length: 1cm, {
  import draw: *
  plot.plot(size: (3, 3), x-tick-step: none, y-tick-step: none, {
    plot.add(domain: (-2, 2), x => x)
  })
})
\`\`\`

\`\`\`typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-plot:0.1.4": plot
#canvas(length: 1cm, {
  import draw: *
  plot.plot(size: (3, 3), x-tick-step: none, y-tick-step: none, {
    plot.add(domain: (-2, 2), x => x * x)
  })
})
\`\`\`

\`\`\`typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-plot:0.1.4": plot
#canvas(length: 1cm, {
  import draw: *
  plot.plot(size: (3, 3), x-tick-step: none, y-tick-step: none, {
    plot.add(domain: (-2, 2), x => x * x * x)
  })
})
\`\`\`

\`\`\`typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-plot:0.1.4": plot
#canvas(length: 1cm, {
  import draw: *
  plot.plot(size: (3, 3), x-tick-step: none, y-tick-step: none, {
    plot.add(domain: (-2, -0.2), x => 1 / x)
    plot.add(domain: (0.2, 2), x => 1 / x)
  })
})
\`\`\`

---

correct_answer: A
answer_area_fraction: 0.7

\`\`\`typst
Welches Diagramm zeigt den Durchschnitt $A inter B$?
\`\`\`

\`\`\`typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-venn:0.2.0": venn2
#canvas(length: 1cm, {
  import draw: *
  venn2(a-fill: white, b-fill: white, ab-fill: rgb("#4a90d9"), stroke: 1pt + black, padding: 0.3em, name: "venn")
  content("venn.a", $A$)
  content("venn.b", $B$)
})
\`\`\`

\`\`\`typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-venn:0.2.0": venn2
#canvas(length: 1cm, {
  import draw: *
  venn2(a-fill: rgb("#4a90d9"), b-fill: white, ab-fill: white, stroke: 1pt + black, padding: 0.3em, name: "venn")
  content("venn.a", $A$)
  content("venn.b", $B$)
})
\`\`\`

\`\`\`typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-venn:0.2.0": venn2
#canvas(length: 1cm, {
  import draw: *
  venn2(a-fill: rgb("#4a90d9"), b-fill: rgb("#4a90d9"), ab-fill: white, stroke: 1pt + black, padding: 0.3em, name: "venn")
  content("venn.a", $A$)
  content("venn.b", $B$)
})
\`\`\`

\`\`\`typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-venn:0.2.0": venn2
#canvas(length: 1cm, {
  import draw: *
  venn2(a-fill: rgb("#4a90d9"), b-fill: rgb("#4a90d9"), ab-fill: rgb("#4a90d9"), stroke: 1pt + black, padding: 0.3em, name: "venn")
  content("venn.a", $A$)
  content("venn.b", $B$)
})
\`\`\`
`;
