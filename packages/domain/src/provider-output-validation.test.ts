import { describe, expect, it } from 'vitest';

import {
  DefaultGeneratedArtworkValidation,
  DefaultProviderOutputValidation,
} from './provider-output-validation.js';

const validator = new DefaultProviderOutputValidation();
const artworkValidator = new DefaultGeneratedArtworkValidation();
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

describe('generated artwork transparency validation', () => {
  it('accepts visible artwork surrounded by transparent canvas', async () => {
    const transparentArtwork = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFElEQVQYlWNgGDTgPxpmGIQK6QgArZYP8VqFzvAAAAAASUVORK5CYII=',
        'base64',
      ),
    );

    await expect(
      artworkValidator.validate({
        body: transparentArtwork,
        contentType: 'image/png',
        width: 10,
        height: 10,
        productContext: context,
      }),
    ).resolves.toEqual({ accepted: true });
  });

  it('rejects an opaque PNG canvas even when the format is otherwise valid', async () => {
    const opaqueArtwork = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWNISUn5j4wZSBcAAI1YIrEpsRqxAAAAAElFTkSuQmCC',
        'base64',
      ),
    );

    await expect(
      artworkValidator.validate({
        body: opaqueArtwork,
        contentType: 'image/png',
        width: 4,
        height: 4,
        productContext: context,
      }),
    ).resolves.toEqual({
      accepted: false,
      reason: 'Generated artwork must have a transparent canvas around the design.',
    });
  });
});
