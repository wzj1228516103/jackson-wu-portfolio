import { locale } from "./localize.mjs";
import translations from "./chat-copy.mjs?v=glyph-chat";

const copy = translations[locale] ?? translations["zh-CN"];
const requestLimitCodes = new Set(["rate_limited", "daily_limit", "busy"]);

function configuredEndpoint(value) {
  if (!value.trim()) return null;
  try {
    const url = new URL(value, location.href);
    const local = url.origin === location.origin
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password) return null;
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url;
  } catch {
    return null;
  }
  return null;
}

async function readEvents(response, handleEvent) {
  if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
    throw new Error("Expected a response stream");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const lines = frame.split(/\r?\n/);
        const data = lines.filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).replace(/^ /, "")).join("\n");
        if (!data) continue;
        const event = JSON.parse(data);
        if (event?.type === "done") return event;
        if (event?.type === "delta" || event?.type === "error") handleEvent(event);
      }
      if (done || buffer.length > 64_000) throw new Error("Incomplete response stream");
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function createAnswerOutput() {
  const output = document.querySelector("[data-chat-answer-output]");
  const frontier = output.querySelector("[data-chat-frontier]");
  const completed = document.createTextNode("");
  output.querySelector("[data-chat-finished]").append(completed);
  const announcement = document.querySelector("[data-chat-announcement]");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const segmenter = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(locale, { granularity: "grapheme" })
    : null;
  let pending = [];
  let cursor = 0;
  let tail = "";
  let tailTimer;
  let glyphTimer;
  let activeGlyph;
  let ended = false;

  function followEnd(update) {
    const follow = output.scrollHeight - output.clientHeight - output.scrollTop < 42;
    update();
    if (follow) output.scrollTop = output.scrollHeight;
  }

  function reset() {
    clearTimeout(tailTimer);
    clearTimeout(glyphTimer);
    tailTimer = glyphTimer = activeGlyph = undefined;
    ended = false;
    pending = [];
    cursor = 0;
    tail = "";
    completed.data = "";
    frontier.textContent = "";
    announcement.textContent = "";
    output.scrollTop = 0;
    window.portfolioParticles?.clearGlyph?.();
  }

  function pump() {
    if (activeGlyph) return;
    const particles = window.portfolioParticles;
    while (cursor < pending.length) {
      const waiting = pending.length - cursor;
      const duration = waiting > 120 ? 22 : waiting > 35 ? 28 : waiting > 8 ? 34 : 43;
      if (reduced.matches || !particles?.setGlyph || particles.canRenderGlyphs?.() === false) {
        const value = pending.slice(cursor).join("");
        followEnd(() => completed.appendData(value));
        break;
      }

      const glyph = pending[cursor++];
      if (!glyph.trim()) {
        followEnd(() => completed.appendData(glyph));
        continue;
      }

      followEnd(() => { frontier.textContent = glyph; });
      const started = performance.now();
      const reveal = () => {
        if (activeGlyph !== reveal) return;
        glyphTimer = activeGlyph = undefined;
        followEnd(() => {
          completed.appendData(glyph);
          frontier.textContent = "";
        });
        particles.clearGlyph?.();
        pump();
      };
      activeGlyph = reveal;
      if (particles.setGlyph(glyph, frontier, duration, painted => {
        if (activeGlyph !== reveal) return;
        clearTimeout(glyphTimer);
        const delay = painted ? Math.max(16, duration - (performance.now() - started)) : 0;
        glyphTimer = setTimeout(reveal, delay);
      })) {
        glyphTimer ??= setTimeout(reveal, 130);
        return;
      }
      activeGlyph = undefined;

      followEnd(() => {
        completed.appendData(glyph);
        frontier.textContent = "";
      });
    }
    pending = [];
    cursor = 0;
    if (ended && completed.length) announcement.textContent = completed.data;
  }

  function flushTail() {
    clearTimeout(tailTimer);
    tailTimer = undefined;
    if (tail) pending.push(tail);
    tail = "";
    pump();
  }

  function write(text) {
    if (!text) return;
    if (output.hidden && text.trim()) {
      document.body.dataset.answerActive = "";
      output.hidden = false;
      window.portfolioParticles?.beginAnswer?.();
    }
    if (!tail && pending.length > cursor) tail = pending.pop();
    const unread = tail + text;
    const segments = segmenter
      ? Array.from(segmenter.segment(unread), ({ segment }) => segment)
      : unread.match(/\p{Regional_Indicator}{2}|\P{M}\p{M}*\p{Emoji_Modifier}?(?:\u200D\P{M}\p{M}*\p{Emoji_Modifier}?)*\u200D?|\p{M}+/gu) ?? [];
    tail = segments.pop() ?? "";
    for (const segment of segments) pending.push(segment);
    clearTimeout(tailTimer);
    tailTimer = setTimeout(flushTail, 52);
    pump();
  }

  return {
    get visible() { return !output.hidden; },
    write,
    finish() {
      ended = true;
      flushTail();
    },
    replace(text) {
      reset();
      write(text);
    },
    clear() {
      reset();
      output.hidden = true;
      delete document.body.dataset.answerActive;
      window.portfolioParticles?.clearAnswer?.();
    }
  };
}

