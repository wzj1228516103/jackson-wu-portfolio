import { locale } from "./localize.mjs";
import translations from "./chat-copy.mjs";

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
        const type = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
        if (!["delta", "sources", "done", "error"].includes(type)) continue;
        const data = lines.filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).replace(/^ /, "")).join("\n");
        handleEvent(type, JSON.parse(data));
        if (type === "done") return;
      }
      if (done || buffer.length > 64_000) throw new Error("Incomplete response stream");
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function renderSources(container, sources) {
  const list = document.createElement("ul");
  const urls = new Set();
  for (const source of sources) {
    if (typeof source?.title !== "string" || !source.title.trim() || typeof source.url !== "string") continue;
    let url;
    try { url = new URL(source.url); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || urls.has(url.href)) continue;
    urls.add(url.href);

    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = source.title;
    item.append(link);
    list.append(item);
    if (urls.size === 6) break;
  }
  if (!urls.size) return;

  const title = document.createElement("h3");
  title.textContent = copy.sources;
  container.replaceChildren(title, list);
}

function appendMessage(list, role, content) {
  const element = document.createElement("li");
  element.className = "chat-message";
  element.dataset.role = role;

  const speaker = document.createElement("span");
  speaker.className = "sr-only";
  speaker.textContent = role === "user" ? copy.you : copy.assistant;
  const text = document.createElement("p");
  text.textContent = content;
  const sources = document.createElement("div");
  sources.className = "chat-sources";
  sources.hidden = true;
  element.append(speaker, text, sources);
  list.append(element);
  return { element, text, sources };
}

function enableChat(footer, endpoint) {
  const dialog = document.querySelector("#portfolio-chat-dialog");
  if (typeof dialog.showModal !== "function") return;

  const transcript = dialog.querySelector("[data-chat-transcript]");
  const prompts = dialog.querySelector("[data-chat-prompts]");
  const messages = dialog.querySelector("[data-chat-messages]");
  const form = dialog.querySelector("[data-chat-form]");
  const input = form.querySelector("textarea");
  const status = form.querySelector("[data-chat-status]");
  const send = form.querySelector("[data-chat-send]");
  const stop = form.querySelector("[data-chat-stop]");
  const retry = form.querySelector("[data-chat-retry]");
  const history = [];
  let activeRequest = null;
  let retryTurn = null;
  let lastOpener = null;

  for (const element of document.querySelectorAll("[data-chat-copy]")) {
    element.textContent = copy[element.dataset.chatCopy];
  }
  transcript.setAttribute("aria-label", copy.transcript);

  function syncActions() {
    const busy = Boolean(activeRequest);
    send.disabled = busy || !input.value.trim();
    stop.hidden = !busy;
    retry.hidden = busy || !retryTurn;
  }

  function payloadFor(question) {
    const messages = [{ role: "user", content: question }];
    let remaining = 4500 - question.length;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const { question: previousQuestion, answer } = history[index];
      const size = previousQuestion.length + answer.length;
      if (size > remaining) break;
      remaining -= size;
      messages.unshift({ role: "user", content: previousQuestion }, { role: "assistant", content: answer });
    }
    return { messages, locale };
  }

  async function answerTurn(turn) {
    const { question, reply } = turn;
    const controller = new AbortController();
    activeRequest = controller;
    retryTurn = null;
    reply.text.textContent = "";
    reply.element.hidden = true;
    reply.sources.hidden = true;
    reply.sources.replaceChildren();
    syncActions();
    status.textContent = copy.waiting;
    transcript.scrollTop = transcript.scrollHeight;

    let answer = "";
    let sources = [];
    let failure = copy.unavailable;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(payloadFor(question)),
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer"
      });
      if (!response.ok) {
        if (response.status === 429) failure = copy.limited;
        throw new Error("Chat request failed");
      }
      await readEvents(response, (type, data) => {
        if (type === "error") {
          if (requestLimitCodes.has(data?.code)) failure = copy.limited;
          throw new Error("Chat stream failed");
        }
        if (type === "sources" && Array.isArray(data?.sources)) sources = data.sources;
        if (type !== "delta" || typeof data?.text !== "string") return;

        const follow = transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop < 40;
        answer += data.text;
        reply.text.textContent = answer;
        reply.element.hidden = false;
        if (follow) transcript.scrollTop = transcript.scrollHeight;
      });
      if (!answer.trim()) throw new Error("Empty answer");

      renderSources(reply.sources, sources);
      if (reply.sources.childElementCount) reply.sources.hidden = false;
      history.push({ question, answer: answer.trim().slice(0, 1200) });
      if (history.length > 3) history.shift();
      status.textContent = copy.completed;
    } catch {
      reply.text.textContent = "";
      reply.element.hidden = true;
      retryTurn = turn;
      status.textContent = controller.signal.aborted ? copy.stopped : failure;
    } finally {
      activeRequest = null;
      syncActions();
    }
  }

  function submitQuestion(question) {
    if (activeRequest || !question || question.length > input.maxLength) return;
    prompts.hidden = true;
    appendMessage(messages, "user", question);
    const reply = appendMessage(messages, "assistant", "");
    answerTurn({ question, reply });
  }

  for (const question of copy.suggestions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-button";
    button.textContent = question;
    button.addEventListener("click", () => submitQuestion(question));
    prompts.append(button);
  }

  input.addEventListener("input", syncActions);
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!send.disabled) form.requestSubmit();
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (send.disabled) return;
    const question = input.value.trim();
    input.value = "";
    submitQuestion(question);
  });
  stop.addEventListener("click", () => activeRequest?.abort());
  retry.addEventListener("click", () => {
    if (retryTurn && !activeRequest) answerTurn(retryTurn);
  });

  for (const button of document.querySelectorAll("[data-chat-open]")) {
    button.addEventListener("click", () => {
      lastOpener = button;
      dialog.showModal();
    });
    button.hidden = false;
  }
  dialog.querySelector("[data-chat-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    activeRequest?.abort();
    lastOpener?.focus({ preventScroll: true });
  });
  footer.dataset.chatReady = "";
}

const footer = document.querySelector("[data-chat-endpoint]");
const endpoint = configuredEndpoint(footer.dataset.chatEndpoint);
if (endpoint) enableChat(footer, endpoint);
