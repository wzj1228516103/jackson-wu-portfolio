(() => {
  const webglCanvas = document.querySelector("#bg");
  const canvas2d = document.querySelector("#bg-2d");
  const button = document.querySelector("#motion-toggle");
  const compact = matchMedia("(max-width: 800px)");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

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

    return { canvas, resize, draw, dispose };
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
        pointer.active = previous.active = false;
        dirty = false;
      }
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
    frameId = requestAnimationFrame(animate);
  }

  function syncMotion() {
    if (unavailable) return;
    button.textContent = paused ? "启用动效" : "暂停动效";
    if (paused || !visible || document.hidden) {
      stopFrame();
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
