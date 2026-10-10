<script setup lang="ts">
// Deliberately plain: no Typst, no examples, nothing fetched. The players'
// footer links here, and their devices load nothing from third parties — the
// docs page, which compiles its examples, could not make that promise.
</script>

<template>
  <div class="quiz-about">
    <header>
      <h1>Datenschutz &amp; Grenzen</h1>
      <p class="quiz-about__lead">
        Die App ist auf Einfachheit und Datensparsamkeit ausgelegt: Das ganze Spiel läuft im Browser der Lehrperson,
        der Server reicht nur Nachrichten zwischen Beamer und Handys weiter. Daraus folgt, was mit den Daten
        geschieht — und auch, was die App nicht kann.
      </p>
    </header>

    <nav class="quiz-about__toc">
      <a href="#datenschutz">Datenschutz</a>
      <a href="#grenzen">Grenzen</a>
    </nav>

    <section id="datenschutz">
      <h2>Datenschutz</h2>
      <p>
        Kein Konto, keine Cookies, keine Werbung, keine Analyse, kein Tracking, keine Telemetrie, keine
        Social-Media-Knöpfe. Der Server speichert nichts.
      </p>
      <dl class="quiz-about__list">
        <dt>Nur ein Spitzname</dt>
        <dd>
          Spielerinnen und Spieler geben einzig einen Spitznamen an. Er erscheint in der Lobby und auf der Rangliste
          am Beamer — alle im Raum sehen ihn.
        </dd>

        <dt>Der Spielstand liegt im Browser der Lehrperson</dt>
        <dd>
          Fragen, Spitznamen, Antworten und Punkte werden nur dort geführt. Der Server leitet die Nachrichten weiter,
          ohne sie zu lesen oder zu speichern. Die Quiz-Datei selbst wird nie an den Server geschickt.
        </dd>

        <dt>Was die anderen erfahren</dt>
        <dd>
          Welche Antwort jemand gewählt hat, erfährt nur der Browser der Lehrperson; am Beamer erscheint nach der
          Auflösung bloss, wie oft jede Antwort gewählt wurde. An die Handys geht, wer schon geantwortet hat und wer
          richtig lag — als zufällige Kennung, ohne Spitznamen.
        </dd>

        <dt>Im eigenen Browser gespeichert</dt>
        <dd>
          Damit ein Neuladen oder ein Verbindungsabbruch das Spiel nicht beendet, merkt sich der Browser das laufende
          Spiel: auf dem Handy Spitzname, Punktestand und die eigene letzte Antwort, bei der Lehrperson das Quiz und
          den Spielstand. Diese Einträge werden gelöscht, sobald das Quiz beendet ist. Der Spitzname bleibt auf dem
          Handy als Vorschlag fürs nächste Mal.
        </dd>

        <dt>Server und Protokolle</dt>
        <dd>
          Die Seite wird von GitHub Pages ausgeliefert, der Server läuft bei FastAPI Cloud. Wie bei jedem
          Webseitenaufruf sehen beide die IP-Adresse des Geräts. Die Zugriffsprotokolle des Servers werden nach einem
          Tag gelöscht.
        </dd>

        <dt>Fremde Server</dt>
        <dd>
          Die Handys der Spielerinnen und Spieler laden nichts von Dritten. Die Seiten «Quiz erstellen» und
          «Anleitung» laden den Typst-Compiler, Schriften und Pakete von jsDelivr und packages.typst.org — und, wenn
          ein Quiz per Link geladen wird, die Datei von der angegebenen Adresse.
        </dd>
      </dl>
    </section>

    <section id="grenzen">
      <h2>Grenzen</h2>
      <p>Die meisten Grenzen sind die Kehrseite davon, dass nichts gespeichert wird.</p>
      <dl class="quiz-about__list">
        <dt>Keine Auswertung danach</dt>
        <dd>
          Nach dem Quiz gibt es keine Resultate, keinen Export und keinen Verlauf. Für Noten oder Lernkontrollen ist
          die App deshalb nicht geeignet.
        </dd>

        <dt>Der Browser am Beamer ist das Spiel</dt>
        <dd>
          Der Tab der Lehrperson muss offen bleiben. Ein Neuladen oder ein kurzer Unterbruch schadet nicht, das Spiel
          geht im selben Browser weiter — aber nicht auf einem anderen Gerät und nicht, nachdem die Browserdaten
          gelöscht wurden. Ein Spiel bleibt höchstens 24 Stunden gültig.
        </dd>

        <dt>Keine Quiz-Sammlung</dt>
        <dd>
          Die App bewahrt keine Quizze auf. Die <code>.typ</code>-Datei gehört in die eigene Ablage; von dort wird sie
          eingefügt oder <a href="/docs#link">per Link geladen</a>.
        </dd>

        <dt>Ohne Internet geht nichts</dt>
        <dd>
          Alle Geräte brauchen Internetzugang. Die Handys müssen <code>quiz.smlz.ch</code> und
          <code>quiz-api.fastapicloud.dev</code> erreichen, der Rechner der Lehrperson zusätzlich <code>jsDelivr</code> und
          <code>packages.typst.org</code>. Der Server läuft auf einem kostenlosen Angebot ohne garantierte Verfügbarkeit und
          braucht nach einer Pause einen Moment zum Aufwachen.
        </dd>

        <dt>Für eine Klasse im selben Raum</dt>
        <dd>
          Die Handys zeigen nur die vier Knöpfe A–D; Fragen und Antworten stehen einzig am Beamer. Wer ihn nicht
          sieht, kann nicht mitspielen. Ausgelegt ist die App für rund 25 Personen, bei 200 ist Schluss. Die Rangliste
          zeigt die besten fünf, alle anderen sehen ihren Rang auf dem eigenen Handy.
        </dd>

        <dt>Ein Fragetyp, feste Regeln</dt>
        <dd>
          Es gibt nur Multiple Choice mit genau vier Antworten, von denen genau eine richtig ist. Eine Antwort ist
          endgültig. Es gibt keine Zeitlimite, und die Punkte sind fest: 12 für die erste richtige Antwort, 11 für die
          zweite, 10 für jede weitere.
        </dd>

        <dt>Die PIN ist der einzige Schutz</dt>
        <dd>
          Wer die PIN kennt, kann beitreten und mitlesen, wer geantwortet hat. Unpassende Spitznamen kann die
          Lehrperson entfernen; eine Zugangskontrolle oder einen Schutz vor absichtlichem Stören gibt es nicht.
        </dd>

        <dt>Ohne Gewähr</dt>
        <dd>
          Die App ist sorgfältig entworfen, aber grösstenteils mit KI-Unterstützung programmiert. Benutzung auf eigene
          Gefahr.
        </dd>
      </dl>
    </section>

    <nav class="quiz-about__links">
      <a href="/">Quiz beitreten</a>
      <a href="/create">Quiz erstellen</a>
      <a href="/docs">Anleitung: Quiz schreiben</a>
    </nav>
  </div>
</template>

<style scoped>
.quiz-about {
  min-width: 0;
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.5rem;
  box-sizing: border-box;
  text-align: left;
}
.quiz-about__lead,
.quiz-about p,
.quiz-about__list {
  max-width: 70ch;
}
.quiz-about__toc,
.quiz-about__links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  font-size: 0.9rem;
}
.quiz-about__toc {
  margin: 1.5rem 0 2.5rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border, #333);
  border-radius: 8px;
}
.quiz-about section {
  margin-bottom: 3rem;
}
.quiz-about h2 {
  margin-bottom: 0.75rem;
  scroll-margin-top: 1rem;
}
.quiz-about__list dt {
  margin-top: 1rem;
  font-weight: 600;
  color: var(--text-h);
}
.quiz-about__list dd {
  margin: 0.25rem 0 0;
}
</style>
