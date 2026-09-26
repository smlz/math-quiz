<script setup lang="ts">
import { onUnmounted } from "vue";
import QuizDocExample from "./QuizDocExample.vue";
import { QUIZ_TEMPLATE, STARTER_QUIZ } from "../quiz/sampleQuiz";

// Every example below is only the `#question(...)` call; the header (and any
// imports/macros it needs) is passed as a hidden prelude so the listing stays
// focused on the one thing the section is about.
const HEADER = `#import "quiz.typ": *
#show: quiz

`;

const PLOT_PRELUDE = `${HEADER}#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-plot:0.1.4": plot

#let graph(body) = canvas(length: 1cm, {
  plot.plot(size: (3, 3), x-tick-step: none, y-tick-step: none, body)
})

`;

const VENN_PRELUDE = `${HEADER}#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-venn:0.2.0": venn2

#let hl = rgb("#4a90d9")

#let venn(a, ab, b) = canvas(length: 1cm, {
  import draw: *
  venn2(a-fill: a, ab-fill: ab, b-fill: b, stroke: 1pt + black, padding: 0.3em, name: "venn")
  content("venn.a", $A$)
  content("venn.b", $B$)
})

`;

const SETS_EXAMPLE = `#question(
  correct: "B",
  answer-area-fraction: 0.6,
  prompt: [
    Gegeben sind $A = { 2, 4, 6, 8, 9 }$ und $B = { 1, 3, 4, 6, 7 }$.

    Was ist $A inter B$?
  ],
  options: (
    [\${ 2, 8, 9 }$],
    [\${ 4, 6 }$],
    [\${ 1, 3, 7 }$],
    [\${ 1, 2, 3, 4, 6, 7, 8, 9 }$],
  ),
)
`;

function fractionExample(fraction: string): string {
  return `#question(
  correct: "C",
  answer-area-fraction: ${fraction},
  prompt: [
    Ein Rechteck hat die Seiten $a = 7 "cm"$ und $b = 4 "cm"$.

    Berechne den Flächeninhalt $A = a dot b$.
  ],
  options: (
    [$11 "cm"^2$],
    [$22 "cm"^2$],
    [$28 "cm"^2$],
    [$35 "cm"^2$],
  ),
)
`;
}

const PLOT_EXAMPLE = `#question(
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
`;

const VENN_EXAMPLE = `#question(
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
`;

function downloadUrl(content: string): string {
  return URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
}

const templateUrl = downloadUrl(QUIZ_TEMPLATE);
const starterUrl = downloadUrl(STARTER_QUIZ);

onUnmounted(() => {
  URL.revokeObjectURL(templateUrl);
  URL.revokeObjectURL(starterUrl);
});


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
    message: "Missing template header: a quiz file must start with …",
    cause:
      "Die ersten beiden Zeilen fehlen oder sind verändert. Sie müssen exakt #import \"quiz.typ\": * und #show: quiz lauten — Kommentare und Leerzeilen davor sind erlaubt.",
  },
  {
    message: "No questions found (expected at least one #question(...) call …)",
    cause:
      "Die Datei enthält keinen #question(…)-Aufruf, oder er ist eingerückt. #question muss immer ganz am Zeilenanfang stehen.",
  },
  {
    message: "Question N: 'correct' missing or not one of \"A\"-\"D\"",
    cause: "correct: fehlt oder der Wert ist kein Buchstabe in Anführungszeichen — richtig ist z. B. correct: \"C\".",
  },
  {
    message: "Question N: 'prompt' missing or not a content block [...]",
    cause: "prompt: fehlt, oder der Wert steht nicht in eckigen Klammern. Richtig: prompt: [Text …].",
  },
  {
    message: "Question N: expected exactly 4 options, found X",
    cause:
      "Es braucht immer genau vier Einträge in options — nie drei, nie fünf. Häufigste Ursache: eine fehlende eckige Klammer, dann verschmelzen zwei Antworten zu einer.",
  },
  {
    message: "Question N: unrecognized argument 'x'",
    cause: "Nur correct, prompt, options und answer-area-fraction sind erlaubt (Tippfehler prüfen, Bindestriche statt Unterstriche).",
  },
  {
    message: "Question N: 'answer-area-fraction' must be a number in (0, 1)",
    cause: "Der Wert muss echt zwischen 0 und 1 liegen, z. B. 0.6 — nicht 60, nicht 1.",
  },
  {
    message: "Question N: unterminated `#question(...)` call (unbalanced brackets)",
    cause: "Irgendwo fehlt eine schliessende Klammer. Der Typst-Editor markiert die Stelle meist direkt.",
  },
  {
    message: "Frage N, Option A: … unknown variable: plot",
    cause:
      "Typst-Kompilierfehler: ein #import fehlt im Vorspann. Für plot.plot(…) braucht es zusätzlich zu cetz auch #import \"@preview/cetz-plot:0.1.4\": plot.",
  },
  {
    message: "Frage N, Aufgabenstellung: … unexpected end of block comment",
    cause: "Typst-Syntaxfehler in der Aufgabenstellung, z. B. ein nicht geschlossenes $ oder eine fehlende Klammer.",
  },
];
</script>

