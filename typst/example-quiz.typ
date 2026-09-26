#import "quiz.typ": *
#show: quiz

#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-plot:0.1.4": plot
#import "@preview/cetz-venn:0.2.0": venn2

#let hl = rgb("#4a90d9")

#let graph(body) = canvas(length: 1cm, {
  plot.plot(size: (3, 3), x-tick-step: none, y-tick-step: none, body)
})

#let venn(a, ab, b) = canvas(length: 1cm, {
  import draw: *
  venn2(a-fill: a, ab-fill: ab, b-fill: b, stroke: 1pt + black, padding: 0.3em, name: "venn")
  content("venn.a", $A$)
  content("venn.b", $B$)
})

#question(
  correct: "C",
  prompt: [Wie gross ist $x$, wenn $2x + 3 = 11$?],
  options: ([$2$], [$3$], [$4$], [$5$]),
)

#question(
  correct: "B",
  answer-area-fraction: 0.8,
  prompt: [Welcher Graph zeigt $y = x^2$?],
  options: (
    [#graph({ plot.add(domain: (-2, 2), x => x) })],
    [#graph({ plot.add(domain: (-2, 2), x => x * x) })],
    [#graph({ plot.add(domain: (-2, 2), x => x * x * x) })],
    [#graph({
      plot.add(domain: (-2, -0.2), x => 1 / x)
      plot.add(domain: (0.2, 2), x => 1 / x)
    })],
  ),
)

#question(
  correct: "A",
  answer-area-fraction: 0.7,
  prompt: [Welches Diagramm zeigt die Schnittmenge $A inter B$?],
  options: (
    [#venn(white, hl, white)],
    [#venn(hl, white, white)],
    [#venn(hl, white, hl)],
    [#venn(hl, hl, hl)],
  ),
)
