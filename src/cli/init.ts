import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  CONFIG_PATH,
  configExists,
  derivePoolerUrls,
  saveConfig,
  type Config,
} from '../db/config.ts';
import { getClient } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { probe, type ProbeResult } from '../db/probe.ts';

async function ask(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input, output });
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  try {
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || defaultValue || '';
  } finally {
    rl.close();
  }
}

function reportProbe(label: string, result: ProbeResult): void {
  if (result.ok) {
    console.log(`  ✔ ${label} OK (${result.latencyMs}ms)`);
  } else {
    console.log(`  ✘ ${label} FAIL: ${result.error}`);
  }
}

export async function runInit(opts: { force?: boolean } = {}): Promise<void> {
  if (configExists() && !opts.force) {
    console.error(
      `Config already exists at ${CONFIG_PATH}. Use \`memex init --force\` to overwrite.`,
    );
    process.exit(1);
  }

  console.log('memex init');
  console.log(`Will write config to ${CONFIG_PATH}\n`);

  const url = await ask("Supabase pooler URL (either port — we'll derive both)");
  if (!url) {
    console.error('URL is required.');
    process.exit(1);
  }

  let urls;
  try {
    urls = derivePoolerUrls(url);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const providedLabel =
    urls.provided === 'session' ? 'session pooler (:5432)' : 'transaction pooler (:6543)';
  const derivedLabel =
    urls.provided === 'session' ? 'transaction pooler (:6543)' : 'session pooler (:5432)';
  console.log(`\nDetected ${providedLabel}; derived ${derivedLabel}.`);
  console.log('Probing both endpoints...');

  let sessionProbe = await probe(urls.session);
  let transactionProbe = await probe(urls.transaction);
  reportProbe('session pooler    ', sessionProbe);
  reportProbe('transaction pooler', transactionProbe);

  if (!sessionProbe.ok || !transactionProbe.ok) {
    console.log(
      '\nDerivation may be wrong (self-hosted Supabase with non-standard ports). Paste the failing URL explicitly.',
    );

    if (!sessionProbe.ok) {
      const explicit = await ask('Session pooler URL');
      if (!explicit) {
        console.error('Cannot proceed without a working session pooler URL.');
        process.exit(1);
      }
      urls.session = explicit;
      sessionProbe = await probe(urls.session);
      reportProbe('session pooler    ', sessionProbe);
    }
    if (!transactionProbe.ok) {
      const explicit = await ask('Transaction pooler URL');
      if (!explicit) {
        console.error('Cannot proceed without a working transaction pooler URL.');
        process.exit(1);
      }
      urls.transaction = explicit;
      transactionProbe = await probe(urls.transaction);
      reportProbe('transaction pooler', transactionProbe);
    }

    if (!sessionProbe.ok || !transactionProbe.ok) {
      console.error('\n✘ Probe still failing. Aborting.');
      process.exit(1);
    }
  }

  const embedProviderRaw = await ask('Embedding provider (openai / xenova-local)', 'openai');
  if (embedProviderRaw !== 'openai' && embedProviderRaw !== 'xenova-local') {
    console.error(`Invalid embed provider: ${embedProviderRaw}`);
    process.exit(1);
  }
  const embedProvider = embedProviderRaw;

  let openaiApiKey: string | undefined;
  if (embedProvider === 'openai') {
    openaiApiKey = await ask('OPENAI_API_KEY');
    if (!openaiApiKey) {
      console.error('OPENAI_API_KEY is required when embedProvider=openai.');
      process.exit(1);
    }
  }

  const config: Config = {
    supabaseSessionPoolerUrl: urls.session,
    supabaseTransactionPoolerUrl: urls.transaction,
    embedProvider,
    embedModel: 'text-embedding-3-small',
    queryExpansionModel: 'gpt-4o-mini',
    openaiApiKey,
    indexRaw: false,
    multiQueryEnabled: true,
    rrfK: 60,
    defaultSource: null,
  };

  await saveConfig(config);
  console.log(`\n✔ Config written to ${CONFIG_PATH} (mode 0600)`);

  console.log('\nRunning migrations...');
  const sql = await getClient();
  try {
    const migResult = await runMigrations(sql);
    if (migResult.applied.length > 0) {
      console.log(`  ✔ Applied: ${migResult.applied.join(', ')}`);
    }
    if (migResult.skipped.length > 0) {
      console.log(`  ✔ Already applied: ${migResult.skipped.join(', ')}`);
    }
  } catch (err) {
    console.error(`  ✘ Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error('  Config was saved; fix the DB issue and re-run `memex init --force`.');
    process.exit(1);
  } finally {
    await sql.end({ timeout: 1 });
  }

  console.log('\n  Next: register a vault with `memex sources add <name> --path <vault-dir>`');
}
