# Accessibility tests

## `contrast.mjs`: token contrast, in Node

```
node test/a11y/contrast.mjs
```

No browser and no install. It reads `ui/tokens.css` as text and checks:

- every text and surface pair listed in the comment table at the top of `tokens.css`, in the light and the dark theme, at the ratio the table gives (4.5:1 for text; 3:1 for the focus ring, outlines on the plan and the edge of a control);
- that every colour token is in that table, so a new token cannot arrive unchecked;
- that the two dark blocks (chosen, and followed from the device) hold the same values;
- every group colour and load band, at full strength and at the plan's strength over paper, card and grid, against the label `ui/colour.js` draws on it: `labelColour` at 3:1 and `labelOn` at 4.5:1;
- that the group palette and load bands in `tokens.css` are the ones `ui/colour.js` hands out;
- the type scale, spacing, radii and motion values, and that reduced motion zeroes every duration;
- that the six `@font-face` rules load relative files that exist in `fonts/`, and that `tokens.css` names no other address;
- `ui/colour.js` itself: `parse`, `luminance`, `contrast`, `mix`, `readable`, `labelColour`, `labelOn`, `presetFor`.

A failure prints the theme, the pair and the ratio, for example `dark: --ink-2 on --stairs is 3.35:1, needs 4.5:1`, and the process exits non-zero.

### Adding a colour

Put the token in the light block and in both dark blocks of `tokens.css`, then add a row to the comment table saying what is drawn on what. The test fails until all of that is done.

## The axe sweep

`test/vendor/axe-core/` holds axe-core for the sweep of every screen in both themes, which needs a browser and arrives with the page shell.
