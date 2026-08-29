import type { SqlClient } from '@let-it-be/db';

export interface CatalogProduct {
  id: string;
  displayName: string;
  description: string;
  startingPriceCents: number;
  imageUrl: string;
  developmentOnly: boolean;
  colors: Array<{ code: string; name: string; imageUrl: string }>;
  sizes: string[];
}

interface ProductRow {
  id: string;
  display_name: string;
  description: string;
  starting_price_cents: number;
  image_url: string;
  development_only: boolean;
  color_code: string;
  color_name: string;
  variant_image_url: string;
  size: string;
}

export class ProductCatalogService {
  public constructor(private readonly db: SqlClient) {}

  async listActiveProducts(): Promise<CatalogProduct[]> {
    const result = await this.db.query<ProductRow>(
      `SELECT p.id, p.display_name, p.description, p.starting_price_cents, p.image_url,
              p.development_only, v.color_code, v.color_name, v.image_url AS variant_image_url, v.size
       FROM app.product_models p
       JOIN app.product_variants v ON v.product_model_id = p.id
       WHERE p.status = 'ACTIVE' AND v.status = 'ACTIVE'
       ORDER BY p.display_name, v.color_name, v.size`,
    );
    return toProducts(result.rows);
  }

  async assertSelectable(productId: string, colorCode: string): Promise<void> {
    const result = await this.db.query<{ id: string }>(
      `SELECT p.id
       FROM app.product_models p
       JOIN app.product_variants v ON v.product_model_id = p.id
       WHERE p.id = $1 AND v.color_code = $2 AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
       LIMIT 1`,
      [productId, colorCode],
    );
    if (!result.rows[0]) throw new Error('Selected product color is unavailable.');
  }
}

function toProducts(rows: ProductRow[]): CatalogProduct[] {
  const products = new Map<string, CatalogProduct>();
  for (const row of rows) {
    const product = products.get(row.id) ?? {
      id: row.id,
      displayName: row.display_name,
      description: row.description,
      startingPriceCents: row.starting_price_cents,
      imageUrl: row.image_url,
      developmentOnly: row.development_only,
      colors: [],
      sizes: [],
    };
    if (!product.colors.some((color) => color.code === row.color_code)) {
      product.colors.push({
        code: row.color_code,
        name: row.color_name,
        imageUrl: row.variant_image_url,
      });
    }
    if (!product.sizes.includes(row.size)) product.sizes.push(row.size);
    products.set(row.id, product);
  }
  return [...products.values()];
}
