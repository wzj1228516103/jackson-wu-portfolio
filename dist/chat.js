import { locale } from "./localize.mjs";
import translations from "./chat-copy.mjs?v=scene-chat";

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

function enableChat(footer, endpoint) {
  const form = footer.querySelector("[data-chat-entry]");
  const input = form.querySelector("input");
  const send = form.querySelector("[data-chat-send]");
  const stop = form.querySelector("[data-chat-stop]");
  const retry = form.querySelector("[data-chat-retry]");
  const clear = form.querySelector("[data-chat-clear]");
  const pager = form.querySelector("[data-chat-pager]");
  const pageLabel = form.querySelector("[data-chat-page]");
  const previous = form.querySelector("[data-chat-prev]");
  const next = form.querySelector("[data-chat-next]");
  const status = form.querySelector("[data-chat-status]");
  const fallback = document.querySelector("[data-chat-answer-fallback]");
  const announcement = document.querySelector("[data-chat-announcement]");
  const compact = matchMedia("(max-width: 800px)");
  let sessionId;
  let activeRequest;
  let retryQuestion;
  let answer = "";
  let page = 0;

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

  function showFallback(active) {
    fallback.hidden = active || !answer;
    const text = fallback.hidden ? "" : answer;
    if (fallback.textContent !== text) {
      const follow = fallback.scrollHeight - fallback.clientHeight - fallback.scrollTop < 40;
      fallback.textContent = text;
      if (follow) fallback.scrollTop = fallback.scrollHeight;
    }
    if (!active) pager.hidden = true;
  }

  function showAnswer(text) {
    answer = text;
    document.body.dataset.answerActive = "";
    clear.hidden = false;
    showFallback(Boolean(window.portfolioParticles?.setAnswer(text)));
  }

  function clearAnswer() {
    answer = "";
    delete document.body.dataset.answerActive;
    window.portfolioParticles?.clearAnswer();
    clear.hidden = true;
    announcement.textContent = "";
    showFallback(false);
  }

  window.addEventListener("portfolio:answer-rendered", ({ detail }) => {
    const active = Boolean(detail?.active && answer);
    showFallback(active);
    if (!active) return;
    const count = detail.pageCount;
    page = detail.page;
    pager.hidden = count <= 1;
    pageLabel.textContent = count > 1 ? page + " / " + count : "";
    previous.disabled = page <= 1;
    next.disabled = page >= count;
  });

  async function answerQuestion(question) {
    const controller = new AbortController();
    const request = { controller, dismissed: false };
    activeRequest = request;
    retryQuestion = undefined;
    clearAnswer();
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
          if (streamed.trim()) showAnswer(streamed);
        }
      });
      if (controller.signal.aborted) throw new Error("Chat request stopped");
      if (!streamed.trim() && typeof result.text === "string" && result.text.trim()) {
        streamed = result.text;
        showAnswer(streamed);
      }
      if (!streamed.trim()) throw new Error("Empty answer");

      if (typeof result.sessionId === "string") sessionId = result.sessionId;
      status.textContent = "";
      announcement.textContent = streamed;
    } catch {
      if (streaming) sessionId = undefined;
      if (!request.dismissed) {
        retryQuestion = question;
        status.textContent = controller.signal.aborted ? copy.stopped : failure;
        announcement.textContent = answer;
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
    clearAnswer();
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
  previous.addEventListener("click", () => window.portfolioParticles?.setPage(page - 1));
  next.addEventListener("click", () => window.portfolioParticles?.setPage(page + 1));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && answer && !document.querySelector("dialog[open]")) dismissAnswer();
  });
  footer.hidden = false;
}

const footer = document.querySelector("[data-chat-endpoint]");
const endpoint = footer && configuredEndpoint(footer.dataset.chatEndpoint);
if (endpoint) enableChat(footer, endpoint);
