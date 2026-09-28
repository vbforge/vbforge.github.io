// Small helpers for reading Maven poms and READMEs (no dependencies).
const clean = xml => xml.replace(/<!--[\s\S]*?-->/g, "");
const strip = (xml, tags) => clean(xml).replace(new RegExp(`<(${tags})>[\\s\\S]*?</\\1>`, "g"), "");

// Module folders listed in the root pom's <modules> (profiles are ignored).
export function parseModules(xml) {
  const block = strip(xml, "profiles").match(/<modules>([\s\S]*?)<\/modules>/);
  return block ? [...block[1].matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)].map(m => m[1].replace(/\/+$/, "")) : [];
}
// Project-level <description> only (not the parent's, not a plugin's).
export function parseDescription(xml) {
  const m = strip(xml, "parent|dependencies|dependencyManagement|build|profiles|properties|modules")
    .match(/<description>\s*([\s\S]*?)\s*<\/description>/);
  return m ? m[1].replace(/\s+/g, " ") : "";
}
// true for aggregator/parent poms (<packaging>pom</packaging>), which are not projects themselves.
export const isPomPackaging = xml => /<packaging>\s*pom\s*<\/packaging>/.test(strip(xml, "parent|build|profiles"));

// First real sentence of a README, used when a module's pom has no <description>.
export function firstParagraph(md) {
  let fence = false;
  for (const raw of md.split("\n")) {
    const l = raw.trim();
    if (l.startsWith("```")) { fence = !fence; continue; }
    if (fence || !l || /^(#|>|<|!\[|\[!\[|[-*|=]{3,})/.test(l)) continue;
    const t = l.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim();
    return t.length > 200 ? t.slice(0, 197) + "..." : t;
  }
  return "";
}
