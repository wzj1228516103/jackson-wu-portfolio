import { locale, t } from "./localize.mjs";

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
    const message = t("正在展示 {count} 个项目", { count: total });
    count.textContent = String(total).padStart(2, "0");
    count.setAttribute("aria-label", message);
    status.textContent = message;
    document.querySelector(".project-scroll").scrollTop = 0;
  });

  function highlightLocation() {
    const active = location.hash || "#profile";
    for (const link of document.querySelectorAll(".profile-nav a, .project-card, .essay-card")) {
      if (link.getAttribute("href") === active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  }

  async function showProjectStars() {
    let stars;
    try {
      const response = await fetch("./project-stars.json");
      if (!response.ok) return;
      stars = await response.json();
    } catch {
      return;
    }
    if (!stars || typeof stars !== "object") return;

    const format = new Intl.NumberFormat(locale);
    for (const card of cards) {
      const repo = card.dataset.githubRepo;
      if (!repo) continue;
      const total = stars[repo];
      if (!Number.isSafeInteger(total) || total < 0) continue;

      const badge = card.querySelector(".project-stars");
      const count = format.format(total);
      badge.textContent = "★ " + count;
      const label = t("GitHub 星标数：{count}", { count });
      badge.setAttribute("aria-label", label);
      badge.title = label;
      badge.hidden = false;
    }
  }

  addEventListener("hashchange", highlightLocation);
  highlightLocation();
  showProjectStars();
})();
