#!/usr/bin/env bun
import { Command } from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import { runInit } from './init.ts';
import { runDoctor } from './doctor.ts';
import { sourcesAdd, sourcesList, sourcesRemove } from './sources.ts';
import { runSync } from './sync.ts';
import { runGet } from './get.ts';
import { runList } from './list.ts';
import { runBacklinks } from './backlinks.ts';
import { runSearch } from './search.ts';
import { runQuery } from './query.ts';
import {
  runConflictsList,
  runConflictsResolve,
  runConflictsShow,
} from './conflicts.ts';
import { runServe } from './serve.ts';

const program = new Command();

program
  .name('memex')
  .description('Multi-source CLI + MCP server for Obsidian-shaped markdown vaults')
  .version(pkg.version);

program
  .command('init')
  .description('Interactive setup: prompts for Supabase URL, probes, writes ~/.memex/config.json, runs migrations')
  .option('--force', 'overwrite existing config')
  .action(async (opts: { force?: boolean }) => {
    await runInit({ force: !!opts.force });
  });

program
  .command('doctor')
  .description('Check connection to Supabase; with --source, also report broken wikilinks + orphans')
  .option('--source <name>', 'run per-source checks (broken wikilinks, orphan pages)')
  .action(async (opts: { source?: string }) => {
    await runDoctor(opts);
  });

const sources = program
  .command('sources')
  .description('Manage registered vaults');

sources
  .command('add <name>')
  .description('Register a vault on this host')
  .requiredOption('--path <dir>', 'path to vault directory')
  .action(async (name: string, opts: { path: string }) => {
    await sourcesAdd(name, opts);
  });

sources
  .command('list')
  .description('List registered vaults (with this host\'s mount paths)')
  .action(async () => {
    await sourcesList();
  });

sources
  .command('remove <name>')
  .description('Unregister a vault and drop its DB rows (cascades pages/chunks/links/tags)')
  .option('--force', 'skip confirmation')
  .action(async (name: string, opts: { force?: boolean }) => {
    await sourcesRemove(name, opts);
  });

program
  .command('sync')
  .description('Walk a vault, parse every .md, upsert pages into Supabase')
  .option('--source <name>', 'sync a single source (default: every registered source)')
  .option('--full', 'skip hash-skip optimization; reparse every file')
  .action(async (opts: { source?: string; full?: boolean }) => {
    await runSync(opts);
  });

program
  .command('get <slug>')
  .description('Fetch one page by slug (e.g. decisions/cart-singleton-keyed-by-authid)')
  .requiredOption('--source <name>', 'source name (required — slug is not unique across sources)')
  .action(async (slug: string, opts: { source: string }) => {
    await runGet(slug, opts);
  });

program
  .command('list')
  .description('List pages, optionally filtered by source/type')
  .option('--source <name>', 'restrict to one source (default: all registered)')
  .option('--type <type>', 'restrict to one type (decision | flow | bug | concept | feature | session | other)')
  .action(async (opts: { source?: string; type?: string }) => {
    await runList(opts);
  });

program
  .command('backlinks <slug>')
  .description('List inbound wikilinks pointing at <slug> (default: federated across all sources)')
  .option('--source <name>', 'restrict to one source')
  .action(async (slug: string, opts: { source?: string }) => {
    await runBacklinks(slug, opts);
  });

program
  .command('search <query>')
  .description('Keyword search over page bodies; supports "phrases", OR, and -exclusions')
  .option('--source <name>', 'restrict to one source (default: all registered)')
  .option('--top-k <n>', 'maximum number of results (default: 10)', (v) => parseInt(v, 10))
  .action(async (query: string, opts: { source?: string; topK?: number }) => {
    await runSearch(query, opts);
  });

program
  .command('query <query>')
  .description(
    'Hybrid retrieval: vector + keyword + RRF fusion + cosine re-rank + backlink boost. ' +
      'Source-scoped queries also get GPT query expansion.',
  )
  .option('--source <name>', 'restrict to one source (enables query expansion)')
  .option('--top-k <n>', 'maximum number of results (default: 10)', (v) => parseInt(v, 10))
  .option('--no-expand', 'disable query expansion even for source-scoped queries')
  .action(async (
    query: string,
    opts: { source?: string; topK?: number; expand?: boolean },
  ) => {
    // commander's --no-expand pattern populates opts.expand=false when set.
    await runQuery(query, {
      ...(opts.source !== undefined ? { source: opts.source } : {}),
      ...(opts.topK !== undefined ? { topK: opts.topK } : {}),
      ...(opts.expand === false ? { noExpand: true } : {}),
    });
  });

const conflicts = program
  .command('conflicts')
  .description('Inspect and resolve concurrent-edit conflicts (PRD §17 decision 13)');

conflicts
  .command('list')
  .description('List open conflicts (default: federated across all sources)')
  .option('--source <name>', 'restrict to one source')
  .action(async (opts: { source?: string }) => {
    await runConflictsList(opts);
  });

conflicts
  .command('show <id>')
  .description('Show the loser body + frontmatter for a conflict, plus version metadata')
  .action(async (id: string) => {
    await runConflictsShow(id);
  });

conflicts
  .command('resolve <id>')
  .description('Mark a conflict resolved (you should have already edited the source page to merge)')
  .option('--note <text>', 'free-text resolution note')
  .action(async (id: string, opts: { note?: string }) => {
    await runConflictsResolve(id, opts);
  });

program
  .command('serve')
  .description('Run as a server. Currently only supports --mcp (stdio MCP server for Claude Code).')
  .option('--mcp', 'run as an MCP stdio server')
  .action(async (opts: { mcp?: boolean }) => {
    await runServe(opts);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
