<script setup lang="ts">
// The host's first screen: the quiz's Typst source beside a live preview.
// "Quiz erstellen" checks and compiles the whole quiz, then creates the
// session that HostApp hosts from then on.
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from "vue";
import { createSession, RelayError, type HostCredentials } from "../api/quizClient";
import { addDebugSecret, debugLog, describeError } from "../debug/debugLog";
import { QuizParseError } from "../quiz/errors";
import { OPTION_LABELS } from "../quiz/optionStyle";
import { parseQuiz } from "../quiz/parseQuiz";
import { fetchQuizSource, resolveSource, type SourceLocation } from "../quiz/remoteSource";
import { MINIMAL_QUIZ } from "../quiz/sampleQuiz";
import { loadQuizImages, renderTypst } from "../quiz/typst";
import type { ParsedQuiz } from "../quiz/types";
import AppFooter from "./AppFooter.vue";
import QuestionCard from "./QuestionCard.vue";
import ScreenFrame from "./ScreenFrame.vue";
import TypstEditor from "./TypstEditor.vue";

/** The quiz source in the editor. HostApp keeps it, as it is stored with a
 * running session and comes back with it after a reload. */
const source = defineModel<string>("source", { required: true });
/** The `?src=` link the quiz in the editor came from, if it came from one:
 * its images are fetched relative to that file (SPEC.md §3.5). It sticks for
 * the whole page, edits included, and a resumed session brings its own. */
const src = defineModel<string | null>("src", { required: true });
const emit = defineEmits<{ created: [quiz: ParsedQuiz, credentials: HostCredentials] }>();

const PREVIEW_DEBOUNCE_MS = 300;

const remoteSource = new URLSearchParams(location.search).get("src");
const remoteLoading = ref(false);
const remoteLoaded = ref(false);
const remoteError = ref<string | null>(null);
// Only ever set from a link that resolved before.
let quizLocation: SourceLocation | null = src.value ? resolveSource(src.value) : null;

const loadErrors = ref<string[]>([]);
// Set while "Quiz erstellen" is busy: first every prompt/option is compiled
// with Typst before the lobby (and its QR code) is shown - the lobby only
// ever appears once this has confirmed the whole document compiles cleanly -
// then the session is created, which can take a while when the backend has
// to cold-start.
const creating = ref<"validating" | "connecting" | null>(null);
const creatingLabel = computed(() =>
  creating.value === "validating"
    ? "Quiz wird geprüft …"
    : "Verbindung zum Server wird aufgebaut …",
);

// Separate from the hosted game so a half-typed draft in the editor never
// disturbs the quiz that was validated for the running session.
const previewQuiz = ref<ParsedQuiz | null>(null);
const previewErrors = ref<string[]>([]);
let previewTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  source,
  (text) => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      // Nothing typed (or a link still loading) is not worth an error list.
      if (!text.trim()) {
        previewQuiz.value = null;
        previewErrors.value = [];
        return;
      }
      // Queued ahead of the preview's renders, which therefore see the images.
      void loadQuizImages(text, quizLocation);
      try {
        previewQuiz.value = parseQuiz(text);
        previewErrors.value = [];
      } catch (e) {
        previewQuiz.value = null;
        previewErrors.value = e instanceof QuizParseError ? e.issues : [String(e)];
      }
    }, PREVIEW_DEBOUNCE_MS);
  },
  { immediate: true },
);

async function loadRemoteSource(link: string) {
  remoteLoading.value = true;
  try {
    const fetched = await fetchQuizSource(link);
    // Set before the editor changes, so the preview fetches the images.
    quizLocation = resolveSource(link);
    src.value = link;
    source.value = fetched;
    reloadBringsBack = fetched;
    remoteLoaded.value = true;
  } catch (e) {
    remoteError.value = e instanceof Error ? e.message : String(e);
    debugLog("quiz link failed", { src: link, error: describeError(e) });
  } finally {
    remoteLoading.value = false;
  }
}

// What a reload of the page would bring back into the editor: the minimal
// quiz, or the `?src=` link's file as it was loaded. Null when that is not
// known -- a quiz carried over from a session resumed after a reload, from a
// page opened with a link, may or may not have been edited.
let reloadBringsBack: string | null = remoteSource ? null : MINIMAL_QUIZ;

