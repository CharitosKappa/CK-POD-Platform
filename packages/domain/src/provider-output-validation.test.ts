import { describe, expect, it } from 'vitest';

import { DefaultProviderOutputValidation } from './provider-output-validation.js';

const validator = new DefaultProviderOutputValidation();
const context = {
  productModelId: 'test',
  productDisplayName: 'Test',
  colorCode: 'black',
  colorName: 'Black',
  printArea: {},
};

function validate(body: Uint8Array, contentType: string, width = 100, height = 100) {
  return validator.validate({ body, contentType, width, height, productContext: context });
}

describe('provider output validation', () => {
  it('rejects MIME spoofing, malformed bytes, unsupported formats and unsafe SVG', async () => {
    await expect(
      validate(new TextEncoder().encode('<svg></svg>'), 'image/png'),
    ).resolves.toMatchObject({
      accepted: false,
    });
    await expect(validate(new Uint8Array([1, 2, 3]), 'image/jpeg')).resolves.toMatchObject({
      accepted: false,
    });
    await expect(validate(new Uint8Array([1]), 'image/gif')).resolves.toMatchObject({
      accepted: false,
    });
    await expect(
      validate(new TextEncoder().encode('<svg><script>alert(1)</script></svg>'), 'image/svg+xml'),
    ).resolves.toMatchObject({ accepted: false });
  });

  it('rejects excessive payloads and pixel dimensions before persistence', async () => {
    await expect(
      validate(new Uint8Array(15 * 1024 * 1024 + 1), 'image/png'),
    ).resolves.toMatchObject({ accepted: false });
    await expect(
      validate(new TextEncoder().encode('<svg></svg>'), 'image/svg+xml', 10_001, 100),
    ).resolves.toMatchObject({ accepted: false });
    await expect(
      validate(new TextEncoder().encode('<svg></svg>'), 'image/svg+xml', 10_000, 10_000),
    ).resolves.toMatchObject({ accepted: false });
  });

  it('accepts a safe SVG only when its content and declared type agree', async () => {
    await expect(
      validate(
        new TextEncoder().encode('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'),
        'image/svg+xml',
      ),
    ).resolves.toEqual({ accepted: true });
  });
});
