import { locale, t } from "./localize.mjs";

function loadEssayImage(image, onFailure) {
  const { essaySrc, essayFallback } = image.dataset;
  image.addEventListener("error", () => {
    if (!image.isConnected) return;
    image.addEventListener("error", onFailure, { once: true });
    image.src = essayFallback;
  }, { once: true });
  image.src = essaySrc;
}

for (const image of document.querySelectorAll(".essay-card img[data-essay-src]")) {
  loadEssayImage(image, () => { image.hidden = true; });
}

const dialog = document.querySelector("#essay-dialog");
if (typeof dialog?.showModal === "function") {
  const title = dialog.querySelector("[data-essay-title]");
  const date = dialog.querySelector("[data-essay-date]");
  const body = dialog.querySelector("[data-essay-body]");
  const scroll = dialog.querySelector("[data-essay-scroll]");
  const formatDate = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
  let trigger;

  dialog.querySelector("[data-essay-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => {
    body.replaceChildren();
    trigger?.focus({ preventScroll: true });
    trigger = undefined;
  });

  document.addEventListener("click", event => {
    const link = event.target.closest("[data-essay]");
    if (!link) return;
    const template = document.getElementById(link.dataset.essay);
    if (!(template instanceof HTMLTemplateElement)) return;

    event.preventDefault();
    trigger = link;
    title.textContent = t(template.dataset.title);
    date.dateTime = template.dataset.date;
    date.textContent = formatDate.format(new Date(template.dataset.date));
    body.replaceChildren(template.content.cloneNode(true));
    for (const image of body.querySelectorAll("img[data-essay-src]")) {
      const figure = document.createElement("figure");
      figure.className = "essay-figure";
      const parent = image.parentElement;
      if (parent.tagName === "P" && parent.childElementCount === 1 && !parent.textContent.trim()) {
        parent.replaceWith(figure);
      } else {
        image.replaceWith(figure);
      }
      figure.append(image);
      if (image.alt) {
        const caption = document.createElement("figcaption");
        caption.textContent = image.alt;
        caption.setAttribute("aria-hidden", "true");
        figure.append(caption);
      }
      loadEssayImage(image, () => {
        if (!image.isConnected) return;
        const message = document.createElement("p");
        message.className = "essay-image-unavailable";
        const fallbackLabel = t("图片暂时无法加载");
        message.textContent = image.alt ? `${fallbackLabel} · ${image.alt}` : fallbackLabel;
        figure.replaceChildren(message);
      });
    }
    dialog.showModal();
    scroll.scrollTop = 0;
    title.focus({ preventScroll: true });
  });
}
