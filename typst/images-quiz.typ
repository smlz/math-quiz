#import "quiz.typ": *
#show: quiz

// The images are in the `images/` folder next to this file. When the quiz is
// loaded from a link (?src=gh:smlz/math-quiz/typst/images-quiz.typ), the app
// fetches them from there. The path must be a literal string in image("...").

#question(
  correct: "A",
  answer-area-fraction: 0.4,
  prompt: [
    #image("images/pythagoras.svg", height: 5cm)

    Wie lang ist die Hypotenuse $c$?
  ],
  options: ([$5$], [$7$], [$6$], [$sqrt(7)$]),
)

#question(
  correct: "C",
  answer-area-fraction: 0.7,
  prompt: [Welches Dreieck ist rechtwinklig?],
  options: (
    [#image("images/triangle-acute.svg", height: 3cm)],
    [#image("images/triangle-obtuse.svg", height: 3cm)],
    [#image("images/triangle-right.svg", height: 3cm)],
    [#image("images/triangle-equilateral.svg", height: 3cm)],
  ),
)

#question(
  correct: "A",
  answer-area-fraction: 0.4,
  prompt: [
    #image("images/quarter-circle.svg", height: 5cm)

    Wie gross ist die Fläche des grünen Viertelkreises?
  ],
  options: ([$pi$], [$2 pi$], [$4 pi$], [$pi / 2$]),
)

#question(
  correct: "B",
  answer-area-fraction: 0.4,
  prompt: [
    #image("images/supplementary-angles.svg", height: 5cm)

    Wie gross ist der Nebenwinkel $beta$?
  ],
  options: ([$65 degree$], [$115 degree$], [$25 degree$], [$90 degree$]),
)
