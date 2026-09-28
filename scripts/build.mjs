// Builds data/projects.json from your GitHub repos. No npm dependencies (Node 20+).
import fs from "node:fs";
import { parseModules, parseDescription, isPomPackaging, firstParagraph } from "./pom.mjs";

const cfg = JSON.parse(fs.readFileSync("projects.config.json", "utf8"));
const H = {
  Accept: "application/vnd.github+json",
  "User-Agent": "portfolio-build",
  ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
};
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com${path}`, { headers: H, ...opts });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r;
}
async function raw(repo, branch, path) {
  const r = await fetch(`https://raw.githubusercontent.com/${cfg.user}/${repo}/${branch}/${path}`);
  return r.ok ? r.text() : null;
}

// Markdown -> HTML via GitHub's own renderer, then make relative links/images absolute.
async function render(md, repo, branch, dir) {
  const r = await gh("/markdown", {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ text: md, mode: "gfm", context: `${cfg.user}/${repo}` }),
  });
  const html = await r.text();
  return html.replace(/\b(src|href)="(?!https?:|#|mailto:|\/\/|data:)([^"]+)"/g, (m, attr, u) => {
    const base = u.startsWith("/") || !dir ? "https://x/" : `https://x/${dir}/`;
    const p = new URL(u.replace(/^\//, ""), base).pathname.slice(1);
    return attr === "src"
      ? `src="https://raw.githubusercontent.com/${cfg.user}/${repo}/${branch}/${p}"`
      : `href="https://github.com/${cfg.user}/${repo}/blob/${branch}/${p}"`;
  });
}

const list = await (await gh(`/users/${cfg.user}/repos?per_page=100&sort=pushed`)).json();
const repos = list.filter(r => !(cfg.hideForks && r.fork) && !(cfg.exclude || []).includes(r.name));

const out = [];
for (const r of repos) {
  const b = r.default_branch;
  console.log("Processing", r.name);

  const rd = await (await gh(`/repos/${cfg.user}/${r.name}/readme`))?.json();
  const md = rd ? Buffer.from(rd.content, "base64").toString("utf8") : "";

  // Optional: a portfolio.json at the repo root lists the projects inside this repo.
  let manifest = null;
  try { manifest = JSON.parse((await raw(r.name, b, "portfolio.json")) || "null"); } catch { console.warn("  bad portfolio.json"); }

  // Sub-projects: entries listed in portfolio.json, plus (optionally) Maven modules found in the root pom.xml.
  const specs = (manifest?.projects || []).map(s => ({ ...s, id: slug(s.name || s.path) }));
  if (manifest?.autoModules === true || (cfg.autoModules || []).includes(r.name)) {
    const pom = await raw(r.name, b, "pom.xml");
    if (!pom) console.warn("  autoModules is on but there is no root pom.xml");
    const skip = manifest?.exclude || [];
    for (const path of parseModules(pom || "")) {
      const base = path.split("/").pop();
      if (path.includes("..") || skip.includes(path) || skip.includes(base) || specs.some(s => s.path === path)) continue;
      const mpom = (await raw(r.name, b, `${path}/pom.xml`)) || "";
      if (isPomPackaging(mpom)) continue;
      specs.push({ name: base, path, description: parseDescription(mpom), id: slug(path) });
    }
  }

  const projects = [];
  for (const s of specs) {
    const smd = (await raw(r.name, b, `${s.path}/README.md`)) || "";
    projects.push({
      id: s.id,
      name: s.name || s.path,
      path: s.path,
      description: s.description || firstParagraph(smd),
      topics: s.topics || [],
      url: `${r.html_url}/tree/${b}/${s.path}`,
      readme: smd ? await render(smd, r.name, b, s.path) : "",
    });
  }

  out.push({
    name: r.name,
    description: r.description || manifest?.description || "",
    language: r.language,
    stars: r.stargazers_count,
    pushed: r.pushed_at,
    topics: r.topics || [],
    url: r.html_url,
    homepage: r.homepage || "",
    featured: false,
    readme: md ? await render(md, r.name, b, "") : "",
    projects,
  });
}

// Featured: names in projects.config.json (in that order), plus any repo with the "featured" topic.
const feat = (cfg.featured || []).map(n => out.find(r => r.name === n)).filter(Boolean);
for (const r of out) if (r.topics.includes("featured") && !feat.includes(r)) feat.push(r);
feat.forEach(r => (r.featured = true));

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync(
  "data/projects.json",
  JSON.stringify({ user: cfg.user, tagline: cfg.tagline || "", repos: [...feat, ...out.filter(r => !r.featured)] })
);
console.log(`Wrote ${out.length} repos`);
