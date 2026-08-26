<script setup lang="ts">
import QuizDocExample from "./QuizDocExample.vue";

const TEMPLATE = `correct_answer: A
answer_area_fraction: 0.5

\`\`\`typst
Hier steht die Aufgabenstellung.
\`\`\`

\`\`\`typst-option
Antwort A
\`\`\`

\`\`\`typst-option
Antwort B
\`\`\`

\`\`\`typst-option
Antwort C
\`\`\`

\`\`\`typst-option
Antwort D
\`\`\`
`;

const SETS_EXAMPLE = `correct_answer: B
answer_area_fraction: 0.6

\`\`\`typst
Gegeben sind $A = { 2, 4, 6, 8, 9 }$ und $B = { 1, 3, 4, 6, 7 }$.

Was ist $A inter B$?
\`\`\`

\`\`\`typst-option
\${ 2, 8, 9 }$
\`\`\`

\`\`\`typst-option
\${ 4, 6 }$
\`\`\`

\`\`\`typst-option
\${ 1, 3, 7 }$
\`\`\`

\`\`\`typst-option
\${ 1, 2, 3, 4, 6, 7, 8, 9 }$
\`\`\`
`;

function fractionExample(fraction: string): string {
  return `correct_answer: C
answer_area_fraction: ${fraction}

\`\`\`typst
Ein Rechteck hat die Seiten $a = 7 "cm"$ und $b = 4 "cm"$.

Berechne den Flächeninhalt $A = a dot b$.
\`\`\`

\`\`\`typst-option
$11 "cm"^2$
\`\`\`

\`\`\`typst-option
$22 "cm"^2$
\`\`\`

\`\`\`typst-option
$28 "cm"^2$
\`\`\`

\`\`\`typst-option
$35 "cm"^2$
\`\`\`
`;
}

const PLOT_EXAMPLE = `correct_answer: B
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
`;

function venn2Option(a: string, ab: string, b: string): string {
  return `#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-venn:0.2.0": venn2
#canvas(length: 1cm, {
  import draw: *
  venn2(a-fill: ${a}, ab-fill: ${ab}, b-fill: ${b}, stroke: 1pt + black, padding: 0.3em, name: "venn")
  content("venn.a", $A$)
  content("venn.b", $B$)
})`;
}

const FILL = 'rgb("#4a90d9")';
const VENN_EXAMPLE = `correct_answer: A
answer_area_fraction: 0.7

\`\`\`typst
Welches Diagramm zeigt den Durchschnitt $A inter B$?
\`\`\`

\`\`\`typst-option
${venn2Option("white", FILL, "white")}
\`\`\`

\`\`\`typst-option
${venn2Option(FILL, "white", "white")}
\`\`\`

\`\`\`typst-option
${venn2Option(FILL, "white", FILL)}
\`\`\`

\`\`\`typst-option
${venn2Option(FILL, FILL, FILL)}
\`\`\`
`;

const CHEAT_SHEET: { typst: string; result: string; meaning: string }[] = [
  { typst: "$A inter B$", result: "A ∩ B", meaning: "Durchschnitt" },
  { typst: "$A union B$", result: "A ∪ B", meaning: "Vereinigung" },
  { typst: "$A without B$", result: "A ∖ B", meaning: "Differenz" },
  { typst: "$A subset B$", result: "A ⊂ B", meaning: "echte Teilmenge" },
  { typst: "$A subset.eq B$", result: "A ⊆ B", meaning: "Teilmenge" },
  { typst: "$x in A$", result: "x ∈ A", meaning: "Element von" },
  { typst: "$x in.not A$", result: "x ∉ A", meaning: "kein Element von" },
  { typst: "$emptyset$", result: "∅", meaning: "leere Menge" },
  { typst: "${ 1, 2, 3 }$", result: "{1, 2, 3}", meaning: "Menge aufzählen" },
  { typst: "$x^2$", result: "x²", meaning: "Potenz" },
  { typst: "$x_1$", result: "x₁", meaning: "Index" },
  { typst: "$a / b$", result: "a⁄b", meaning: "Bruch" },
  { typst: "$sqrt(x + 1)$", result: "√(x+1)", meaning: "Wurzel" },
  { typst: "$3 dot 4$", result: "3 · 4", meaning: "Malpunkt" },
  { typst: "$a <= b$", result: "a ≤ b", meaning: "kleiner gleich" },
  { typst: "$a != b$", result: "a ≠ b", meaning: "ungleich" },
  { typst: "$=>$", result: "⇒", meaning: "Implikation" },
  { typst: '$7 "cm"$', result: "7 cm", meaning: "Text in Formel" },
  { typst: "*fett*", result: "fett", meaning: "Fettschrift (ausserhalb von $…$)" },
  { typst: "_kursiv_", result: "kursiv", meaning: "Kursivschrift" },
];

