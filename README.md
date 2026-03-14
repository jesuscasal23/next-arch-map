# next-arch-map

Static analyzer that builds a multi-layer graph for Next.js-style apps. The graph can contain pages, endpoints, DB entities, and UI components.

## Quickstart

```bash
npm install --save-dev next-arch-map
npx next-arch-map analyze --project-root . --out arch/graph.full.json
```

## What It Produces

`next-arch-map` emits a single JSON graph:

```json
{
  "nodes": [
    { "id": "page:/dashboard", "type": "page", "label": "/dashboard" },
    { "id": "endpoint:/api/users", "type": "endpoint", "label": "/api/users" },
    { "id": "db:user", "type": "db", "label": "user" },
    { "id": "ui:ProfileCard", "type": "ui", "label": "ProfileCard" }
  ],
  "edges": [
    { "from": "page:/dashboard", "to": "endpoint:/api/users", "kind": "page-endpoint" },
    { "from": "endpoint:/api/users", "to": "db:user", "kind": "endpoint-db" },
    { "from": "page:/dashboard", "to": "ui:ProfileCard", "kind": "page-ui" }
  ]
}
```

## CLI

```bash
npx next-arch-map analyze --project-root . --out arch/graph.full.json
```

The CLI accepts:

- `--project-root <path>`
- `--out <path>`
- `--app-dir <path>` (repeatable)

## Library API

```ts
import { analyzeProject } from "next-arch-map";

const graph = await analyzeProject({
  projectRoot: process.cwd(),
});
```

## Notes

- Page to endpoint detection currently looks for direct string-literal HTTP calls such as `fetch("/api/...")`, `axios.get("/api/...")`, and `apiClient.get("/api/...")`.
- Endpoint to DB detection currently looks for Prisma-style calls such as `prisma.user.findMany(...)`.
- Page to UI detection currently looks at page imports that resolve into component-like paths.
