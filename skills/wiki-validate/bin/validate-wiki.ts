#!/usr/bin/env bun
// validate-wiki.ts — check a wiki vault's pages against its wiki.schema.json.
//
// Reads the markdown files on disk directly — no database, no `memex sync`, no
// memex install required. The vault's markdown is the source of truth; this
// just checks it conforms to the contract the vault declares for itself.
//
// Usage:  bun validate-wiki.ts <vault-path> [--strict]
//   <vault-path>  vault root (the dir containing wiki.schema.json). Default: "."
//   --strict      force strict mode (non-zero exit on any strict violation),
//                 overriding the schema's own "strict" flag.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

interface TypeRule {
  frontmatter: { required: string[]; enums: Record<string, string[]> };
  sections: { required: string[]; optional: string[] };
}
interface WikiSchema {
  version: number;
  strict: boolean;
  structure: { raw: string[]; wiki: string[] };
  types: Record<string, TypeRule>;
  citation: {
    require_sources_frontmatter: boolean;
    allow_inferred_in_wiki: boolean;
    require_supersedes_pair: boolean;
  };
}

type Severity = 'strict' | 'lint';
interface Issue {
  path: string;
  severity: Severity;
  message: string;
}

// ── args ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const strictFlag = argv.includes('--strict');
const vaultPath = argv.find((a) => !a.startsWith('--')) ?? '.';

// ── load + sanity-check the schema ─────────────────────────────────────────
const schemaPath = join(vaultPath, 'wiki.schema.json');
if (!existsSync(schemaPath)) {
  // Unconfigured is not a failure — a vault without wiki.schema.json simply has
  // no contract to check against.
  console.log(`No wiki.schema.json at ${schemaPath} — nothing to validate against.`);
  console.log('Scaffold one with the wiki-init skill, or add the file by hand.');
  process.exit(0);
}

let schema: WikiSchema;
try {
  schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as WikiSchema;
  if (!schema.types || !schema.structure || !schema.citation) {
    throw new Error('missing one of: types, structure, citation');
  }
} catch (err) {
  console.error(
    `✘ wiki.schema.json is invalid: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}

const effectiveStrict = strictFlag || schema.strict === true;

// ── walk wiki/ ─────────────────────────────────────────────────────────────
const wikiRoot = join(vaultPath, 'wiki');
if (!existsSync(wikiRoot)) {
  console.error(`✘ No wiki/ directory at ${wikiRoot} — is this a wiki vault?`);
  process.exit(1);
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(full);
  }
}
const files: string[] = [];
walk(wikiRoot, files);
files.sort();

// ── zero-dep frontmatter parsing (handles the simple wiki-page shape) ──────
interface Parsed {
  relPath: string;
  slug: string;
  /** every top-level frontmatter key seen (covers block values too) */
  fmKeys: Set<string>;
  /** key → trimmed scalar value, for single-line `key: value` entries only */
  fmScalar: Map<string, string>;
  body: string;
}

/** Mirror of memex's normalizeSlug: drop `.md`, drop a leading `wiki/`. */
function normalizeSlug(s: string): string {
  let n = s.trim().replace(/\.md$/i, '');
  if (n.startsWith('wiki/')) n = n.slice('wiki/'.length);
  return n;
}

/** Resolve a frontmatter ref: `[[decisions/x]]`, `[[x|alias]]`, `x`, `[a, b]`. */
function normalizeRef(raw: string): string | null {
  let v = raw.trim();
  if (!v) return null;
  if (v.startsWith('[') && !v.startsWith('[[')) {
    v = (v.replace(/^\[|\]$/g, '').split(',')[0] ?? '').trim();
    if (!v) return null;
  }
  const m = v.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
  return normalizeSlug(m && m[1] ? m[1] : v);
}

function parseFile(full: string): Parsed {
  const relPath = relative(vaultPath, full).split(sep).join('/');
  const slug = normalizeSlug(relPath);
  const content = readFileSync(full, 'utf8');

  const fmKeys = new Set<string>();
  const fmScalar = new Map<string, string>();
  let body = content;

  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    body = content.slice(fm[0].length);
    for (const line of fm[1]!.split(/\r?\n/)) {
      // top-level `key: value` only — indented lines belong to block values
      if (/^\s/.test(line) || !line.trim()) continue;
      const km = line.match(/^([^:#][^:]*?):\s*(.*)$/);
      if (!km) continue;
      const key = km[1]!.trim();
      // strip a trailing ` # comment` so it doesn't pollute enum checks
      const val = (km[2] ?? '').replace(/\s+#.*$/, '').trim();
      fmKeys.add(key);
      if (val) fmScalar.set(key, val);
    }
  }
  return { relPath, slug, fmKeys, fmScalar, body };
}

const parsed = files.map(parseFile);
const slugMap = new Map<string, Parsed>();
for (const p of parsed) slugMap.set(p.slug, p);

// ── checks ─────────────────────────────────────────────────────────────────
const knownTypes = new Set(Object.keys(schema.types));
const wikiDirs = new Set(schema.structure.wiki);
const issues: Issue[] = [];