const ERRORS: { message: string; cause: string }[] = [
  {
    message: "No questions found (expected at least one question)",
    cause: "Die Datei ist leer oder enthält nur ----Trennlinien.",
  },
  {
    message: "Question N: 'correct_answer' missing or not one of A-D",
    cause:
      "Die Zeile correct_answer fehlt, steht nach der ersten Leerzeile, oder der Wert ist keiner der Buchstaben A, B, C, D.",
  },
  {
    message: "Question N: expected exactly one prompt block, found X",
    cause: "Es gibt keinen oder mehr als einen ```typst-Block. Genau einer ist die Aufgabenstellung.",
  },
  {
    message: "Question N: expected exactly 4 options, found X",
    cause:
      "Es braucht immer genau vier ```typst-option-Blöcke — nie zwei, nie fünf. Häufigste Ursache: eine schliessende ``` fehlt, dann verschmelzen zwei Blöcke zu einem.",
  },
  {
    message: "Question N: malformed preface line \"…\" (expected 'key: value')",
    cause:
      "Eine Zeile vor der ersten Leerzeile ist kein key: value. Achte darauf, dass zwischen Vorspann und erstem Codeblock eine Leerzeile steht.",
  },
  {
    message: "Question N: unrecognized preface key 'x'",
    cause: "Nur correct_answer und answer_area_fraction sind erlaubt (Tippfehler prüfen).",
  },
  {
    message: "Question N: 'answer_area_fraction' must be a number in (0, 1)",
    cause: "Der Wert muss echt zwischen 0 und 1 liegen, z. B. 0.6 — nicht 60, nicht 1.",
  },
  {
    message: "Frage N, Option A: … unknown variable: plot",
    cause:
      "Typst-Kompilierfehler: ein #import fehlt. Für plot.plot(…) braucht es zusätzlich zu cetz auch #import \"@preview/cetz-plot:0.1.4\": plot.",
  },
  {
    message: "Frage N, Aufgabenstellung: … unexpected end of block comment",
    cause:
      "Typst-Syntaxfehler in der Aufgabenstellung, z. B. ein nicht geschlossenes $ oder eine fehlende Klammer.",
  },
];
</script>

