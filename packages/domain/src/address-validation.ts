import type { Network } from './assets';

const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const BTC_LEGACY_RE = /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/;
const BTC_BECH32_RE = /^bc1[02-9ac-hj-np-z]{6,87}$/;
// Solana addresses are base58-encoded ed25519 public keys (32 bytes). Encoded
// length is 32-44 chars depending on leading zero bytes; in practice almost
// every address is 43-44 chars but the spec allows the shorter range.
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidAddress(network: Network, address: string): boolean {
  switch (network) {
    case 'TRC20':
      return TRC20_RE.test(address);
    case 'ERC20':
    case 'BSC':
    case 'POLYGON':
    case 'ARBITRUM':
      return EVM_RE.test(address);
    case 'SOL':
      return SOL_RE.test(address);
    case 'BTC':
      return BTC_LEGACY_RE.test(address) || BTC_BECH32_RE.test(address.toLowerCase());
    default:
      return false;
  }
}

export function explorerTxUrl(network: Network, txHash: string): string | null {
  switch (network) {
    case 'TRC20':
      return `https://tronscan.org/#/transaction/${txHash}`;
    case 'ERC20':
      return `https://etherscan.io/tx/${txHash}`;
    case 'BSC':
      return `https://bscscan.com/tx/${txHash}`;
    case 'POLYGON':
      return `https://polygonscan.com/tx/${txHash}`;
    case 'ARBITRUM':
      return `https://arbiscan.io/tx/${txHash}`;
    case 'SOL':
      return `https://solscan.io/tx/${txHash}`;
    case 'BTC':
      return `https://mempool.space/tx/${txHash}`;
    default:
      return null;
  }
}
