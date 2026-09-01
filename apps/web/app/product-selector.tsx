'use client';

import React, { useCallback, useEffect, useState } from 'react';

export interface Product {
  id: string;
  displayName: string;
  description: string;
  startingPriceCents: number;
  developmentOnly: boolean;
  colors: Array<{ code: string; name: string }>;
  sizes: string[];
}

type ProductCatalog = [Product, ...Product[]];

export type ProductCatalogState =
  | { status: 'loading' }
  | { products: ProductCatalog; status: 'ready' }
  | { message: string; status: 'error' };

const catalogUnavailableMessage =
  'The product catalog is temporarily unavailable. Please try again.';
const catalogRequestTimeoutMs = 10_000;

export async function fetchProductCatalog(
  request: typeof fetch = fetch,
  timeoutMs = catalogRequestTimeoutMs,
): Promise<ProductCatalog> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await request('/api/catalog/products', { signal: controller.signal });
    if (!response.ok) throw new Error('Catalog unavailable');

    const body = (await response.json()) as { products: Product[] };
    const firstProduct = body.products[0];
    if (!firstProduct) throw new Error('Catalog unavailable');
    return [firstProduct, ...body.products.slice(1)];
  } finally {
    clearTimeout(timeout);
  }
}

export function ProductSelectorView({
  catalog,
  colorCode,
  error,
  onColorChange,
  onContinue,
  onRetry,
  saving,
}: {
  catalog: ProductCatalogState;
  colorCode: string | undefined;
  error: string | undefined;
  onColorChange: (colorCode: string) => void;
  onContinue: () => void;
  onRetry: () => void;
  saving: boolean;
}) {
  if (catalog.status === 'loading') return <p role="status">Loading product choices…</p>;

  if (catalog.status === 'error') {
    return (
      <section aria-labelledby="catalog-error-title" className="selector">
        <h1 id="catalog-error-title">Product choices are unavailable</h1>
        <p className="form-error" role="alert">
          {catalog.message}
        </p>
        <button className="continue" onClick={onRetry} type="button">
          Try again
        </button>
      </section>
    );
  }

  const product = catalog.products[0];
  const selectedColor = product.colors.find((color) => color.code === colorCode);

  return (
    <section className="selector" aria-labelledby="product-title">
      <div className="product-preview" aria-label={`${product.displayName} preview`}>
        <div className={`tee tee-${colorCode}`} />
      </div>
      <div className="selector-copy">
        <p className="eyebrow">Step 1 of 5 · Choose Product</p>
        <h1 id="product-title">Create Your T-Shirt</h1>
        <p>{product.description}</p>
        <p className="price">From ${(product.startingPriceCents / 100).toFixed(2)}</p>
        {product.developmentOnly ? (
          <p className="development-note">Development catalog and pricing</p>
        ) : null}
        <fieldset>
          <legend>Choose color</legend>
          <div className="color-options">
            {product.colors.map((color) => (
              <button
                className={`color-choice color-${color.code}`}
                key={color.code}
                type="button"
                aria-pressed={color.code === colorCode}
                onClick={() => onColorChange(color.code)}
              >
                <span aria-hidden="true" />
                {color.name}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="size-note">Available sizes: {product.sizes.join(', ')}</p>
        {selectedColor ? <p className="selected-color">{selectedColor.name} selected</p> : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="continue"
          type="button"
          disabled={!colorCode || saving}
          onClick={onContinue}
        >
          {saving ? 'Saving your selection…' : 'Describe Your Idea'}
        </button>
      </div>
    </section>
  );
}

export function ProductSelector() {
  const [catalog, setCatalog] = useState<ProductCatalogState>({ status: 'loading' });
  const [colorCode, setColorCode] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const loadCatalog = useCallback(async () => {
    setCatalog({ status: 'loading' });
    try {
      const products = await fetchProductCatalog();
      setCatalog({ products, status: 'ready' });
      setColorCode(products[0].colors.at(0)?.code);
    } catch {
      setCatalog({ message: catalogUnavailableMessage, status: 'error' });
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  async function continueToIdea(): Promise<void> {
    if (catalog.status !== 'ready' || !colorCode) return;
    const product = catalog.products[0];
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productModelId: product.id, colorCode }),
      });
      const body = (await response.json()) as { project?: { id: string }; error?: string };
      if (!response.ok || !body.project)
        throw new Error(body.error ?? 'Could not save your selection.');
      window.location.assign(`/describe?project=${encodeURIComponent(body.project.id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save your selection.');
      setSaving(false);
    }
  }

  return (
    <ProductSelectorView
      catalog={catalog}
      colorCode={colorCode}
      error={error}
      onColorChange={setColorCode}
      onContinue={() => void continueToIdea()}
      onRetry={() => void loadCatalog()}
      saving={saving}
    />
  );
}