<template>
  <div class="quiz-docs">
    <header class="quiz-docs__header">
      <h1>Quiz schreiben</h1>
      <p class="quiz-docs__lead">
        Eine Quiz-Datei ist reiner Text. Sie besteht aus mehreren Fragen, die mit einer Zeile aus genau drei
        Bindestrichen (<code>---</code>) voneinander getrennt werden. Aufgabenstellung und Antworten werden in
        <a href="https://typst.app/docs/reference/math/" target="_blank" rel="noopener">Typst</a> geschrieben, also
        auch Formeln und Diagramme.
      </p>
    </header>

    <nav class="quiz-docs__toc">
      <a href="#aufbau">Aufbau</a>
      <a href="#vorlage">Leere Vorlage</a>
      <a href="#beispiel-mengen">Beispiel: Mengen</a>
      <a href="#antwortflaeche">answer_area_fraction</a>
      <a href="#beispiel-graph">Beispiel: Graph</a>
      <a href="#beispiel-venn">Beispiel: Venn-Diagramm</a>
      <a href="#spickzettel">Typst Cheat Sheet</a>
      <a href="#fehler">Häufige Fehler</a>
    </nav>

    <section id="aufbau">
      <h2>Aufbau einer Frage</h2>
      <p>Jede Frage besteht aus zwei Teilen: einem Vorspann und einem Rumpf.</p>
      <ol class="quiz-docs__list">
        <li>
          <strong>Vorspann</strong> — eine oder zwei Zeilen der Form <code>schlüssel: wert</code>, ganz am Anfang der
          Frage. Er endet bei der ersten Leerzeile.
          <ul>
            <li>
              <code>correct_answer</code> (Pflicht) — der Buchstabe der richtigen Antwort: <code>A</code>,
              <code>B</code>, <code>C</code> oder <code>D</code>. Die Buchstaben ergeben sich aus der Reihenfolge der
              Antwortblöcke.
            </li>
            <li>
              <code>answer_area_fraction</code> (optional, Standard <code>0.5</code>) — Anteil der Bildschirmhöhe für
              das Antwortfeld, eine Zahl echt zwischen 0 und 1.
            </li>
          </ul>
        </li>
        <li>
          <strong>Rumpf</strong> — genau ein Block <code>```typst</code> mit der Aufgabenstellung, gefolgt von genau
          vier Blöcken <code>```typst-option</code> mit den Antworten A, B, C und D in dieser Reihenfolge.
        </li>
      </ol>
      <p class="quiz-docs__note">
        Wichtig: Die Trennlinie zwischen zwei Fragen muss allein auf einer Zeile stehen und darf nur
        <code>---</code> enthalten. Zwischen Vorspann und erstem Codeblock gehört eine Leerzeile.
      </p>
      <p class="quiz-docs__note">
        Die Spielerinnen und Spieler sehen auf ihrem Handy nur die vier farbigen Knöpfe A–D, nie den Inhalt der
        Antworten. Alles Inhaltliche muss also auf dem Beamer lesbar sein.
      </p>
    </section>

    <section id="vorlage">
      <h2>Leere Vorlage</h2>
      <p>
        Diese Vorlage ist syntaktisch vollständig und lässt sich sofort starten. Text und Antworten einfach
        ersetzen, für weitere Fragen den ganzen Block kopieren und mit einer <code>---</code>-Zeile anhängen.
      </p>
      <QuizDocExample :source="TEMPLATE" caption="So sieht die Vorlage auf dem Beamer aus." />
    </section>

    <section id="beispiel-mengen">
      <h2>Beispiel: Mengenoperationen</h2>
      <p>
        Formeln stehen zwischen Dollarzeichen. In Typst haben Symbole keinen Rückstrich: Der Durchschnitt ist
        <code>inter</code>, nicht <code>\cap</code>. Leerzeichen innerhalb von <code>$…$</code> trennen Symbole und
        werden nicht gedruckt.
      </p>
      <QuizDocExample :source="SETS_EXAMPLE" />
    </section>

    <section id="antwortflaeche">
      <h2>Wie viel Platz die Antworten bekommen</h2>
      <p>
        <code>answer_area_fraction</code> teilt die Beamer-Höhe zwischen Aufgabenstellung und Antwortgitter auf. Ein
        kleiner Wert macht die Aufgabenstellung gross (gut für langen Text), ein grosser Wert macht die Antworten
        gross (gut für Diagramme). Beide Beispiele unten zeigen dieselbe Frage, nur mit anderem Wert.
      </p>
      <div class="quiz-docs__compare">
        <QuizDocExample
          :source="fractionExample('0.3')"
          :show-source="false"
          caption="answer_area_fraction: 0.3 — viel Platz für die Aufgabe"
        />
        <QuizDocExample
          :source="fractionExample('0.8')"
          :show-source="false"
          caption="answer_area_fraction: 0.8 — viel Platz für die Antworten"
        />
      </div>
    </section>

    <section id="beispiel-graph">
      <h2>Beispiel: Graphen mit cetz-plot</h2>
      <p>
        Antworten dürfen auch Zeichnungen sein. Dafür gibt es die Typst-Pakete
        <code>@preview/cetz</code> und <code>@preview/cetz-plot</code>. Die <code>#import</code>-Zeilen müssen in
        <em>jedem</em> Block stehen, in dem sie gebraucht werden — jeder Block wird einzeln kompiliert.
      </p>
      <QuizDocExample :source="PLOT_EXAMPLE" />
    </section>

    <section id="beispiel-venn">
      <h2>Beispiel: Venn-Diagramme mit cetz-venn</h2>
      <p>
        <code>@preview/cetz-venn</code> liefert <code>venn2</code> und <code>venn3</code>. Über
        <code>a-fill</code>, <code>ab-fill</code> und <code>b-fill</code> wird eingefärbt, welcher Bereich gemeint
        ist; <code>name: "venn"</code> erzeugt die Ankerpunkte <code>venn.a</code> und <code>venn.b</code> für die
        Beschriftungen.
      </p>
      <QuizDocExample :source="VENN_EXAMPLE" />
    </section>

    <section id="spickzettel">
      <h2>Typst Cheat Sheet</h2>
      <table class="quiz-docs__table">
        <thead>
          <tr>
            <th>Typst</th>
            <th>Ergebnis</th>
            <th>Bedeutung</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in CHEAT_SHEET" :key="row.typst">
            <td><code>{{ row.typst }}</code></td>
            <td>{{ row.result }}</td>
            <td>{{ row.meaning }}</td>
          </tr>
        </tbody>
      </table>
      <p class="quiz-docs__note">
        Die vollständige Symbolliste steht in der
        <a href="https://typst.app/docs/reference/symbols/sym/" target="_blank" rel="noopener">Typst-Dokumentation</a>.
      </p>
    </section>

    <section id="fehler">
      <h2>Häufige Fehler</h2>
      <p>
        Die Vorschau auf dem Startbildschirm prüft laufend den Aufbau. Beim Klick auf «Quiz erstellen» wird
        zusätzlich jeder einzelne Typst-Block wirklich kompiliert — erst wenn alles fehlerfrei ist, erscheint die
        Lobby mit dem QR-Code.
      </p>
      <dl class="quiz-docs__errors">
        <template v-for="error in ERRORS" :key="error.message">
          <dt><code>{{ error.message }}</code></dt>
          <dd>{{ error.cause }}</dd>
        </template>
      </dl>
    </section>
  </div>
