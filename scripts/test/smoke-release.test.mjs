import assert from "node:assert/strict";
import test from "node:test";
import { staticAssetPaths } from "../smoke-release.mjs";

test("release smoke discovers every local script and stylesheet asset", () => {
  assert.deepEqual(staticAssetPaths('<link rel="stylesheet" href="./assets/app.css"><script src="./assets/app.js"></script><img src="data:image/png;base64,x">'), [
    "./assets/app.css",
    "./assets/app.js"
  ]);
});
