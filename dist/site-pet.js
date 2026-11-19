const pet = document.querySelector("[data-site-pet]");

if (pet) {
  const image = pet.querySelector("img");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motionControl = document.querySelector("#motion-toggle");
  const frameDurations = {
    idle: [600, 180, 110, 130, 320, 700],
    waving: [100, 75, 75, 75, 75, 75, 75, 170],
    jumping: [70, 70, 64, 64, 64, 64, 64, 64, 72, 130],
    "running-left": [75, 75, 75, 75, 75, 75, 75, 75],
    "running-right": [75, 75, 75, 75, 75, 75, 75, 75],
  };
  const gazeDirections = 16;
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
  let action = "idle";
  let gazeSheet;
  let gazeReady = false;
  let pointer;
  let lookAngle;
  let lookDirection;
  let gazeFrame;
  let gazeTime;

  function motionPaused() {
    return reducedMotion.matches || motionControl?.dataset.motionPaused === "true";
  }

  function canAnimate() {
    return sheetReady && !motionPaused() && !document.hidden;
  }

  function renderLook() {
    pet.dataset.petAction = "looking";
    pet.style.setProperty("--pet-frame", lookDirection % 8);
    pet.style.setProperty("--pet-look-row", Math.floor(lookDirection / 8));
  }

  function play(nextAction = "idle") {
    window.clearTimeout(frameTimer);
    action = nextAction;
    if (!canAnimate()) return;

    if (action === "idle" && lookDirection !== undefined && !drag?.moved) {
      renderLook();
      return;
    }

    pet.dataset.petAction = action;
    const durations = frameDurations[action];
    let frame = 0;

    function advance() {
      pet.style.setProperty("--pet-frame", frame);
      frameTimer = window.setTimeout(() => {
        frame += 1;
        if (frame === durations.length) {
          if (action === "waving" || action === "jumping") return play();
          frame = 0;
        }
        advance();
      }, durations[frame]);
    }

    advance();
  }

  function clearLook() {
    if (gazeFrame !== undefined) window.cancelAnimationFrame(gazeFrame);
    gazeFrame = gazeTime = lookAngle = lookDirection = undefined;
    if (pet.dataset.petAction === "looking") play();
  }

  function updateLook(time) {
    gazeFrame = undefined;
    if (!canAnimate() || !gazeReady || !pointer || drag?.moved) return;

    const { left, top, width, height } = pet.getBoundingClientRect();
    const x = pointer.x - (left + width / 2);
    const y = pointer.y - (top + height * .4);
    if (Math.hypot(x, y) < (lookDirection === undefined ? 36 : 28)) {
      clearLook();
      return;
    }

    const target = (Math.atan2(x, -y) * gazeDirections / (2 * Math.PI) + gazeDirections) % gazeDirections;
    lookAngle ??= target;
    const delta = (target - lookAngle + gazeDirections * 1.5) % gazeDirections - gazeDirections / 2;
    const elapsed = Math.min(40, time - (gazeTime ?? time - 16));
    gazeTime = time;
    lookAngle = (lookAngle + delta * (1 - Math.exp(-elapsed / 55)) + gazeDirections) % gazeDirections;
    const offset = (lookAngle - (lookDirection ?? lookAngle) + gazeDirections * 1.5) % gazeDirections - gazeDirections / 2;
    const direction = lookDirection !== undefined && Math.abs(offset) < .62
      ? lookDirection : Math.round(lookAngle) % gazeDirections;
    if (direction !== lookDirection) {
      lookDirection = direction;
      if (action === "idle") {
        window.clearTimeout(frameTimer);
        renderLook();
      }
    }

    if (Math.abs(delta) > .08) queueLook();
    else gazeTime = undefined;
  }

  function queueLook() {
    if (gazeFrame === undefined && gazeReady && pointer && canAnimate()) {
      gazeFrame = window.requestAnimationFrame(updateLook);
    }
  }

  function syncMotion() {
    pet.classList.toggle("is-motion-paused", motionPaused());
    pet.classList.toggle("is-animated", sheetReady && !motionPaused());
    if (!canAnimate()) clearLook();
    play();
    queueLook();
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
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, left, top };
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
      clearLook();
      if (action !== "idle") play();
    }
    const stepX = event.clientX - drag.lastX;
    if (Math.abs(stepX) >= 2) {
      drag.lastX = event.clientX;
      const gait = stepX < 0 ? "running-left" : "running-right";
      if (gait !== action) play(gait);
    }
    place(drag.left + dx, drag.top + dy);
    event.stopPropagation();
  });

  function endDrag(event) {
    if (drag?.id !== event.pointerId) return;
    const moved = drag.moved;
    drag = undefined;
    pet.classList.remove("is-dragging");
    if (moved) {
      suppressClick = event.type === "pointerup";
      if (suppressClick && (event.pointerType === "mouse" || event.pointerType === "pen")) {
        pointer = { x: event.clientX, y: event.clientY };
      }
      play(suppressClick ? "jumping" : "idle");
    }
    queueLook();
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
      queueLook();
      return;
    }
    const direction = arrowMoves.get(event.key);
    if (!direction) return;
    event.preventDefault();
    const { left, top } = pet.getBoundingClientRect();
    const distance = event.shiftKey ? 48 : 16;
    place(left + direction[0] * distance, top + direction[1] * distance);
    queueLook();
  });

  const keepInView = () => {
    if (position) place(position.x, position.y);
    queueLook();
  };
  window.addEventListener("resize", keepInView);
  window.visualViewport?.addEventListener("resize", keepInView);
  window.visualViewport?.addEventListener("scroll", keepInView);
  document.addEventListener("visibilitychange", syncMotion);
  reducedMotion.addEventListener("change", syncMotion);
  if (motionControl) {
    new MutationObserver(syncMotion).observe(motionControl, { attributeFilter: ["data-motion-paused"] });
  }

  window.addEventListener("pointermove", event => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    pointer = { x: event.clientX, y: event.clientY };
    if (!canAnimate()) return;
    if (!gazeSheet) {
      gazeSheet = new Image();
      gazeSheet.addEventListener("load", () => {
        gazeReady = true;
        queueLook();
      }, { once: true });
      gazeSheet.src = new URL("./jacksonwu-pet-gaze.webp", import.meta.url).href;
    }
    queueLook();
  }, { passive: true });

  function pointerLeft() {
    pointer = undefined;
    clearLook();
  }
  document.documentElement.addEventListener("pointerleave", pointerLeft);
  window.addEventListener("blur", pointerLeft);

  const sheet = new Image();
  sheet.addEventListener("load", () => {
    sheetReady = true;
    syncMotion();
  }, { once: true });
  sheet.src = new URL("./jacksonwu-pet-motion-smooth.webp", import.meta.url).href;

  if (image?.complete && image.naturalWidth > 0) pet.hidden = false;
  else image?.addEventListener("load", () => { pet.hidden = false; }, { once: true });
}
