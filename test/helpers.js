import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '../src/index.js';

export const MINT = 'MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export function item(pubkey, owner, amount, opts = {}) {
  return {
    pubkey,
    account: {
      owner: opts.program ?? TOKEN_PROGRAM,
      data: {
        program: opts.program === TOKEN_2022_PROGRAM ? 'spl-token-2022' : 'spl-token',
        parsed: {
          type: opts.type ?? 'account',
          info: {
            mint: opts.mint ?? MINT,
            owner,
            state: opts.state ?? 'initialized',
            tokenAmount: { amount, decimals: 6 },
            ...(opts.extensions ? { extensions: opts.extensions } : {}),
          },
        },
      },
    },
  };
}

export const NONE = { owners: [], token_accounts: [] };