function enableChat(footer, endpoint) {
  const form = footer.querySelector("[data-chat-entry]");
  const input = form.querySelector("input");
  const send = form.querySelector("[data-chat-send]");
  const stop = form.querySelector("[data-chat-stop]");
  const retry = form.querySelector("[data-chat-retry]");
  const clear = form.querySelector("[data-chat-clear]");
  const status = form.querySelector("[data-chat-status]");
  const compact = matchMedia("(max-width: 800px)");
  const answer = createAnswerOutput();
  let sessionId;
  let activeRequest;
  let retryQuestion;

  for (const element of footer.querySelectorAll("[data-chat-copy]")) {
    element.textContent = copy[element.dataset.chatCopy];
  }
  for (const element of document.querySelectorAll("[data-chat-label]")) {
    const label = copy[element.dataset.chatLabel];
    element.setAttribute("aria-label", label);
    if (element instanceof HTMLButtonElement) element.title = label;
  }
  input.placeholder = copy.prompt;

  function syncActions() {
    const busy = Boolean(activeRequest);
    send.disabled = busy || !input.value.trim();
    send.hidden = busy;
    stop.hidden = !busy;
    retry.hidden = busy || !retryQuestion || Boolean(input.value.trim());
  }

  async function answerQuestion(question) {
    const controller = new AbortController();
    const request = { controller, dismissed: false };
    activeRequest = request;
    retryQuestion = undefined;
    answer.clear();
    clear.hidden = true;
    status.textContent = copy.waiting;
    syncActions();

    let streamed = "";
    let failure = copy.unavailable;
    let streaming = false;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ message: question, sessionId }),
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer"
      });
      if (!response.ok) {
        if (response.status === 429) failure = copy.limited;
        if (response.status === 404) sessionId = undefined;
        throw new Error("Chat request failed");
      }
      streaming = true;
      const result = await readEvents(response, event => {
        if (event.type === "error") {
          if (requestLimitCodes.has(event.code)) failure = copy.limited;
          throw new Error("Chat stream failed");
        }
        if (!controller.signal.aborted && typeof event.text === "string") {
          streamed += event.text;
          answer.write(event.text);
          clear.hidden = !answer.visible;
        }
      });
      if (controller.signal.aborted) throw new Error("Chat request stopped");
      const final = typeof result.text === "string" && result.text.trim() ? result.text : streamed;
      if (!final.trim()) throw new Error("Empty answer");
      if (final.startsWith(streamed)) answer.write(final.slice(streamed.length));
      else answer.replace(final);
      clear.hidden = !answer.visible;
      answer.finish();

      if (typeof result.sessionId === "string") sessionId = result.sessionId;
      status.textContent = "";
    } catch {
      if (streaming) sessionId = undefined;
      if (!request.dismissed) {
        retryQuestion = question;
        status.textContent = controller.signal.aborted ? copy.stopped : failure;
        answer.finish();
      }
    } finally {
      activeRequest = undefined;
      syncActions();
    }
  }

  function dismissAnswer() {
    if (activeRequest) {
      activeRequest.dismissed = true;
      activeRequest.controller.abort();
    }
    retryQuestion = undefined;
    status.textContent = "";
    answer.clear();
    clear.hidden = true;
    syncActions();
  }

  input.addEventListener("input", syncActions);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const question = input.value.trim();
    if (activeRequest || !question || question.length > input.maxLength) return;
    input.value = "";
    if (compact.matches) input.blur();
    answerQuestion(question);
  });
  stop.addEventListener("click", event => {
    if (event.detail === 0) input.focus({ preventScroll: true });
    activeRequest?.controller.abort();
  });
  retry.addEventListener("click", event => {
    if (activeRequest || !retryQuestion) return;
    if (event.detail === 0) input.focus({ preventScroll: true });
    answerQuestion(retryQuestion);
  });
  clear.addEventListener("click", event => {
    if (event.detail === 0) input.focus({ preventScroll: true });
    dismissAnswer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && answer.visible && !document.querySelector("dialog[open]")) dismissAnswer();
  });
  footer.hidden = false;
}

const footer = document.querySelector("[data-chat-endpoint]");
const endpoint = footer && configuredEndpoint(footer.dataset.chatEndpoint);
if (endpoint) enableChat(footer, endpoint);
