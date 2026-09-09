'use client';

import { useEffect, useRef, useState } from 'react';

import { createClientIdempotencyKey } from '../lib/client-id';

import {
  CreateExperience,
  type ColorId,
  type CartItem,
  type CartPersistenceResult,
  type CheckoutCompletionInput,
  type CheckoutCompletionResult,
  type CreateExperienceProps,
  type EditorTransform,
  type GenerationLifecyclePhase,
  type GenerationLifecycleResult,
  type ReferenceImageState,
  type SizeId,
  type StyleId,
  type ToneId,
} from '../../ux-prototype/app/create-experience';

interface CatalogProduct {
  id: string;
  colors: Array<{ code: string }>;
}

interface ProjectSnapshot {
  id: string;
  productModelId: string | null;
  selectedColorCode: string | null;
  revision: number;
}

interface CreationDraftSnapshot {
  prompt: string;
  referenceAssetIds: string[];
  prototypeStyleId: string | null;
  prototypeToneId: string;
  selectedSize: string | null;
}

interface ReferenceMutationResponse {
  projectRevision: number;
  asset: { id: string } | null;
}

interface GenerationSnapshot {
  id: string;
  status:
    | 'QUEUED'
    | 'PROCESSING'
    | 'VALIDATING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'REJECTED_INTERNAL'
    | 'CANCELLED';
  previewAsset: { id: string } | null;
}

interface CartSnapshot {
  id: string;
  revision: number;
  status: string;
  items: CartLineSnapshot[];
  item: CartLineSnapshot | null;
}

interface CartLineSnapshot {
    id: string;
    projectId: string;
    previewAssetId: string;
    designPreviewAssetId: string | null;
    colorCode: string;
    colorName: string;
    size: string;
    quantity: number;
    unitPriceCents: number;
}

interface CheckoutSnapshot {
  id: string;
  pricing: {
    subtotalCents: number;
    customerShippingCents: number;
    taxCents: number;
    totalCents: number;
  };
}

interface PrepressSnapshot {
  status:
    'PENDING' | 'RENDERING' | 'VALIDATING' | 'PASSED' | 'REVIEW_REQUIRED' | 'BLOCKED' | 'FAILED';
}

const activeCreationKey = 'let-it-be-active-creation-project';
const activeCartKey = 'let-it-be-active-cart';

class ApiRequestError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new ApiRequestError(body.error ?? 'The request could not be completed.', response.status);
  }
  return body;
}

