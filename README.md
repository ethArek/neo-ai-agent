# Neo X AI Agent

Neo X AI Agent is a CLI-first and server-hostable AI assistant for the Neo X network.

You talk to it in plain English, and it decides which Neo X tool to run.

It is built for action, not small talk:

- it reads Neo X chain data
- it prepares wallet actions safely
- it can bridge GAS between Neo N3 and Neo X
- it validates inputs before doing anything important
- it requires explicit confirmation before broadcasting write actions

The project supports both:

- a CLI for local or operator-driven usage
- a REST API for server-side integrations such as transfers, approvals, bridge requests, and confirmations

## What It Can Do

### Read-only actions

- check native GAS balance for a Neo X address
- fetch a combined portfolio overview with Neo X balances and a full optional Neo N3 section
- fetch a full Neo N3 portfolio overview with GAS, NEO, and tracked NEP-17 balances
- fetch Neo N3 NEP-17 balances, including single-token lookups by symbol or contract hash
- fetch recent Neo N3 NEP-17 transfer history for an address
- estimate Flamingo swap output on Neo N3, including the best route, min received, slippage guard, and deadline
- estimate current bridge fee, min/max amount, expected received amount, and heuristic ETA for GAS bridging
- track a bridge end-to-end across source and destination networks, including destination arrival checks
- fetch tracked ERC-20 balances
- fetch a single tracked ERC-20 balance
- look up transactions by hash
- check the status of the most recent broadcast transaction in the current session
- list recent broadcast actions from the current session, with optional address filtering
- look up blocks by height or hash
- call read-only EVM contract functions
- call read-only Neo N3 contract operations

### Wallet-aware actions

- load a Neo N3 wallet from `WALLET_WIF` or `WALLET_PRIVATE_KEY`
- optionally load a Neo X wallet from `NEO_X_WALLET_PRIVATE_KEY`
- show the loaded wallet address
- prepare GAS bridge transactions between Neo N3 and Neo X
- prepare native GAS transfers on Neo N3
- prepare NEP-17 token transfers on Neo N3
- prepare Flamingo swaps on Neo N3, including force-swap prompts with the same confirmation guardrail
- prepare native GAS transfers
- prepare ERC-20 transfers
- prepare ERC-20 approvals
- prepare generic contract writes
- prepare generic Neo N3 contract writes
- resolve NeoNS names such as `arkadiusz.neo` for Neo N3 recipients
- sign and broadcast only after explicit confirmation

## Safety Model

- read-only actions run immediately
- write actions are prepared first
- the agent stores the prepared action in memory during the CLI or API session
- only after you type `Confirm` does it sign and broadcast
- if you type `Cancel`, the pending action is discarded
- private keys are never returned in responses

In plain English:

- asking to send funds does not send funds immediately
- asking to bridge GAS does not bridge immediately
- asking to approve a token does not approve it immediately
- the CLI or API shows you what it plans to do, then waits for confirmation

## Beginner Guide

If you are new to Neo, wallets, or DeFi, use the agent in this order:

### 1. Start in read-only mode

Do not add `WALLET_WIF`, `WALLET_PRIVATE_KEY`, or `NEO_X_WALLET_PRIVATE_KEY` yet.

Run the agent in read-only mode:

Interactive CLI:

```bash
npm run cli -- interactive
```

One-shot question:

```bash
npm run cli -- "Show my Neo N3 portfolio"
```

REST API:

```bash
npm run api
```

This lets you safely ask questions like:

- `What is my GAS balance?`
- `Show my Neo N3 portfolio`
- `Show my last 5 transfers on Neo N3`
- `What is the best Flamingo route to swap 1 GAS for FUSD on N3?`
- `What is the fee to bridge 1 GAS from Neo X to Neo N3?`

In read-only mode, the agent cannot sign or send anything.

### 2. Learn the two networks first

- `Neo X` is the EVM-compatible network in this project
- `Neo N3` is the native Neo network
- `Bridge` means moving GAS between Neo X and Neo N3
- `Swap` means trading one token for another, for example `GAS -> FUSD` on Neo N3 through Flamingo

If you are unsure which network you want, ask explicitly:

- `Show my Neo N3 token balances`
- `Bridge 1 GAS from Neo X to Neo N3`
- `Swap 1 GAS for FUSD on N3`

