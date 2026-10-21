<script setup lang="ts">
// Deliberately plain: no Typst, no examples, nothing fetched. The players'
// footer links here, and their devices load nothing from third parties — the
// docs page, which compiles its examples, could not make that promise.
</script>

<template>
  <div class="quiz-about">
    <header>
      <h1>Datenschutz</h1>
      <p class="quiz-about__lead">
        Die App ist auf Einfachheit und Datensparsamkeit ausgelegt: Das ganze Spiel läuft im Browser der Lehrperson,
        der Server reicht nur Nachrichten zwischen Beamer und Handys weiter.
        Es gibt kein Konto, keine Cookies, keine Werbung, keine Analyse, kein Tracking, keine Telemetrie, keine
        Social-Media-Knöpfe. Der Server speichert nichts.
      </p>
    </header>

    <section id="datenschutz">
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
          Auflösung bloss, wie oft jede Antwort gewählt wurde. An die Handys geht, wer schon geantwortet hat, wer
          richtig lag und wer wie viele Punkte hat — als zufällige Kennung, ohne Spitznamen.
        </dd>

        <dt>Im eigenen Browser gespeichert</dt>
        <dd>
          Damit ein Neuladen oder ein Verbindungsabbruch das Spiel nicht beendet, merkt sich der Browser das laufende
          Spiel: auf dem Handy Spitzname und die eigene letzte Antwort, bei der Lehrperson das Quiz und
          den Spielstand. Diese Einträge werden gelöscht, sobald das Quiz beendet ist. Der Spitzname bleibt auf dem
          Handy als Vorschlag fürs nächste Mal.
        </dd>

        <dt>Diagnose-Protokoll</dt>
        <dd>
          Damit sich Probleme im Unterricht nachvollziehen lassen, schreibt jedes Gerät mit, was es erlebt:
          Verbindungsabbrüche, gesendete und empfangene Nachrichten, wann der Bildschirm aus war. Dieses Protokoll
          bleibt im eigenen Browser und verlässt ihn nur, wenn man es unter <a href="/debug">Diagnose</a> selbst
          kopiert oder teilt. Auf dem Handy enthält es den eigenen Spitznamen und die eigenen Antworten, bei der
          Lehrperson die Spitznamen und Antworten aller. Es wird nach einem Tag gekürzt und lässt sich dort jederzeit
          löschen.
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

        <dt>Ohne Gewähr</dt>
        <dd>
          Die App ist sorgfältig entworfen, aber grösstenteils mit LLM-Unterstützung programmiert. Benutzung auf eigenes
          Risiko.
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
.quiz-about__links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  font-size: 0.9rem;
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