export function ProductionCreateExperience() {
  const projectRef = useRef<ProjectSnapshot | null>(null);
  const cartRef = useRef<CartSnapshot | null>(null);
  const [initialCreation, setInitialCreation] = useState<
    CreateExperienceProps['initialCreation'] | undefined
  >();
  const [creditBalance, setCreditBalance] = useState<number>();
  const [initialCart, setInitialCart] = useState<CartItem[]>();
  const [resumeState, setResumeState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let active = true;
    const resume = async () => {
      try {
        const creditResponse = await fetch('/api/credits', { cache: 'no-store' });
        const creditAccount = await readJson<{ balance: number }>(creditResponse);
        if (!active) return;
        setCreditBalance(creditAccount.balance);

        let creation = emptyCreation();
        const projectId = window.localStorage.getItem(activeCreationKey);
        if (projectId) {
          const [projectResponse, draftResponse] = await Promise.all([
            fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: 'no-store' }),
            fetch(`/api/projects/${encodeURIComponent(projectId)}/draft`, { cache: 'no-store' }),
          ]);
          const [{ project }, { draft }] = await Promise.all([
            readJson<{ project: ProjectSnapshot }>(projectResponse),
            readJson<{ draft: CreationDraftSnapshot }>(draftResponse),
          ]);
          if (!active) return;
          projectRef.current = project;
          const referenceId = draft.referenceAssetIds[0];
          creation = {
            step: draft.prototypeStyleId ? 'product' : draft.prompt ? 'style' : 'idea',
            prompt: draft.prompt,
            reference: referenceId
              ? {
                  assetId: referenceId,
                  name: 'Reference image',
                  url: referencePreviewUrl(project.id, referenceId),
                }
              : null,
            style: draft.prototypeStyleId as StyleId | null,
            tone: draft.prototypeToneId as ToneId,
            color: (project.selectedColorCode ?? 'black') as ColorId,
            size: draft.selectedSize as SizeId | null,
          };
          setInitialCreation(creation);
        }
        const cartId = window.localStorage.getItem(activeCartKey);
        if (cartId) {
          try {
            const cartResponse = await fetch(`/api/carts/${encodeURIComponent(cartId)}`, {
              cache: 'no-store',
            });
            const { cart } = await readJson<{ cart: CartSnapshot }>(cartResponse);
            if (cart.items.length && cart.status === 'READY') {
              cartRef.current = cart;
              setInitialCart(cart.items.map((item) => cartItemFromSnapshot(item, creation)));
            } else {
              window.localStorage.removeItem(activeCartKey);
            }
          } catch (error) {
            if (!(error instanceof ApiRequestError) || error.status !== 404) throw error;
            window.localStorage.removeItem(activeCartKey);
          }
        }
        setResumeState('ready');
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiRequestError && error.status === 404) {
          window.localStorage.removeItem(activeCreationKey);
          setResumeState('ready');
          return;
        }
        setResumeState('failed');
      }
    };
    void resume();
    return () => {
      active = false;
    };
  }, []);

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
    window.localStorage.setItem(activeCreationKey, result.project.id);
    return result.project;
  }

  async function persistDraft(patch: Record<string, string | null>): Promise<void> {
    const project = projectRef.current ?? (await createProject());
    const draftResponse = await fetch(`/api/projects/${encodeURIComponent(project.id)}/draft`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: project.revision, ...patch }),
    });
    const saved = await readJson<{ project: ProjectSnapshot }>(draftResponse);
    projectRef.current = saved.project;
  }

  async function persistIdea(prompt: string): Promise<void> {
    await persistDraft({ prompt });
  }

  async function persistStyle(selection: { style: string; tone: string }): Promise<void> {
    const project = projectRef.current ?? (await createProject());
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/creation-style`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: project.revision,
        prototypeStyleId: selection.style,
        prototypeToneId: selection.tone,
      }),
    });
    const saved = await readJson<{ project: ProjectSnapshot }>(response);
    projectRef.current = saved.project;
  }

  async function persistProduct(selection: { color: string; size: string }): Promise<void> {
    const project = projectRef.current ?? (await createProject());
    if (!project.productModelId) throw new Error('The product catalog is unavailable.');
    const response = await fetch(
      `/api/projects/${encodeURIComponent(project.id)}/creation-product`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: project.revision,
          productModelId: project.productModelId,
          colorCode: selection.color,
          selectedSize: selection.size,
        }),
      },
    );
    const saved = await readJson<{ project: ProjectSnapshot }>(response);
    projectRef.current = saved.project;
  }

  async function persistReference(file: File): Promise<ReferenceImageState> {
    const project = projectRef.current ?? (await createProject());
    const form = new FormData();
    form.set('file', file);
    form.set('expectedRevision', String(project.revision));
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/reference`, {
      method: 'POST',
      body: form,
    });
    const saved = await readJson<ReferenceMutationResponse>(response);
    const assetId = saved.asset?.id;
    if (!assetId) throw new Error('The reference image was not saved.');
    projectRef.current = { ...project, revision: saved.projectRevision };
    return {
      assetId,
      name: file.name,
      url: referencePreviewUrl(project.id, assetId),
    };
  }

  async function removeReference(assetId: string): Promise<void> {
    const project = projectRef.current;
    if (!project) return;
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/reference`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId, expectedRevision: project.revision }),
    });
    const saved = await readJson<ReferenceMutationResponse>(response);
    projectRef.current = { ...project, revision: saved.projectRevision };
  }

  async function generateDesign(
    input: { prompt: string; referenceAssetIds: string[] },
    reportPhase: (phase: GenerationLifecyclePhase) => void,
  ): Promise<GenerationLifecycleResult> {
    const project = projectRef.current;
    if (!project) throw new Error('Your design project could not be found.');
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    let { generation } = await readJson<{ generation: GenerationSnapshot }>(response);
    reportPhase(generationPhase(generation.status));

    for (let poll = 0; poll < 120; poll += 1) {
      if (generation.status === 'SUCCEEDED') {
        const previewAssetId = generation.previewAsset?.id;
        if (!previewAssetId) throw new Error('The generated preview is not available yet.');
        const creditResponse = await fetch('/api/credits', { cache: 'no-store' });
        const creditAccount = await readJson<{ balance: number }>(creditResponse);
        return {
          creditBalance: creditAccount.balance,
          generationId: generation.id,
          previewAssetId,
          previewUrl: referencePreviewUrl(project.id, previewAssetId),
        };
      }
      if (
        generation.status === 'FAILED' ||
        generation.status === 'REJECTED_INTERNAL' ||
        generation.status === 'CANCELLED'
      ) {
        throw new Error(
          generation.status === 'REJECTED_INTERNAL'
            ? 'We couldn’t use that request. Try a different idea or reference image. Your credit wasn’t used.'
            : 'We couldn’t create this version. Your credit wasn’t used.',
        );
      }
      await wait(500);
      const statusResponse = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/generations/${encodeURIComponent(generation.id)}`,
        { cache: 'no-store' },
      );
      generation = (await readJson<{ generation: GenerationSnapshot }>(statusResponse)).generation;
      reportPhase(generationPhase(generation.status));
    }
    throw new Error('This design is taking longer than expected. Please try again.');
  }

  async function addToCart(input: {
    generationId: string;
    size: SizeId;
    transform: EditorTransform;
  }): Promise<CartPersistenceResult> {
    const project = projectRef.current;
    if (!project) throw new Error('Your design project could not be found.');
    const deliveredResponse = await fetch(
      `/api/projects/${encodeURIComponent(project.id)}/delivered-design`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: project.revision,
          generationId: input.generationId,
          transform: input.transform,
        }),
      },
    );
    const delivered = await readJson<{ project: ProjectSnapshot }>(deliveredResponse);
    projectRef.current = delivered.project;

    let prepress = (
      await readJson<{ prepress: PrepressSnapshot }>(
        await fetch(`/api/projects/${encodeURIComponent(project.id)}/prepress`, {
          method: 'POST',
        }),
      )
    ).prepress;
    for (let poll = 0; poll < 120; poll += 1) {
      if (prepress.status === 'PASSED' || prepress.status === 'REVIEW_REQUIRED') break;
      if (prepress.status === 'BLOCKED') {
        throw new Error('This placement needs an adjustment before it can be printed.');
      }
      if (prepress.status === 'FAILED') {
        throw new Error('We couldn’t prepare the print file. Please try again.');
      }
      await wait(500);
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/prepress`, {
        cache: 'no-store',
      });
      const latest = await readJson<{ prepress: PrepressSnapshot | null }>(response);
      if (!latest.prepress) throw new Error('The print-quality check is unavailable.');
      prepress = latest.prepress;
    }
    if (prepress.status !== 'PASSED' && prepress.status !== 'REVIEW_REQUIRED') {
      throw new Error('The print-quality check is taking longer than expected. Please try again.');
    }
    const cartResponse = await fetch('/api/carts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, size: input.size.toUpperCase(), quantity: 1 }),
    });
    const { cart } = await readJson<{ cart: CartSnapshot }>(cartResponse);
    cartRef.current = cart;
    window.localStorage.setItem(activeCartKey, cart.id);
    return cartPersistenceResult(cart, project.id);
  }

  async function updateCartQuantity(itemId: string, quantity: number): Promise<CartPersistenceResult> {
    const cart = cartRef.current;
    if (!cart) throw new Error('Your cart could not be found.');
    const response = await fetch(`/api/carts/${encodeURIComponent(cart.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemId, expectedRevision: cart.revision, quantity }),
    });
    const saved = await readJson<{ cart: CartSnapshot }>(response);
    cartRef.current = saved.cart;
    return cartPersistenceResult(saved.cart, undefined, itemId);
  }

  async function removeCart(itemId: string): Promise<void> {
    const cart = cartRef.current;
    if (!cart) return;
    const response = await fetch(`/api/carts/${encodeURIComponent(cart.id)}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemId, expectedRevision: cart.revision }),
    });
    const { cart: saved } = await readJson<{ cart: CartSnapshot }>(response);
    cartRef.current = saved.items.length ? saved : null;
    if (!saved.items.length) window.localStorage.removeItem(activeCartKey);
  }

  function createAnotherDesign(): void {
    projectRef.current = null;
    window.localStorage.removeItem(activeCreationKey);
  }

  async function completeCheckout(
    input: CheckoutCompletionInput,
  ): Promise<CheckoutCompletionResult> {
    const cart = cartRef.current;
    if (!cart) throw new Error('Your cart could not be found.');

    await readJson<{ approved: boolean }>(
      await fetch(`/api/carts/${encodeURIComponent(cart.id)}/proof`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    const recipientName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
    const addressResponse = await fetch(`/api/carts/${encodeURIComponent(cart.id)}/address`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipientName,
        email: input.email,
        line1: input.address,
        line2: input.apartment,
        city: input.city,
        stateCode: input.state,
        postalCode: input.zip,
        countryCode: 'US',
        ...(input.mobile ? { phone: input.mobile } : {}),
      }),
    });
    const { addressId } = await readJson<{ addressId: string }>(addressResponse);
    const checkoutResponse = await fetch(`/api/carts/${encodeURIComponent(cart.id)}/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ addressId, idempotencyKey: createClientIdempotencyKey() }),
    });
    const { checkout } = await readJson<{ checkout: CheckoutSnapshot }>(checkoutResponse);
    const confirmationResponse = await fetch(
      `/api/checkout/${encodeURIComponent(checkout.id)}/fake-confirm`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome: 'SUCCEEDED' }),
      },
    );
    const confirmation = await readJson<{ orderNumber: string | null }>(confirmationResponse);
    if (!confirmation.orderNumber) throw new Error('Your order is still being confirmed.');

    cartRef.current = null;
    window.localStorage.removeItem(activeCartKey);
    return {
      orderNumber: confirmation.orderNumber,
      pricing: {
        subtotalCents: checkout.pricing.subtotalCents,
        shippingCents: checkout.pricing.customerShippingCents,
        taxCents: checkout.pricing.taxCents,
        totalCents: checkout.pricing.totalCents,
      },
    };
  }

  if (resumeState === 'loading') return null;
  if (resumeState === 'failed') {
    return (
      <main className="prototype theme-a">
        <section className="phone-stage composition-canvas">
          <div className="flow-error-state" role="alert">
            <p>We couldn’t restore your design.</p>
            <button onClick={() => window.location.reload()} type="button">
              Try again
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <CreateExperience
      {...(creditBalance === undefined ? {} : { creditBalance })}
      {...(initialCreation ? { initialCreation } : {})}
      onContinueFromIdea={persistIdea}
      onContinueFromProduct={persistProduct}
      onContinueFromStyle={persistStyle}
      onGenerateDesign={generateDesign}
      onAddToCart={addToCart}
      onAccountAccess={() => {
        window.location.assign('/sign-in?returnTo=/account');
      }}
      onCartQuantityChange={updateCartQuantity}
      onCartRemove={removeCart}
      onCreateAnotherDesign={createAnotherDesign}
      onCheckoutCompleted={completeCheckout}
      {...(initialCart ? { initialCart } : {})}
      onReferenceRemoved={removeReference}
      onReferenceSelected={persistReference}
    />
  );
}

