import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "tinyglobby";
import ts from "typescript";
import { normalizePath } from "vite";
const virtualPagesModuleId = "virtual:joltui-pages";
const resolvedVirtualPagesModuleId = `\0${virtualPagesModuleId}`;
class PageDiscoveryError extends Error {
    constructor(file, message) {
        super(`JoltUI page discovery failed in '${normalizePath(file)}':\n${message}`);
        this.name = "PageDiscoveryError";
    }
}
function hasModifier(node, kind) {
    return ts.canHaveModifiers(node) &&
        ts.getModifiers(node)?.some(modifier => modifier.kind === kind) === true;
}
function getDecoratorKind(decorator, imports, namespaces) {
    const expression = ts.isCallExpression(decorator.expression)
        ? decorator.expression.expression
        : decorator.expression;
    if (ts.isIdentifier(expression))
        return imports.get(expression.text) ?? null;
    if (ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        namespaces.has(expression.expression.text) &&
        (expression.name.text === "page" || expression.name.text === "component"))
        return expression.name.text;
    return null;
}
function getStaticRoutePath(decorator) {
    if (!ts.isCallExpression(decorator.expression))
        return null;
    const argument = decorator.expression.arguments[0];
    if (!argument)
        return null;
    if (ts.isStringLiteralLike(argument))
        return argument.text;
    if (!ts.isObjectLiteralExpression(argument))
        return null;
    for (const property of argument.properties) {
        if (!ts.isPropertyAssignment(property))
            continue;
        const name = property.name;
        if ((ts.isIdentifier(name) || ts.isStringLiteralLike(name)) &&
            name.text === "path" &&
            ts.isStringLiteralLike(property.initializer))
            return property.initializer.text;
    }
    return null;
}
async function inspectFile(file, frameworkPackage) {
    const source = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const imports = new Map();
    const namespaces = new Set();
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text !== frameworkPackage)
            continue;
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
            namespaces.add(bindings.name.text);
        }
        else if (bindings) {
            for (const specifier of bindings.elements) {
                const imported = specifier.propertyName?.text ?? specifier.name.text;
                if (imported === "page" || imported === "component") {
                    imports.set(specifier.name.text, imported);
                }
            }
        }
    }
    const pages = [];
    for (const statement of source.statements) {
        if (!ts.isClassDeclaration(statement) || !ts.canHaveDecorators(statement))
            continue;
        const decorators = ts.getDecorators(statement) ?? [];
        const pageDecorator = decorators.find(decorator => getDecoratorKind(decorator, imports, namespaces) === "page");
        if (!pageDecorator)
            continue;
        if (!statement.name) {
            throw new PageDiscoveryError(file, "An automatically discovered page must have a class name.");
        }
        if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
            !hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
            throw new PageDiscoveryError(file, `Page class '${statement.name.text}' uses @page but is not the module's default export.\n` +
                "Automatically discovered pages must use 'export default class'.");
        }
        if (!decorators.some(decorator => getDecoratorKind(decorator, imports, namespaces) === "component")) {
            throw new PageDiscoveryError(file, `Default page class '${statement.name.text}' must also use @component.`);
        }
        pages.push({
            file: path.resolve(file),
            className: statement.name.text,
            routePath: getStaticRoutePath(pageDecorator),
        });
    }
    if (pages.length > 1) {
        throw new PageDiscoveryError(file, "A module may contain at most one @page class.");
    }
    return pages[0] ?? null;
}
function createVirtualModule(pages, frameworkPackage) {
    const pageImports = pages.map((page, index) => `import Page${index} from ${JSON.stringify(`/@fs/${normalizePath(page.file)}`)};`);
    const pageNames = pages.map((_page, index) => `Page${index}`).join(",\n    ");
    return [
        ...pageImports,
        `import { registerGeneratedPages } from ${JSON.stringify(frameworkPackage)};`,
        "",
        "const pages = [",
        `    ${pageNames}`,
        "];",
        "registerGeneratedPages(pages);",
        "export default pages;",
        "",
    ].join("\n");
}
export default function joltui(options = {}) {
    let config;
    let sourceRoot = "";
    let entryFiles = new Set();
    let pages = [];
    let signature = "";
    let scanPromise = null;
    const frameworkPackage = options.frameworkPackage ?? "joltui";
    const isSourceFile = (file) => {
        const cleanFile = normalizePath(file.split("?", 1)[0] ?? file);
        return cleanFile.startsWith(`${normalizePath(sourceRoot)}/`) &&
            /\.(?:ts|tsx|mts)$/.test(cleanFile) &&
            !cleanFile.endsWith(".d.ts");
    };
    const scan = async () => {
        const files = await glob([...(options.include ?? ["**/*.ts", "**/*.tsx", "**/*.mts"])], {
            cwd: sourceRoot,
            absolute: true,
            onlyFiles: true,
            ignore: [...(options.exclude ?? [
                    "**/*.d.ts", "**/*.test.*", "**/*.spec.*",
                    "**/node_modules/**", "**/dist/**",
                ])],
        });
        const found = (await Promise.all(files.sort().map(file => inspectFile(file, frameworkPackage)))).filter((page) => page !== null);
        const paths = new Map();
        for (const page of found) {
            if (page.routePath === null)
                continue;
            const previous = paths.get(page.routePath);
            if (previous) {
                throw new PageDiscoveryError(page.file, `Duplicate static route '${page.routePath}' is also declared in ` +
                    `'${normalizePath(previous.file)}'.`);
            }
            paths.set(page.routePath, page);
        }
        pages = found;
        signature = found.map(page => `${normalizePath(page.file)}:${page.className}:${page.routePath ?? "?"}`).join("|");
    };
    const ensureScan = () => {
        scanPromise ??= scan().finally(() => { scanPromise = null; });
        return scanPromise;
    };
    const refresh = async (server) => {
        const oldSignature = signature;
        await ensureScan();
        if (oldSignature === signature)
            return false;
        const module = server.moduleGraph.getModuleById(resolvedVirtualPagesModuleId);
        if (module)
            server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: "full-reload" });
        return true;
    };
    return {
        name: "joltui-page-discovery",
        enforce: "pre",
        configResolved(resolvedConfig) {
            config = resolvedConfig;
            const configuredRoot = options.root
                ? path.resolve(config.root, options.root)
                : path.join(config.root, "src");
            sourceRoot = !options.root && !existsSync(configuredRoot)
                ? config.root
                : configuredRoot;
            const entries = typeof options.entry === "string"
                ? [options.entry]
                : options.entry ?? ["main.ts", "main.tsx", "main.js"];
            entryFiles = new Set(entries.map(entry => normalizePath(path.resolve(sourceRoot, entry))));
        },
        async buildStart() {
            try {
                await ensureScan();
                if (pages.length === 0) {
                    this.error(`No JoltUI pages were discovered under '${normalizePath(sourceRoot)}'.`);
                }
            }
            catch (error) {
                this.error(error instanceof Error ? error.message : String(error));
            }
        },
        resolveId(id) {
            return id === virtualPagesModuleId ? resolvedVirtualPagesModuleId : null;
        },
        async load(id) {
            if (id !== resolvedVirtualPagesModuleId)
                return null;
            await ensureScan();
            return createVirtualModule(pages, frameworkPackage);
        },
        transform(code, id) {
            const cleanId = normalizePath(id.split("?", 1)[0] ?? id);
            if (!entryFiles.has(cleanId) || code.includes(virtualPagesModuleId))
                return null;
            return { code: `import ${JSON.stringify(virtualPagesModuleId)};\n${code}`, map: null };
        },
        configureServer(server) {
            const update = (file) => {
                if (!isSourceFile(file))
                    return;
                void refresh(server).catch(error => {
                    server.config.logger.error(error instanceof Error ? error.message : String(error));
                });
            };
            server.watcher.on("add", update);
            server.watcher.on("unlink", update);
        },
        async handleHotUpdate(context) {
            if (!isSourceFile(context.file))
                return;
            return await refresh(context.server) ? [] : undefined;
        },
    };
}
export { virtualPagesModuleId };
//# sourceMappingURL=index.js.map