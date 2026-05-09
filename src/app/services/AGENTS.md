# Service Layer Notes

Only files in this directory and `indexer/**` may import `@/db`.

Routes, server actions, and components must call service methods instead of using Drizzle directly. Keep service exports as object defaults, matching the `validatorinfo` style:

```ts
const exampleService = { method };
export default exampleService;
```

Keep methods small and specific. Shared pure helpers belong in `src/lib/**`, not in services.
