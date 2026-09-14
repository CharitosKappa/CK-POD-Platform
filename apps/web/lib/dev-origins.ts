import type { NetworkInterfaceInfo } from 'node:os';

type NetworkInterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

/**
 * Build the Next.js development-origin allowlist from the machine's active IPv4
 * interfaces. This keeps phone previews working when DHCP assigns a new LAN IP,
 * without opening development assets to arbitrary origins.
 */
export function getAllowedDevelopmentOrigins(interfaces: NetworkInterfaceMap): string[] {
  const origins = new Set(['127.0.0.1', 'localhost']);

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        origins.add(entry.address);
      }
    }
  }

  return [...origins];
}
