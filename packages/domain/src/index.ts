/**
 * Product-domain ownership for the modular monolith.  This is a map, not an
 * implementation: Milestone 0 must not introduce later-milestone behaviour.
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
