# Solana Copy Trader

This bot copies the token trades of a Solana wallet. It monitors a source wallet. When the source wallet buys a token, the bot buys the same token.

> **Warning:** This is an experimental project. It is not tested with real funds. Use it on devnet only.

## Features

- Monitors the source wallet with a WebSocket subscription.
- Decodes Pump.fun, Pump.fun AMM, Raydium and Jupiter swap instructions.
- Sells positions with take-profit and stop-loss limits.
- Sends transactions through Jito with a tip.
- Two modes:
  - `COPY`: Copy the buys and sells of the source wallet.
  - `SELLING`: Sell all active positions.

## Setup

1. Install the packages: `npm install`.
   The project uses a local copy of `pumpdotfun-sdk` (see `package.json`).
2. Copy `.env.example` to `.env`. Set your values.
3. Start the bot: `npm run main`.

The bot keeps keypairs in `keypairs/`. Do not commit this folder.

## Tests

```bash
npx jest
```
