import { t } from "./localize.mjs";
import { createGlyphRaster } from "./answer-layout.mjs?v=glyph-frontier";

(() => {
  const webglCanvas = document.querySelector("#bg");
  const canvas2d = document.querySelector("#bg-2d");
  const button = document.querySelector("#motion-toggle");
  const drawAscii = window.createAxonAscii?.(document.querySelector("#gradient-ascii"));
  const compact = matchMedia("(max-width: 800px)");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const answerRegion = document.querySelector("[data-chat-answer-region]");
  const rasterGlyph = createGlyphRaster(webglCanvas);

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

    return {
      canvas, resize, draw, dispose,
      setGlyph: (points, startTime, duration) => particles.setGlyph(points, startTime, duration),
      clearGlyph: () => particles?.clearGlyph(),
      setSettledGlyphs: (glyphs, dissolveTiming) => particles.setSettledGlyphs(glyphs, dissolveTiming),
      setSettledProgress: (now, progress) => particles.setSettledProgress(now, progress),
      clearSettled: returnToOrbit => particles?.clearSettled(returnToOrbit),
      setAnswerMode: active => particles?.setAnswerMode(active)
    };
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
  let answerMode = false;
  let glyph, glyphDirty;
  const scattered = new Map();
  const scatterHold = 650;
  const dissolveTiming = { wave: 0.56, handoff: 0.09, travel: 0.35 };
  let scatterDirty = false;
  let settledGeometryDirty = false;
  let dissolve;

  function acknowledgeGlyph(rendered) {
    const onDrawn = glyph?.onDrawn;
    if (!onDrawn) return;
    glyph.onDrawn = undefined;
    queueMicrotask(() => onDrawn(rendered));
  }

  function clearGlyph() {
    glyph = null;
    glyphDirty = false;
    engine?.clearGlyph?.();
  }

  function beginAnswer() {
    answerMode = true;
    engine?.setAnswerMode?.(true);
  }

  function canRenderGlyphs() {
    return !!(rasterGlyph && tryWebGL && !unavailable && !paused &&
      !reduced.matches && engine?.canvas !== canvas2d);
  }

  function canRenderSettled() {
    return answerMode && canRenderGlyphs() && engine?.canvas === webglCanvas && visible && !document.hidden;
  }

  function releaseScatter(anchor, entry) {
    scattered.delete(anchor);
    scatterDirty = true;
    queueMicrotask(() => entry.onChange?.(anchor, false));
  }

  function cancelSettledEffects() {
    for (const [anchor, entry] of scattered) releaseScatter(anchor, entry);
    const interrupted = dissolve;
    dissolve = null;
    engine?.clearSettled?.(false);
    if (interrupted) queueMicrotask(() => interrupted.onFinish?.(false));
  }

  window.portfolioParticles = {
    beginAnswer,
    canRenderGlyphs,
    setGlyph(text, anchor, duration = 64, onDrawn) {
      if (!visible) {
        const rect = webglCanvas.getBoundingClientRect();
        visible = rect.top < innerHeight && rect.bottom > 0 && rect.width > 0;
        if (visible) syncMotion();
      }
      beginAnswer();
      if (!canRenderGlyphs() || engine?.canvas !== webglCanvas || !visible ||
          document.hidden || typeof text !== "string" || !text.trim() || !anchor?.isConnected) {
        clearGlyph();
        return false;
      }
      glyph = { text, anchor, duration: Math.max(20, duration), startedAt: performance.now(), onDrawn };
      glyphDirty = true;
      return true;
    },
    clearGlyph,
    clearAnswer() {
      answerMode = false;
      clearGlyph();
      cancelSettledEffects();
      engine?.setAnswerMode?.(false);
    },
    scatterGlyphs(anchors, onChange) {
      if (!canRenderSettled() || dissolve || !anchors.length) return false;
      const now = performance.now();
      for (const anchor of anchors) {
        const entry = scattered.get(anchor) ?? { anchor, onChange, startedAt: now };
        entry.expiresAt = now + scatterHold;
        scattered.set(anchor, entry);
      }
      scatterDirty = true;
      return true;
    },
    refreshSettledGeometry() {
      if (scattered.size) settledGeometryDirty = true;
    },
    dissolveAnswer(anchors, duration = 4200, onStart, onFinish) {
      if (!canRenderSettled() || dissolve || !anchors.length) return false;
      const glyphs = [];
      for (const anchor of anchors) {
        if (!anchor.isConnected) continue;
        const points = rasterGlyph(anchor.textContent, anchor);
        if (points.length) glyphs.push({ anchor, points });
      }
      if (!glyphs.length) return false;
      const phaseStep = dissolveTiming.wave / Math.max(1, glyphs.length - 1);
      glyphs.forEach((glyph, index) => { glyph.dissolvePhase = index * phaseStep; });
      cancelSettledEffects();
      dissolve = { glyphs, startedAt: null, duration, onStart, onFinish };
      settledGeometryDirty = true;
      return true;
    },
    cancelSettledEffects
  };

  function updateGlyph(now) {
    if (!glyph) return;
    if (!glyph.anchor.isConnected) {
      acknowledgeGlyph(false);
      clearGlyph();
      return;
    }
    if (!glyphDirty) return;
    glyphDirty = false;
    const points = rasterGlyph(glyph.text, glyph.anchor);
    if (!points.length) {
      acknowledgeGlyph(false);
      engine.clearGlyph();
      return;
    }
    const lead = Math.min(14, glyph.duration * 0.38);
    const timeInFlight = Math.max(0, now - glyph.startedAt) + lead;
    engine.setGlyph(points, elapsed - timeInFlight / 1000, glyph.duration / 1000);
    return true;
  }

  function updateSettledEffects(now) {
    if (dissolve) {
      dissolve.startedAt ??= now;
      if (settledGeometryDirty) {
        if (dissolve.painted) {
          for (const glyph of dissolve.glyphs) {
            glyph.points = rasterGlyph(glyph.anchor.textContent, glyph.anchor);
          }
        }
        engine.setSettledGlyphs(dissolve.glyphs, dissolveTiming);
      }
      const progress = Math.min(1, (now - dissolve.startedAt) / dissolve.duration);
      engine.setSettledProgress(now, progress);
      settledGeometryDirty = false;
      return progress === 1;
    }

    for (const [anchor, entry] of scattered) {
      if (!anchor.isConnected || now >= entry.expiresAt) {
        releaseScatter(anchor, entry);
        continue;
      }
      if (!entry.points || settledGeometryDirty) {
        entry.points = rasterGlyph(anchor.textContent, anchor);
        if (!entry.points.length) releaseScatter(anchor, entry);
      }
    }
    if (scatterDirty || settledGeometryDirty && scattered.size) {
      engine.setSettledGlyphs?.(Array.from(scattered.values()));
      scatterDirty = false;
    }
    if (scattered.size) engine.setSettledProgress(now, -1);
    settledGeometryDirty = false;
    return false;
  }

  function acknowledgeSettledEffects(completed) {
    if (dissolve) {
      const effect = dissolve;
      if (!effect.painted) {
        effect.painted = true;
        queueMicrotask(() => {
          if (dissolve !== effect) return;
          effect.onStart?.({
            startedAt: effect.startedAt,
            anchors: effect.glyphs.map(({ anchor, dissolvePhase }) => ({
              anchor,
              delay: dissolvePhase * effect.duration,
              duration: dissolveTiming.handoff * effect.duration
            }))
          });
        });
      }
      if (completed) {
        answerMode = false;
        dissolve = null;
        engine.clearSettled(true);
        queueMicrotask(() => effect.onFinish?.(true));
      }
      return;
    }
    for (const [anchor, entry] of scattered) {
      if (entry.painted) continue;
      entry.painted = true;
      queueMicrotask(() => {
        if (scattered.get(anchor) === entry) entry.onChange?.(anchor, true);
      });
    }
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
    acknowledgeGlyph(false);
    clearGlyph();
    cancelSettledEffects();
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
        engine.setAnswerMode?.(answerMode);
        glyphDirty = settledGeometryDirty = true;
        pointer.active = previous.active = false;
        dirty = false;
      }
      const glyphDrawn = updateGlyph(now);
      const dissolveComplete = updateSettledEffects(now);
      if (engine.draw(now, elapsed, delta, pointer, getBrush())) engine.canvas.classList.add("is-rendering");
      if (glyphDrawn) acknowledgeGlyph(true);
      acknowledgeSettledEffects(dissolveComplete);
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
      if (answerMode) {
        engine?.canvas.classList.remove("is-rendering");
        acknowledgeGlyph(false);
        clearGlyph();
        cancelSettledEffects();
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
  addEventListener("scroll", () => { glyphDirty = settledGeometryDirty = true; }, {passive: true, capture: true});
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
