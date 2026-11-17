const defaultLocale = "zh-CN";
const loadTranslations = {
  en: () => import("./locales/en.mjs"),
  "zh-TW": () => import("./locales/zh-TW.mjs"),
  ja: () => import("./locales/ja.mjs")
};

const requestedLocale = new URL(location.href).searchParams.get("lang");
let translations = {};
export let locale = defaultLocale;

if (Object.hasOwn(loadTranslations, requestedLocale)) {
  try {
    translations = (await loadTranslations[requestedLocale]()).default;
    locale = requestedLocale;
  } catch (error) {
    console.warn("Could not load the selected language", error);
  }
}

export function t(source, values) {
  const translation = Object.hasOwn(translations, source) ? translations[source] : source;
  if (!values) return translation;
  return translation.replace(/\{(\w+)\}/g, (placeholder, key) => values[key] ?? placeholder);
}

function addressInLanguage(address, language) {
  const url = new URL(address, location.href);
  if (language === defaultLocale) url.searchParams.delete("lang");
  else url.searchParams.set("lang", language);
  return url;
}

if (locale !== defaultLocale) {
  document.documentElement.lang = locale;
  document.title = t(document.title);
  const description = document.querySelector('meta[name="description"]');
  description.content = t(description.content);

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement.closest("script, style, noscript, option")) continue;
    const source = node.data.trim();
    if (Object.hasOwn(translations, source)) {
      node.data = node.data.replace(source, () => t(source));
    }
  }

  for (const attribute of ["aria-label", "alt", "title"]) {
    for (const element of document.querySelectorAll(`[${attribute}]`)) {
      const source = element.getAttribute(attribute);
      if (Object.hasOwn(translations, source)) element.setAttribute(attribute, t(source));
    }
  }

  for (const link of document.querySelectorAll("[data-local-link]")) {
    link.href = addressInLanguage(link.href, locale).href;
  }
}

const select = document.querySelector(".language-select");
select.value = locale;
select.hidden = false;
select.addEventListener("change", () => {
  location.assign(addressInLanguage(location.href, select.value));
});
