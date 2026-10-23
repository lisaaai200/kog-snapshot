import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchAccounts, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '../src/index.js';
import { run } from '../src/cli.js';
import { item, MINT } from './helpers.js';

function fakeRpc(slots, values) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const i = body.params[0] === TOKEN_PROGRAM ? 0 : 1;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { context: { slot: slots[i] }, value: values[i] } }));
  };
  return { fetch, calls };
}

test('A6 fetchAccounts sends one getProgramAccounts call per token program and keeps the lowest slot', async () => {
  const { fetch, calls } = fakeRpc([105, 101], [[item('a', 'x', '1')], [item('b', 'y', '2', { program: TOKEN_2022_PROGRAM })]]);
  const out = await fetchAccounts({ rpcUrl: 'https://rpc.example', mint: MINT, fetch });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.body.params[0]).sort(), [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].sort());
  for (const c of calls) {
    assert.equal(c.body.method, 'getProgramAccounts');
    const cfg = c.body.params[1];
    assert.equal(cfg.encoding, 'jsonParsed');
    assert.equal(cfg.withContext, true);
    assert.deepEqual(cfg.filters, [{ memcmp: { offset: 0, bytes: MINT } }]);
  }
  assert.equal(out.slot, 101);
  assert.equal(out.accounts.length, 2);
});

test('A6 fetchAccounts passes minContextSlot and surfaces an RPC error', async () => {
  const { fetch, calls } = fakeRpc([9, 9], [[], []]);
  await fetchAccounts({ rpcUrl: 'https://rpc.example', mint: MINT, minContextSlot: 8, fetch });
  assert.equal(calls[0].body.params[1].minContextSlot, 8);
  const failing = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32010, message: 'excluded from secondary indexes' } }));
  await assert.rejects(fetchAccounts({ rpcUrl: 'https://rpc.example', mint: MINT, fetch: failing }), /RPC error -32010/);
});

function capture() {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: (t) => (out.stdout += t), stderr: (t) => (out.stderr += t) } };
}

test('A6 the CLI writes the snapshot from a recorded fixture with no network', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kog-'));
  const fixture = join(dir, 'fx.json');
  const excl = join(dir, 'ex.json');
  const outFile = join(dir, 'snap.json');
  writeFileSync(fixture, JSON.stringify({ slot: 42, accounts: [item('a', 'alice', '5'), item('b', 'bob', '7')] }));
  writeFileSync(excl, JSON.stringify({ owners: [], token_accounts: [] }));
  const noNetwork = async () => {
    throw new Error('network used');
  };
  const { out, io } = capture();
  const code = await run(['--mint', MINT, '--exclusions', excl, '--fixture', fixture, '--out', outFile], { env: {}, fetch: noNetwork, ...io });
  assert.equal(code, 0, out.stderr);
  const snap = JSON.parse(readFileSync(outFile, 'utf8'));
  assert.equal(snap.slot, 42);
  assert.deepEqual(snap.holders.map((h) => h.owner), ['bob', 'alice']);

  const toStdout = capture();
  assert.equal(await run(['--mint', MINT, '--exclusions', excl, '--fixture', fixture, '--top', '1'], { env: {}, ...toStdout.io }), 0);
  assert.equal(JSON.parse(toStdout.out.stdout).holders.length, 1);
});

test('A6 the CLI saves a fixture from the RPC and never prints the RPC URL', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kog-'));
  const excl = join(dir, 'ex.json');
  const saved = join(dir, 'saved.json');
  writeFileSync(excl, JSON.stringify({ owners: [], token_accounts: [] }));
  const secret = 'https://rpc.example/?api-key=SECRET123';
  const { fetch } = fakeRpc([3, 4], [[item('a', 'alice', '5')], []]);
  const ok = capture();
  assert.equal(await run(['--mint', MINT, '--exclusions', excl, '--save-fixture', saved], { env: { SOLANA_RPC_URL: secret }, fetch, ...ok.io }), 0);
  assert.equal(JSON.parse(readFileSync(saved, 'utf8')).slot, 3);
  assert.ok(!ok.out.stdout.includes('SECRET123'));

  const down = async () => {
    throw new Error(`connect failed to ${secret}`);
  };
  const bad = capture();
  assert.equal(await run(['--mint', MINT, '--exclusions', excl], { env: { SOLANA_RPC_URL: secret }, fetch: down, ...bad.io }), 1);
  assert.match(bad.out.stderr, /RPC request failed/);
  assert.ok(!bad.out.stderr.includes('SECRET123'));
});

test('A6 the CLI exits 1 with a plain message on bad input', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kog-'));
  const excl = join(dir, 'ex.json');
  writeFileSync(excl, '{}');
  const cases = [
    [['--exclusions', excl, '--fixture', excl], /missing --mint/],
    [['--mint', MINT, '--exclusions', join(dir, 'nope.json'), '--fixture', excl], /cannot read exclusions file/],
    [['--mint', MINT, '--exclusions', excl, '--fixture', join(dir, 'nope.json')], /cannot read fixture file/],
    [['--mint', MINT, '--exclusions', excl, '--top', 'ten', '--fixture', excl], /--top must be a whole number/],
    [['--mint', MINT, '--exclusions', excl], /set SOLANA_RPC_URL or pass --fixture/],
  ];
  for (const [argv, pattern] of cases) {
    const c = capture();
    assert.equal(await run(argv, { env: {}, ...c.io }), 1, argv.join(' '));
    assert.match(c.out.stderr, pattern);
  }
});
