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

```
node test/a11y/axe.mjs
```

`test/vendor/axe-core/` holds axe-core. `axe.mjs` opens every screen in `test/browser/screens.mjs` three times, and fails on any violation of WCAG 2.0 and 2.1 at A and AA and of axe's best practices:

- with the device asking for light;
- with the device asking for dark;
- with the device asking for light and Dark chosen from the planner's theme menu (the top bar's theme switch), so a rule written only for the device's colour scheme, and not for the chosen theme, is caught.

Where a screen has the print preview open, axe runs a second time inside the preview's frame, on the document that goes to paper, which is light in every pass. The frame is sandboxed without scripts, so a script tag put in it never runs and its timers never fire: axe's source is evaluated into the frame from outside, its timers are lent as promise callbacks, and its answer is read from the planner's page. An entry in `ALLOW` with `where: 'print'` is for the frame's document.

A screen (`screens.mjs`) is `{ id, hash, open, viewport, close }`; `close` puts away what `open` started outside the page, such as the other tab that makes the read-only screen read-only. Since SV2-32g1 the list holds every dialog of the planner, every print preview, the read-only second tab, a floor with a traced image (and moving it, scaling and placing it), and Getting started folded and unfolded.

It needs a browser: the site's harness, so `Tools/board-check` has to be installed. `node test/run.mjs --browser` runs it with the journeys.
