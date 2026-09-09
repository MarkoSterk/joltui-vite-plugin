import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import joltui from "../dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("discovers default page exports and injects their registry before the entry", async () => {
    const root = path.join(here, "fixtures", "valid");
    const outDir = await mkdtemp(path.join(os.tmpdir(), "joltui-plugin-"));
    await build({
        root,
        logLevel: "silent",
        plugins: [joltui()],
        resolve: { alias: { joltui: path.join(root, "src", "joltui.ts") } },
        build: {
            outDir,
            emptyOutDir: true,
            lib: { entry: path.join(root, "src", "main.ts"), formats: ["es"], fileName: "app" },
        },
    });
    const output = await readFile(path.join(outDir, "app.js"), "utf8");
    assert.match(output, /home-page/);
    assert.match(output, /profile-page/);
    assert.match(output, /globalThis\.pages/);
    assert.match(output, /application entry/);
});

test("rejects an @page class that is not the default export", async () => {
    const root = path.join(here, "fixtures", "invalid-named");
    const outDir = await mkdtemp(path.join(os.tmpdir(), "joltui-plugin-invalid-"));
    await assert.rejects(
        build({
            root,
            logLevel: "silent",
            plugins: [joltui()],
            build: {
                outDir,
                emptyOutDir: true,
                lib: { entry: path.join(root, "src", "main.ts"), formats: ["es"] },
            },
        }),
        /not the module's default export/,
    );
});
