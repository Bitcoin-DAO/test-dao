# render-mockups

Renders every screen in `design/mockups/` to a PNG in `design/screens/`, in its default state, at 2x resolution.

`support.js` is a small stand-in for the design canvas runtime: it runs each screen's `renderVals()` once and fills in the template (`{{holes}}`, `<sc-if>`, `<sc-for>`). It does not run interactions, so each PNG shows the screen as it first opens. Network access is blocked during rendering; IBM Plex fonts come from the local `@fontsource` packages.

## Use

Needs Node (for the fonts), Python 3 with Playwright, and Google Chrome.

```sh
cd tools/render-mockups
npm install
python3 render.py ../../design/mockups ../../design/screens
```

The Chrome path is set in `render.py` (`/usr/bin/google-chrome`); change it if yours differs.

Note: put rows of a `<table>` directly in the markup. A `<sc-for>` inside `<tbody>` is dropped by the browser's HTML parser.
