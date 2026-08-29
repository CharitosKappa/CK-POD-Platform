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
export * from './identity';
export * from './projects';
