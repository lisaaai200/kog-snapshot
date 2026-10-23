import { createHash } from 'node:crypto';

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const TOKEN_PROGRAMS = [TOKEN_PROGRAM, TOKEN_2022_PROGRAM];

const DIGITS = /^[0-9]+$/;

/** Reads the base unit amount of one getProgramAccounts item, or null when it does not count. */
function countedAmount(item, mint) {
  const info = item?.account?.data?.parsed?.info;
  if (item?.account?.data?.parsed?.type !== 'account' || !info) return null;
  if (info.mint !== mint || typeof info.owner !== 'string') return null;
  const raw = info.tokenAmount?.amount;
  if (typeof raw !== 'string' || !DIGITS.test(raw)) return null;
  const amount = BigInt(raw);
  return amount > 0n ? amount : null;
}

/** sha256 in lowercase hex of the lines rank,owner,amount joined by a newline. */
export function snapshotHash(holders) {
  const text = holders.map((h) => `${h.rank},${h.owner},${h.amount}`).join('\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function buildSnapshot({ mint, slot, accounts, exclusions, top = 100 }) {
  if (typeof mint !== 'string' || mint.length === 0) throw new Error('mint is required');
  if (!Array.isArray(accounts)) throw new Error('accounts must be an array');
  if (!Number.isInteger(top) || top < 1) throw new Error('top must be a positive whole number');
  const excludedOwners = new Set(exclusions?.owners ?? []);
  const excludedAccounts = new Set(exclusions?.token_accounts ?? []);

  const seen = new Set();
  const byOwner = new Map();
  for (const item of accounts) {
    const amount = countedAmount(item, mint);
    if (amount === null) continue;
    // The same token account can appear twice if a caller merges answers; count it once.
    if (typeof item.pubkey === 'string') {
      if (seen.has(item.pubkey)) continue;
      seen.add(item.pubkey);
      if (excludedAccounts.has(item.pubkey)) continue;
    }
    const owner = item.account.data.parsed.info.owner;
    if (excludedOwners.has(owner)) continue;
    byOwner.set(owner, (byOwner.get(owner) ?? 0n) + amount);
  }

  const ranked = [...byOwner.entries()].sort((a, b) => {
    if (a[1] !== b[1]) return a[1] > b[1] ? -1 : 1;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  let total = 0n;
  for (const [, amount] of ranked) total += amount;
  const holders = ranked
    .slice(0, top)
    .map(([owner, amount], i) => ({ rank: i + 1, owner, amount: amount.toString() }));
  return { mint, slot, total: total.toString(), holders, hash: snapshotHash(holders) };
}

async function rpcCall(fetchFn, rpcUrl, id, method, params) {
  let res;
  try {
    res = await fetchFn(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
  } catch (err) {
    throw new Error(`RPC request failed: ${err?.message ?? 'network error'}`);
  }
  if (!res.ok) throw new Error(`RPC answered HTTP ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error('RPC answer is not JSON');
  }
  if (body.error) throw new Error(`RPC error ${body.error.code}: ${body.error.message}`);
  return body.result;
}

export async function fetchAccounts({ rpcUrl, mint, minContextSlot, fetch: fetchFn = globalThis.fetch }) {
  if (!rpcUrl) throw new Error('rpcUrl is required');
  if (!mint) throw new Error('mint is required');
  const results = await Promise.all(
    TOKEN_PROGRAMS.map((program, i) => {
      const config = {
        encoding: 'jsonParsed',
        withContext: true,
        filters: [{ memcmp: { offset: 0, bytes: mint } }],
      };
      if (minContextSlot !== undefined) config.minContextSlot = minContextSlot;
      return rpcCall(fetchFn, rpcUrl, i + 1, 'getProgramAccounts', [program, config]);
    }),
  );
  let slot = null;
  const accounts = [];
  for (const result of results) {
    if (!result || !Array.isArray(result.value) || typeof result.context?.slot !== 'number') {
      throw new Error('RPC answer has no context and value');
    }
    slot = slot === null ? result.context.slot : Math.min(slot, result.context.slot);
    accounts.push(...result.value);
  }
  return { slot, accounts };
}
