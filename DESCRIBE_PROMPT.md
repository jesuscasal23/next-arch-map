# Describe Architecture Graph Nodes

You are given a `next-arch-map` architecture graph JSON file. Your job is to add short descriptions to every node by reading its source code.

## Instructions

1. Read the graph file at `arch/graph.full.json`.
2. For each node in `nodes`, read the source file at `meta.filePath`.
3. Based on the source code and the node's role (`type`, `label`, connected edges), write:
   - `meta.description` — A single sentence (under 80 characters) summarizing what this module does. This is displayed inside the node box in the viewer.
   - `meta.descriptionLong` — 2-3 sentences giving more context: what it renders/handles, key dependencies, or notable behavior. This is shown when clicking the node in the details panel.
4. Write the updated graph back to `arch/graph.full.json`.

## Node types and what to focus on

- **page**: What the page displays to the user and its primary purpose.
- **endpoint**: What the API route handles (CRUD operation, data shape, auth).
- **handler**: What the specific HTTP method does (GET returns what, POST creates what).
- **action**: What the server action does and what it mutates.
- **db**: What the database model represents and its key relationships.

## Style guide

- Write in present tense, third person ("Displays...", "Handles...", "Stores...").
- Be specific — prefer "Displays paginated user list with search" over "Shows users".
- Don't repeat the node label — add information beyond what the name already tells you.
- Keep `description` under 80 characters so it fits in the node box.

## Example

```json
{
  "id": "page:/dashboard",
  "type": "page",
  "label": "/dashboard",
  "meta": {
    "filePath": "app/dashboard/page.tsx",
    "route": "/dashboard",
    "description": "Displays key metrics and recent activity feed",
    "descriptionLong": "Main dashboard page showing KPI cards, a chart of weekly trends, and a scrollable feed of recent user actions. Fetches data from /api/stats and /api/activity endpoints."
  }
}
```

## Running

Point your AI coding assistant at this file:

```
Read DESCRIBE_PROMPT.md and follow the instructions to describe all nodes in arch/graph.full.json.
```
