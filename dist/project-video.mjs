import { t } from "./localize.mjs";

const closeDuration = 240;

function isPrimaryActivation(event) {
  return !event.defaultPrevented && event.button === 0 &&
    !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

export function setupProjectVideo(cards, highlightLocation) {
  const dialog = document.querySelector("#project-video");
  if (typeof dialog?.show !== "function" || typeof dialog.showModal !== "function") return;

  const title = dialog.querySelector("#project-video-title");
  const closeButton = dialog.querySelector("[data-project-video-close]");
  const detailsLink = dialog.querySelector("[data-project-video-details]");
  const status = dialog.querySelector("[data-project-video-status]");
  const retry = dialog.querySelector("[data-project-video-retry]");
  const video = dialog.querySelector("video");
  const profileScroll = document.querySelector(".profile-scroll");
  const motionToggle = document.querySelector("#motion-toggle");
  const wide = matchMedia("(min-width: 1050px)");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let selected;
  let closeTimer;
  let playGeneration = 0;
  let waitingForGesture = false;

  function canAnimate() {
    return !reducedMotion.matches && motionToggle?.dataset.motionPaused !== "true";
  }

  function setStatus(message = "", failed = false) {
    status.textContent = message;
    status.hidden = !message;
    retry.hidden = !failed;
  }

  function showDialog() {
    if (wide.matches) dialog.show();
    else dialog.showModal();
  }

  function showDetails(target) {
    const behavior = canAnimate() ? "smooth" : "instant";
    if (wide.matches && profileScroll) {
      const top = target.getBoundingClientRect().top - profileScroll.getBoundingClientRect().top;
      profileScroll.scrollTo({ top: profileScroll.scrollTop + top, behavior });
    } else {
      target.scrollIntoView({ block: "start", behavior });
    }
  }

  function reportPlaybackError() {
    if (!selected || closeTimer !== undefined) return;
    waitingForGesture = false;
    setStatus(t("视频无法播放，请重试。"), true);
  }

  function playVideo() {
    const generation = ++playGeneration;
    video.play()?.catch(error => {
      if (generation !== playGeneration || error.name === "AbortError") return;
      if (error.name === "NotAllowedError") {
        waitingForGesture = true;
        setStatus(t("请点击播放按钮继续。"));
      } else {
        reportPlaybackError();
      }
    });
  }

  function loadVideo(source, reloading = false) {
    waitingForGesture = false;
    setStatus(t("正在加载视频…"));
    if (reloading) {
      video.load();
    } else {
      video.pause();
      video.poster = source.replace(/\.mp4$/i, ".webp");
      video.src = source;
    }
    playVideo();
  }

  function openPlayer(project) {
    const needsReload = selected?.card !== project.card || !video.hasAttribute("src");
    clearTimeout(closeTimer);
    closeTimer = undefined;
    selected?.card.setAttribute("aria-expanded", "false");
    selected = project;
    project.card.setAttribute("aria-expanded", "true");
    title.textContent = project.title;
    detailsLink.href = project.hash;

    if (location.hash !== project.hash) {
      history.pushState(history.state, "", project.hash);
      highlightLocation();
    }
    if (wide.matches) showDetails(project.target);

    if (!dialog.open) {
      showDialog();
      // Commit the initial geometry before enabling the entry transition.
      dialog.getBoundingClientRect();
    }
    document.body.setAttribute("data-project-video-open", "");
    dialog.classList.add("is-open");
    closeButton.focus({ preventScroll: true });

    if (needsReload) loadVideo(project.source);
    else if (video.paused && !video.error) playVideo();
  }

  function closePlayer({ restoreFocus = true, revealDetails = false } = {}) {
    if (!selected || closeTimer !== undefined) return;
    const project = selected;
    const focusWasInside = dialog.contains(document.activeElement);
    ++playGeneration;
    video.pause();
    dialog.classList.remove("is-open");
    document.body.removeAttribute("data-project-video-open");
    project.card.setAttribute("aria-expanded", "false");

    function finish() {
      closeTimer = undefined;
      selected = undefined;
      dialog.close();
      video.removeAttribute("src");
      video.removeAttribute("poster");
      video.load();
      setStatus();
      if (revealDetails) {
        project.target.focus({ preventScroll: true });
        showDetails(project.target);
      } else if (restoreFocus && focusWasInside && !project.card.hidden) {
        project.card.focus({ preventScroll: true });
      }
    }

    if (canAnimate()) closeTimer = setTimeout(finish, closeDuration);
    else finish();
  }

  for (const card of cards) {
    const source = card.dataset.projectVideo;
    const hash = card.getAttribute("href");
    const target = hash?.startsWith("#") && document.getElementById(hash.slice(1));
    const projectTitle = card.querySelector(".project-meta strong")?.textContent.trim();
    if (!source || !target || !projectTitle) continue;
    const project = { card, source, hash, target, title: projectTitle };
    card.setAttribute("aria-haspopup", "dialog");
    card.setAttribute("aria-controls", dialog.id);
    card.setAttribute("aria-expanded", "false");
    card.addEventListener("click", event => {
      if (!isPrimaryActivation(event)) return;
      event.preventDefault();
      openPlayer(project);
    });
  }

  closeButton.addEventListener("click", () => closePlayer());
  detailsLink.addEventListener("click", event => {
    if (!isPrimaryActivation(event)) return;
    event.preventDefault();
    closePlayer({ revealDetails: true });
  });
  retry.addEventListener("click", () => {
    if (selected && closeTimer === undefined) loadVideo(selected.source, true);
  });
  video.addEventListener("canplay", () => {
    if (selected && !waitingForGesture && !video.error) setStatus();
  });
  video.addEventListener("playing", () => {
    waitingForGesture = false;
    setStatus();
  });
  video.addEventListener("error", () => {
    if (video.error) reportPlaybackError();
  });

  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    closePlayer();
  });
  dialog.addEventListener("click", event => {
    if (wide.matches || event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) closePlayer();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !dialog.open || document.fullscreenElement ||
        video.webkitDisplayingFullscreen || document.querySelector("dialog[open]:not(#project-video)")) return;
    event.preventDefault();
    event.stopPropagation();
    closePlayer();
  }, true);
  document.addEventListener("click", event => {
    if (dialog.open && event.target.closest("[data-essay]")) closePlayer({ restoreFocus: false });
  }, true);

  function syncLocation() {
    if (selected && location.hash !== selected.hash) closePlayer({ restoreFocus: false });
  }

  addEventListener("hashchange", syncLocation);
  addEventListener("popstate", syncLocation);
  wide.addEventListener("change", () => {
    if (!selected || closeTimer !== undefined) return;
    const focused = dialog.contains(document.activeElement) ? document.activeElement : closeButton;
    dialog.close();
    showDialog();
    focused.focus({ preventScroll: true });
    if (wide.matches) showDetails(selected.target);
  });
}
