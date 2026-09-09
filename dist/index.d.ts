import type { Plugin } from "vite";
declare const virtualPagesModuleId = "virtual:joltui-pages";
export type JoltUiPluginOptions = {
    /** Directory to scan, relative to Vite root. Defaults to `src` when it exists. */
    root?: string;
    /** Application entry or entries, relative to the scan root. */
    entry?: string | readonly string[];
    include?: readonly string[];
    exclude?: readonly string[];
    /** Package that exports page, component and registerGeneratedPages. */
    frameworkPackage?: string;
};
export default function joltui(options?: JoltUiPluginOptions): Plugin;
export { virtualPagesModuleId };
//# sourceMappingURL=index.d.ts.map