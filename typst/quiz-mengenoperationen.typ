#import "quiz.typ": *
#show: quiz

#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-venn:0.2.0": venn2

#let hl = rgb("#4a90d9")

#let venn(a, ab, b) = canvas(length: 1cm, {
  import draw: *
  venn2(a-fill: a, ab-fill: ab, b-fill: b, stroke: 1pt + black, padding: 0.3em, name: "venn")
  content("venn.a", $A$)
  content("venn.b", $B$)
})

#let A = $A = { 2, 4, 6, 8, 9 }$
#let B = $B = { 1, 3, 4, 6, 7 }$

#question(
  correct: "B",
  answer-area-fraction: 0.6,
  prompt: [
    Gegeben sind #A und #B.

    Was ist $A inter B$?
  ],
  options: (
    [${ 2, 8, 9 }$],
    [${ 4, 6 }$],
    [${ 1, 3, 7 }$],
    [${ 1, 2, 3, 4, 6, 7, 8, 9 }$],
  ),
)

#question(
  correct: "D",
  answer-area-fraction: 0.6,
  prompt: [
    Wieder mit #A und #B.

    Was ist $A without B$?
  ],
  options: (
    [${ 1, 3, 7 }$],
    [${ 4, 6 }$],
    [${ 1, 2, 3, 7, 8, 9 }$],
    [${ 2, 8, 9 }$],
  ),
)

#question(
  correct: "A",
  answer-area-fraction: 0.6,
  prompt: [
    Immer noch #A und #B.

    Was ist $(A without B) union (B without A)$?
  ],
  options: (
    [${ 1, 2, 3, 7, 8, 9 }$],
    [${ 1, 2, 3, 4, 6, 7, 8, 9 }$],
    [${ 4, 6 }$],
    [${ }$],
  ),
)

#question(
  correct: "C",
  answer-area-fraction: 0.7,
  prompt: [Welche Aussage ist für *alle* Mengen $A$ und $B$ wahr?],
  options: (
    [$(A union B) subset B$],
    [$A subset (A inter B)$],
    [$(A inter B) subset A$],
    [$B subset (A without B)$],
  ),
)

#question(
  correct: "A",
  answer-area-fraction: 0.7,
  prompt: [Vereinfache: $A inter (B union A) = $ ?],
  options: (
    [$A$],
    [$B$],
    [$A inter B$],
    [${ }$],
  ),
)

#question(
  correct: "C",
  answer-area-fraction: 0.8,
  prompt: [Welches Diagramm zeigt $B without A$?],
  options: (
    [#venn(hl, white, white)],
    [#venn(white, hl, white)],
    [#venn(white, white, hl)],
    [#venn(hl, white, hl)],
  ),
)
