import { z } from "zod";

import type { ToolDefinition } from "../agent/types";
import {
  evmAddressSchema,
  evmBlockHashSchema,
  evmTransactionHashSchema,
  positiveDecimalAmountSchema,
} from "../core/validation";
import { neoXNetworks } from "../neo/types";
import {
  confirmPreparedTransaction,
  createPreparedTransactionResult,
} from "./confirmableTransaction";

const neoXNetworkSchema = z.enum(neoXNetworks).optional();
const functionNameSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z_$][A-Za-z0-9_$]*$/,
    "Function name must be a valid Solidity identifier.",
  );
const abiInputSchema = z.union([
  z.string().trim().min(1, "ABI or function signature is required."),
  z.array(z.unknown()).min(1, "ABI array must not be empty."),
]);
const tokenIdSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)$/, "tokenId must be a non-negative integer string.");

const chainInfoInputSchema = z.object({
  network: neoXNetworkSchema,
});

const nativeBalanceInputSchema = z.object({
  address: evmAddressSchema,
  network: neoXNetworkSchema,
});

const blockInputSchema = z
  .object({
    number: tokenIdSchema.optional(),
    hash: evmBlockHashSchema.optional(),
    tag: z.literal("latest").optional(),
    network: neoXNetworkSchema,
  })
  .superRefine((value, context) => {
    const references = [value.number, value.hash, value.tag].filter(Boolean);

    if (references.length > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide only one of number, hash, or tag.",
      });
    }
  });

const transactionInputSchema = z.object({
  hash: evmTransactionHashSchema,
  network: neoXNetworkSchema,
});

const contractCallInputSchema = z.object({
  contractAddress: evmAddressSchema,
  abi: abiInputSchema,
  functionName: functionNameSchema,
  args: z.array(z.unknown()).default([]),
  network: neoXNetworkSchema,
});

const erc20MetadataInputSchema = z.object({
  tokenContract: evmAddressSchema,
  network: neoXNetworkSchema,
});

const erc20BalanceInputSchema = z.object({
  tokenContract: evmAddressSchema,
  owner: evmAddressSchema,
  network: neoXNetworkSchema,
});

const erc721OwnerInputSchema = z.object({
  contractAddress: evmAddressSchema,
  tokenId: tokenIdSchema,
  network: neoXNetworkSchema,
});

const nativeTransferInputSchema = z.object({
  to: evmAddressSchema,
  amount: positiveDecimalAmountSchema,
  network: neoXNetworkSchema,
});

const erc20TransferInputSchema = z.object({
  tokenContract: evmAddressSchema,
  to: evmAddressSchema,
  amount: positiveDecimalAmountSchema,
  network: neoXNetworkSchema,
});

const contractWriteInputSchema = z.object({
  contractAddress: evmAddressSchema,
  abi: abiInputSchema,
  functionName: functionNameSchema,
  args: z.array(z.unknown()).default([]),
  value: positiveDecimalAmountSchema.optional(),
  network: neoXNetworkSchema,
});

export const neoXGetChainInfoTool: ToolDefinition<
  z.infer<typeof chainInfoInputSchema>
> = {
  name: "neox_get_chain_info",
  networks: ["neoX"],
  description:
    "Fetch Neo X EVM chain information, RPC connectivity, and latest block.",
  argumentsDescription: '{ "network"?: "mainnet | testnet | custom" }',
  readOnly: true,
  dangerous: false,
  schema: chainInfoInputSchema,
  async execute(input, context) {
    const parsed = chainInfoInputSchema.parse(input);
    const info = await context.neo.getNeoXChainInfo(parsed.network);

    return {
      message: `Loaded Neo X ${info.network} chain info at block ${info.latestBlock}.`,
      data: info,
    };
  },
};

export const neoXGetNativeBalanceTool: ToolDefinition<
  z.infer<typeof nativeBalanceInputSchema>
> = {
  name: "neox_get_native_balance",
  networks: ["neoX"],
  description: "Fetch native GAS balance for a Neo X EVM address.",
  argumentsDescription:
    '{ "address": "0x EVM address", "network"?: "mainnet | testnet | custom" }',
  readOnly: true,
  dangerous: false,
  schema: nativeBalanceInputSchema,
  async execute(input, context) {
    const parsed = nativeBalanceInputSchema.parse(input);
    const balance = await context.neo.getNeoXNativeBalance(
      parsed.address,
      parsed.network,
    );

    return {
      message: `Loaded Neo X ${balance.network} GAS balance for ${balance.owner}: ${balance.balance} GAS.`,
      data: balance,
    };
  },
};

