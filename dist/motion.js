import { t } from "./localize.mjs";
import { createAnswerLayout } from "./answer-layout.mjs";

(() => {
  const webglCanvas = document.querySelector("#bg");
  const canvas2d = document.querySelector("#bg-2d");
  const button = document.querySelector("#motion-toggle");
  const drawAscii = window.createAxonAscii?.(document.querySelector("#gradient-ascii"));
  const compact = matchMedia("(max-width: 800px)");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const answerRegion = document.querySelector("[data-chat-answer-region]");
  const textRaster = createAnswerLayout(answerRegion, webglCanvas);

  function createWebGL(canvas) {
    if (!window.THREE || !window.AxonFluid || !window.AxonParticles) return null;
    const options = {alpha: false, antialias: false, powerPreference: "high-performance"};
    const context = canvas.getContext("webgl2", options);
    if (!context?.getExtension("EXT_color_buffer_float")) return null;

    const renderer = new THREE.WebGLRenderer({canvas, context, ...options});
    renderer.setClearColor(0x000000, 1);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
    const base = new THREE.Vector3(-1.17, 0, 6);
    const target = base.clone();
    camera.position.copy(base);

    let particles, fluid, mobile, width, height;
    let lastSplat = -Infinity;

    function resize(size) {
      ({width, height} = size);
      const {dpr} = size;
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.zoom = size.mobile ? Math.min(0.9, camera.aspect * 1.08) : 0.88;
      camera.updateProjectionMatrix();

      if (fluid) fluid.resize(width, height, dpr);
      else fluid = new AxonFluid(renderer, width, height, dpr);
      if (!particles || mobile !== size.mobile) {
        particles?.dispose();
        mobile = size.mobile;
        particles = new AxonParticles(renderer, mobile);
        scene.add(particles.group);
      }
      particles.resize(dpr);
      target.copy(base);
    }

    function draw(now, elapsed, delta, pointer, brush) {
      if (pointer.active) {
        target.x = base.x - (pointer.x / width * 2 - 1) * 0.8;
        target.y = base.y + (pointer.y / height * 2 - 1) * 1.5;
      }
      if (brush) {
        const {dx, dy, distance, radius, stroke} = brush;
        const power = Math.min(distance / 15, 1) * 3.8 * stroke;
        const x = pointer.x / width;
        const y = 1 - pointer.y / height;
        const trail = now - lastSplat <= 50 ? stroke : 0;
        fluid.splat(x - dx * trail / width, y + dy * trail / height,
          x, y, dx * power, -dy * power, radius / height);
        lastSplat = now;
      }

      camera.position.lerp(target, 0.05);
      camera.lookAt(0, 0, 0);
      fluid.step();
      particles.step(elapsed, delta * 60, camera, fluid.velocity, fluid.density);
      renderer.render(scene, camera);
      return true;
    }

    function dispose() {
      particles?.dispose();
      fluid?.dispose();
      renderer.dispose();
    }

    function setAnswer(points, time) {
      particles.setAnswer(points, time);
    }

    return { canvas, resize, draw, dispose, setAnswer };
  }

  const pointer = {x: 0, y: 0, active: false};
  const previous = {...pointer};
  let engine, size, frameId, lastFrame;
  let elapsed = 0;
  let paused = reduced.matches;
  let visible = true;
  let dirty = true;
  let tryWebGL = true;
  let unavailable = false;
  let answerText = "";
  let answerDirty = false;
  let answerLayout = null;
  let pageIndex = 0;
  let pageSince = null;
  let followPages = true;
  let lastLayout = -Infinity;
  let paintedKey = "";
  let particlesFormingText = false;
  let expectingParticles = false;
  let layoutFailed = false;
  let renderedAnswer = { active: false, page: 0, pageCount: 0 };

  function reportAnswer(active, page = 0, pageCount = 0, force = false) {
    if (!force && renderedAnswer.active === active && renderedAnswer.page === page &&
        renderedAnswer.pageCount === pageCount) return;
    renderedAnswer = { active, page, pageCount };
    window.dispatchEvent(new CustomEvent("portfolio:answer-rendered", { detail: renderedAnswer }));
  }

  function canRenderAnswer() {
    return !!(textRaster && engine?.canvas === webglCanvas &&
      !paused && !reduced.matches && visible && !document.hidden);
  }

  function invalidateLayout() {
    answerDirty = true;
    lastLayout = -Infinity;
    paintedKey = "";
    layoutFailed = false;
  }

  function hideAnswer() {
    if (particlesFormingText) engine?.setAnswer?.([], elapsed);
    particlesFormingText = false;
    paintedKey = "";
    const force = expectingParticles && !renderedAnswer.active;
    expectingParticles = false;
    reportAnswer(false, 0, 0, force);
  }

  window.portfolioParticles = {
    setAnswer(text) {
      if (typeof text !== "string" || !text.trim()) {
        this.clearAnswer();
        return false;
      }
      if (!answerText) {
        pageIndex = 0;
        pageSince = null;
        followPages = true;
        invalidateLayout();
      }
      if (answerText !== text) {
        answerText = text;
        answerDirty = true;
      }
      if (!visible) {
        const rect = webglCanvas.getBoundingClientRect();
        visible = rect.top < innerHeight && rect.bottom > 0 && rect.width > 0;
        if (visible) syncMotion();
      }
      expectingParticles = canRenderAnswer() && !layoutFailed;
      return expectingParticles;
    },
    clearAnswer() {
      answerText = "";
      answerLayout = null;
      answerDirty = false;
      hideAnswer();
    },
    setPage(page) {
      if (!Number.isInteger(page) || page < 1 || page > (answerLayout?.pages.length ?? 0)) return;
      followPages = false;
      pageIndex = page - 1;
    }
  };

  function updateAnswer(now) {
    if (!answerText || !canRenderAnswer()) return;
    if (answerDirty && now - lastLayout >= 85) {
      answerLayout = textRaster.layout(answerText);
      lastLayout = now;
      answerDirty = false;
    }
    const pages = answerLayout?.pages;
    if (!pages?.length) {
      layoutFailed = true;
      hideAnswer();
      return;
    }

    pageIndex = Math.min(pageIndex, pages.length - 1);
    pageSince ??= now;
    const dwell = Math.max(2100, pages[pageIndex].join("").length * 28);
    if (followPages && pageIndex < pages.length - 1 && now - pageSince >= dwell) {
      pageIndex += 1;
      pageSince = now;
    }

    const key = [pageIndex, ...pages[pageIndex]].join("\n");
    if (key !== paintedKey) {
      const points = textRaster.sample(answerLayout, pageIndex);
      if (!points.length) {
        layoutFailed = true;
        hideAnswer();
        return;
      }
      engine.setAnswer(points, elapsed);
      particlesFormingText = true;
      layoutFailed = false;
      paintedKey = key;
    }
    reportAnswer(true, pageIndex + 1, pages.length);
  }

  function track(point, restart) {
    if (frameId === undefined || !size) return;
    const rect = webglCanvas.getBoundingClientRect();
    pointer.x = point.clientX - rect.left;
    pointer.y = point.clientY - rect.top;
    pointer.active = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= size.width && pointer.y <= size.height;
    if (restart || !pointer.active) previous.active = false;
  }

  function getBrush() {
    if (!pointer.active || !previous.active) return null;
    const dx = pointer.x - previous.x;
    const dy = pointer.y - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.01) return null;
    const maxRadius = Math.min(size.mobile ? 42 : 54, size.height * (size.mobile ? 0.08 : 0.06));
    return { dx, dy, distance, radius: Math.min(distance / 5, 1) * maxRadius, stroke: Math.min(1, 32 / distance) };
  }

  function stopFrame() {
    cancelAnimationFrame(frameId);
    frameId = lastFrame = undefined;
    pointer.active = previous.active = false;
  }

  function fallBack() {
    tryWebGL = false;
    stopFrame();
    const previousEngine = engine;
    engine = undefined;
    previousEngine.canvas.classList.remove("is-rendering");
    try { previousEngine.dispose(); } catch { /* The WebGL context may already be gone. */ }
    hideAnswer();
    dirty = true;
    syncMotion();
  }

  function animate(now) {
    const delta = lastFrame === undefined ? 1 / 60 : Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    elapsed += delta;

    try {
      if (dirty) {
        size = {
          width: Math.max(webglCanvas.clientWidth, 1),
          height: Math.max(webglCanvas.clientHeight, 1),
          dpr: Math.min(devicePixelRatio || 1, 2),
          mobile: compact.matches
        };
        engine.resize(size);
        invalidateLayout();
        pointer.active = previous.active = false;
        dirty = false;
      }
      updateAnswer(now);
      if (engine.draw(now, elapsed, delta, pointer, getBrush())) engine.canvas.classList.add("is-rendering");
    } catch {
      if (engine.canvas === webglCanvas) fallBack();
      else {
        engine.canvas.classList.remove("is-rendering");
        stopFrame();
        unavailable = true;
        button.hidden = true;
      }
      return;
    }

    Object.assign(previous, pointer);
    drawAscii?.(elapsed);
    frameId = requestAnimationFrame(animate);
  }

  function syncMotion() {
    button.dataset.motionPaused = String(paused);
    if (unavailable) return;
    button.textContent = t(paused ? "启用动效" : "暂停动效");
    if (paused || !visible || document.hidden) {
      stopFrame();
      if (particlesFormingText || expectingParticles) {
        engine.canvas.classList.remove("is-rendering");
        hideAnswer();
        pageSince = null;
      }
      return;
    }

    if (!engine) {
      try {
        if (tryWebGL) engine = createWebGL(webglCanvas);
      } catch {
        tryWebGL = false;
      }
      if (!engine) {
        try { engine = window.createAxonCanvasMotion?.(canvas2d); } catch { /* Static poster remains visible. */ }
      }
      if (!engine) {
        unavailable = true;
        button.hidden = true;
        return;
      }
    }
    if (frameId === undefined) frameId = requestAnimationFrame(animate);
  }

  button.hidden = false;
  button.addEventListener("click", () => {
    paused = !paused;
    syncMotion();
  });
  reduced.addEventListener("change", event => {
    paused = event.matches;
    syncMotion();
  });
  addEventListener("resize", () => { dirty = true; }, {passive: true});
  const resizeObserver = new ResizeObserver(() => { dirty = true; });
  resizeObserver.observe(webglCanvas);
  if (answerRegion) resizeObserver.observe(answerRegion);
  addEventListener("pointermove", event => {
    if (event.isPrimary && event.pointerType !== "touch") track(event, false);
  }, {passive: true});
  function touch(event) {
    if (event.touches.length === 1) track(event.touches[0], event.type === "touchstart");
  }
  addEventListener("touchstart", touch, {passive: true});
  addEventListener("touchmove", touch, {passive: true});
  document.addEventListener("visibilitychange", syncMotion);
  webglCanvas.addEventListener("webglcontextlost", event => {
    if (engine?.canvas !== webglCanvas) return;
    event.preventDefault();
    fallBack();
  });

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    syncMotion();
  }).observe(webglCanvas);

  syncMotion();
})();
