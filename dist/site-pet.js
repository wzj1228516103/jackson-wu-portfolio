const pet = document.querySelector("[data-site-pet]");

if (pet) {
  const image = pet.querySelector("img");
  const viewportEdge = 8;
  const arrowMoves = new Map([
    ["ArrowLeft", [-1, 0]], ["ArrowRight", [1, 0]],
    ["ArrowUp", [0, -1]], ["ArrowDown", [0, 1]],
  ]);
  let position;
  let drag;

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
    const { left, top } = pet.getBoundingClientRect();
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, left, top };
    pet.setPointerCapture(event.pointerId);
  });

  pet.addEventListener("pointermove", event => {
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    pet.classList.add("is-dragging");
    place(drag.left + dx, drag.top + dy);
    event.stopPropagation();
  });

  function endDrag(event) {
    if (drag?.id !== event.pointerId) return;
    drag = undefined;
    pet.classList.remove("is-dragging");
  }

  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    pet.addEventListener(type, endDrag);
  }

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

  if (image?.complete && image.naturalWidth > 0) pet.hidden = false;
  else image?.addEventListener("load", () => { pet.hidden = false; }, { once: true });
}
