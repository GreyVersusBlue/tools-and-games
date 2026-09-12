// The packet builder. Ticked chapters in, one printable document out,
// assembled in the browser from the HTML this site already publishes — no
// second copy of any chapter exists anywhere for this to drift from.
//
// What the assembly has to do beyond concatenating:
//
// - **Demote the headings.** Every chapter is a page with its own <h1>. Six of
//   them in one document is six documents. Each chapter's h1 becomes the
//   packet's h2 and everything under it shifts one level, so the packet has a
//   single outline from cover to last page. h5 is the deepest heading any
//   chapter uses, so the shift bottoms out at h6.
// - **Namespace the ids.** Two chapters that both have a "Vitality" heading
//   both carry id="vitality", and in one document the second one is
//   unreachable. Every id gains the chapter's own prefix, and every link that
//   pointed at it is rewritten to match.
// - **Turn cross-chapter links inward.** A link from Core Rules to a chapter
//   that is also in this packet should go to the page in your hand, not to a
//   web address you cannot open in a field.
//
// Page numbering is print.css's: `@page packet` carries a bottom-centre
// counter, which Chromium honours and Firefox ignores. The contents lists
// chapters and not page numbers, because `target-counter()` — the one thing
// that could put a page number beside a contents entry — is in no shipping
// browser.
const doc = document.querySelector("[data-packet-doc]");
const form = document.querySelector("[data-packet-form]");
const notice = document.querySelector("[data-packet-needs-js]");
const countEl = document.querySelector("[data-packet-count]");
const boxes = () => Array.from(document.querySelectorAll("[data-packet-chapter]"));

// packetData in eleventy.config.mjs has already put the path prefix on every
// URL in here, the same way the builder's skill links get theirs.
const packets = JSON.parse(document.getElementById("numina-packets").textContent);

if (form) {
  form.hidden = false;
  if (notice) notice.remove();
}

const slugFor = (url) =>
  url.replace(/^\/|\/$/g, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "page";

function selected() {
  return boxes()
    .filter((box) => box.checked)
    .map((box) => box.value);
}

function updateCount() {
  const n = selected().length;
  countEl.textContent =
    n === 0 ? "Nothing chosen yet." : n === 1 ? "1 chapter chosen." : `${n} chapters chosen.`;
}

// One chapter, cleaned up and renamed. `slugs` maps every URL in this packet to
// its slug, so a link to another included chapter can be turned inward.
function chapterSection(html, url, slugs) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const main = parsed.querySelector("main");
  if (!main) return null;
  const slug = slugs.get(url);

  // The chrome: breadcrumb, contents, the print button, the come-play block,
  // the map, the skill filter, and the two families of § permalink. All of it
  // is navigation for a screen, and none of it belongs on paper.
  main
    .querySelectorAll(".crumb, .toc, .print-action, .come-play, .world-map, .skill-filter, .heading-anchor, .skill-anchor")
    .forEach((el) => el.remove());

  const h1 = main.querySelector("h1");
  const title = h1 ? h1.textContent.trim() : url;
  if (h1) h1.remove();

  // Deepest first, or an h2 promoted to h3 would be shifted again as an h3.
  for (let level = 5; level >= 2; level--) {
    main.querySelectorAll(`h${level}`).forEach((heading) => {
      const replacement = parsed.createElement(`h${level + 1}`);
      for (const attr of Array.from(heading.attributes)) replacement.setAttribute(attr.name, attr.value);
      replacement.innerHTML = heading.innerHTML;
      heading.replaceWith(replacement);
    });
  }

  const renamed = new Map();
  main.querySelectorAll("[id]").forEach((el) => {
    const from = el.id;
    const to = `${slug}--${from}`;
    renamed.set(from, to);
    el.id = to;
  });

  main.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href");
    if (href.startsWith("#")) {
      const to = renamed.get(decodeURIComponent(href.slice(1))) ?? renamed.get(href.slice(1));
      if (to) link.setAttribute("href", `#${to}`);
      return;
    }
    const [path, fragment] = href.split("#");
    const targetSlug = slugs.get(path) ?? slugs.get(`${path}/`);
    if (!targetSlug) return;
    link.setAttribute(
      "href",
      fragment ? `#${targetSlug}--${fragment}` : `#packet-${targetSlug}`
    );
  });

  const section = document.createElement("section");
  section.className = "packet-chapter";
  const heading = document.createElement("h2");
  heading.className = "packet-chapter__title";
  heading.id = `packet-${slug}`;
  heading.textContent = title;
  section.appendChild(heading);
  while (main.firstChild) section.appendChild(document.adoptNode(main.firstChild));
  return { section, title, slug };
}

