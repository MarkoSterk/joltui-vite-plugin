export class CustomElement {}
export const page = (..._args: unknown[]) => <T>(value: T): T => value;
export const component = (..._args: unknown[]) => <T>(value: T): T => value;
export function registerGeneratedPages(pages: readonly unknown[]): void {
    (globalThis as Record<string, unknown>).pages = pages;
}
