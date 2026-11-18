export function createGlyphRaster(surface) {
  const stencil = document.createElement("canvas");
  const context = stencil.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  return (text, anchor) => {
    const rect = anchor.getBoundingClientRect();
    const canvas = surface.getBoundingClientRect();
    if (!rect.width || !rect.height || !canvas.width || !canvas.height) return [];

    const output = anchor.closest("[data-chat-answer-output]");
    const outputRect = output?.getBoundingClientRect();
    const outputLeft = outputRect ? outputRect.left + output.clientLeft : canvas.left;
    const outputTop = outputRect ? outputRect.top + output.clientTop : canvas.top;
    const left = Math.max(canvas.left, outputLeft);
    const top = Math.max(canvas.top, outputTop);
    const right = Math.min(canvas.right, output ? outputLeft + output.clientWidth : canvas.right);
    const bottom = Math.min(canvas.bottom, output ? outputTop + output.clientHeight : canvas.bottom);
    if (rect.right <= left || rect.left >= right || rect.bottom <= top || rect.top >= bottom) return [];

    const style = getComputedStyle(anchor);
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const pad = 4;
    const width = Math.ceil(rect.width) + pad * 2;
    const height = Math.ceil(rect.height) + pad * 2;
    if (stencil.width !== width) stencil.width = width;
    if (stencil.height !== height) stencil.height = height;
    context.clearRect(0, 0, width, height);
    context.font = font;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillStyle = "#fff";
    const metrics = context.measureText(text);
    const ascent = metrics.fontBoundingBoxAscent ?? parseFloat(style.fontSize) * 0.8;
    const descent = metrics.fontBoundingBoxDescent ?? parseFloat(style.fontSize) * 0.2;
    const baseline = pad + (rect.height + ascent - descent) / 2;
    context.fillText(text, pad, baseline);

    const pixels = context.getImageData(0, 0, width, height).data;
    const points = [];
    for (let y = 0; y < height; y++) {
      const screenY = rect.top + y - pad + 0.5;
      if (screenY < top || screenY >= bottom) continue;
      for (let x = 0; x < width; x++) {
        const screenX = rect.left + x - pad + 0.5;
        if (screenX < left || screenX >= right || pixels[(y * width + x) * 4 + 3] < 96) continue;
        points.push([
          (screenX - canvas.left) * 2 / canvas.width - 1,
          1 - (screenY - canvas.top) * 2 / canvas.height
        ]);
      }
    }
    return points;
  };
}