// An empty editor is filled from a `?src=` link (SPEC.md §3.5) or else with
// the minimal quiz; it starts empty rather than briefly showing that while
// the file loads. A session resumed after a reload keeps its own quiz.
if (!source.value) {
  if (remoteSource) {
    // Should the link fail, a reload fails the same way.
    reloadBringsBack = "";
    void loadRemoteSource(remoteSource);
  } else {
    source.value = MINIMAL_QUIZ;
  }
}

// The editor saves nothing: a reload, a closed tab or a link followed by
// mistake would take any edits along, so the browser asks first. A running
// session stores its own source, which is why this only applies while the
// editor is showing (it is kept alive in the background during a quiz).
const sameText = (a: string, b: string) => a.replace(/\r\n?/g, "\n") === b.replace(/\r\n?/g, "\n");
function askBeforeLeaving(event: BeforeUnloadEvent) {
  if (reloadBringsBack !== null && sameText(source.value, reloadBringsBack)) return;
  event.preventDefault();
  // Browsers that predate preventDefault() here.
  event.returnValue = true;
}
const watchLeaving = () => window.addEventListener("beforeunload", askBeforeLeaving);
const unwatchLeaving = () => window.removeEventListener("beforeunload", askBeforeLeaving);
onMounted(watchLeaving);
onActivated(watchLeaving);
onDeactivated(unwatchLeaving);
onUnmounted(unwatchLeaving);

// Structural parsing alone doesn't catch a Typst syntax/compile error inside
// a prompt or option body - actually compiling every snippet here is the
// only way to guarantee the lobby (and its QR code) is never shown for a
// document that would fail to render mid-game.
async function compileAllTypstSnippets(parsedQuiz: ParsedQuiz): Promise<string[]> {
  const checks: Promise<string | null>[] = [];
  parsedQuiz.questions.forEach((question, qIndex) => {
    checks.push(
      renderTypst(question.promptTypst)
        .then(() => null)
        .catch((e) => `Frage ${qIndex + 1}, Aufgabenstellung: ${e instanceof Error ? e.message : String(e)}`),
    );
    question.options.forEach((option, oIndex) => {
      checks.push(
        renderTypst(option.typst)
          .then(() => null)
          .catch(
            (e) =>
              `Frage ${qIndex + 1}, Option ${OPTION_LABELS[oIndex]}: ${e instanceof Error ? e.message : String(e)}`,
          ),
      );
    });
  });
  const results = await Promise.all(checks);
  return results.filter((r): r is string => r !== null);
}

function createSessionErrorMessage(error: unknown): string {
  // The relay answers 503 when it cannot hand out a pin: every pin is taken,
  // or too many sessions are live. Both clear up on their own.
  if (error instanceof RelayError && error.status === 503) {
    return "Gerade sind alle Spiel-PINs vergeben. Bitte versuche es in ein paar Minuten noch einmal.";
  }
  // 429: this network (usually the whole school) has started too many
  // quizzes in a short time. One more is allowed every minute, so the wait
  // is never longer than that.
  if (error instanceof RelayError && error.status === 429) {
    return "Von diesem Netzwerk aus wurden in kurzer Zeit zu viele Quiz gestartet. Bitte versuche es in etwa einer Minute noch einmal.";
  }
  return "Das Quiz konnte nicht gestartet werden, weil der Server nicht erreichbar ist. Bitte versuche es später noch einmal.";
}

async function loadAndCreateSession() {
  loadErrors.value = [];
  let quiz: ParsedQuiz;
  try {
    quiz = parseQuiz(source.value);
  } catch (e) {
    loadErrors.value = e instanceof QuizParseError ? e.issues : [String(e)];
    debugLog("quiz rejected", { issues: loadErrors.value.length, first: loadErrors.value[0] });
    return;
  }

  creating.value = "validating";
  // The preview may not have caught up with the last edit yet.
  await loadQuizImages(source.value, quizLocation);
  const typstErrors = await compileAllTypstSnippets(quiz);
  if (typstErrors.length) {
    creating.value = null;
    loadErrors.value = typstErrors;
    debugLog("quiz does not compile", { issues: typstErrors.length, first: typstErrors[0] });
    return;
  }

  let created: HostCredentials;
  creating.value = "connecting";
  try {
    created = await createSession();
  } catch (e) {
    creating.value = null;
    loadErrors.value = [createSessionErrorMessage(e)];
    debugLog("session not created", { error: describeError(e) });
    return;
  }
  addDebugSecret(created.hostToken);
  debugLog("session created", { pin: created.pin, questions: quiz.questions.length });
  creating.value = null;
  emit("created", quiz, created);
}

