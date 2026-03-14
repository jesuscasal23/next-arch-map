# Next.js Dev Route Integration

1. Add a script in your Next.js app:

```json
{
  "scripts": {
    "arch:graph": "next-arch-map analyze --project-root . --out arch/graph.full.json"
  }
}
```

2. Run the analyzer before visiting your dev-only architecture route:

```bash
npm run arch:graph
```

3. In your Next.js `_dev/routes` page, read `arch/graph.full.json` on the server and pass it into a client-side inspector UI.

4. In the UI:

- render the route graph on the left
- show page, endpoint, DB, and UI summaries in the sidebar
- when a page is selected, derive its reachable endpoints and DB entities from the graph edges
