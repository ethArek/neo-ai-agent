import { wallet as neoWallet } from "@cityofzion/neon-js";
import { getAddress, isAddress } from "viem";
import { z } from "zod";

const hex256Pattern = /^(0x)?[0-9a-fA-F]{64}$/;
const hex160Pattern = /^(0x)?[0-9a-fA-F]{40}$/;
const evmTransactionHashPattern = /^0x[0-9a-fA-F]{64}$/;
const positiveDecimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const neoNsNamePattern =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.neo$/i;

export function stripHexPrefix(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X")
    ? value.slice(2)
    : value;
}

export function normalizeHash256(value: string): string {
  return `0x${stripHexPrefix(value).toLowerCase()}`;
}

export function normalizeHash160(value: string): string {
  return `0x${stripHexPrefix(value).toLowerCase()}`;
}

export function isHash256(value: string): boolean {
  return hex256Pattern.test(value);
}

export function isHash160(value: string): boolean {
  return hex160Pattern.test(value);
}

export function isPositiveDecimal(value: string): boolean {
  if (!positiveDecimalPattern.test(value)) {
    return false;
  }

  return Number(value) > 0;
}

export function isNeoN3Address(value: string): boolean {
  return neoWallet.isAddress(value);
}

export function isEvmAddress(value: string): boolean {
  return isAddress(value.trim());
}

export function normalizeEvmAddress(value: string): string {
  return getAddress(value.trim());
}

export function normalizeNeoNsName(value: string): string {
  return value.trim().toLowerCase();
}

export function isNeoNsName(value: string): boolean {
  return neoNsNamePattern.test(value.trim());
}

export const hash256Schema = z
  .string()
  .trim()
  .min(1, "Hash is required.")
  .refine((value) => isHash256(value), "Invalid 32-byte hash.")
  .transform((value) => normalizeHash256(value));

export const positiveDecimalAmountSchema = z
  .string()
  .trim()
  .min(1, "Amount is required.")
  .refine(
    (value) => isPositiveDecimal(value),
    "Amount must be a positive decimal string.",
  );

export const hash160Schema = z
  .string()
  .trim()
  .min(1, "Hash160 value is required.")
  .refine((value) => isHash160(value), "Invalid 20-byte hash.")
  .transform((value) => normalizeHash160(value));

export const evmAddressSchema = z
  .string()
  .trim()
  .min(1, "EVM address is required.")
  .refine((value) => isEvmAddress(value), "Invalid EVM address.")
  .transform((value) => normalizeEvmAddress(value));

export const evmTransactionHashSchema = z
  .string()
  .trim()
  .min(1, "Transaction hash is required.")
  .refine(
    (value) => evmTransactionHashPattern.test(value),
    "Invalid EVM transaction hash.",
  )
  .transform((value) => value.toLowerCase());

export const neoN3AddressSchema = z
  .string()
  .trim()
  .min(1, "Neo N3 address is required.")
  .refine((value) => isNeoN3Address(value), "Invalid Neo N3 address.");

export const neoN3AddressOrNeoNsSchema = z
  .string()
  .trim()
  .min(1, "Neo N3 address or NeoNS name is required.")
  .refine(
    (value) => isNeoN3Address(value) || isNeoNsName(value),
    "Invalid Neo N3 address or NeoNS name.",
  )
  .transform((value) =>
    isNeoNsName(value) ? normalizeNeoNsName(value) : value,
  );
