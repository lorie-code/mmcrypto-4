# MMCrypto Reference Direction

A separate visual direction inspired by the supplied MMCRYPTO UI reference: black editorial canvas, electric blue/violet light ribbons, horizontal chapter tabs, a dark video library and quiet article rows. Existing MMCrypto content, membership preview and interaction scripts remain intact.

## Preview

From the repository root, serve `outputs`:

```bash
python3 -m http.server 4173 --directory outputs
```

Then open:

`http://127.0.0.1:4173/mmcrypto-reference/`

## Files

- `index.html` — page markup and content
- `reference.css` — isolated reference art direction (`reference-site` body class)
- `assets/mmcrypto-ribbon-field.svg` — blue/violet flow ribbon field used in the opening hero
- existing JS/CSS/assets — inherited from `mmcrypto-prism-bright`, unchanged