for (const p of parsed) {
  // ── Structure: a wiki/ page must live in a declared subdir ──────────────
  const segs = p.relPath.split('/');
  if (segs[0] === 'wiki') {
    const dir = segs.length >= 3 ? segs[1]! : null;
    if (dir === null) {
      issues.push({ path: p.relPath, severity: 'strict', message: 'not inside a declared wiki/ subdir' });
    } else if (!wikiDirs.has(dir)) {
      issues.push({
        path: p.relPath,
        severity: 'strict',
        message: `wiki/ subdir "${dir}" not declared in structure.wiki`,
      });
    }
  }

  // ── Type: present and one the schema defines rules for ──────────────────
  const type = p.fmScalar.get('type');
  if (!type) {
    issues.push({ path: p.relPath, severity: 'strict', message: 'missing "type:" in frontmatter' });
    continue; // no type → no rule set → skip the rest
  }
  if (!knownTypes.has(type)) {
    issues.push({
      path: p.relPath,
      severity: 'strict',
      message: `unknown type "${type}" — not defined in wiki.schema.json`,
    });
    continue;
  }
  const rules = schema.types[type]!;

  // ── Frontmatter: required keys present ──────────────────────────────────
  for (const key of rules.frontmatter.required) {
    if (!p.fmKeys.has(key)) {
      issues.push({
        path: p.relPath,
        severity: 'strict',
        message: `missing required frontmatter key "${key}"`,
      });
    }
  }

  // ── Frontmatter: enum values valid ──────────────────────────────────────
  for (const [key, allowed] of Object.entries(rules.frontmatter.enums)) {
    const v = p.fmScalar.get(key);
    if (v !== undefined && !allowed.includes(v)) {
      issues.push({
        path: p.relPath,
        severity: 'strict',
        message: `invalid ${key}: "${v}" — allowed: ${allowed.join(' | ')}`,
      });
    }
  }

  // ── Body sections: required headings present (lint only) ────────────────
  const headings = new Set<string>();
  for (const m of p.body.matchAll(/^##\s+(.+?)\s*$/gm)) {
    headings.add(m[1]!.trim().toLowerCase());
  }
  for (const section of rules.sections.required) {
    if (!headings.has(section.trim().toLowerCase())) {
      issues.push({
        path: p.relPath,
        severity: 'lint',
        message: `missing recommended section "## ${section}"`,
      });
    }
  }

  // ── Citation: page-level provenance ─────────────────────────────────────
  if (schema.citation.require_sources_frontmatter) {
    const hasSources = p.fmKeys.has('sources') && p.fmScalar.get('sources') !== '[]';
    if (!hasSources) {
      issues.push({
        path: p.relPath,
        severity: 'strict',
        message: 'missing "sources:" in frontmatter (page-level provenance)',
      });
    }
  }

  // ── Citation: no [Inferred] markers in wiki/ ────────────────────────────
  if (!schema.citation.allow_inferred_in_wiki && p.body.includes('[Inferred')) {
    issues.push({
      path: p.relPath,
      severity: 'strict',
      message: '"[Inferred ...]" marker not allowed in wiki/ pages',
    });
  }

  // ── Citation: supersession edges are symmetric ──────────────────────────
  if (schema.citation.require_supersedes_pair && p.fmScalar.has('supersedes')) {
    const targetSlug = normalizeRef(p.fmScalar.get('supersedes')!);
    if (targetSlug) {
      const target = slugMap.get(targetSlug);
      if (!target) {
        issues.push({
          path: p.relPath,
          severity: 'strict',
          message: `supersedes "${targetSlug}" but no such page in the vault`,
        });
      } else {
        const back = target.fmScalar.has('superseded_by')
          ? normalizeRef(target.fmScalar.get('superseded_by')!)
          : null;
        if (back !== p.slug) {
          issues.push({
            path: p.relPath,
            severity: 'strict',
            message:
              `supersedes "${targetSlug}" but that page's superseded_by is ` +
              `"${back ?? 'null'}" (asymmetric)`,
          });
        }
      }
    }
  }
}

// ── report ─────────────────────────────────────────────────────────────────
const strictIssues = issues.filter((i) => i.severity === 'strict');
const lintIssues = issues.filter((i) => i.severity === 'lint');

console.log(`Validating ${vaultPath}/wiki/ against wiki.schema.json`);
console.log(
  `  ${parsed.length} wiki page(s) checked  ` +
    `(mode: ${effectiveStrict ? 'strict — violations fail' : 'informational'})`,
);
console.log();

if (strictIssues.length === 0) {
  console.log('  ✔ 0 strict violations');
} else {
  console.log(`  ✘ ${strictIssues.length} strict violation(s):`);
  for (const i of strictIssues) console.log(`    - ${i.path}: ${i.message}`);
}
if (lintIssues.length === 0) {
  console.log('  ✔ 0 lint warnings');
} else {
  console.log(`  ⚠ ${lintIssues.length} lint warning(s):`);
  for (const i of lintIssues) console.log(`    - ${i.path}: ${i.message}`);
}

if (parsed.length === 0) {
  console.log();
  console.log('  (no .md files under wiki/ yet — nothing to check)');
}

if (effectiveStrict && strictIssues.length > 0) {
  console.log();
  console.log(`✘ ${strictIssues.length} strict violation(s) — failing (strict mode).`);
  process.exit(1);
}
process.exit(0);
