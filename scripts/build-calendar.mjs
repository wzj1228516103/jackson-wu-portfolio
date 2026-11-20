import { readFile, writeFile } from "node:fs/promises";

const USERNAME = "wzj1228516103";
const DAY = 86_400_000;

function attribute(tag, name) {
  return tag.match(new RegExp("\\s" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i"))?.[2];
}

function readCalendar(html) {
  const counts = new Map();
  for (const [, attributes, text] of html.matchAll(/<tool-tip\b([^>]*)>([^<]*)<\/tool-tip>/gi)) {
    const id = attribute(attributes, "for");
    if (!id?.startsWith("contribution-day-component-")) continue;
    const value = text.match(/^\s*(No|[0-9]+(?:,[0-9]{3})*)\s+contributions?\s+on\b/i)?.[1];
    if (value) counts.set(id, value.toLowerCase() === "no" ? 0 : Number(value.replaceAll(",", "")));
  }

  const days = [];
  for (const [tag] of html.matchAll(/<td\b[^>]*>/gi)) {
    if (!attribute(tag, "class")?.split(/\s+/).includes("ContributionCalendar-day")) continue;
    const date = attribute(tag, "data-date");
    const level = attribute(tag, "data-level");
    const count = counts.get(attribute(tag, "id"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[0-4]$/.test(level) ||
        !Number.isSafeInteger(count) || count < 0 || (count === 0) !== (level === "0")) {
      throw new Error("Missing GitHub calendar data");
    }
    days.push({ date, count, level: Number(level) });
  }

  days.sort((first, second) => first.date.localeCompare(second.date));
  // GitHub can start at the preceding Sunday to show a complete first week.
  if (days.length < 365 || days.length > 373) throw new Error("Unexpected GitHub calendar length");
  const start = Date.parse(days[0].date + "T00:00:00Z");
  if (!Number.isFinite(start) || days.some(({ date }, index) =>
    new Date(start + index * DAY).toISOString().slice(0, 10) !== date
  )) throw new Error("Non-contiguous GitHub calendar");
  if (days.length > 367 && new Date(start).getUTCDay() !== 0) {
    throw new Error("GitHub calendar does not start on a Sunday");
  }

  const total = days.reduce((sum, day) => sum + day.count, 0);
  const heading = html.match(/id=["']js-contribution-activity-description["'][^>]*>\s*([\d,]+)\s+contributions?\b/i);
  if (heading && Number(heading[1].replaceAll(",", "")) !== total) throw new Error("GitHub calendar total mismatch");

  const now = Date.now();
  const lastDay = start + (days.length - 1) * DAY;
  if (now - lastDay > 3 * DAY || lastDay - now > DAY) throw new Error("GitHub returned an unexpected date range");
  return { username: USERNAME, total, days, fetchedAt: new Date(now).toISOString() };
}

const [input] = process.argv.slice(2);
if (!input) throw new Error("Usage: node scripts/build-calendar.mjs <GitHub calendar HTML>");
const data = readCalendar(await readFile(input, "utf8"));
await writeFile(new URL("../dist/contributions.json", import.meta.url), JSON.stringify(data) + "\n");
console.log("Generated " + data.days.length + " daily entries from GitHub (" + data.total + " contributions).");
