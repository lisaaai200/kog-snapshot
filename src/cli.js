import { readFile, writeFile } from 'node:fs/promises';
import { buildSnapshot, fetchAccounts } from './index.js';

const USAGE =
  'Usage: kog-snapshot --mint <address> --exclusions <file> [--slot <n>] [--top <n>] [--out <file>] [--fixture <file>] [--save-fixture <file>]\n';
const VALUE_FLAGS = new Set(['--mint', '--exclusions', '--slot', '--top', '--out', '--fixture', '--save-fixture']);

export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!VALUE_FLAGS.has(flag)) throw new Error(`unknown option ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    opts[flag.slice(2)] = value;
    i++;
  }
  if (!opts.mint) throw new Error('missing --mint');
  if (!opts.exclusions) throw new Error('missing --exclusions');
  for (const key of ['slot', 'top']) {
    if (opts[key] !== undefined) {
      if (!/^[0-9]+$/.test(opts[key])) throw new Error(`--${key} must be a whole number`);
      opts[key] = Number(opts[key]);
    }
  }
  return opts;
}

async function readJson(path, what) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new Error(`cannot read ${what} file ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} file ${path} is not valid JSON`);
  }
}

/** Runs the CLI. Returns the exit code. The RPC URL is never printed. */
export async function run(argv, { env = {}, stdout, stderr, fetch } = {}) {
  try {
    const opts = parseArgs(argv);
    const exclusions = await readJson(opts.exclusions, 'exclusions');
    let data;
    if (opts.fixture) {
      data = await readJson(opts.fixture, 'fixture');
      if (!Array.isArray(data?.accounts)) throw new Error(`fixture file ${opts.fixture} has no accounts`);
    } else {
      if (!env.SOLANA_RPC_URL) throw new Error('set SOLANA_RPC_URL or pass --fixture');
      data = await fetchAccounts({ rpcUrl: env.SOLANA_RPC_URL, mint: opts.mint, minContextSlot: opts.slot, fetch });
    }
    if (opts['save-fixture']) await writeFile(opts['save-fixture'], JSON.stringify(data, null, 2) + '\n');
    const snapshot = buildSnapshot({
      mint: opts.mint,
      slot: data.slot ?? opts.slot,
      accounts: data.accounts,
      exclusions,
      top: opts.top,
    });
    const json = JSON.stringify(snapshot, null, 2) + '\n';
    if (opts.out) await writeFile(opts.out, json);
    else stdout(json);
    return 0;
  } catch (err) {
    const message = String(err?.message ?? err);
    const safe = env.SOLANA_RPC_URL ? message.split(env.SOLANA_RPC_URL).join('<rpc>') : message;
    stderr(`kog-snapshot: ${safe}\n`);
    if (/missing --|unknown option|needs a value/.test(safe)) stderr(USAGE);
    return 1;
  }
}