onUnmounted(() => clearTimeout(previewTimer));
</script>

<template>
  <div class="host-setup">
    <div class="host-setup__editor">
      <div class="host-setup__editor-header">
        <h2>Quiz-Quelltext (Typst)</h2>
        <a class="host-setup__docs-link" href="/docs" target="_blank" rel="noopener">Anleitung: Quiz schreiben ↗</a>
      </div>
      <p v-if="remoteSource && (remoteLoading || remoteLoaded || remoteError)" class="host-setup__remote">
        <template v-if="remoteLoading">Quiz wird geladen: <code>{{ remoteSource }}</code> …</template>
        <template v-else-if="remoteLoaded">Geladen von <code>{{ remoteSource }}</code></template>
        <span v-else class="host-setup__remote-error">{{ remoteError }}</span>
      </p>
      <!-- Read-only while "Quiz erstellen" is busy: the source stored with the
           session must be the one that was checked. -->
      <TypstEditor v-model="source" class="host-setup__source" :readonly="remoteLoading || creating !== null" />
      <ul v-if="loadErrors.length" class="host-setup__errors">
        <li v-for="issue in loadErrors" :key="issue">{{ issue }}</li>
      </ul>
      <button
        type="button"
        class="host-setup__submit"
        :disabled="creating !== null || remoteLoading"
        :aria-busy="creating !== null"
        @click="loadAndCreateSession"
      >
        <template v-if="creating">
          <span class="host-setup__spinner" aria-hidden="true"></span>
          {{ creatingLabel }}
        </template>
        <template v-else>Quiz erstellen</template>
      </button>
    </div>

    <div class="host-setup__preview">
      <h2>Vorschau</h2>
      <div class="host-setup__preview-list">
        <ul v-if="previewErrors.length" class="host-setup__errors">
          <li v-for="issue in previewErrors" :key="issue">{{ issue }}</li>
        </ul>
        <template v-else-if="previewQuiz">
          <section v-for="(question, i) in previewQuiz.questions" :key="question.id" class="host-setup__preview-item">
            <h3>Frage {{ i + 1 }} von {{ previewQuiz.questions.length }}</h3>
            <ScreenFrame>
              <div class="host-setup__preview-screen">
                <QuestionCard :question="question" :reveal-correct="true" />
              </div>
            </ScreenFrame>
          </section>
        </template>
      </div>
    </div>
  </div>
  <AppFooter />
</template>

<style scoped>
.host-setup {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1.5rem;
  flex: 1;
  min-height: 0;
}
.host-setup__editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.host-setup__editor-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.host-setup__docs-link {
  font-size: 0.9rem;
  white-space: nowrap;
}
.host-setup__remote {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  color: #888;
  overflow-wrap: anywhere;
}
.host-setup__remote-error {
  color: #b00020;
}
.host-setup__submit {
  margin-top: 0.75rem;
}
.host-setup__spinner {
  display: inline-block;
  width: 1em;
  height: 1em;
  margin-right: 0.5em;
  vertical-align: -0.15em;
  border: 0.15em solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: host-setup-spin 0.8s linear infinite;
}
@keyframes host-setup-spin {
  to {
    transform: rotate(360deg);
  }
}
.host-setup__preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.host-setup__preview-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.host-setup__preview-item {
  margin-bottom: 1.5rem;
}
/* Mirrors `.host-app`'s own layout so the framed preview matches the real
   host screen exactly. */
.host-setup__preview-screen {
  width: 100%;
  height: 100%;
  padding: 1rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
.host-setup__source {
  flex: 1;
  min-height: 0;
}
.host-setup__errors {
  color: #b00020;
}
</style>
