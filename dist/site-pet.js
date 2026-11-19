const pet = document.querySelector("[data-site-pet]");

if (pet) {
  const image = pet.querySelector("img");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motionControl = document.querySelector("#motion-toggle");
  const frameDurations = {
    idle: [600, 180, 110, 130, 320, 700],
    waving: [180, 240, 220, 260],
    jumping: [120, 110, 140, 130, 220],
  };
  const viewportEdge = 8;
  const arrowMoves = new Map([
    ["ArrowLeft", [-1, 0]], ["ArrowRight", [1, 0]],
    ["ArrowUp", [0, -1]], ["ArrowDown", [0, 1]],
  ]);
  let position;
  let drag;
  let sheetReady = false;
  let frameTimer;
  let suppressClick = false;

  function motionPaused() {
    return reducedMotion.matches || motionControl?.dataset.motionPaused === "true";
  }

  function play(action = "idle") {
    window.clearTimeout(frameTimer);
    if (!sheetReady || motionPaused() || document.hidden) return;

    pet.dataset.petAction = action;
    const durations = frameDurations[action];
    let frame = 0;

    function advance() {
      pet.style.setProperty("--pet-frame", frame);
      frameTimer = window.setTimeout(() => {
        frame += 1;
        if (frame === durations.length) {
          if (action !== "idle") return play();
          frame = 0;
        }
        advance();
      }, durations[frame]);
    }

    advance();
  }

  function syncMotion() {
    pet.classList.toggle("is-motion-paused", motionPaused());
    pet.classList.toggle("is-animated", sheetReady && !motionPaused());
    play();
  }

  function place(x, y) {
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? document.documentElement.clientWidth;
    const height = viewport?.height ?? document.documentElement.clientHeight;
    position = {
      x: Math.max(left + viewportEdge, Math.min(x, left + width - pet.offsetWidth - viewportEdge)),
      y: Math.max(top + viewportEdge, Math.min(y, top + height - pet.offsetHeight - viewportEdge)),
    };
    pet.style.setProperty("--pet-x", `${position.x}px`);
    pet.style.setProperty("--pet-y", `${position.y}px`);
    pet.classList.add("is-positioned");
  }

  pet.addEventListener("pointerdown", event => {
    if (drag || !event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    const { left, top } = pet.getBoundingClientRect();
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, left, top };
    pet.setPointerCapture(event.pointerId);
  });

  pet.addEventListener("pointermove", event => {
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      pet.classList.add("is-dragging");
      play();
    }
    place(drag.left + dx, drag.top + dy);
    event.stopPropagation();
  });

  function endDrag(event) {
    if (drag?.id !== event.pointerId) return;
    const moved = drag.moved;
    drag = undefined;
    pet.classList.remove("is-dragging");
    if (moved && event.type === "pointerup") {
      suppressClick = true;
      play("jumping");
    }
  }

  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    pet.addEventListener(type, endDrag);
  }

  pet.addEventListener("click", event => {
    if (suppressClick && event.detail > 0) return;
    play("waving");
  });

  pet.addEventListener("keydown", event => {
    if (event.key === "Home") {
      event.preventDefault();
      position = undefined;
      pet.classList.remove("is-positioned");
      return;
    }
    const direction = arrowMoves.get(event.key);
    if (!direction) return;
    event.preventDefault();
    const { left, top } = pet.getBoundingClientRect();
    const distance = event.shiftKey ? 48 : 16;
    place(left + direction[0] * distance, top + direction[1] * distance);
  });

  const keepInView = () => {
    if (position) place(position.x, position.y);
  };
  window.addEventListener("resize", keepInView);
  window.visualViewport?.addEventListener("resize", keepInView);
  window.visualViewport?.addEventListener("scroll", keepInView);
  document.addEventListener("visibilitychange", syncMotion);
  reducedMotion.addEventListener("change", syncMotion);
  if (motionControl) {
    new MutationObserver(syncMotion).observe(motionControl, { attributeFilter: ["data-motion-paused"] });
  }

  const sheet = new Image();
  sheet.addEventListener("load", () => {
    sheetReady = true;
    syncMotion();
  }, { once: true });
  sheet.src = new URL("./jacksonwu-pet-motion.webp", import.meta.url).href;

  if (image?.complete && image.naturalWidth > 0) pet.hidden = false;
  else image?.addEventListener("load", () => { pet.hidden = false; }, { once: true });
}
