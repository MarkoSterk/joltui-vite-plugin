import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import joltui from "../dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function waitForBuild(watcher, timeout = 10_000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            watcher.off("event", onEvent);
            reject(new Error("Timed out waiting for Vite watch build."));
        }, timeout);
        const onEvent = event => {
            if (event.code === "ERROR") {
                clearTimeout(timer);
                watcher.off("event", onEvent);
                reject(event.error);
            } else if (event.code === "END") {
                clearTimeout(timer);
                watcher.off("event", onEvent);
                resolve();
            }
        };
        watcher.on("event", onEvent);
    });
}

async function readAppOutput(outDir) {
    const outputFile = (await readdir(outDir)).find(file => /^app\.(?:js|mjs)$/.test(file));
    assert.ok(outputFile, "Expected Vite to emit the application bundle.");
    return readFile(path.join(outDir, outputFile), "utf8");
}

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

test("build --watch rebuilds when a previously unimported page file is created", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "joltui-plugin-watch-"));
    await cp(path.join(here, "fixtures", "valid"), root, { recursive: true });
    const outDir = path.join(root, "dist");
    const watcher = await build({
        root,
        logLevel: "silent",
        plugins: [joltui()],
        resolve: { alias: { joltui: path.join(root, "src", "joltui.ts") } },
        build: {
            outDir,
            emptyOutDir: true,
            watch: {},
            lib: { entry: path.join(root, "src", "main.ts"), formats: ["es"], fileName: "app" },
        },
    });

    try {
        await waitForBuild(watcher);
        const initialOutput = await readAppOutput(outDir);
        assert.doesNotMatch(initialOutput, /watch-page/);

        const nextBuild = waitForBuild(watcher);
        await writeFile(
            path.join(root, "src", "pages", "watchPage.ts"),
            `import { component, CustomElement, page } from "joltui";\n` +
            `@page("/watch")\n` +
            `@component({ tagName: "watch-page" })\n` +
            `export default class WatchPage extends CustomElement {}\n`,
        );
        await nextBuild;

        const rebuiltOutput = await readAppOutput(outDir);
        assert.match(rebuiltOutput, /watch-page/);
    } finally {
        await watcher.close();
    }
});
