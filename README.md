# @jubasjl76-eng/api-client

The typed TypeScript client for the Smart Pet API. Repo: `smart-pet-api-client`.

`src/schema.d.ts` is **generated** from `smart-pet-backend`'s `openapi.json`
(`npm run codegen`; a daily `regen` workflow opens a PR when it drifts). The
runtime is a thin `openapi-fetch` wrapper.

## Install

Git-tag dependency (repo is public; no registry auth):

```json
"@jubasjl76-eng/api-client": "git+https://github.com/jubasjl76-eng/smart-pet-api-client.git#api-client-v0.1.0"
```

## Use

```ts
import { createSmartPetClient, RateLimitedError } from '@jubasjl76-eng/api-client';

const api = createSmartPetClient({
  baseUrl: '/api/v1',
  token: () => localStorage.getItem('token'),
});

const { data, error } = await api.POST('/api/auth/login', {
  body: { email, password },
});
```

- **Bearer auth** from the `token` getter, per request.
- **Retry** with jittered exponential backoff on `429` / `5xx` / network errors
  (honours `Retry-After`). Only idempotent methods + POSTs carrying an
  `Idempotency-Key`. `RateLimitedError` once retries are exhausted.
- Fully typed paths / params / bodies / responses from the OpenAPI spec — only
  routes migrated onto the backend's zod registry are present (growing).

`createRawClient` is re-exported for an unwrapped `openapi-fetch` client.
