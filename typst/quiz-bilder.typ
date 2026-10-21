#import "quiz.typ": *
#show: quiz

// Bilder liegen im Ordner `bilder/` neben dieser Datei. Per Link geladen
// (?src=gh:smlz/math-quiz/typst/quiz-bilder.typ), holt die App sie von dort.
// Der Pfad muss als fester Text in image("...") stehen.

#question(
  correct: "A",
  answer-area-fraction: 0.4,
  prompt: [
    #image("bilder/rechtwinkliges-dreieck.svg", height: 5cm)

    Wie lang ist die Hypotenuse $c$?
  ],
  options: ([$5$], [$7$], [$6$], [$sqrt(7)$]),
)

#question(
  correct: "C",
  answer-area-fraction: 0.7,
  prompt: [Welches Dreieck ist rechtwinklig?],
  options: (
    [#image("bilder/dreieck-spitzwinklig.svg", height: 3cm)],
    [#image("bilder/dreieck-stumpfwinklig.svg", height: 3cm)],
    [#image("bilder/dreieck-rechtwinklig.svg", height: 3cm)],
    [#image("bilder/dreieck-gleichseitig.svg", height: 3cm)],
  ),
)

#question(
  correct: "A",
  answer-area-fraction: 0.4,
  prompt: [
    #image("bilder/viertelkreis.svg", height: 5cm)

    Wie gross ist die Fläche des grünen Viertelkreises?
  ],
  options: ([$pi$], [$2 pi$], [$4 pi$], [$pi / 2$]),
)

#question(
  correct: "B",
  answer-area-fraction: 0.4,
  prompt: [
    #image("bilder/nebenwinkel.svg", height: 5cm)

    Wie gross ist der Nebenwinkel $beta$?
  ],
  options: ([$65 degree$], [$115 degree$], [$25 degree$], [$90 degree$]),
)
