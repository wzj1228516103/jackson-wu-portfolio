import { locale, t } from "./localize.mjs";

(() => {
  const section = document.querySelector("#contributions");
  const grid = document.querySelector("#contribution-grid");
  const state = document.querySelector("#contribution-state");
  const retry = document.querySelector("#contribution-retry");
  const dayLabel = document.querySelector("#contribution-day");
  const calendar = document.querySelector("#contribution-results");
  const number = new Intl.NumberFormat(locale);
  const dateLabel = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
  const updatedLabel = new Intl.DateTimeFormat(locale, {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai"
  });
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const weekdayLabel = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const cells = [];
  let activeCell;
  let loading = false;
  let loaded = false;

  function label(text, className, column, row) {
    const element = document.createElement("span");
    element.textContent = text;
    element.className = className;
    element.style.gridColumnStart = column;
    element.style.gridRowStart = row;
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  function select(cell) {
    if (activeCell) activeCell.tabIndex = -1;
    activeCell = cell;
    cell.tabIndex = 0;
    dayLabel.textContent = cell.getAttribute("aria-label");
  }

  function show(data) {
    const dates = data.days.map(day => new Date(day.date + "T00:00:00Z"));
    const offset = dates[0].getUTCDay();
    grid.style.setProperty("--weeks", Math.ceil((offset + dates.length) / 7));
    const contents = document.createDocumentFragment();
    for (const weekday of [1, 3, 5]) {
      const day = new Date(Date.UTC(2024, 0, weekday)); // January 1 was a Monday.
      contents.append(label(weekdayLabel.format(day), "contribution-weekday", 1, weekday + 2));
    }

    const first = dates[0];
    const nextMonth = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
    const fullWeeksInFirstMonth = Math.floor((offset + (nextMonth - first) / 86400000) / 7);
    for (const [index, date] of dates.entries()) {
      const column = Math.floor((offset + index) / 7) + 2;
      if (date.getUTCDate() === 1 || (index === 0 && fullWeeksInFirstMonth >= 3)) {
        contents.append(label(monthLabel.format(date), "contribution-month", column, 1));
      }

      const day = data.days[index];
      const cell = document.createElement("button");
      const description = t("{date} · {count} 次贡献", { date: dateLabel.format(date), count: number.format(day.count) });
      cell.type = "button";
      cell.className = "contribution-cell";
      cell.style.gridColumnStart = column;
      cell.style.gridRowStart = date.getUTCDay() + 2;
      cell.tabIndex = -1;
      cell.dataset.level = day.level;
      cell.dataset.dayIndex = index;
      cell.title = description;
      cell.setAttribute("aria-label", description);
      cells.push(cell);
      contents.append(cell);
    }
    grid.replaceChildren(contents);
    select(cells.at(-1));

    document.querySelector("#contribution-total").textContent = number.format(data.total);
    const fetchedAt = new Date(data.fetchedAt);
    const timestamp = updatedLabel.format(fetchedAt);
    const stale = Date.now() - fetchedAt > 2 * 86400000;
    document.querySelector("#contribution-source").textContent =
      t(stale ? "上次成功更新于 {timestamp}（北京时间）" : "每日更新 · {timestamp}（北京时间）", { timestamp });
    calendar.hidden = false;
    const scroll = grid.parentElement;
    scroll.scrollLeft = scroll.scrollWidth - scroll.clientWidth;
  }

  async function load() {
    if (loading || loaded) return;
    loading = true;
    retry.hidden = true;
    state.hidden = false;
    state.textContent = t("正在读取 GitHub 贡献日历…");
    try {
      const response = await fetch("./contributions.json", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Contributions unavailable");
      const data = await response.json();
      if (!Array.isArray(data.days) || !data.days.length) throw new Error("Empty calendar");
      show(data);
      state.textContent = "";
      state.hidden = true;
      loaded = true;
    } catch {
      state.textContent = t("暂时无法读取 GitHub 贡献日历。");
      retry.hidden = false;
    } finally {
      loading = false;
    }
  }

  grid.addEventListener("pointerover", event => {
    if (event.target.matches(".contribution-cell")) dayLabel.textContent = event.target.getAttribute("aria-label");
  });
  grid.addEventListener("focusin", event => {
    if (event.target.matches(".contribution-cell")) select(event.target);
  });
  grid.addEventListener("click", event => {
    if (event.target.matches(".contribution-cell")) select(event.target);
  });
  grid.addEventListener("keydown", event => {
    if (!event.target.matches(".contribution-cell")) return;
    const index = Number(event.target.dataset.dayIndex);
    const deltas = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    const next = event.key === "Home" ? 0 : event.key === "End" ? cells.length - 1 : index + deltas[event.key];
    if (!Number.isInteger(next)) return;
    event.preventDefault();
    cells[Math.max(0, Math.min(cells.length - 1, next))].focus();
  });

  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    observer.disconnect();
    load();
  });
  observer.observe(section);
  retry.addEventListener("click", load);
  function loadSection() {
    if (location.hash !== "#contributions") return;
    observer.disconnect();
    load();
  }
  addEventListener("hashchange", loadSection);
  loadSection();
})();
