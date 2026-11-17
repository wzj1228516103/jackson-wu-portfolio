import json
import re
from ipaddress import ip_address
from os import environ
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

from bs4 import BeautifulSoup, Tag


SITE_URL = "https://wzj1228516103.github.io/jackson-wu-portfolio/"
DIST = Path(__file__).resolve().parent.parent / "dist"
PROJECT_IDS = ("miniprogram-skill", "voice-pet", "app-community")
RESUME_SECTIONS = ("opensource", "experience", "projects", "skills", "education")
MAX_NOTES = 20
MAX_NOTE_CHARS = 2_000
MAX_MANIFEST_BYTES = 32_768


def visible_text(fragment: Tag) -> str:
    for element in fragment.select('script, style, template, noscript, [hidden], [aria-hidden="true"]'):
        if element.parent is not None:
            element.decompose()
    return " ".join(" ".join(fragment.stripped_strings).split())


def require_element(fragment: Tag, selector: str) -> Tag:
    element = fragment.select_one(selector)
    if element is None:
        raise ValueError(f"Missing public portfolio section: {selector}")
    return element


def portfolio_sources() -> list[dict[str, str]]:
    index = BeautifulSoup((DIST / "index.html").read_text(encoding="utf-8"), "html.parser")
    resume = BeautifulSoup((DIST / "resume.html").read_text(encoding="utf-8"), "html.parser")
    sheet = require_element(resume, "main.sheet")

    sources = []
    for project_id in PROJECT_IDS:
        section = require_element(index, f"section.project-detail#{project_id}")
        sources.append({
            "id": project_id,
            "title": visible_text(require_element(section, "h2")),
            "url": f"{SITE_URL}#{project_id}",
            "text": visible_text(section),
        })

    resume_url = f"{SITE_URL}resume.html"
    sources.append({
        "id": "resume-summary",
        "title": "A4 简历 · 个人简介",
        "url": resume_url,
        "text": " ".join(visible_text(require_element(sheet, selector))
                         for selector in (".identity-copy", ".summary")),
    })
    for name in RESUME_SECTIONS:
        heading_id = f"{name}-heading"
        section = require_element(sheet, f'section[aria-labelledby="{heading_id}"]')
        heading = visible_text(require_element(section, f"#{heading_id}"))
        sources.append({
            "id": f"resume-{name}",
            "title": f"A4 简历 · {heading}",
            "url": f"{resume_url}#{heading_id}",
            "text": visible_text(section),
        })
    return sources


def read_limited_text(file: Path, max_bytes: int) -> str:
    with file.open("rb") as stream:
        content = stream.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise ValueError("Approved document exceeds its size limit")
    return content.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")


def reviewed_file(root: Path, name: str) -> Path:
    if not isinstance(name, str) or "\\" in name or ":" in name:
        raise ValueError("Expected a relative file path")
    relative = PurePosixPath(name)
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        raise ValueError("Expected a relative file path")

    file = root
    for part in relative.parts:
        file = file / part
        if file.is_symlink():
            raise ValueError("Symbolic links are not supported in approved documents")
    resolved = file.resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ValueError("File must be inside the approved document directory")
    return resolved


def public_https_url(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 2_048:
        raise ValueError("Expected a public HTTPS citation URL")
    if "\\" in value or any(character.isspace() or ord(character) < 32 for character in value):
        raise ValueError("Expected a public HTTPS citation URL")
    url = urlsplit(value)
    if url.scheme != "https" or not url.hostname or url.username is not None:
        raise ValueError("Expected a public HTTPS citation URL")
    if url.port == 0:
        raise ValueError("Expected a public HTTPS citation URL")

    host = url.hostname.rstrip(".")
    try:
        address = ip_address(host)
    except ValueError:
        labels = host.encode("idna").decode("ascii").lower().split(".")
        label_pattern = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
        if (len(labels) < 2 or not labels[-1][0:1].isalpha()
                or labels[-1] in {"localhost", "local", "internal", "invalid", "test"}
                or not all(re.fullmatch(label_pattern, label) for label in labels)):
            raise ValueError("Expected a public HTTPS citation URL") from None
    else:
        if not address.is_global or address.is_multicast:
            raise ValueError("Expected a public HTTPS citation URL")
    return value


def approved_notes() -> list[dict[str, str]]:
    directory = environ.get("PORTFOLIO_CHAT_NOTE_DIR")
    if not directory:
        return []

    try:
        root = Path(directory).resolve(strict=True)
        manifest_file = reviewed_file(root, "manifest.json")
        manifest = json.loads(read_limited_text(manifest_file, MAX_MANIFEST_BYTES))
    except (OSError, ValueError):
        raise ValueError("Could not read the approved notes manifest") from None
    if not isinstance(manifest, list) or len(manifest) > MAX_NOTES:
        raise ValueError(f"The approved notes manifest must list up to {MAX_NOTES} documents")

    sources = []
    for index, entry in enumerate(manifest, 1):
        try:
            if not isinstance(entry, dict) or not isinstance(entry.get("title"), str):
                raise ValueError("Expected a document title")
            title = " ".join(entry["title"].split())
            if not title or len(title) > 120:
                raise ValueError("Invalid document title")
            url = public_https_url(entry.get("url"))
            file = reviewed_file(root, entry.get("file"))
            if file.suffix.lower() not in {".md", ".txt"}:
                raise ValueError("Expected a Markdown or text document")
            text = read_limited_text(file, MAX_NOTE_CHARS * 4).strip()
            if not text or len(text) > MAX_NOTE_CHARS or "\x00" in text:
                raise ValueError("Expected a reviewed excerpt within the document size limit")
        except (OSError, ValueError):
            raise ValueError(f"Invalid approved notes manifest entry {index}") from None
        sources.append({"id": f"note-{index}", "title": title, "url": url, "text": text})
    return sources


def load_sources() -> list[dict[str, str]]:
    """Load the public portfolio and only excerpts listed in the approved manifest."""
    return portfolio_sources() + approved_notes()
