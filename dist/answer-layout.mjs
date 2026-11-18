const pointLimit = 128 * 128;

function wrapText(text, context, width) {
  const lines = [];
  let line = "";
  const pushLine = () => {
    lines.push(line.trimEnd());
    line = "";
  };
  const tokens = text.replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .match(/\n|[^\S\n]+|(?:[\p{Script=Latin}\p{N}_]+|[^\s])[\p{Pe}\p{Pf}.,!?;:%。，、！？：；…]*/gu) ?? [];

  for (const token of tokens) {
    if (token === "\n") {
      pushLine();
      continue;
    }
    if (line && context.measureText(line + token).width > width) pushLine();
    if (context.measureText(token).width <= width) {
      line += line ? token : token.trimStart();
      continue;
    }
    for (const letter of token) {
      if (line && context.measureText(line + letter).width > width) pushLine();
      line += letter;
    }
  }
  if (line) pushLine();
  return lines;
}

export function createAnswerLayout(region, surface) {
  if (!region) return null;
  const stencil = document.createElement("canvas");
  const context = stencil.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  function layout(text) {
    const box = region.getBoundingClientRect();
    const canvas = surface.getBoundingClientRect();
    const width = Math.floor(box.width);
    const height = Math.floor(box.height);
    if (width < 80 || height < 32 || !canvas.width || !canvas.height) return null;

    const size = Math.round(Math.max(17, Math.min(22, width / 25)));
    const font = `650 ${size}px ${getComputedStyle(region).fontFamily}`;
    const lineHeight = Math.ceil(size * 1.48);
    const inset = Math.round(Math.min(18, width * 0.04));
    const linesPerPage = Math.max(1, Math.floor((height - 2 * inset) / lineHeight));
    context.font = font;
    const lines = wrapText(text.trim(), context, width - 2 * inset);
    const pages = [];
    for (let index = 0; index < lines.length; index += linesPerPage) {
      const page = lines.slice(index, index + linesPerPage);
      if (page.some(Boolean)) pages.push(page);
    }
    return { box, canvas, width, height, size, font, lineHeight, inset, pages };
  }

  function sample(layout, index) {
    const { box, canvas, width, height, size, font, lineHeight, inset, pages } = layout;
    const lines = pages[index];
    if (!lines) return [];
    const usedHeight = Math.min(height, 2 * inset + lines.length * lineHeight);
    const verticalOffset = Math.min(height * 0.28, (height - usedHeight) / 2);
    stencil.width = width;
    stencil.height = usedHeight;
    context.font = font;
    context.textBaseline = "alphabetic";
    context.fillStyle = "#fff";
    const contentWidth = Math.max(...lines.map(line => context.measureText(line).width));
    const left = Math.max(inset, Math.round((width - contentWidth) / 2));
    const right = Math.min(width, Math.ceil(left + contentWidth + 2));
    lines.forEach((line, row) => context.fillText(line, left, inset + size + row * lineHeight));

    const pixels = context.getImageData(0, 0, width, usedHeight).data;
    function collect(stride) {
      const points = [];
      const diameter = stride === 1 ? 1.45 : 2.3;
      for (let row = 0; row < lines.length; row++) {
        const top = inset + row * lineHeight - 2;
        const bottom = Math.min(top + lineHeight, usedHeight);
        // Sample a line column-first so newly streamed glyphs do not reorder the preceding letters.
        for (let x = Math.max(0, left - 2); x < right; x += stride) {
          for (let y = Math.max(top, 0); y < bottom; y += stride) {
            if (pixels[(y * width + x) * 4 + 3] < 96) continue;
            const screenX = box.left - canvas.left + x + 0.5;
            const screenY = box.top - canvas.top + verticalOffset + y + 0.5;
            points.push([screenX * 2 / canvas.width - 1, 1 - screenY * 2 / canvas.height, diameter]);
          }
        }
      }
      return points;
    }

    const dense = collect(1);
    if (dense.length <= pointLimit) return dense;
    const points = collect(2);
    if (points.length <= pointLimit) return points;
    return Array.from({ length: pointLimit }, (_, index) => points[Math.floor(index * points.length / pointLimit)]);
  }

  return { layout, sample };
}