<template>
  <div class="quiz-docs">
    <header class="quiz-docs__header">
      <h1>Quiz schreiben</h1>
      <p class="quiz-docs__lead">
        Eine Quiz-Datei ist ein ganz normales
        <a href="https://typst.app/docs/" target="_blank" rel="noopener">Typst</a>-Dokument
        (<code>.typ</code>). Du schreibst sie mit den üblichen Typst-Werkzeugen — am einfachsten in VS Code mit der
        Erweiterung <strong>Tinymist Typst</strong>, die dir Fehler sofort anzeigt und eine Live-Vorschau öffnet.
        Kompilierst du die Datei, erhältst du pro Frage eine 16:9-Seite mit hervorgehobener richtiger Antwort — genau
        so, wie sie später auf dem Beamer aussieht.
      </p>
    </header>

    <nav class="quiz-docs__toc">
      <a href="#aufbau">Aufbau</a>
      <a href="#vorlage">Vorlage herunterladen</a>
      <a href="#beispiel-mengen">Beispiel: Mengen</a>
      <a href="#antwortflaeche">answer-area-fraction</a>
      <a href="#beispiel-graph">Beispiel: Graph</a>
      <a href="#beispiel-venn">Beispiel: Venn-Diagramm</a>
      <a href="#spickzettel">Typst Cheat Sheet</a>
      <a href="#fehler">Häufige Fehler</a>
    </nav>

    <section id="aufbau">
      <h2>Aufbau einer Quiz-Datei</h2>
      <p>Jede Quiz-Datei hat denselben, festen Aufbau aus drei Teilen:</p>
      <ol class="quiz-docs__list">
        <li>
          <strong>Kopf</strong> — genau diese zwei Zeilen, ganz am Anfang der Datei:
          <code>#import "quiz.typ": *</code> und <code>#show: quiz</code>. Damit wird die Vorlage geladen, die für das
          Layout sorgt. Die Datei <code>quiz.typ</code> muss im selben Ordner liegen (siehe unten).
        </li>
        <li>
          <strong>Vorspann</strong> (optional) — weitere <code>#import</code>-Zeilen und eigene Abkürzungen
          (<code>#let</code>). Alles, was hier steht, gilt für <em>alle</em> Fragen: Du musst ein Paket wie
          <code>cetz</code> also nur einmal importieren, nicht in jeder Antwort.
        </li>
        <li>
          <strong>Fragen</strong> — ein <code>#question(…)</code>-Aufruf pro Frage, jeweils am Zeilenanfang. Die
          Reihenfolge in der Datei ist die Reihenfolge im Spiel.
        </li>
      </ol>

      <p>Eine Frage hat genau vier benannte Angaben:</p>
      <table class="quiz-docs__table">
        <thead>
          <tr>
            <th>Angabe</th>
            <th>Pflicht</th>
            <th>Bedeutung</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>correct</code></td>
            <td>ja</td>
            <td>Buchstabe der richtigen Antwort in Anführungszeichen: <code>"A"</code> bis <code>"D"</code></td>
          </tr>
          <tr>
            <td><code>prompt</code></td>
            <td>ja</td>
            <td>Aufgabenstellung, in eckigen Klammern: <code>[…]</code></td>
          </tr>
          <tr>
            <td><code>options</code></td>
            <td>ja</td>
            <td>Genau vier Antworten, je in eckigen Klammern: <code>([…], […], […], […])</code> — in dieser Reihenfolge A, B, C, D</td>
          </tr>
          <tr>
            <td><code>answer-area-fraction</code></td>
            <td>nein</td>
            <td>Anteil der Bildschirmhöhe fürs Antwortgitter, Standard <code>0.5</code></td>
          </tr>
        </tbody>
      </table>

      <p class="quiz-docs__note">
        Die Spielerinnen und Spieler sehen auf ihrem Handy nur die vier farbigen Knöpfe A–D, nie den Inhalt der
        Antworten. Alles Inhaltliche muss also auf dem Beamer lesbar sein.
      </p>
    </section>

    <section id="vorlage">
      <h2>Vorlage herunterladen</h2>
      <p>
        Lade beide Dateien in denselben Ordner. <code>quiz.typ</code> ist die Vorlage und wird nie verändert;
        <code>mein-quiz.typ</code> ist dein Startpunkt — Text und Antworten ersetzen, für weitere Fragen den ganzen
        <code>#question(…)</code>-Block kopieren.
      </p>
      <p class="quiz-docs__downloads">
        <a class="quiz-docs__download" :href="templateUrl" download="quiz.typ">quiz.typ (Vorlage)</a>
        <a class="quiz-docs__download" :href="starterUrl" download="mein-quiz.typ">mein-quiz.typ (Startdatei)</a>
      </p>
      <p>
        Danach in VS Code <code>mein-quiz.typ</code> öffnen und die Tinymist-Vorschau starten — oder im Terminal
        <code>typst watch mein-quiz.typ</code> laufen lassen. Zum Spielen den Inhalt der Datei kopieren und auf der
        Startseite einfügen.
      </p>
      <QuizDocExample
        :source="STARTER_QUIZ"
        prelude=""
        caption="So sieht die Startdatei auf dem Beamer aus."
      />
    </section>

    <section id="beispiel-mengen">
      <h2>Beispiel: Mengenoperationen</h2>
      <p>
        Formeln stehen zwischen Dollarzeichen. In Typst haben Symbole keinen Rückstrich: Der Durchschnitt ist
        <code>inter</code>, nicht <code>\cap</code>. Leerzeichen innerhalb von <code>$…$</code> trennen Symbole und
        werden nicht gedruckt. Eine Leerzeile in <code>prompt: […]</code> ergibt einen Absatz.
      </p>
      <QuizDocExample :source="SETS_EXAMPLE" />
    </section>

    <section id="antwortflaeche">
      <h2>Wie viel Platz die Antworten bekommen</h2>
      <p>
        <code>answer-area-fraction</code> teilt die Beamer-Höhe zwischen Aufgabenstellung und Antwortgitter auf. Ein
        kleiner Wert macht die Aufgabenstellung gross (gut für langen Text), ein grosser Wert macht die Antworten
        gross (gut für Diagramme). Beide Beispiele unten zeigen dieselbe Frage, nur mit anderem Wert.
      </p>
      <div class="quiz-docs__compare">
        <QuizDocExample
          :source="fractionExample('0.3')"
          :show-source="false"
          caption="answer-area-fraction: 0.3 — viel Platz für die Aufgabe"
        />
        <QuizDocExample
          :source="fractionExample('0.8')"
          :show-source="false"
          caption="answer-area-fraction: 0.8 — viel Platz für die Antworten"
        />
      </div>
    </section>

    <section id="beispiel-graph">
      <h2>Beispiel: Graphen mit cetz-plot</h2>
      <p>
        Antworten dürfen auch Zeichnungen sein. Dafür gibt es die Typst-Pakete
        <code>@preview/cetz</code> und <code>@preview/cetz-plot</code>. Die <code>#import</code>-Zeilen und die
        Abkürzung <code>#let graph(…)</code> stehen einmal im Vorspann der Datei:
      </p>
      <pre class="quiz-docs__code">{{ PLOT_PRELUDE.trim() }}</pre>
      <QuizDocExample :source="PLOT_EXAMPLE" :prelude="PLOT_PRELUDE" />
    </section>

    <section id="beispiel-venn">
      <h2>Beispiel: Venn-Diagramme mit cetz-venn</h2>
      <p>
        <code>@preview/cetz-venn</code> liefert <code>venn2</code> und <code>venn3</code>. Über
        <code>a-fill</code>, <code>ab-fill</code> und <code>b-fill</code> wird eingefärbt, welcher Bereich gemeint
        ist; <code>name: "venn"</code> erzeugt die Ankerpunkte <code>venn.a</code> und <code>venn.b</code> für die
        Beschriftungen. Auch hier lohnt sich eine Abkürzung im Vorspann:
      </p>
      <pre class="quiz-docs__code">{{ VENN_PRELUDE.trim() }}</pre>
      <QuizDocExample :source="VENN_EXAMPLE" :prelude="VENN_PRELUDE" />
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
.quiz-docs__downloads {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.quiz-docs__download {
  padding: 0.5rem 1rem;
  border: 1px solid var(--accent-border, #666);
  border-radius: 8px;
  background: var(--accent-bg, transparent);
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 0.9rem;
  text-decoration: none;
}
.quiz-docs__code {
  max-width: 70ch;
  margin: 0 0 1rem;
  padding: 0.75rem;
  overflow: auto;
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 0.78rem;
  line-height: 1.45;
  background: var(--code-bg, #1f2028);
  color: var(--text-h, #f3f4f6);
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