### 3. Only add a wallet when you are ready to send real transactions

Set:

```bash
WALLET_WIF=<neo-n3-wif>
WALLET_PRIVATE_KEY=<neo-n3-raw-private-key-optional>
NEO_X_WALLET_PRIVATE_KEY=0x...
```

Access rules are simple:

- no wallet keys set = read-only access only
- `WALLET_WIF` or `WALLET_PRIVATE_KEY` set = Neo N3 writes enabled
- `NEO_X_WALLET_PRIVATE_KEY` set = Neo X writes enabled
- Neo N3 key plus Neo X key = Neo N3 and Neo X writes enabled

Run the agent with write access after adding the right key to `.env`:

Interactive CLI:

```bash
npm run cli -- interactive
```

One-shot write preparation:

```bash
npm run cli -- "Swap 1 GAS for FUSD on N3"
```

You can also enable access just for the current shell session.

Windows PowerShell, Neo N3 write access only:

```powershell
$env:WALLET_WIF="<neo-n3-wif>"
npm run cli -- interactive
```

Windows PowerShell, Neo X write access only:

```powershell
$env:NEO_X_WALLET_PRIVATE_KEY="0x..."
npm run cli -- interactive
```

Windows PowerShell, both write modes:

```powershell
$env:WALLET_WIF="<neo-n3-wif>"
$env:NEO_X_WALLET_PRIVATE_KEY="0x..."
npm run cli -- interactive
```

macOS or Linux, Neo N3 write access only:

```bash
WALLET_WIF=<neo-n3-wif> npm run cli -- interactive
```

macOS or Linux, Neo X write access only:

```bash
NEO_X_WALLET_PRIVATE_KEY=0x... npm run cli -- interactive
```

macOS or Linux, both write modes:

```bash
WALLET_WIF=<neo-n3-wif> NEO_X_WALLET_PRIVATE_KEY=0x... npm run cli -- interactive
```

After that, the agent can prepare write actions, but it still will not send them immediately.

It always follows this pattern:

1. You ask for an action
2. The agent prepares it
3. The agent shows a summary
4. You type `Confirm` to broadcast
5. You can type `Cancel` to discard it

### 4. Use simple prompts

You do not need contract terminology. Plain English is enough.

Good beginner prompts:

- `Show my address`
- `Show my Neo N3 portfolio`
- `Send 1 GAS on N3 to arkadiusz.neo`
- `Swap 1 GAS for FUSD on N3`
- `Swap 1 GAS for FUSD on N3 with "force" and 1% slippage`
- `Bridge 1 GAS from Neo N3 to Neo X`
- `Did my last bridge arrive?`

### 5. Understand what the agent will show before you confirm

For transfers, it shows:

- recipient
- token
- amount

For swaps, it shows:

- token in and token out
- expected output
- minimum received
- slippage
- route
- deadline

For bridges, it shows:

- source network and destination network
- destination address
- fee
- expected received
- ETA estimate

### 6. Use `force` carefully

`Force` is useful when you want one prompt to do the planning work for you.

Example:

- `Swap 1 GAS for FUSD on N3 with "force" and 1% slippage`

This means the agent will automatically choose the best route and prepare the transaction in one step, but it still waits for `Confirm` before broadcasting.

### 7. Start small on mainnet

If this is your first real transaction:

- start with a tiny amount
- verify the destination address
- double-check the network
- read the prepared summary before typing `Confirm`

If you are experimenting, use testnet first.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Choose your environment file

- [`.env.example`](C:/Users/empe/projects/neo-ai-agent/.env.example) for Neo X mainnet
- [`.env.testnet.example`](C:/Users/empe/projects/neo-ai-agent/.env.testnet.example) for Neo X testnet

### 3. Copy the environment file

Windows PowerShell, mainnet:

```powershell
Copy-Item .env.example .env
```

Windows PowerShell, testnet:

```powershell
Copy-Item .env.testnet.example .env
```

macOS or Linux, mainnet:

```bash
cp .env.example .env
```

macOS or Linux, testnet:

```bash
cp .env.testnet.example .env
```

### 4. Configure your wallets if you want write access

Set:

```bash
WALLET_WIF=<neo-n3-wif>
WALLET_PRIVATE_KEY=<neo-n3-raw-private-key-optional>
NEO_X_WALLET_PRIVATE_KEY=0x...
```

