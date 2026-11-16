(() => {
  const canvas = document.querySelector("#bg");
  const button = document.querySelector("#motion-toggle");
  if (!window.THREE || !window.AxonFluid || !window.AxonParticles) return;

  const options = {alpha: false, antialias: false, powerPreference: "high-performance"};
  const context = canvas.getContext("webgl2", options);
  if (!context || !context.getExtension("EXT_color_buffer_float")) return;

  const compact = matchMedia("(max-width: 800px)");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
  const base = new THREE.Vector3(-1.17, 0, 6);
  const target = base.clone();
  camera.position.copy(base);

  const pointer = {x: 0, y: 0, active: false};
  const previous = {x: 0, y: 0, active: false};
  let renderer, particles, fluid, mobile, frameId, lastFrame;
  let lastSplat = -Infinity;
  let elapsed = 0;
  let width = 1, height = 1;
  let paused = reduced.matches;
  let visible = true;
  let contextLost = false;
  let dirty = true;

  function sizeScene() {
    width = Math.max(canvas.clientWidth, 1);
    height = Math.max(canvas.clientHeight, 1);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);

    camera.aspect = width / height;
    camera.zoom = compact.matches ? Math.min(0.9, camera.aspect * 1.08) : 0.88;
    camera.updateProjectionMatrix();

    if (fluid) fluid.resize(width, height, dpr);
    else fluid = new AxonFluid(renderer, width, height, dpr);

    if (!particles || mobile !== compact.matches) {
      particles?.dispose();
      mobile = compact.matches;
      particles = new AxonParticles(renderer, mobile);
      scene.add(particles.group);
    }
    particles.resize(dpr);
    pointer.active = previous.active = false;
    target.copy(base);
    dirty = false;
  }

  function track(point, restart) {
    if (!frameId) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = point.clientX - rect.left;
    pointer.y = point.clientY - rect.top;
    pointer.active = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= width && pointer.y <= height;
    if (restart || !pointer.active) previous.active = false;
  }

  function stir(now) {
    const dx = pointer.x - previous.x;
    const dy = pointer.y - previous.y;
    const distance = Math.hypot(dx, dy);

    if (previous.active && distance > 0.01) {
      const maxRadius = Math.min(mobile ? 42 : 54, height * (mobile ? 0.08 : 0.06));
      const radius = Math.min(distance / 5, 1) * maxRadius / height;
      const stroke = Math.min(1, 32 / distance);
      const power = Math.min(distance / 15, 1) * 3.8 * stroke;
      const x = pointer.x / width;
      const y = 1 - pointer.y / height;
      const trail = now - lastSplat <= 50 ? stroke : 0;
      fluid.splat(x - dx * trail / width, y + dy * trail / height,
        x, y, dx * power, -dy * power, radius);
      lastSplat = now;
    }

    Object.assign(previous, pointer);
  }

  function animate(now) {
    if (dirty) sizeScene();
    const delta = lastFrame === undefined ? 1 / 60 : Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    elapsed += delta;

    if (pointer.active) {
      target.x = base.x - (pointer.x / width * 2 - 1) * 0.8;
      target.y = base.y + (pointer.y / height * 2 - 1) * 1.5;
      stir(now);
    }

    camera.position.lerp(target, 0.05);
    camera.lookAt(0, 0, 0);
    fluid.step();
    particles.step(elapsed, delta * 60, camera, fluid.velocity, fluid.density);
    renderer.render(scene, camera);
    canvas.classList.add("is-rendering");
    frameId = requestAnimationFrame(animate);
  }

  function syncMotion() {
    button.textContent = paused ? "启用动效" : "暂停动效";

    if (paused || !visible || document.hidden || contextLost) {
      cancelAnimationFrame(frameId);
      frameId = lastFrame = undefined;
      pointer.active = previous.active = false;
      return;
    }

    if (!renderer) {
      renderer = new THREE.WebGLRenderer({canvas, context, ...options});
      renderer.setClearColor(0x000000, 1);
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
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    contextLost = true;
    canvas.classList.remove("is-rendering");
    syncMotion();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    particles?.dispose();
    fluid?.dispose();
    particles = fluid = undefined;
    dirty = true;
    contextLost = false;
    syncMotion();
  });

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    syncMotion();
  }).observe(canvas);

  syncMotion();
})();
