import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSnapshot, snapshotHash, TOKEN_2022_PROGRAM } from '../src/index.js';
import { item, MINT, NONE } from './helpers.js';

test('A1 accounts are grouped by owner across both token programs; other mints, zero balances and non accounts are ignored', () => {
  const accounts = [
    item('ta1', 'alice', '100'),
    item('ta2', 'alice', '50', { program: TOKEN_2022_PROGRAM }),
    item('ta3', 'bob', '120'),
    item('ta4', 'carol', '999', { mint: 'OtherMint' }),
    item('ta5', 'dave', '0'),
    item('ta6', 'erin', '500', { type: 'mint' }),
    { pubkey: 'junk', account: { owner: 'x', data: ['AAAA', 'base64'] } },
  ];
  const snap = buildSnapshot({ mint: MINT, slot: 7, accounts, exclusions: NONE });
  assert.deepEqual(snap.holders, [
    { rank: 1, owner: 'alice', amount: '150' },
    { rank: 2, owner: 'bob', amount: '120' },
  ]);
  assert.equal(snap.total, '270');
  assert.equal(snap.mint, MINT);
  assert.equal(snap.slot, 7);
});

test('A1 amounts use BigInt math beyond the float range', () => {
  const big = '18446744073709551615';
  const snap = buildSnapshot({ mint: MINT, slot: 1, accounts: [item('a', 'o', big), item('b', 'o', '1')], exclusions: NONE });
  assert.equal(snap.holders[0].amount, '18446744073709551616');
});

test('A2 exclusions by owner and by token account are applied', () => {
  const accounts = [item('ta1', 'alice', '100'), item('ta2', 'alice', '40'), item('ta3', 'bob', '300'), item('ta4', 'carol', '10')];
  const snap = buildSnapshot({ mint: MINT, slot: 1, accounts, exclusions: { owners: ['bob'], token_accounts: ['ta2'] } });
  assert.deepEqual(snap.holders, [
    { rank: 1, owner: 'alice', amount: '100' },
    { rank: 2, owner: 'carol', amount: '10' },
  ]);
  assert.equal(snap.total, '110');
});

test('A3 ranking by amount descending, ties by owner ascending, top keeps the first N', () => {
  const accounts = [item('1', 'zed', '5'), item('2', 'amy', '5'), item('3', 'Bea', '5'), item('4', 'max', '9'), item('5', 'kim', '1')];
  const all = buildSnapshot({ mint: MINT, slot: 1, accounts, exclusions: NONE });
  assert.deepEqual(all.holders.map((h) => h.owner), ['max', 'Bea', 'amy', 'zed', 'kim']);
  assert.deepEqual(all.holders.map((h) => h.rank), [1, 2, 3, 4, 5]);
  const top2 = buildSnapshot({ mint: MINT, slot: 1, accounts, exclusions: NONE, top: 2 });
  assert.deepEqual(top2.holders.map((h) => h.owner), ['max', 'Bea']);
  assert.equal(top2.total, all.total, 'total covers every counted owner, not only the kept ones');
  const many = Array.from({ length: 150 }, (_, i) => item(`t${i}`, `o${String(i).padStart(3, '0')}`, String(i + 1)));
  assert.equal(buildSnapshot({ mint: MINT, slot: 1, accounts: many, exclusions: NONE }).holders.length, 100);
});

test('A4 the hash follows the rule and does not depend on account order', () => {
  const accounts = [item('1', 'a', '3'), item('2', 'b', '2'), item('3', 'c', '1'), item('4', 'a', '1')];
  const snap = buildSnapshot({ mint: MINT, slot: 1, accounts, exclusions: NONE });
  const expected = createHash('sha256').update('1,a,4\n2,b,2\n3,c,1', 'utf8').digest('hex');
  assert.equal(snap.hash, expected);
  assert.equal(snapshotHash(snap.holders), expected);
  const reversed = buildSnapshot({ mint: MINT, slot: 1, accounts: [...accounts].reverse(), exclusions: NONE });
  assert.equal(reversed.hash, expected);
});

test('A5 Token 2022 accounts with extensions and a frozen state are counted by their amount', () => {
  const accounts = [
    item('f', 'frozen', '70', { program: TOKEN_2022_PROGRAM, state: 'frozen', extensions: [{ extension: 'immutableOwner' }] }),
    item('t', 'fee', '30', {
      program: TOKEN_2022_PROGRAM,
      extensions: [{ extension: 'transferFeeAmount', state: { withheldAmount: 12 } }, { extension: 'immutableOwner' }],
    }),
  ];
  const snap = buildSnapshot({ mint: MINT, slot: 1, accounts, exclusions: NONE });
  assert.deepEqual(snap.holders, [
    { rank: 1, owner: 'frozen', amount: '70' },
    { rank: 2, owner: 'fee', amount: '30' },
  ]);
});

test('A7 recorded fixture of a real Token 2022 mint gives a stable, order independent snapshot', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/fsm11-token2022.json', import.meta.url), 'utf8'));
  const mint = 'Fsm11MJFuRoToF9w9JoTGwAnBimJjRS56JaKVz9dGLyb';
  assert.ok(fixture.accounts.every((a) => a.account.owner === TOKEN_2022_PROGRAM));
  assert.ok(fixture.accounts.some((a) => (a.account.data.parsed.info.extensions ?? []).length > 0));
  const snap = buildSnapshot({ mint, slot: fixture.slot, accounts: fixture.accounts, exclusions: NONE, top: 5 });
  assert.equal(snap.slot, 460253012);
  assert.equal(snap.total, '1000000000000000');
  assert.equal(snap.holders[0].owner, 'FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM');
  assert.equal(snap.hash, '02ed2bde75ff358e99e23b42e45234a8b6916a0c66aa7832c818457900cd55a7');
  const shuffled = [...fixture.accounts].sort((a, b) => (a.pubkey < b.pubkey ? 1 : -1));
  assert.equal(buildSnapshot({ mint, slot: fixture.slot, accounts: shuffled, exclusions: NONE, top: 5 }).hash, snap.hash);
});