- `WALLET_WIF` or `WALLET_PRIVATE_KEY` is used for Neo N3 writes such as Neo N3 -> Neo X bridging, Neo N3 token transfers, Neo N3 contract writes, and Flamingo swaps
- `NEO_X_WALLET_PRIVATE_KEY` is used for Neo X writes such as transfers, approvals, contract writes, and Neo X -> Neo N3 bridging
- if neither wallet key is set, the agent still works in read-only mode

### 5. Start the CLI

```bash
npm run cli -- interactive
```

Example prompts:

- `What is my GAS balance?`
- `Show my portfolio`
- `Show my Neo N3 portfolio`
- `Show my Neo N3 token balances`
- `Show my last 5 transfers on Neo N3`
- `What is the best Flamingo route to swap 1 GAS for FUSD on N3?`
- `Swap 1 GAS for FUSD on N3 with "force" and 1% slippage`
- `What is the fee to bridge 1 GAS from Neo X to Neo N3?`
- `Did my last bridge arrive?`
- `Show my tracked token balances`
- `Send 12.5 FUSD on N3 to arkadiusz.neo`
- `Invoke balanceOf on Neo N3 contract 0x...`
- `Approve 25 XETH for 0x1111111111111111111111111111111111111111`
- `Bridge 1 GAS from Neo X to Neo N3 NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM`
- `Bridge 1 GAS from Neo N3 to Neo X`
- `Send 0.1 GAS to 0x...`
- `Send 1 GAS on N3 to arkadiusz.neo`
- `Check the status of my last transaction`
- `Show my last 5 actions`

## Environment Variables

### Network

- `NEOX_RPC_URL` Neo X JSON-RPC endpoint
- `NEO_N3_RPC_URL` Neo N3 JSON-RPC endpoint used for Neo N3 bridge transactions
- `NEOX_CHAIN_ID` Neo X chain ID

Mainnet defaults:

- RPC: `https://mainnet-1.rpc.banelabs.org`
- Chain ID: `47763`

Testnet example:

- RPC: `https://neoxt4seed1.ngd.network`
- Chain ID: `12227332`

### Wallet

- `WALLET_WIF` Neo N3 WIF used for Neo N3 write actions
- `WALLET_PRIVATE_KEY` Neo N3 raw private key used for Neo N3 write actions
- `NEO_X_WALLET_PRIVATE_KEY` EVM private key used for Neo X write actions

Legacy compatibility:

- `N3_WALLET_PRIVATE_KEY` is still accepted as a fallback alias for Neo N3, but new production setups should use `WALLET_WIF` or `WALLET_PRIVATE_KEY`

### Bridge

- `NEOX_BRIDGE_CONTRACT` Neo X bridge contract used for Neo X -> Neo N3 GAS bridging
- `NEO_N3_BRIDGE_CONTRACT` Neo N3 bridge contract used for Neo N3 -> Neo X GAS bridging
- `NEO_N3_GAS_TOKEN_CONTRACT` Neo N3 GAS contract hash used for signer scopes during Neo N3 deposits
- `NEO_N3_NNS_CONTRACT` NeoNS contract hash used to resolve `.neo` recipients on Neo N3
- `NEO_N3_FLAMINGO_BROKER_CONTRACT` Flamingo broker contract hash used by Neo N3 convert flows
- `NEO_N3_FLAMINGO_CONVERT_CONTRACT` Flamingo convert contract hash used for Neo N3 swap quotes and swaps
- `NEO_N3_FLAMINGO_ROUTER_CONTRACT` Flamingo router contract hash used by Flamingo liquidity and pool internals
- `NEO_N3_TOKEN_MAP_JSON` tracked Neo N3 NEP-17 symbol-to-contract-hash map for Neo N3 portfolio overviews

### Neo X Tokens

- `NEOX_WRAPPED_GAS_ADDRESS` wrapped GAS contract used for Neo X token metadata
- `ERC20_TOKEN_MAP_JSON` tracked token symbol-to-address map for balances and symbol resolution

On Neo N3, portfolio overviews always include native `GAS` and `NEO`. Add extra tracked NEP-17 tokens through `NEO_N3_TOKEN_MAP_JSON`.

