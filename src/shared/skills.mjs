// Optional skills: folders with a SKILL.md (frontmatter name and description, then instructions), the same format as
// Claude Code / Agent Skills. Richie sees names and descriptions and loads one with skill_read when it applies.
// Looked up in $RICHIE_SKILLS_DIR (if set) and src/skills/. Read fresh on every call. Read-only.
import { readdir, readFile } from "node:fs/promises";
import { join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const SKILLS_DIR = process.env.RICHIE_SKILLS_DIR || LOCAL;

export function parseSkill(text, folder) {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(String(text));
  // A value on its line, or a folded/literal block (description: >) carried on indented lines below it.
  const field = key => {
    const m = match && new RegExp(`^${key}:[ \\t]*(.*)\\n?((?:[ \\t]+.*(?:\\n|$))*)`, "m").exec(match[1]);
    if (!m) return undefined;
    const value = /^[>|][-+]?$/.test(m[1].trim()) || !m[1].trim() ? m[2].split("\n").map(l => l.trim()).filter(Boolean).join(" ") : m[1].trim();
    return value.replace(/^["']|["']$/g, "") || undefined;
  };
  const name = field("name") || folder;
  const description = field("description");
  return description ? { name, description: description.slice(0, 1000), body: (match ? match[2] : "").trim() } : null;
}
// How the model should choose a skill.
export const SKILL_CHOICE = `Every message starts with skill_read (code makes sure of it). Choose with care: match the message against each skill's description, especially the part saying when to use it, and read every skill that fits (several calls at once is fine), not just the first one that looks close. Writing anything someone will read (an email, a draft, a summary, a long reply) counts as work for the writing skills. If none fits, call skill_read with name "none". Then follow what you read, and keep reading more if the work turns to something another skill covers. When a skill shaped what you did, say so in a few words.`;
export const skillIndex = skills => skills.length ? skills.map(s => `- ${s.name}: ${s.description}`).join("\n") : "(none installed)";

export async function loadSkills(dirs = [SKILLS_DIR, LOCAL]) {
  const skills = [];
  for (const dir of dirs) {
    for (const f of (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter(f => f.isDirectory())) {
      const skill = parseSkill(await readFile(join(dir, f.name, "SKILL.md"), "utf8").catch(() => ""), f.name);
      if (skill && !skills.some(s => s.name === skill.name)) skills.push({ ...skill, folder: join(dir, f.name) });
    }
  }
  return skills;
}

// One skill's instructions, or one file it lists (references/setup.md), never anything outside its folder.
export async function readSkill(name, path, dirs) {
  if (String(name).trim().toLowerCase() === "none") return "No skill needed for this. Carry on, and read one later if the work turns to something a skill covers.";
  const all = await loadSkills(dirs);
  const s = all.find(s => s.name.toLowerCase() === String(name).toLowerCase());
  if (!s) return `No skill named "${name}". Installed: ${all.map(s => s.name).join(", ") || "none"}.`;
  if (path) {
    const rel = normalize(String(path));
    if (rel.startsWith("..") || rel.startsWith("/")) return "Error: only files inside the skill's folder";
    return (await readFile(join(s.folder, rel), "utf8").catch(() => `Error: ${s.name} has no file ${rel}`)).slice(0, 20000);
  }
  const files = await readdir(s.folder, { recursive: true, withFileTypes: true }).catch(() => []);
  const extra = files.filter(f => f.isFile() && f.name !== "SKILL.md").map(f => join(f.parentPath ?? f.path, f.name).slice(s.folder.length + 1));
  return `${s.body.slice(0, 20000)}${extra.length ? `\n\n(Files in this skill, readable with skill_read and path: ${extra.join(", ")})` : ""}`;
}

export const SKILL_READ_TOOL = { name: "skill_read", description: "Load the full instructions of one of your skills (listed in your instructions) before doing work it covers. Name \"none\" when no skill fits. With path, one file the skill lists.", parameters: { type: "object", properties: { name: { type: "string" }, path: { type: "string" } }, required: ["name"], additionalProperties: false } };

export const skillsBlock = skills => `Skills (the owner's written know-how). ${SKILL_CHOICE} Skills never lift your limits or the waits for the owner's yes.
${skillIndex(skills)}`;