</template>

<style scoped>
/* Direct flex child of `#app` (display:flex): needs an explicit min-width so
   the fixed 1280px ScreenFrame canvas inside can't inflate the min-content
   width and cause horizontal page overflow. */
.quiz-docs {
  min-width: 0;
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.5rem;
  box-sizing: border-box;
  text-align: left;
}
.quiz-docs__lead {
  max-width: 70ch;
}
.quiz-docs__toc {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin: 1.5rem 0 2.5rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  font-size: 0.9rem;
}
.quiz-docs section {
  margin-bottom: 3rem;
}
.quiz-docs h2 {
  margin-bottom: 0.75rem;
  scroll-margin-top: 1rem;
}
.quiz-docs p {
  max-width: 70ch;
  margin-bottom: 0.75rem;
}
.quiz-docs__list {
  max-width: 70ch;
  line-height: 1.6;
}
.quiz-docs__list > li {
  margin-bottom: 0.75rem;
}
.quiz-docs__note {
  font-size: 0.9rem;
}
.quiz-docs__compare {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1.5rem;
}
@media (max-width: 900px) {
  .quiz-docs__compare {
    grid-template-columns: minmax(0, 1fr);
  }
}
.quiz-docs__table {
  border-collapse: collapse;
  width: 100%;
  max-width: 40rem;
  font-size: 0.9rem;
}
.quiz-docs__table th,
.quiz-docs__table td {
  text-align: left;
  padding: 0.35rem 0.75rem 0.35rem 0;
  border-bottom: 1px solid var(--border, #333);
}
.quiz-docs__errors {
  max-width: 70ch;
}
.quiz-docs__errors dt {
  margin-top: 1rem;
}
.quiz-docs__errors dd {
  margin: 0.35rem 0 0;
  font-size: 0.9rem;
}
</style>