export const neoXGetBlockTool: ToolDefinition<
  z.infer<typeof blockInputSchema>
> = {
  name: "neox_get_block",
  networks: ["neoX"],
  description: "Fetch Neo X block details by number, block hash, or latest.",
  argumentsDescription:
    '{ "number"?: "123", "hash"?: "0x block hash", "tag"?: "latest", "network"?: "mainnet | testnet | custom" }',
  readOnly: true,
  dangerous: false,
  schema: blockInputSchema,
  async execute(input, context) {
    const parsed = blockInputSchema.parse(input);
    const block = await context.neo.getNeoXBlock({
      number: parsed.number,
      hash: parsed.hash,
      tag: parsed.tag ?? "latest",
      network: parsed.network,
    });
    const resolvedNetwork =
      typeof block === "object" &&
      block !== null &&
      "network" in block &&
      typeof block.network === "string"
        ? block.network
        : (parsed.network ?? "default");

    return {
      message: `Loaded Neo X ${resolvedNetwork} block ${parsed.hash ?? parsed.number ?? "latest"}.`,
      data: block,
    };
  },
};

export const neoXGetTransactionTool: ToolDefinition<
  z.infer<typeof transactionInputSchema>
> = {
  name: "neox_get_transaction",
  networks: ["neoX"],
  description: "Fetch a Neo X EVM transaction by hash.",
  argumentsDescription:
    '{ "hash": "0x transaction hash", "network"?: "mainnet | testnet | custom" }',
  readOnly: true,
  dangerous: false,
  schema: transactionInputSchema,
  async execute(input, context) {
    const parsed = transactionInputSchema.parse(input);
    const transaction = await context.neo.getNeoXTransaction(parsed);

    return {
      message: `Loaded Neo X transaction ${parsed.hash}.`,
      data: transaction,
    };
  },
};

export const neoXGetTransactionReceiptTool: ToolDefinition<
  z.infer<typeof transactionInputSchema>
> = {
  name: "neox_get_transaction_receipt",
  networks: ["neoX"],
  description: "Fetch a Neo X EVM transaction receipt by hash.",
  argumentsDescription:
    '{ "hash": "0x transaction hash", "network"?: "mainnet | testnet | custom" }',
  readOnly: true,
  dangerous: false,
  schema: transactionInputSchema,
  async execute(input, context) {
    const parsed = transactionInputSchema.parse(input);
    const receipt = await context.neo.getNeoXTransactionReceipt(parsed);

    return {
      message: `Loaded Neo X transaction receipt ${parsed.hash}.`,
      data: receipt,
    };
  },
};

export const neoXCallContractTool: ToolDefinition<
  z.infer<typeof contractCallInputSchema>
> = {
  name: "neox_call_contract",
  networks: ["neoX"],
  description:
    "Call a read-only Neo X Solidity contract function using an ABI fragment.",
  argumentsDescription:
    '{ "contractAddress": "0x contract", "abi": "function balanceOf(address) view returns (uint256)", "functionName": "balanceOf", "args"?: [], "network"?: "mainnet | testnet | custom" }',
  readOnly: true,
  dangerous: false,
  schema: contractCallInputSchema,
  async execute(input, context) {
    const parsed = contractCallInputSchema.parse(input);
    const result = await context.neo.callNeoXContract(parsed);

    return {
      message: `Called Neo X ${result.network} contract ${result.functionName} on ${result.contractAddress}.`,
      data: result,
    };
  },
};

export const neoXGetErc20MetadataTool: ToolDefinition<
  z.infer<typeof erc20MetadataInputSchema>
> = {
  name: "neox_get_erc20_metadata",
  networks: ["neoX"],
  description: "Read ERC-20 name, symbol, and decimals from a Neo X token.",
  argumentsDescription:
    '{ "tokenContract": "0x token contract", "network"?: "mainnet | testnet | custom" }',
  readOnly: true,
  dangerous: false,
  schema: erc20MetadataInputSchema,
  async execute(input, context) {
    const parsed = erc20MetadataInputSchema.parse(input);
    const metadata = await context.neo.getNeoXErc20Metadata(
      parsed.tokenContract,
      parsed.network,
    );

    return {
      message: `Loaded Neo X ERC-20 metadata for ${metadata.symbol} at ${metadata.contractAddress}.`,
      data: metadata,
    };
  },
};

export const neoXGetErc20BalanceTool: ToolDefinition<
  z.infer<typeof erc20BalanceInputSchema>
