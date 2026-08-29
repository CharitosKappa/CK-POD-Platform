/**
 * Product-domain ownership map for the modular monolith. Implemented modules
 * are exported below as their approved milestone foundation is established.
 */
export const domainModules = [
  'identity',
  'sessions',
  'users',
  'projects',
  'project-versions',
  'assets',
  'ai-orchestration',
  'moderation',
  'editor',
  'product-catalog',
  'product-profiles',
  'prepress',
  'mockups',
  'pricing',
  'cart',
  'checkout',
  'payments',
  'taxes',
  'orders',
  'fulfillment',
  'printify-adapter',
  'routing',
  'credits',
  'notifications',
  'analytics',
  'admin',
  'audit-log',
] as const;

export type DomainModule = (typeof domainModules)[number];

export * from './catalog';
export * from './ai-contracts';
export * from './assets';
export * from './ai-providers';
export * from './ai-runtime';
export * from './benchmark';
export * from './credits';
export * from './editor';
export * from './generation-worker';
export * from './generations';
export * from './identity';
export * from './prompt-pipeline';
export * from './projects';
