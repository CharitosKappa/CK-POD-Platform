'use client';

import { useRef } from 'react';

import { CreateExperience } from '../../ux-prototype/app/create-experience';

interface CatalogProduct {
  id: string;
  colors: Array<{ code: string }>;
}

interface ProjectSnapshot {
  id: string;
  revision: number;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'The request could not be completed.');
  return body;
}

export function ProductionCreateExperience() {
  const projectRef = useRef<ProjectSnapshot | null>(null);

  async function createProject(): Promise<ProjectSnapshot> {
    const catalogResponse = await fetch('/api/catalog/products');
    const catalog = await readJson<{ products: CatalogProduct[] }>(catalogResponse);
    const product = catalog.products[0];
    const colorCode =
      product?.colors.find((color) => color.code === 'black')?.code ?? product?.colors[0]?.code;
    if (!product || !colorCode) throw new Error('The product catalog is unavailable.');

    const projectResponse = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productModelId: product.id, colorCode }),
    });
    const result = await readJson<{ project: ProjectSnapshot }>(projectResponse);
    projectRef.current = result.project;
    return result.project;
  }

  async function persistIdea(prompt: string): Promise<void> {
    const project = projectRef.current ?? (await createProject());
    const draftResponse = await fetch(`/api/projects/${encodeURIComponent(project.id)}/draft`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: project.revision, prompt }),
    });
    const saved = await readJson<{ project: ProjectSnapshot }>(draftResponse);
    projectRef.current = saved.project;
  }

  return <CreateExperience onContinueFromIdea={persistIdea} />;
}