The mainnet [`.env.example`](C:/Users/empe/projects/neo-ai-agent/.env.example) and [`.env.testnet.example`](C:/Users/empe/projects/neo-ai-agent/.env.testnet.example) now ship with an official Flamingo Neo N3 starter set for swaps: `FLM`, `FUSD`, `bNEO`, `USDT`, `USDC`, `WETH`, `WBTC`, `ONT`, `WINGv2`, `BNB`, `CAKE`, and `SWTH`.

On mainnet, bridge, Neo X token defaults, and the Neo N3 Flamingo broker, convert, and router contracts are prefilled. On testnet, the Neo N3 RPC URL and official Flamingo broker, convert, router, and token defaults are prefilled for swap flows, while bridge contracts remain empty until you provide valid testnet deployments.

## CLI Usage

One-shot request:

```bash
npm run cli -- Show my tracked token balances
```

Interactive mode:

```bash
npm run cli -- interactive
```

Direct tool execution:

```bash
npm run cli -- tool approveErc20 --args "{\"token\":\"XETH\",\"amount\":\"25\",\"spender\":\"0x1111111111111111111111111111111111111111\"}"
```

Bridge tool execution:

```bash
npm run cli -- tool bridgeGas --args "{\"direction\":\"neoXToNeoN3\",\"amount\":\"1\",\"to\":\"NQ9NEvVrutLL6JDtUMKMrkEG6QpWNxgNBM\"}"
```

Flamingo quote execution:

```bash
npm run cli -- tool getNeoN3SwapQuote --args "{\"fromToken\":\"GAS\",\"toToken\":\"FUSD\",\"amount\":\"1\",\"slippagePercent\":\"1\"}"
```

## REST API

Start in development:

```bash
npm run api
```

Start after building:

```bash
npm run build
npm run start:api
```

Important API environment variables:

- `PORT` controls the listening port
- `API_HOST` controls the bind address
- `API_BEARER_TOKEN` enables bearer-token auth for every route

Important safety note:

- if `WALLET_WIF`, `WALLET_PRIVATE_KEY`, or `NEO_X_WALLET_PRIVATE_KEY` is set, you should also set `API_BEARER_TOKEN`
- pending confirmations live in memory, so restarting the process clears pending API sessions

### API routes

- `GET /health`
- `GET /openapi.json`
- `GET /swagger.json`
- `GET /api/tools`
- `POST /api/messages`
- `POST /api/tools/:tool`
- `POST /api/sessions/:sessionId/confirm`
- `POST /api/sessions/:sessionId/cancel`

### Example: prepare and confirm an ERC-20 approval

Prepare the approval:

```bash
curl -X POST http://127.0.0.1:3000/api/tools/approveErc20 \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "arguments": {
      "token": "XETH",
      "amount": "25",
      "spender": "0x1111111111111111111111111111111111111111"
    }
  }'
```

Confirm the prepared approval:

```bash
curl -X POST http://127.0.0.1:3000/api/sessions/<sessionId>/confirm \
  -H "Authorization: Bearer your-secret-token"
```

### Example: natural-language API usage

```bash
curl -X POST http://127.0.0.1:3000/api/messages \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Show my last 5 actions"
  }'
```

## Verification

Run the full verification suite:

```bash
npm run verify
```

That runs:

- ESLint
- TypeScript typecheck
- Jest tests
- Prettier format check

## Notes

- GAS bridging currently targets the official Neo bridge flow between Neo N3 and Neo X
- bridge ETA and Neo X-side arrival detection are heuristic estimates; Neo N3 arrival detection uses transfer history when the TokenTracker RPC plugin is available
- Neo N3 GAS transfers accept either a raw Neo N3 address or a NeoNS name
- Neo N3 Flamingo swaps search the best direct or one-hop route from the configured token set in `NEO_N3_TOKEN_MAP_JSON`
- force-swap prompts on Neo N3 still require the same explicit confirmation before broadcast
- ERC-20 approvals require an explicit spender address
- tracked token balance lookups depend on `ERC20_TOKEN_MAP_JSON`
- Neo N3 portfolio token lookups depend on `NEO_N3_TOKEN_MAP_JSON` in addition to native `NEO` and `GAS`
- Neo N3 generic read and write tools accept plain `args` arrays, and for non-trivial parameter types you can pass structured `{ "type": "...", "value": ... }` arguments such as `Hash160`, `Address`, `Integer`, `Boolean`, `ByteArray`, `PublicKey`, `Array`, and `Any`
