// @jarvishub/canvas-layout — pure, dependency-free canvas layout primitives
// shared by the frontend (apps/web) and backend (apps/hono-api).
//
// Import mechanics (intentionally asymmetric, see docs in each config):
//   - web: path alias `@jarvishub/canvas-layout` -> this index.ts, declared in
//     apps/web/{tsconfig.json, vite.config.ts, _test/vitest.config.ts}.
//   - hono-api: RELATIVE import of the individual source files, because the
//     esbuild bundle uses `packages: 'external'` (bare specifiers are NOT
//     bundled) and Node cannot execute a .ts entry at runtime. A relative
//     import is bundled inline by esbuild and transpiled by ts-node in dev.

export * from './balancedDagLayout'
export * from './textNodeSize'
export * from './incrementalPlacement'
export * from './harnessOrigin'
export * from './turnAwareLayout'
