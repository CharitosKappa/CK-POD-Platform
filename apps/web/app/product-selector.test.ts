import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  fetchProductCatalog,
  ProductSelectorView,
  type Product,
  type ProductCatalogState,
} from './product-selector.js';

const product: Product = {
  id: 'essential-dtg-tee',
  displayName: 'Essential DTG T-Shirt',
  description: 'A development-only MVP T-shirt seed for product selection.',
  startingPriceCents: 2900,
  developmentOnly: true,
  colors: [
    { code: 'black', name: 'Black' },
    { code: 'navy', name: 'Navy' },
  ],
  sizes: ['S', 'M'],
};

function renderCatalogState(catalog: ProductCatalogState): string {
  return renderToStaticMarkup(
    createElement(ProductSelectorView, {
      catalog,
      colorCode: 'black',
      error: undefined,
      onColorChange: vi.fn(),
      onContinue: vi.fn(),
      onRetry: vi.fn(),
      saving: false,
    }),
  );
}

function successfulResponse(products: Product[]): Response {
  return {
    ok: true,
    json: async () => ({ products }),
  } as Response;
}

describe('ProductSelector catalog states', () => {
  it('renders a loading status while the catalog request is pending', () => {
    const markup = renderCatalogState({ status: 'loading' });

    expect(markup).toContain('Loading product choices…');
    expect(markup).toContain('role="status"');
  });

  it('renders products after a successful catalog request', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(successfulResponse([product]));
    const products = await fetchProductCatalog(request);
    const markup = renderCatalogState({ products, status: 'ready' });

    expect(markup).toContain('Essential DTG T-Shirt');
    expect(markup).toContain('Black');
    expect(markup).toContain('From $29.00');
  });

  it('renders the consumer-safe error and exits loading when catalog retrieval fails', () => {
    const markup = renderCatalogState({
      message: 'The product catalog is temporarily unavailable. Please try again.',
      status: 'error',
    });

    expect(markup).toContain('The product catalog is temporarily unavailable. Please try again.');
    expect(markup).toContain('Try again');
    expect(markup).not.toContain('Loading product choices…');
  });

  it('can retry after a failed request and recover on the next successful request', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(successfulResponse([product]));

    await expect(fetchProductCatalog(request)).rejects.toThrow('network unavailable');
    await expect(fetchProductCatalog(request)).resolves.toEqual([product]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/catalog/products',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/api/catalog/products',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('aborts a stalled catalog request so loading cannot continue indefinitely', async () => {
    const request = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('catalog timed out')));
        }),
    ) as typeof fetch;

    await expect(fetchProductCatalog(request, 1)).rejects.toThrow('catalog timed out');
  });
});
