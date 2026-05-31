# Mermaid Local Editor

Standalone local editor for Mermaid diagrams.
It can still run as a static page, but the recommended mode is the local SQLite server so diagrams and annotations are stored outside a single browser profile.

---

## Usage

```sh
pnpm build:mermaid:full
```

For persistent sharing on the same machine or LAN:

```sh
pnpm copy:editor
pnpm serve:editor:sqlite
```

Then open:

```text
http://localhost:8081/
```

By default data is stored in:

```text
packages/mermaid-local-editor/data/mermaid-local-editor.sqlite
```

The database path can be overridden:

```sh
MERMAID_EDITOR_DB=/absolute/path/mermaid-local-editor.sqlite pnpm serve:editor:sqlite
```

---

## Build Pipeline

The `build:mermaid:full` command performs the following steps:

1. **Clean**

   Removes the existing build output:

   ```sh
   pnpm clean
   ```

2. **Build Mermaid**

   Compiles Mermaid using the repository build pipeline:

   ```sh
   pnpm build:mermaid
   ```

3. **Copy Editor**

   Copies the local editor sources into the distribution directory:

   ```sh
   pnpm copy:editor
   ```

4. **Bundle Dependencies**

   Copies required runtime dependencies into the editor bundle:

   ```sh
   pnpm copy:mermaid
   pnpm copy:dompurify
   ```

5. **Serve**

   Starts a local static server:

   ```sh
   pnpm serve:dist
   ```

   Or starts the SQLite-backed server:

   ```sh
   pnpm serve:editor:sqlite
   ```

---

## Output

After build, the editor is available at [`packages/mermaid/dist/mermaid-local-editor/`](../mermaid/dist/mermaid-local-editor):

---

## Notes

- No external CDN dependencies are used
- DOMPurify is bundled locally
- The editor is fully offline-capable
- SQLite mode persists diagrams, view state and annotations in a local `.sqlite` file
- If SQLite mode is unavailable, the browser falls back to `localStorage`
- Designed to run directly from the `dist/` directory
