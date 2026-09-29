// Builds data/projects.json from your GitHub repos. No npm dependencies (Node 20+).
import fs from "node:fs";
import { parseModules, parseDescription, isPomPackaging, firstParagraph } from "./pom.mjs";

const cfg = JSON.parse(fs.readFileSync("projects.config.json", "utf8"));
const H = {
  Accept: "application/vnd.github+json",
  "User-Agent": "portfolio-build",
  ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
};
// #tags from portfolio.json: trim, drop a leading "#", lower-case, spaces -> "-", no duplicates
const tagsOf = a => [...new Set((Array.isArray(a) ? a : []).map(t => String(t).trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-")).filter(Boolean))];
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com${path}`, { headers: H, ...opts });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r;
}
async function raw(repo, branch, path) {
  const r = await fetch(`https://raw.githubusercontent.com/${cfg.user}/${repo}/${branch}/${path}?nocache=${Date.now()}`);
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
// The profile README repo (<user>/<user>) and the site repo (<user>.github.io) are never projects.
const always = [cfg.user, `${cfg.user}.github.io`].map(n => n.toLowerCase());
const skip = [...always, ...(cfg.exclude || []).map(n => n.toLowerCase())];
const repos = list.filter(r => !(cfg.hideForks && r.fork) && !skip.includes(r.name.toLowerCase()));

const out = [];
for (const r of repos) {
  const b = r.default_branch;
  const languages = (await (await gh(`/repos/${cfg.user}/${r.name}/languages`))?.json()) || {};
  console.log("Processing", r.name);

  const rd = await (await gh(`/repos/${cfg.user}/${r.name}/readme`))?.json();
  const md = rd ? Buffer.from(rd.content, "base64").toString("utf8") : "";

  // Per-repo settings: portfolio.json in that repo's root wins over the "repos" entry in projects.config.json.
  let own = null;
  try { own = JSON.parse((await raw(r.name, b, "portfolio.json")) || "null"); } catch { console.warn("  bad portfolio.json"); }
  if (own?.repos) { // tolerate the hub-config shape ("repos": { "<name>": {...} }) inside a project repo
    console.log('  portfolio.json has a "repos" wrapper; using its entry for this repo');
    own = own.repos[r.name] || {};
  }
  const manifest = { ...(cfg.repos?.[r.name] || {}), ...(own || {}) };
  const rootPom = await raw(r.name, b, "pom.xml");
  console.log(`  portfolio.json: ${own ? "found" : "not found"}${manifest.autoModules ? ", autoModules on" : ""}; root pom lists ${parseModules(rootPom || "").length} modules`);

  // Sub-projects: entries listed in portfolio.json, plus (optionally) Maven modules found in the root pom.xml.
  const specs = (manifest?.projects || []).map(s => ({ ...s, id: slug(s.name || s.path) }));
  if (manifest?.autoModules === true || (cfg.autoModules || []).includes(r.name)) {
    const pom = rootPom;
    if (!pom) console.warn("  autoModules is on but there is no root pom.xml");
    const skip = manifest?.exclude || [];
    for (const path of parseModules(pom || "")) {
      const base = path.split("/").pop();
      if (path.includes("..") || skip.includes(path) || skip.includes(base) || specs.some(s => s.path === path)) continue;
      const mpom = (await raw(r.name, b, `${path}/pom.xml`)) || "";
      if (isPomPackaging(mpom)) continue;
      specs.push({ name: base, path, description: parseDescription(mpom), id: slug(path) });
    }
  } else if (parseModules(rootPom || "").length > 1) {
    console.log(`  hint: looks multi-module (${parseModules(rootPom).length} modules). To list them, add "${r.name}" to "autoModules" in projects.config.json.`);
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
      tags: tagsOf([...(s.tags || []), ...(s.topics || [])]),
      url: `${r.html_url}/tree/${b}/${s.path}`,
      readme: smd ? await render(smd, r.name, b, s.path) : "",
    });
  }

  out.push({
    name: r.name,
    description: r.description || manifest?.description || firstParagraph(md),
    language: r.language,
    stars: r.stargazers_count,
    pushed: r.pushed_at,
    created: r.created_at,
    languages,
    topics: r.topics || [],
    tags: tagsOf(manifest.tags),
    url: r.html_url,
    homepage: r.homepage || "",
    featured: false,
    readme: md ? await render(md, r.name, b, "") : "",
    projects,
  });
}

for (const n of [...(cfg.autoModules || []), ...(cfg.featured || []), ...Object.keys(cfg.repos || {})])
  if (!out.some(r => r.name === n)) console.warn(`WARNING: "${n}" in projects.config.json matches no listed repo. Check the exact name (public, not a fork).`);
for (const r of out) console.log(`${r.name}: ${r.projects.length} modules`);

// Featured: names in projects.config.json (in that order), plus any repo with the "featured" topic.
const feat = (cfg.featured || []).map(n => out.find(r => r.name === n)).filter(Boolean);
for (const r of out) if ((r.topics.includes("featured") || r.tags.includes("featured")) && !feat.includes(r)) feat.push(r);
feat.forEach(r => (r.featured = true));

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync(
  "data/projects.json",
  JSON.stringify({ user: cfg.user, tagline: cfg.tagline || "", repos: [...feat, ...out.filter(r => !r.featured)] })
);
console.log(`Wrote ${out.length} repos`);
