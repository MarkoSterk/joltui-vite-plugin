# JoltUI Vite plugin

Automatically discovers JoltUI pages and supplies them to `Router`. A discovered
page must be a named class decorated directly with `@page` and `@component`, imported
from `joltui`, and exported as the module default.

```ts
// src/pages/homePage.ts
import { component, CustomElement, page } from "joltui";

@page("/")
@component({ tagName: "home-page" })
export default class HomePage extends CustomElement {}
```

Install and configure the plugin:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import joltui from "joltui-vite-plugin";

export default defineConfig({
    plugins: [joltui()],
});
```

The plugin scans `src` when it exists (otherwise the Vite root), creates a virtual
module containing static default imports, and injects that module into `src/main.ts`.
The generated module registers the pages before application startup. The router no
longer needs a pages array:

```ts
return new ApplicationRouter({
    app: this,
    baseLayout: BaseLayout,
    defaultTarget: "#page",
});
```

Options:

```ts
joltui({
    root: "src",
    entry: "main.ts",
    include: ["**/*.ts"],
    exclude: ["**/*.test.ts"],
    frameworkPackage: "joltui",
});
```

Named `@page` exports are build errors rather than being silently ignored. The plugin
also rejects missing `@component`, multiple pages in one file, duplicate statically
declared paths, anonymous page classes, and an empty discovery result. Adding,
removing, or changing page declarations during development causes a full reload;
this is necessary because browser custom elements cannot be unregistered safely.

Pages are eager static imports. Their lazy JoltUI dependencies remain separate Vite
chunks and continue to load on demand.
