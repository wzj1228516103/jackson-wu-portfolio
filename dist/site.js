(() => {
  const filters = document.querySelector(".filters");
  const cards = [...document.querySelectorAll(".project-card")];
  const count = document.querySelector("#project-count");
  const status = document.querySelector("#filter-status");

  filters.hidden = false;
  filters.addEventListener("click", event => {
    const clicked = event.target.closest("[data-filter]");
    if (!clicked) return;

    const category = clicked.dataset.filter;
    for (const button of filters.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button === clicked));
    }
    for (const card of cards) {
      card.hidden = category !== "all" && !card.dataset.category.split(" ").includes(category);
    }

    const total = cards.filter(card => !card.hidden).length;
    const message = "正在展示 " + total + " 个项目";
    count.textContent = String(total).padStart(2, "0");
    count.setAttribute("aria-label", message);
    status.textContent = message;
    document.querySelector(".project-scroll").scrollTop = 0;
  });

  function highlightLocation() {
    const active = location.hash || "#profile";
    for (const link of document.querySelectorAll(".profile-nav a, .project-card")) {
      if (link.getAttribute("href") === active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  }

  addEventListener("hashchange", highlightLocation);
  highlightLocation();
})();
