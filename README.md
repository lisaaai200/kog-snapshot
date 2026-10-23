# kog-snapshot

A command line tool and a small Node library that take a Solana token mint, a slot and an exclusions file and write a ranked holder list with its sha256. It reads both token programs (SPL Token and Token 2022), groups token accounts by owner and is reproducible from recorded data.

Built by Genie, an AI agent, for the Kognai Kognessium bundle "KOG holder snapshot tool". No runtime dependency, Node 20 or later, MIT licence.

## Use

```sh
export SOLANA_RPC_URL=https://your-rpc.example   # never printed
npx kog-snapshot --mint <address> --exclusions exclusions.json --top 100 --out snapshot.json --save-fixture fixture.json

# Offline, from a recorded fixture
npx kog-snapshot --mint Fsm11MJFuRoToF9w9JoTGwAnBimJjRS56JaKVz9dGLyb \
  --exclusions test/fixtures/no-exclusions.json --fixture test/fixtures/fsm11-token2022.json --top 5
```

Options: `--mint <address>` (required), `--exclusions <file>` (required, `{"owners": [], "token_accounts": []}`), `--slot <n>` (sent as `minContextSlot`), `--top <n>` (default 100), `--out <file>` (default stdout), `--fixture <file>` (read `{slot, accounts}` instead of calling the RPC), `--save-fixture <file>` (write what the RPC returned). Exit code 0 on success, 1 with a plain message on an error.

## Library

```js
import { buildSnapshot, fetchAccounts } from 'kog-snapshot';

const { slot, accounts } = await fetchAccounts({ rpcUrl: process.env.SOLANA_RPC_URL, mint });
const snapshot = buildSnapshot({ mint, slot, accounts, exclusions: { owners: [], token_accounts: [] }, top: 100 });
// { mint, slot, total, holders: [{ rank, owner, amount }], hash }
```

Rules:

* Only `getProgramAccounts` items of parsed type `account`, of the mint, with a positive amount count. Frozen accounts and Token 2022 accounts with extensions (transfer fee, immutable owner and so on) count by their amount.
* Amounts are base units as decimal strings, summed per owner with BigInt.
* An excluded owner or token account is left out. `total` is the sum over every counted owner after exclusions, not only the kept ones.
* Ranking is by amount descending, ties by owner ascending (plain string comparison). Rank starts at 1 and `top` keeps the first N.
* `hash` is the sha256, lowercase hex, of the UTF 8 text with one line `rank,owner,amount` per kept holder, joined by a newline, with no trailing newline. The same accounts in any order give the same hash.
* `fetchAccounts` sends one `getProgramAccounts` call per token program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` and `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) with `encoding: jsonParsed`, `withContext: true` and a memcmp filter on the mint at offset 0. `slot` is the lowest context slot of the two answers.

## Tests

`npm test` runs node:test with no network. Each test is named after the acceptance item it proves (A1 to A7). The fixture `test/fixtures/fsm11-token2022.json` was recorded with this CLI from Solana mainnet at slot 460253012: 205 Token 2022 accounts of mint `Fsm11MJFuRoToF9w9JoTGwAnBimJjRS56JaKVz9dGLyb`, 201 of them with the immutable owner extension.
