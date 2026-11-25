import { locale } from "./localize.mjs";
import translations from "./chat-copy.mjs?v=retry-countdown";
import { getChallengeToken } from "./chat-challenge.mjs?v=verification-retry";
import { answerPreviewText, renderAnswerMarkdown } from "./answer-markdown.mjs?v=markdown-chat";

const copy = translations[locale] ?? translations["zh-CN"];
const requestLimitCodes = new Set(["rate_limited", "busy"]);
const rateWindowMs = 60_000;
const verificationRequestsPerWindow = 4;
const verificationRetryDelayMs = 4000;
const answerIdleMs = 60_000;
const answerDissolveMs = 4200;

function configuredEndpoint(value = "") {
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

function retryDelay(response, fallbackMs) {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= rateWindowMs / 1000
    ? seconds * 1000 : fallbackMs;
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

function createSettledEffects({ output, revealed, finished, reduced, segment, canIdle, onIdle }) {
  const glyphSelector = "[data-chat-settled-glyph]";
  let content = revealed;
  let glyphs = [];
  let indexedLength = 0;
  let idleTimer;
  let dissolving;
  let normalizeQueued = false;
  let lastScan = -Infinity;
  let hadSelection = false;

  function hasSelection() {
    const selection = document.getSelection();
    return Boolean(selection?.rangeCount && !selection.isCollapsed &&
      selection.getRangeAt(0).intersectsNode(output));
  }

  function readingWithKeyboard() {
    return output.matches(":focus-visible") || Boolean(output.querySelector(":focus-visible"));
  }

  function restore(anchor) {
    delete anchor.dataset.scattered;
    if ("dissolvingGlyph" in anchor.dataset) {
      delete anchor.dataset.dissolvingGlyph;
      anchor.style.removeProperty("--chat-dissolve-delay");
      anchor.style.removeProperty("--chat-dissolve-duration");
    }
    if (!anchor.isConnected || hasSelection()) return;
    const root = content;
    if (!root.contains(anchor)) return;
    anchor.replaceWith(...anchor.childNodes);
    if (normalizeQueued) return;
    normalizeQueued = true;
    queueMicrotask(() => {
      normalizeQueued = false;
      if (content === root && glyphs.length && !hasSelection()) root.normalize();
    });
  }

  function restoreAll() {
    dissolving = undefined;
    delete output.dataset.dissolving;
    output.style.removeProperty("--chat-dissolve-ornament-delay");
    window.portfolioParticles?.cancelSettledEffects?.();
    content.querySelectorAll(glyphSelector).forEach(restore);
  }

  function visibleGlyphs(point) {
    const area = output.getBoundingClientRect();
    const radius = 31;
    const top = Math.max(area.top, point ? point.y - radius : 0);
    const bottom = Math.min(area.bottom, point ? point.y + radius : innerHeight);
    const left = Math.max(area.left, point ? point.x - radius : 0);
    const right = Math.min(area.right, point ? point.x + radius : innerWidth);
    if (top >= bottom || left >= right) return { anchors: [], inserted: [] };

    const ranges = [];
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let cursor = 0;
    for (let text = walker.nextNode(); text && cursor < glyphs.length; text = walker.nextNode()) {
      const start = offset;
      offset += text.length;
      let first = cursor;
      while (cursor < glyphs.length && glyphs[cursor].start < offset) cursor++;
      if (cursor === first || (point && text.parentElement.closest("a"))) continue;
      const parent = text.parentElement.getBoundingClientRect();
      if (parent.bottom < top || parent.top > bottom || parent.right < left || parent.left > right) continue;
      const scrollFrame = text.parentElement.closest("pre")?.getBoundingClientRect();
      const clipLeft = Math.max(left, scrollFrame?.left ?? left);
      const clipRight = Math.min(right, scrollFrame?.right ?? right);
      const measure = index => {
        const glyph = glyphs[index];
        const range = document.createRange();
        range.setStart(text, glyph.start - start);
        range.setEnd(text, glyph.end - start);
        return { range, rect: range.getBoundingClientRect() };
      };
      let last = cursor;
      while (first < last) {
        const index = (first + last) >>> 1;
        if (measure(index).rect.bottom < top) first = index + 1;
        else last = index;
      }
      for (let index = first; index < cursor; index++) {
        const { range, rect } = measure(index);
        if (rect.top > bottom) break;
        if (!rect.width || !rect.height || rect.bottom <= top || rect.left >= clipRight || rect.right <= clipLeft) continue;
        const distance = point ? Math.hypot(
          Math.max(rect.left - point.x, 0, point.x - rect.right),
          Math.max(rect.top - point.y, 0, point.y - rect.bottom)
        ) : 0;
        if (distance < radius) ranges.push({ range, index, distance });
      }
    }
    if (point && ranges.length > 12) {
      ranges.sort((a, b) => a.distance - b.distance);
      ranges.length = 12;
    }
    ranges.sort((a, b) => b.index - a.index);
    const anchors = [];
    const inserted = [];
    for (const { range } of ranges) {
      const existing = range.startContainer.parentElement;
      if (existing.matches(glyphSelector)) {
        anchors.push(existing);
        continue;
      }
      const anchor = document.createElement("span");
      anchor.dataset.chatSettledGlyph = "";
      range.surroundContents(anchor);
      anchors.push(anchor);
      inserted.push(anchor);
    }
    return { anchors, inserted };
  }

  function readyToIdle() {
    return content === finished && glyphs.length > 0 && !output.hidden && !reduced.matches && !document.hidden &&
      !output.contains(document.activeElement) && !hasSelection() && canIdle();
  }

  function idle() {
    if (!readyToIdle()) return;
    const particles = window.portfolioParticles;
    if (!particles?.dissolveAnswer) return;
    restoreAll();
    const group = visibleGlyphs();
    if (!group.anchors?.length) return;
    const ordered = group.anchors.reverse();
    const current = {};
    dissolving = current;
    const accepted = particles.dissolveAnswer(ordered, answerDissolveMs, ({ anchors, startedAt }) => {
      if (dissolving !== current || !anchors.length) return;
      const stages = new Map(anchors.map(stage => [stage.anchor, stage]));
      const last = anchors.at(-1);
      const elapsed = Math.max(0, performance.now() - startedAt);
      output.dataset.dissolving = "";
      const ornamentDelay = Math.max(0, last.delay + last.duration / 2 - elapsed);
      output.style.setProperty("--chat-dissolve-ornament-delay", ornamentDelay + "ms");
      for (const anchor of ordered) {
        const { delay, duration } = stages.get(anchor) ?? last;
        anchor.style.setProperty("--chat-dissolve-delay", Math.max(-duration, delay - elapsed) + "ms");
        anchor.style.setProperty("--chat-dissolve-duration", duration + "ms");
        anchor.dataset.dissolvingGlyph = "";
      }
    }, complete => {
      if (dissolving !== current) return;
      dissolving = undefined;
      if (complete) onIdle();
      else restoreAll();
    });
    if (!accepted) restoreAll();
  }

  function noteInteraction() {
    if (dissolving) restoreAll();
    clearTimeout(idleTimer);
    if (readyToIdle()) idleTimer = setTimeout(idle, answerIdleMs);
  }

  output.addEventListener("pointermove", event => {
    if (!glyphs.length) return;
    noteInteraction();
    const particles = window.portfolioParticles;
    if (event.pointerType !== "mouse" || event.buttons || reduced.matches || hasSelection() ||
        readingWithKeyboard() || (event.target instanceof Element && event.target.closest("a")) ||
        !particles?.scatterGlyphs ||
        performance.now() - lastScan < 24) return;
    lastScan = performance.now();
    const { anchors, inserted } = visibleGlyphs({ x: event.clientX, y: event.clientY });
    if (!anchors?.length) return;
    if (!particles.scatterGlyphs(anchors, (anchor, active) => {
      if (active && !hasSelection() && !readingWithKeyboard()) anchor.dataset.scattered = "";
      else restore(anchor);
    })) inserted.forEach(restore);
  }, { capture: true, passive: true });
  output.addEventListener("pointerdown", () => {
    if (!glyphs.length) return;
    restoreAll();
    noteInteraction();
  }, { capture: true, passive: true });
  output.addEventListener("scroll", () => {
    if (!glyphs.length) return;
    if (content === finished) restoreAll();
    noteInteraction();
  }, { capture: true, passive: true });
  output.addEventListener("pointerleave", noteInteraction, { passive: true });
  output.addEventListener("focusin", () => {
    if (!glyphs.length) return;
    restoreAll();
    noteInteraction();
  });
  output.addEventListener("focusout", () => queueMicrotask(noteInteraction));
  output.addEventListener("keydown", noteInteraction);
  document.addEventListener("selectionchange", () => {
    const selected = hasSelection();
    if (!hadSelection && !selected) return;
    hadSelection = selected;
    restoreAll();
    noteInteraction();
  });
  document.addEventListener("visibilitychange", noteInteraction);
  reduced.addEventListener("change", () => {
    if (reduced.matches) restoreAll();
    noteInteraction();
  });

  function record(text) {
    for (const glyph of segment(text)) {
      const end = indexedLength + glyph.length;
      if (glyph.trim()) glyphs.push({ start: indexedLength, end });
      indexedLength = end;
    }
  }

  function reset() {
    restoreAll();
    glyphs = [];
    indexedLength = 0;
    lastScan = -Infinity;
    clearTimeout(idleTimer);
    content = revealed;
  }

  return {
    noteInteraction,
    record,
    settle() {
      reset();
      content = finished;
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) record(node.data);
      noteInteraction();
    },
    reset
  };
}

function createAnswerOutput(canIdle, onIdle) {
  const output = document.querySelector("[data-chat-answer-output]");
  const draft = output.querySelector("[data-chat-draft]");
  const revealed = output.querySelector("[data-chat-revealed]");
  const frontier = output.querySelector("[data-chat-frontier]");
  const finished = output.querySelector("[data-chat-markdown]");
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
  let settled = false;
  let preview = "";
  let completed = "";
  let finalSource = "";
  const segment = text => segmenter
    ? Array.from(segmenter.segment(text), ({ segment }) => segment)
    : text.match(/\p{Regional_Indicator}{2}|\P{M}\p{M}*\p{Emoji_Modifier}?(?:\u200D\P{M}\p{M}*\p{Emoji_Modifier}?)*\u200D?|\p{M}+/gu) ?? [];

  const effects = createSettledEffects({
    output, revealed, finished, reduced, segment, canIdle,
    onIdle() {
      clear();
      onIdle();
    }
  });

  function followEnd(update) {
    const follow = output.scrollHeight - output.clientHeight - output.scrollTop < 42;
    update();
    if (follow) output.scrollTop = output.scrollHeight;
    if (!draft.hidden) window.portfolioParticles?.refreshSettledGeometry?.();
  }

  function appendDraft(value) {
    completed += value;
    const last = revealed.lastChild;
    if (last instanceof Text) last.appendData(value);
    else revealed.append(value);
    effects.record(value);
  }

  function discardDraftTail() {
    clearTimeout(tailTimer);
    clearTimeout(glyphTimer);
    tailTimer = glyphTimer = activeGlyph = undefined;
    pending = [];
    cursor = 0;
    tail = "";
    frontier.textContent = "";
    window.portfolioParticles?.clearGlyph?.();
  }

  function reset() {
    effects.reset();
    discardDraftTail();
    ended = false;
    settled = false;
    preview = finalSource = completed = "";
    revealed.replaceChildren();
    finished.replaceChildren();
    finished.hidden = true;
    draft.hidden = false;
    announcement.textContent = "";
    output.scrollTop = 0;
  }

  function showOutput() {
    if (!output.hidden) return;
    document.body.dataset.answerActive = "";
    output.hidden = false;
    window.portfolioParticles?.beginAnswer?.();
  }

  function settleMarkdown() {
    const fragment = renderAnswerMarkdown(finalSource, copy);
    if (!fragment.hasChildNodes() && preview.trim()) {
      const paragraph = document.createElement("p");
      paragraph.textContent = preview;
      fragment.append(paragraph);
    }
    if (!fragment.hasChildNodes()) return;
    showOutput();
    followEnd(() => {
      finished.replaceChildren(fragment);
      finished.hidden = false;
      draft.hidden = true;
      effects.settle();
      revealed.replaceChildren();
      completed = "";
    });
    announcement.textContent = finished.innerText.trim();
  }

  function pump() {
    if (activeGlyph) return;
    const particles = window.portfolioParticles;
    while (cursor < pending.length) {
      const waiting = pending.length - cursor;
      const duration = waiting > 120 ? 22 : waiting > 35 ? 28 : waiting > 8 ? 34 : 43;
      if (reduced.matches || !particles?.setGlyph || particles.canRenderGlyphs?.() === false) {
        const value = pending.slice(cursor).join("");
        followEnd(() => appendDraft(value));
        break;
      }

      const glyph = pending[cursor++];
      if (!glyph.trim()) {
        followEnd(() => appendDraft(glyph));
        continue;
      }

      followEnd(() => { frontier.textContent = glyph; });
      const started = performance.now();
      const reveal = () => {
        if (activeGlyph !== reveal) return;
        glyphTimer = activeGlyph = undefined;
        followEnd(() => {
          appendDraft(glyph);
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
        appendDraft(glyph);
        frontier.textContent = "";
      });
    }
    pending = [];
    cursor = 0;
    if (ended && !settled && finalSource.trim()) {
      settled = true;
      settleMarkdown();
    }
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
    if (text.trim()) showOutput();
    if (!tail && pending.length > cursor) tail = pending.pop();
    const unread = tail + text;
    const segments = segment(unread);
    tail = segments.pop() ?? "";
    for (const segment of segments) pending.push(segment);
    clearTimeout(tailTimer);
    tailTimer = setTimeout(flushTail, 52);
    pump();
  }

  function update(source) {
    const next = answerPreviewText(source);
    if (next === preview) return;
    if (next.startsWith(preview)) {
      write(next.slice(preview.length));
    } else {
      discardDraftTail();
      if (!next.startsWith(completed)) {
        const shown = segment(completed).length;
        followEnd(() => {
          effects.reset();
          completed = segment(next).slice(0, shown).join("");
          revealed.textContent = completed;
          effects.record(completed);
        });
      }
      write(next.slice(completed.length));
    }
    preview = next;
  }

  function clear() {
    reset();
    output.hidden = true;
    delete document.body.dataset.answerActive;
    window.portfolioParticles?.clearAnswer?.();
  }

  return {
    get visible() { return !output.hidden; },
    update,
    finish(source) {
      update(source);
      finalSource = source;
      ended = true;
      flushTail();
    },
    clear,
    noteInteraction: effects.noteInteraction
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
  const countdown = form.querySelector("[data-chat-countdown]");
  const challenge = form.querySelector("#portfolio-chat-challenge");
  const siteKey = footer.dataset.chatTurnstileSiteKey?.trim();
  const accessUrl = footer.dataset.chatAccessEndpoint?.trim();
  const accessEndpoint = configuredEndpoint(accessUrl);
  const requireAccess = Boolean(siteKey || accessUrl);
  const compact = matchMedia("(max-width: 800px)");
  let accessToken;
  let accessExpiresAt = 0;
  let verificationAttempts = [];
  let retryAt = 0;
  let countdownTimer;
  let sessionId;
  let activeRequest;
  let retryQuestion;
  const answer = createAnswerOutput(
    () => !activeRequest && !input.value,
    () => { clear.hidden = true; }
  );

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
    const coolingDown = Date.now() < retryAt;
    send.disabled = busy || coolingDown || !input.value.trim();
    send.hidden = busy;
    stop.hidden = !busy;
    retry.hidden = busy || !retryQuestion || Boolean(input.value.trim());
    retry.disabled = coolingDown;
  }

  function updateCountdown() {
    const remaining = retryAt - Date.now();
    if (countdown) {
      countdown.textContent = remaining > 0
        ? copy.retryCountdown.replace("{seconds}", Math.ceil(remaining / 1000)) : "";
    }
    syncActions();
    if (remaining > 0) countdownTimer = setTimeout(updateCountdown, Math.min(1000, remaining));
  }

  function pauseUntil(timestamp) {
    if (timestamp <= retryAt || timestamp <= Date.now()) return;
    retryAt = timestamp;
    clearTimeout(countdownTimer);
    updateCountdown();
  }

  function recordVerificationAttempt() {
    const now = Date.now();
    verificationAttempts = verificationAttempts.filter(at => now - at < rateWindowMs);
    verificationAttempts.push(now);
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
    try {
      if (requireAccess && Date.now() >= accessExpiresAt) {
        failure = copy.verificationUnavailable;
        status.textContent = copy.verifying;
        if (!siteKey || accessEndpoint?.origin !== endpoint.origin) {
          throw new Error("Visitor verification not configured");
        }
        failure = copy.verificationFailed;
        const challengeToken = await getChallengeToken(challenge, siteKey, locale, controller.signal);
        failure = copy.verificationUnavailable;
        const challengeBody = { challengeToken };
        if (accessToken && sessionId) Object.assign(challengeBody, { accessToken, sessionId });
        const access = await fetch(accessEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(challengeBody),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          cache: "no-store"
        }).catch(error => {
          if (!controller.signal.aborted) pauseUntil(Date.now() + verificationRetryDelayMs);
          throw error;
        }).finally(recordVerificationAttempt);
        if (!access.ok) {
          if (access.status === 429) {
            failure = copy.verificationLimited;
            verificationAttempts = [];
            // The rate window also covers gateways that don't expose Retry-After to the browser.
            pauseUntil(Date.now() + retryDelay(access, rateWindowMs));
          }
          if (access.status >= 500) pauseUntil(Date.now() + retryDelay(access, verificationRetryDelayMs));
          if (access.status === 400 || access.status === 403) failure = copy.verificationRejected;
          throw new Error("Visitor verification rejected");
        }
        const credential = await access.json();
        if (typeof credential.accessToken !== "string" || !credential.accessToken
          || !Number.isSafeInteger(credential.expiresIn) || credential.expiresIn <= 0) {
          throw new Error("Invalid visitor credential");
        }
        accessToken = credential.accessToken;
        accessExpiresAt = Date.now() + Math.max(0, credential.expiresIn * 1000 - 5000);
        if (credential.continued !== true) sessionId = undefined;
        failure = copy.unavailable;
        status.textContent = copy.waiting;
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ message: question, sessionId, accessToken }),
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer"
      });
      if (!response.ok) {
        if (response.status === 429) {
          const result = await response.json().catch(() => null);
          if (result?.error?.code === "daily_limit") {
            failure = copy.dailyLimit;
          } else {
            failure = copy.limited;
            pauseUntil(Date.now() + retryDelay(response, rateWindowMs));
          }
        }
        if (response.status === 404 && sessionId) {
          sessionId = undefined;
          failure = copy.sessionExpired;
        }
        if (requireAccess && (response.status === 401 || response.status === 403)) {
          accessExpiresAt = 0;
          failure = copy.verificationRejected;
        }
        throw new Error("Chat request failed");
      }
      const result = await readEvents(response, event => {
        if (event.type === "error") {
          if (event.code === "daily_limit") failure = copy.dailyLimit;
          if (requestLimitCodes.has(event.code)) failure = copy.limited;
          throw new Error("Chat stream failed");
        }
        if (!controller.signal.aborted && typeof event.text === "string") {
          streamed += event.text;
          answer.update(streamed);
          clear.hidden = !answer.visible;
        }
      });
      if (controller.signal.aborted) throw new Error("Chat request stopped");
      const final = typeof result.text === "string" && result.text.trim() ? result.text : streamed;
      if (!final.trim()) throw new Error("Empty answer");
      answer.finish(final);
      clear.hidden = !answer.visible;

      if (typeof result.sessionId === "string") sessionId = result.sessionId;
      status.textContent = "";
    } catch {
      if (requireAccess && Date.now() >= accessExpiresAt && verificationAttempts.length >= verificationRequestsPerWindow) {
        pauseUntil(verificationAttempts[0] + rateWindowMs);
      }
      if (!request.dismissed) {
        retryQuestion = question;
        status.textContent = controller.signal.aborted ? copy.stopped : failure;
        answer.finish(streamed);
        clear.hidden = !answer.visible;
      }
    } finally {
      activeRequest = undefined;
      syncActions();
      answer.noteInteraction();
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

  input.addEventListener("input", () => {
    syncActions();
    answer.noteInteraction();
  });
  form.addEventListener("focusin", answer.noteInteraction);
  form.addEventListener("keydown", answer.noteInteraction);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const question = input.value.trim();
    if (activeRequest || Date.now() < retryAt || !question || question.length > input.maxLength) return;
    input.value = "";
    if (compact.matches) input.blur();
    answerQuestion(question);
  });
  stop.addEventListener("click", event => {
    if (event.detail === 0) input.focus({ preventScroll: true });
    activeRequest?.controller.abort();
  });
  retry.addEventListener("click", event => {
    if (activeRequest || Date.now() < retryAt || !retryQuestion) return;
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
