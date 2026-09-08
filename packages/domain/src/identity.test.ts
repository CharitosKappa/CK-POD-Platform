import { describe, expect, it, vi } from 'vitest';

import {
  generateEmailCode,
  hashEmailCode,
  InMemoryEmailCodeDelivery,
  LocalEmailCodeDelivery,
  normalizeEmail,
} from './identity.js';

describe('passwordless email-code primitives', () => {
  it('normalizes valid email addresses and rejects malformed ones', () => {
    expect(normalizeEmail('  HELLO@EXAMPLE.COM ')).toBe('hello@example.com');
    expect(() => normalizeEmail('not-an-email')).toThrow('Enter a valid email address.');
  });

  it('creates six-digit codes and binds their hashes to the email and pepper', () => {
    const code = generateEmailCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(hashEmailCode('person@example.com', code, 'test-pepper')).not.toBe(
      hashEmailCode('other@example.com', code, 'test-pepper'),
    );
    expect(hashEmailCode('person@example.com', code, 'test-pepper')).not.toBe(
      hashEmailCode('person@example.com', code, 'other-pepper'),
    );
  });

  it('keeps test delivery in memory and local delivery confined to the local log', async () => {
    const memory = new InMemoryEmailCodeDelivery();
    const expiresAt = new Date('2026-09-08T12:00:00.000Z');
    await memory.deliver({ email: 'person@example.com', code: '482916', expiresAt });
    expect(memory.latestCodeFor('PERSON@example.com')).toBe('482916');

    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await new LocalEmailCodeDelivery().deliver({
      email: 'person@example.com',
      code: '482916',
      expiresAt,
    });
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('development.email_login_code_delivered'),
    );
    info.mockRestore();
  });
});
