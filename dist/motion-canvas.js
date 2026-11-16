(() => {
  const palette = ["#666273", "#a49fae", "#d7d4e0", "#f9f6ff", "#b9a4ee"];

  function samplePoster(image) {
    const sampler = document.createElement("canvas");
    sampler.width = 640;
    sampler.height = Math.round(sampler.width * image.naturalHeight / image.naturalWidth);
    const context = sampler.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, sampler.width, sampler.height);
    const pixels = context.getImageData(0, 0, sampler.width, sampler.height).data;
    const candidates = [];
    for (let index = 0; index < pixels.length; index += 4) {
      if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) >= 65) candidates.push(index);
    }

    const groups = palette.map(() => []);
    const count = Math.min(candidates.length, 4800);
    for (let i = 0; i < count; i++) {
      const index = candidates[Math.floor((i + Math.random()) * candidates.length / count)];
      const pixel = index / 4;
      const [red, green, blue] = [pixels[index], pixels[index + 1], pixels[index + 2]];
      const light = Math.max(red, green, blue);
      const tone = blue - green > 16 && blue - red > 6 ? 4 : Math.min(3, Math.floor((light - 65) / 48));
      groups[tone].push({
        x: ((pixel % sampler.width) + Math.random()) / sampler.width,
        y: (Math.floor(pixel / sampler.width) + Math.random()) / sampler.height,
        phase: Math.random() * Math.PI * 2,
        size: 0.9 + light / 285,
        shiftX: 0,
        shiftY: 0
      });
    }
    return groups;
  }

  window.createAxonCanvasMotion = function createAxonCanvasMotion(canvas) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;

    const poster = new Image();
    let groups;
    let failed = false;
    let width = 1, height = 1, mobile = false;
    poster.addEventListener("load", () => {
      try {
        groups = samplePoster(poster);
      } catch {
        failed = true;
      }
    }, { once: true });
    poster.addEventListener("error", () => { failed = true; }, { once: true });
    poster.src = "./particle-poster.webp";

    function resize(size) {
      ({ width, height, mobile } = size);
      const dpr = Math.min(size.dpr, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(now, elapsed, delta, pointer, brush) {
      if (failed) throw new Error("Unable to load the particle poster");
      if (!groups) return false;

      const aspect = poster.naturalWidth / poster.naturalHeight;
      const imageHeight = mobile ? height : Math.max(height, width / aspect);
      const imageWidth = imageHeight * aspect;
      const left = (width - imageWidth) / 2;
      const top = (height - imageHeight) / 2;
      const decay = Math.exp(-delta * 7);
      const radiusSquared = brush ? brush.radius * brush.radius : 0;

      context.fillStyle = "#000";
      context.fillRect(0, 0, width, height);
      for (const [index, points] of groups.entries()) {
        context.fillStyle = palette[index];
        for (let i = 0; i < points.length; i += mobile ? 2 : 1) {
          const point = points[i];
          const angle = point.phase + elapsed * 1.5;
          const x = left + point.x * imageWidth + Math.sin(angle) * 1.5;
          const y = top + point.y * imageHeight + Math.cos(angle * 0.8) * 1.5;
          point.shiftX *= decay;
          point.shiftY *= decay;

          if (brush) {
            const dx = x - pointer.x;
            const dy = y - pointer.y;
            const proximity = Math.max(0, 1 - (dx * dx + dy * dy) / radiusSquared);
            point.shiftX += brush.dx * brush.stroke * proximity ** 2 * 0.2;
            point.shiftY += brush.dy * brush.stroke * proximity ** 2 * 0.2;
          }
          context.fillRect(x + point.shiftX, y + point.shiftY, point.size, point.size);
        }
      }
      return true;
    }

    return { canvas, resize, draw };
  };
})();
