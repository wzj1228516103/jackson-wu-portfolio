import { readFile, writeFile } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
const html = await readFile(new URL("index.html", dist), "utf8");
const repositories = new Set(
  [...html.matchAll(/\sdata-github-repo\s*=\s*(["'])([\w-]+\/[\w.-]+)\1/g)]
    .map(([, , repository]) => repository)
);

async function fetchStars(repository) {
  try {
    const response = await fetch("https://api.github.com/repos/" + repository, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) throw new Error("GitHub API returned HTTP " + response.status);

    const { private: isPrivate, stargazers_count: stars } = await response.json();
    if (isPrivate !== false || !Number.isSafeInteger(stars) || stars < 0) {
      throw new Error("No valid public star count");
    }
    return [repository, stars];
  } catch (error) {
    console.warn("Could not update stars for " + repository + ": " + error.message);
    return null;
  }
}

const entries = await Promise.all([...repositories].map(fetchStars));
const counts = Object.fromEntries(entries.filter(entry => entry !== null));
await writeFile(new URL("project-stars.json", dist), JSON.stringify(counts) + "\n");
console.log("Generated star counts for " + Object.keys(counts).length + " of " + repositories.size + " repositories.");
