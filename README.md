# MMCrypto Reference Direction

A separate visual direction inspired by the supplied MMCRYPTO UI reference: black editorial canvas, electric blue/violet light ribbons, horizontal chapter tabs, a dark video library and quiet article rows. Existing MMCrypto content, membership preview and interaction scripts remain intact.

## Latest UI refresh

The 2026-10-29 refresh enlarges the opening Chris + car portrait into the square right-hand hero composition from the new UI board. The visible portrait canvas is locked to the board’s 357 × 357px proportion on desktop, with proportional tablet and mobile sizing. The unused hero height below the CTA row is removed so the proof rail follows the opening composition more closely. Navigation, controls, labels, metadata and supporting copy use a minimum 12px type size on desktop.

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
