// Client entry for /ui. Bundled by scripts/build-ui.mjs into
// src/ui/client-bundle.gen.ts and inlined into the HTML response.
//
// Templates in the .vue SFCs under ./components are precompiled at build
// time by unplugin-vue, so Vue's runtime template compiler never ships —
// that keeps the bundle compatible with the /ui CSP (no `unsafe-eval`) and
// ~40 KB smaller.

import { createApp } from "vue";
import App from "./components/App.vue";
import type { UiData } from "./lib/types.js";

const dataEl = document.getElementById("ui-data");
const raw = dataEl?.textContent ?? "{}";
const data = JSON.parse(raw) as UiData;

createApp(App, { data }).mount("#app");
