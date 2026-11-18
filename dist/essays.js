// Opens an essay in a full-size reader dialog instead of switching the resume panel.

(() => {
  const dialog = document.querySelector("#essay-dialog");
  if (!dialog || typeof dialog.showModal !== "function") return;

  const title = dialog.querySelector("[data-essay-title]");
  const body = dialog.querySelector("[data-essay-body]");

  const close = () => dialog.close();
  dialog.querySelector("[data-essay-close]").addEventListener("click", close);
  dialog.addEventListener("click", event => {
    // A click on the dialog element itself is the backdrop, not its content.
    if (event.target === dialog) close();
  });
  dialog.addEventListener("close", () => body.replaceChildren());

  document.addEventListener("click", event => {
    const link = event.target.closest("[data-essay]");
    if (!link) return;
    const template = document.getElementById(link.dataset.essay);
    if (!(template instanceof HTMLTemplateElement)) return;

    event.preventDefault();
    title.textContent = template.dataset.title ?? "";
    body.replaceChildren(template.content.cloneNode(true));
    dialog.showModal();
    body.scrollTop = 0;
    title.setAttribute("tabindex", "-1");
    title.focus({ preventScroll: true });
  });
})();
