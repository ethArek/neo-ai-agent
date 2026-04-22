import { isNeoN3Address } from "./validation";

const neoNsPattern =
  /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.neo)\b/i;

const walletAddressPattern =
  /\b(?:my (?:address|wallet|account|wallet address)|m[oó]j (?:adres|portfel)|moje konto|moim (?:adresie|portfelu|koncie))\b/;
const lastKnownAddressPattern =
  /\b(?:(?:this|that|same) (?:address|wallet|account)|(?:ten|tamten|ten sam) (?:adres|portfel|konto)|tym (?:adresie|portfelu|koncie))\b/;

interface AddressContext {
  walletAddress?: string;
  lastReferencedAddress?: string;
}

export function extractNeoN3AddressOrName(message: string): string | undefined {
  const parts = message.match(/[A-Za-z0-9]+/g) ?? [];

  for (const part of parts) {
    if (isNeoN3Address(part)) {
      return part;
    }
  }

  const neoNsMatch = message.match(neoNsPattern);

  if (neoNsMatch) {
    return neoNsMatch[1].toLowerCase();
  }

  return undefined;
}

export function referencesWalletAddress(message: string): boolean {
  return walletAddressPattern.test(message);
}

export function referencesLastKnownAddress(message: string): boolean {
  return lastKnownAddressPattern.test(message);
}

export function resolveAddressReference(
  message: string,
  context: AddressContext,
): string | undefined {
  const explicitAddress = extractNeoN3AddressOrName(message);

  if (explicitAddress) {
    return explicitAddress;
  }

  const normalizedMessage = message.trim().toLowerCase();

  if (referencesWalletAddress(normalizedMessage)) {
    return context.walletAddress ?? context.lastReferencedAddress;
  }

  if (referencesLastKnownAddress(normalizedMessage)) {
    return context.lastReferencedAddress ?? context.walletAddress;
  }

  return undefined;
}

export function resolveSessionAddressReference(
  message: string,
  context: AddressContext,
): string | undefined {
  const normalizedMessage = message.trim().toLowerCase();

  if (referencesWalletAddress(normalizedMessage)) {
    return context.walletAddress ?? context.lastReferencedAddress;
  }

  if (referencesLastKnownAddress(normalizedMessage)) {
    return context.lastReferencedAddress ?? context.walletAddress;
  }

  return undefined;
}

export function isNeoN3AddressReference(address: string): boolean {
  return isNeoN3Address(address) || neoNsPattern.test(address);
}