function cartPersistenceResult(
  cart: CartSnapshot,
  projectId?: string,
  itemId?: string,
): CartPersistenceResult {
  const item = itemId
    ? cart.items.find((candidate) => candidate.id === itemId)
    : [...cart.items].reverse().find((candidate) => candidate.projectId === projectId);
  if (!item) throw new Error('The cart item is unavailable.');
  if (!item.designPreviewAssetId) {
    throw new Error('The saved design preview is unavailable. Please add the design again.');
  }
  return {
    id: item.id,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    previewUrl: referencePreviewUrl(item.projectId, item.designPreviewAssetId),
  };
}

function cartItemFromSnapshot(
  item: CartLineSnapshot,
  creation: NonNullable<CreateExperienceProps['initialCreation']>,
): CartItem {
  return {
    id: item.id,
    prompt: creation.prompt,
    style: creation.style,
    tone: creation.tone,
    color: item.colorCode as ColorId,
    size: item.size.toLowerCase() as SizeId,
    generationVersion: 0,
    ...(item.designPreviewAssetId
      ? { generatedPreviewUrl: referencePreviewUrl(item.projectId, item.designPreviewAssetId) }
      : {}),
    transform: { x: 50, y: 50, scale: 1, rotation: 0, flipped: false },
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
  };
}

function emptyCreation(): NonNullable<CreateExperienceProps['initialCreation']> {
  return {
    step: 'idea',
    prompt: '',
    reference: null,
    style: null,
    tone: 'auto',
    color: 'black',
    size: null,
  };
}

function referencePreviewUrl(projectId: string, assetId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/preview`;
}

function generationPhase(status: GenerationSnapshot['status']): GenerationLifecyclePhase {
  if (status === 'PROCESSING') return 'processing';
  if (status === 'VALIDATING' || status === 'SUCCEEDED') return 'validating';
  return 'queued';
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
