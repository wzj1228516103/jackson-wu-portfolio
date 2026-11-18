import { Marked } from "./marked-18.2.1.mjs";

const destinations = {
  "published/index.html": { href: "./index.html", label: "portfolio", fallback: "Portfolio" },
  "published/resume.html": { href: "./resume.html", label: "resume", fallback: "Résumé" }
};
const destination = href => Object.hasOwn(destinations, href) ? destinations[href] : undefined;
const sourceLocales = new Set(["en", "zh-TW", "ja"]);
const citationStart = /(?:[（(][ \t]*)?\[[1-9]\d{0,2}\]/u;
const citationPath = /^\[([1-9]\d{0,2})\][ \t]+(?:\x60(published\/(?:index|resume)\.html)\x60|(published\/(?:index|resume)\.html)(?![\w/%?#\\-]|\.[\w%]))/u;
const citationLink = /^\[([1-9]\d{0,2})\]\((published\/(?:index|resume)\.html)\)/u;
const lexer = new Marked({ gfm: true, breaks: true });

lexer.use({ extensions: [{
  name: "siteCitation",
  level: "inline",
  start(text) { return text.search(citationStart); },
  tokenizer(text) {
    const opening = text[0] === "(" || text[0] === "（";
    const prefix = opening ? text.match(/^[（(][ \t]*/u)[0] : "";
    const body = text.slice(prefix.length);
    const match = citationPath.exec(body) ?? citationLink.exec(body);
    if (!match) return;
    const trailing = body.slice(match[0].length);
    const closing = opening && trailing.trim() ? trailing.match(/^[ \t]*[)）]/u)?.[0] : "";
    if (closing === undefined) return;
    const raw = prefix + match[0] + closing;
    return { type: "siteCitation", raw, index: match[1], path: match[2] ?? match[3] };
  }
}] });

const entities = new Map([
  ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"], ["nbsp", "\u00a0"],
  ["copy", "©"], ["reg", "®"], ["hellip", "…"], ["mdash", "—"], ["ndash", "–"]
]);

function readable(text = "") {
  return text.replace(/&([a-z]{2,6});/gi, (entity, name) => entities.get(name.toLowerCase()) ?? entity);
}

function webLink(href) {
  if (!href || /[\u0000-\u001f\u007f\\]/u.test(href) || href.startsWith("//")) return null;
  if (/^(?:\.\/)?published\//u.test(href)) return null;
  const absolute = /^https?:\/\//i.test(href);
  if (!absolute && /^[^/?#]*[:&%]/u.test(href)) return null;
  try {
    const url = new URL(href, document.baseURI);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    if (!absolute && url.origin !== new URL(document.baseURI).origin) return null;
    return absolute ? url.href : href;
  } catch {
    return null;
  }
}

function addElement(parent, tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
}

function addLink(parent, href) {
  const link = addElement(parent, "a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.referrerPolicy = "no-referrer";
  return link;
}

function sourceHref(source) {
  const locale = document.documentElement.lang;
  return sourceLocales.has(locale) ? source.href + "?lang=" + locale : source.href;
}

function addCitation(parent, index, path, labels) {
  const marker = "[" + index + "]";
  if (parent.closest?.("a")) {
    parent.append(marker);
    return;
  }
  const source = destination(path);
  const link = addLink(parent, sourceHref(source));
  const label = (labels.source ?? "Source") + " " + index + " · " + (labels[source.label] ?? source.fallback);
  link.className = "chat-citation";
  link.textContent = marker;
  link.setAttribute("aria-label", label);
  link.title = label;
}

function appendTable(parent, token, labels) {
  const table = addElement(parent, "table");
  const head = addElement(addElement(table, "thead"), "tr");
  for (const cell of token.header) {
    const heading = addElement(head, "th");
    heading.scope = "col";
    appendTokens(heading, cell.tokens, labels);
  }
  const body = addElement(table, "tbody");
  for (const row of token.rows) {
    const line = addElement(body, "tr");
    for (const cell of row) appendTokens(addElement(line, "td"), cell.tokens, labels);
  }
}

function appendTokens(parent, tokens, labels) {
  for (const token of tokens) {
    switch (token.type) {
      case "paragraph":
      case "blockquote":
      case "heading":
      case "strong":
      case "em":
      case "del": {
        const tag = token.type === "paragraph" ? "p"
          : token.type === "heading" ? "h" + Math.max(2, token.depth) : token.type;
        appendTokens(addElement(parent, tag), token.tokens, labels);
        break;
      }
      case "list": {
        const list = addElement(parent, token.ordered ? "ol" : "ul");
        if (token.ordered && token.start !== 1) list.start = token.start;
        for (const item of token.items) appendTokens(addElement(list, "li"), item.tokens, labels);
        break;
      }
      case "code":
        addElement(addElement(parent, "pre"), "code", token.text);
        break;
      case "codespan":
        addElement(parent, "code", token.text);
        break;
      case "table":
        appendTable(parent, token, labels);
        break;
      case "space":
      case "def":
      case "html":
        break;
      case "br":
      case "hr":
        addElement(parent, token.type);
        break;
      case "image":
        parent.append(readable(token.text));
        break;
      case "checkbox":
        parent.append(token.checked ? "☑ " : "☐ ");
        break;
      case "link": {
        const source = destination(token.href);
        const index = token.text.match(/^[1-9]\d{0,2}$/u)?.[0];
        if (source && index) {
          addCitation(parent, index, token.href, labels);
          break;
        }
        const href = source ? sourceHref(source) : webLink(token.href);
        appendTokens(href ? addLink(parent, href) : parent, token.tokens, labels);
        break;
      }
      case "siteCitation":
        addCitation(parent, token.index, token.path, labels);
        break;
      default:
        if (token.tokens) appendTokens(parent, token.tokens, labels);
        else parent.append(token.type === "escape" ? token.text : readable(token.text));
    }
  }
}

export function renderAnswerMarkdown(source, labels = {}) {
  const fragment = document.createDocumentFragment();
  appendTokens(fragment, lexer.lexer(source), labels);
  return fragment;
}

function previewText(text) {
  const clean = readable(text);
  const unfinished = /(?:[（(][ \t]*)?\[[1-9]\d{0,2}\](?:[ \t]+\x60?([^ \t\r\n\x60)）]*))?$/u.exec(clean);
  const citationTail = unfinished && (/[（(]/u.test(unfinished[0][0]) ||
    unfinished[1] && Object.keys(destinations).some(path => path.startsWith(unfinished[1])));
  const withoutCitation = citationTail ? clean.slice(0, unfinished.index) : clean;
  return withoutCitation
    .replace(/(^|[\s(（])(?:\*{1,3}|_{1,3}|~{1,2}|\x60{1,3})(?=\S|$)/gu, "$1")
    .replace(/(?:\*{1,3}|_{1,3}|~{1,2}|\x60{1,3})$/u, "")
    .replace(/\[([^\]\r\n]+)\]\([^\r\n)]*$/u, "$1")
    .replace(/^(?:#{1,6}|>{1,3}|\d+[.)]|[-+])(?:[ \t]+|$)/gm, "");
}

function plainTokens(tokens, separator = "") {
  return tokens.map(token => {
    switch (token.type) {
      case "space":
      case "def":
      case "html":
      case "hr":
        return "";
      case "br":
        return "\n";
      case "siteCitation":
        return "[" + token.index + "]";
      case "link":
        return destination(token.href) && /^[1-9]\d{0,2}$/u.test(token.text)
          ? "[" + token.text + "]"
          : plainTokens(token.tokens);
      case "checkbox":
        return token.checked ? "☑ " : "☐ ";
      case "code":
      case "codespan":
      case "escape":
        return token.text;
      case "list":
        return token.items.map((item, index) => {
          const bullet = token.ordered ? (token.start + index) + ". " : "• ";
          return bullet + plainTokens(item.tokens, "\n").trim().replaceAll("\n", "\n  ");
        }).join("\n");
      case "table":
        return [token.header, ...token.rows].map(row => row.map(cell => plainTokens(cell.tokens)).join(" · ")).join("\n");
      case "blockquote":
        return plainTokens(token.tokens, "\n\n");
      default:
        return token.tokens ? plainTokens(token.tokens) : previewText(token.text);
    }
  }).filter(Boolean).join(separator);
}

export function answerPreviewText(source) {
  return plainTokens(lexer.lexer(source), "\n\n").trim();
}
