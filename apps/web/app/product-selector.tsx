'use client';

import { useEffect, useMemo, useState } from 'react';

interface Product {
  id: string;
  displayName: string;
  description: string;
  startingPriceCents: number;
  developmentOnly: boolean;
  colors: Array<{ code: string; name: string }>;
  sizes: string[];
}

export function ProductSelector() {
  const [products, setProducts] = useState<Product[]>([]);
  const [colorCode, setColorCode] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const product = products[0];

  useEffect(() => {
    void fetch('/api/catalog/products')
      .then(async (response) => {
        if (!response.ok) throw new Error('Catalog unavailable');
        return (await response.json()) as { products: Product[] };
      })
      .then(({ products: fetched }) => {
        setProducts(fetched);
        setColorCode(fetched[0]?.colors[0]?.code);
      })
      .catch(() => setError('The product catalog is temporarily unavailable. Please try again.'));
  }, []);

  const selectedColor = useMemo(
    () => product?.colors.find((color) => color.code === colorCode),
    [colorCode, product],
  );

  async function continueToIdea(): Promise<void> {
    if (!product || !colorCode) return;
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

  if (!product) return <p role="status">Loading product choices…</p>;

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
                onClick={() => setColorCode(color.code)}
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
          onClick={() => void continueToIdea()}
        >
          {saving ? 'Saving your selection…' : 'Describe Your Idea'}
        </button>
      </div>
    </section>
  );
}
