# dsh-simple-pin

Pin workspace / session rows to the **top** of the DSH Web sidebar — via the
native **"…"** menu of each row. No extra icon buttons, no settings panel, no
bloat. One small host plugin that does exactly one thing.

![Pinned sidebar — 5TORCHES and DUONGKHANH floated to the top with 📌 markers](https://raw.githubusercontent.com/phuongncn/dsh-simple-pin/main/assets/sidebar.png)

## Why "simple"

Most sidebar-pin plugins add their own UI (floating buttons, new panels, config
pages). `dsh-simple-pin` reuses the menu you already have: open **…** on any
workspace or session row → **📌 Pin / 📌 Unpin**. Pinned rows float to the top of
their list. That's the whole feature.

## Install

```sh
dsh plugin --profile web add @phuongncn/dsh-simple-pin
```

Then reload the DSH Web UI (HMR usually applies it instantly).

## How it works

- **Pin workspace** → that workspace jumps to the top of the workspace list.
- **Pin session** → that session jumps to the top of its workspace's session list.
- Pins are stored **host-side** at `~/.dsh/simple-pin.json` and shared across
  every machine / browser you use.
- Pins are keyed by the **real workspace/session ID** (resolved from
  `/api/workspace.list` and `/api/session.list`), so renaming a session or
  workspace does **not** drop the pin.
- A `📌` marker is shown before pinned rows.
- Sorting is done with a `MutationObserver` + `requestAnimationFrame` debounce;
  the DOM is only touched when the real order actually changed.

## Manual install (no npm)

If you prefer not to use the registry, copy the plugin file into your DSH
plugins directory and mount it:

```sh
cp dsh-simple-pin.mjs ~/.dsh/plugins/
```

Then add to your profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-simple-pin
      name: "file:///home/<you>/.dsh/plugins/dsh-simple-pin.mjs"
```

## Uninstall

```sh
dsh plugin --profile web remove @phuongncn/dsh-simple-pin
```

Your `~/.dsh/simple-pin.json` is left in place; delete it manually if you want
a clean slate.

## License

[MIT](./LICENSE)
