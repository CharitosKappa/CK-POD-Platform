import { describe, expect, it } from 'vitest';

import { getAllowedDevelopmentOrigins } from './dev-origins';

describe('getAllowedDevelopmentOrigins', () => {
  it('allows localhost and the current non-internal IPv4 interfaces', () => {
    const origins = getAllowedDevelopmentOrigins({
      Ethernet: [
        {
          address: '192.168.68.56',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.255.0',
          cidr: '192.168.68.56/24',
          mac: '00:00:00:00:00:00',
        },
      ],
      Loopback: [
        {
          address: '127.0.0.1',
          family: 'IPv4',
          internal: true,
          netmask: '255.0.0.0',
          cidr: '127.0.0.1/8',
          mac: '00:00:00:00:00:00',
        },
        {
          address: '::1',
          family: 'IPv6',
          internal: true,
          netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
          cidr: '::1/128',
          mac: '00:00:00:00:00:00',
          scopeid: 0,
        },
      ],
    });

    expect(origins).toEqual(['127.0.0.1', 'localhost', '192.168.68.56']);
  });

  it('deduplicates addresses and ignores IPv6 interfaces', () => {
    const origins = getAllowedDevelopmentOrigins({
      Ethernet: [
        {
          address: '10.0.0.8',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.255.0',
          cidr: '10.0.0.8/24',
          mac: '00:00:00:00:00:00',
        },
      ],
      Wifi: [
        {
          address: '10.0.0.8',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.255.0',
          cidr: '10.0.0.8/24',
          mac: '00:00:00:00:00:00',
        },
        {
          address: 'fe80::1',
          family: 'IPv6',
          internal: false,
          netmask: 'ffff:ffff:ffff:ffff::',
          cidr: 'fe80::1/64',
          mac: '00:00:00:00:00:00',
          scopeid: 12,
        },
      ],
    });

    expect(origins).toEqual(['127.0.0.1', 'localhost', '10.0.0.8']);
  });
});