> = {
  name: "neox_get_erc20_balance",
  networks: ["neoX"],
  description: "Fetch an ERC-20 token balance for a Neo X EVM address.",
  argumentsDescription:
    '{ "tokenContract": "0x token contract", "owner": "0x owner", "network"?: "mainnet | testnet | custom" }',
  readOnly: true,
  dangerous: false,
  schema: erc20BalanceInputSchema,
  async execute(input, context) {
    const parsed = erc20BalanceInputSchema.parse(input);
    const balance = await context.neo.getNeoXErc20Balance(parsed);

    return {
      message: `Loaded Neo X ERC-20 ${balance.symbol} balance for ${balance.owner}: ${balance.formattedBalance}.`,
      data: balance,
    };
  },
};

export const neoXGetErc721OwnerTool: ToolDefinition<
  z.infer<typeof erc721OwnerInputSchema>
> = {
  name: "neox_get_erc721_owner",
  networks: ["neoX"],
  description: "Read the owner of an ERC-721 token on Neo X.",
  argumentsDescription:
    '{ "contractAddress": "0x NFT contract", "tokenId": "123", "network"?: "mainnet | testnet | custom" }',
  readOnly: true,
  dangerous: false,
  schema: erc721OwnerInputSchema,
  async execute(input, context) {
    const parsed = erc721OwnerInputSchema.parse(input);
    const owner = await context.neo.getNeoXErc721Owner(parsed);

    return {
      message: `Loaded Neo X ERC-721 owner for token ${owner.tokenId}: ${owner.owner}.`,
      data: owner,
    };
  },
};

export const neoXPrepareNativeTransferTool: ToolDefinition<
  z.infer<typeof nativeTransferInputSchema>
> = {
  name: "neox_prepare_native_transfer",
  networks: ["neoX"],
  description:
    "Prepare a Neo X native GAS transfer preview and require confirmation before broadcasting.",
  argumentsDescription:
    '{ "to": "0x recipient", "amount": "decimal GAS amount", "network"?: "mainnet | testnet | custom" }',
  readOnly: false,
  dangerous: true,
  schema: nativeTransferInputSchema,
  async execute(input, context, options) {
    const parsed = nativeTransferInputSchema.parse(input);

    if (options?.confirm) {
      return confirmPreparedTransaction(
        context,
        options,
        "neox_prepare_native_transfer",
      );
    }

    const prepared = await context.neo.prepareNeoXNativeTransfer(parsed);

    return createPreparedTransactionResult(
      "neox_prepare_native_transfer",
      parsed,
      prepared,
    );
  },
};

export const neoXPrepareErc20TransferTool: ToolDefinition<
  z.infer<typeof erc20TransferInputSchema>
> = {
  name: "neox_prepare_erc20_transfer",
  networks: ["neoX"],
  description:
    "Prepare a Neo X ERC-20 transfer preview and require confirmation before broadcasting.",
  argumentsDescription:
    '{ "tokenContract": "0x token contract", "to": "0x recipient", "amount": "decimal token amount", "network"?: "mainnet | testnet | custom" }',
  readOnly: false,
  dangerous: true,
  schema: erc20TransferInputSchema,
  async execute(input, context, options) {
    const parsed = erc20TransferInputSchema.parse(input);

    if (options?.confirm) {
      return confirmPreparedTransaction(
        context,
        options,
        "neox_prepare_erc20_transfer",
      );
    }

    const prepared = await context.neo.prepareNeoXErc20Transfer(parsed);

    return createPreparedTransactionResult(
      "neox_prepare_erc20_transfer",
      parsed,
      prepared,
    );
  },
};

export const neoXPrepareContractWriteTool: ToolDefinition<
  z.infer<typeof contractWriteInputSchema>
> = {
  name: "neox_prepare_contract_write",
  networks: ["neoX"],
  description:
    "Prepare a Neo X Solidity contract write preview and require confirmation before broadcasting.",
  argumentsDescription:
    '{ "contractAddress": "0x contract", "abi": "function mint(address)", "functionName": "mint", "args"?: [], "value"?: "decimal GAS", "network"?: "mainnet | testnet | custom" }',
  readOnly: false,
  dangerous: true,
  schema: contractWriteInputSchema,
  async execute(input, context, options) {
    const parsed = contractWriteInputSchema.parse(input);

    if (options?.confirm) {
      return confirmPreparedTransaction(
        context,
        options,
        "neox_prepare_contract_write",
      );
    }

    const prepared = await context.neo.prepareNeoXContractWrite(parsed);

    return createPreparedTransactionResult(
      "neox_prepare_contract_write",
      parsed,
      prepared,
    );
  },
};
