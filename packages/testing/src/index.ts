/** Shared deterministic values for unit and integration tests. */
export const testEnvironment = {
  databaseUrl: 'postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe_test',
  redisUrl: 'redis://localhost:6379/1',
} as const;