function cover(name, count) {
  const el = document.createElement("header");
  el.className = "packet-cover";
  const site = document.createElement("p");
  site.className = "packet-cover__site";
  site.textContent = "Numina";
  const title = document.createElement("h2");
  title.className = "packet-cover__title";
  title.textContent = name;
  const note = document.createElement("p");
  note.className = "packet-cover__note";
  note.textContent = `${count} ${count === 1 ? "chapter" : "chapters"} · greyversusblue.com/Numina/`;
  el.append(site, title, note);
  return el;
}

function contents(chapters) {
  const nav = document.createElement("nav");
  nav.className = "packet-contents";
  nav.setAttribute("aria-labelledby", "packet-contents-title");
  const heading = document.createElement("h2");
  heading.id = "packet-contents-title";
  heading.textContent = "Contents";
  const list = document.createElement("ol");
  for (const chapter of chapters) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#packet-${chapter.slug}`;
    link.textContent = chapter.title;
    item.appendChild(link);
    list.appendChild(item);
  }
  nav.append(heading, list);
  return nav;
}

function message(text) {
  doc.textContent = "";
  doc.hidden = false;
  const p = document.createElement("p");
  p.className = "packet-doc__message";
  p.textContent = text;
  doc.appendChild(p);
}

async function assemble(urls, name) {
  if (urls.length === 0) {
    message("Tick at least one chapter, then press Assemble packet.");
    return;
  }
  message("Assembling…");
  const slugs = new Map(urls.map((url) => [url, slugFor(url)]));
  const chapters = [];
  const missing = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      const chapter = chapterSection(await response.text(), url, slugs);
      if (chapter) chapters.push(chapter);
      else missing.push(url);
    } catch {
      missing.push(url);
    }
  }
  doc.textContent = "";
  if (chapters.length === 0) {
    message("None of those chapters could be fetched. If you are offline, open them once while you have signal and try again.");
    return;
  }
  doc.appendChild(cover(name, chapters.length));
  doc.appendChild(contents(chapters));
  for (const chapter of chapters) doc.appendChild(chapter.section);
  if (missing.length) {
    const warning = document.createElement("p");
    warning.className = "packet-doc__message";
    warning.textContent = `${missing.length} chapter${missing.length === 1 ? "" : "s"} could not be fetched and ${missing.length === 1 ? "is" : "are"} not in this packet.`;
    doc.insertBefore(warning, doc.firstChild);
  }
  doc.hidden = false;
  doc.setAttribute("data-chapters", String(chapters.length));
}

// --- wiring -----------------------------------------------------------------

for (const box of boxes()) box.addEventListener("change", updateCount);
updateCount();

document.querySelector("[data-packet-assemble]").addEventListener("click", () => {
  assemble(selected(), "Print Packet");
});
document.querySelector("[data-packet-print]").addEventListener("click", () => {
  if (doc.hidden) assemble(selected(), "Print Packet").then(() => window.print());
  else window.print();
});
document.querySelector("[data-packet-clear]").addEventListener("click", () => {
  for (const box of boxes()) box.checked = false;
  doc.textContent = "";
  doc.hidden = true;
  doc.removeAttribute("data-chapters");
  updateCount();
});

// A prebuilt packet is ?p=<id>. It ticks the same boxes a reader would have
// ticked and assembles straight away, so the link a staffer sends opens on the
// packet rather than on the form.
const preset = new URLSearchParams(location.search).get("p");
if (preset) {
  const packet = packets.find((p) => p.id === preset && Array.isArray(p.chapters));
  if (packet) {
    const wanted = new Set(packet.chapters);
    for (const box of boxes()) box.checked = wanted.has(box.value);
    updateCount();
    assemble(
      boxes().filter((box) => box.checked).map((box) => box.value),
      packet.name
    );
  }
}

// --- the offline kit's controls ---------------------------------------------

const status = document.querySelector("[data-offline-status]");
const checkButton = document.querySelector("[data-offline-check]");
const updateButton = document.querySelector("[data-offline-update]");
const offline = window.numinaOffline;

if (!offline || !offline.supported) {
  status.textContent = "This browser cannot keep an offline copy of the site.";
  checkButton.hidden = true;
} else {
  offline.subscribe((state) => {
    if (state.updateReady) {
      status.textContent = `A newer build is ready. This device has build ${state.version ?? "unknown"}.`;
      updateButton.hidden = false;
    } else if (state.saved) {
      status.textContent = `This device has build ${state.version} saved and will open Numina with no signal.`;
      updateButton.hidden = true;
    } else {
      status.textContent = "Saving a copy to this device. Leave the page open for a moment.";
      updateButton.hidden = true;
    }
  });
  checkButton.addEventListener("click", () => {
    checkButton.disabled = true;
    status.textContent = "Checking…";
    offline.check().then((state) => {
      checkButton.disabled = false;
      if (!state.updateReady) {
        status.textContent = state.saved
          ? `This device has the newest build, ${state.version}.`
          : "Nothing is saved on this device yet.";
      }
    });
  });
  updateButton.addEventListener("click", () => {
    updateButton.disabled = true;
    status.textContent = "Updating…";
    offline.update();
  });
}
