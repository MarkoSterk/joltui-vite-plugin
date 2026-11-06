#!/usr/bin/env node
// Publishes the current build to the public npm registry (registry.npmjs.org).
//
// Runs automatically as the `postpublish` hook, i.e. right after `npm publish`
// has pushed @pro/joltui-vite-plugin to the internal Gitea registry. Can also be run on its
// own (e.g. to retry after a failure):  npm run publish:npm [-- --dry-run]
//
// The internal package is scoped (@pro/joltui-vite-plugin) and its publishConfig points at
// Gitea, so the public release is staged in a temp folder with a rewritten
// package.json (public name, no publishConfig, public repository URL) and
// published from there. The token is read from NPM_ACCESS_TOKEN (environment,
// this repo's .env, or the sibling ../joltui/.env).
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const PUBLIC_NAME = 'jolt-ui-vite-plugin';
const PUBLIC_REPOSITORY = { type: 'git', url: 'git+https://github.com/MarkoSterk/joltui-vite-plugin.git' };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run') || process.env.npm_config_dry_run === 'true';
const fromHook = process.env.npm_lifecycle_event === 'postpublish';

function loadEnv(file) {
    if (!existsSync(file)) return;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match || match[1] in process.env) continue;
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
}

// Run npm without a shell (paths with spaces, Windows .cmd shims).
function npmCommand() {
    const candidates = [
        process.env.npm_execpath,
        join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ];
    const cli = candidates.find(path => path && /npm-cli\.js$/.test(path) && existsSync(path));
    if (!cli) throw new Error('Could not locate npm-cli.js; run this via `npm run publish:npm`.');
    return cli;
}

loadEnv(join(root, '.env'));
loadEnv(join(root, '..', 'joltui', '.env'));
const token = process.env.NPM_ACCESS_TOKEN;
if (!token && !dryRun) {
    console.error('publish-npm: NPM_ACCESS_TOKEN is not set (.env or environment); skipping the public npm release.');
    process.exit(1);
}

const npmCli = npmCommand();
const npm = (npmArgs, options = {}) => execFileSync(process.execPath, [npmCli, ...npmArgs], { cwd: root, ...options });
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const label = `${PUBLIC_NAME}@${pkg.version}`;

const existing = spawnSync(process.execPath, [npmCli, 'view', label, 'version', '--registry', PUBLIC_REGISTRY], { cwd: root, encoding: 'utf8' });
if (existing.status === 0 && existing.stdout.trim() === pkg.version) {
    console.log(`publish-npm: ${label} is already on npm; nothing to do.`);
    process.exit(0);
}

if (!fromHook && !args.has('--no-build')) npm(['run', 'build'], { stdio: 'inherit' });

const staging = mkdtempSync(join(tmpdir(), 'joltui-vite-plugin-npm-'));
try {
    // Same file list npm would pack for the internal release.
    // HUSKY=0: npm 10 still runs `prepare` on pack despite --ignore-scripts.
    const packOutput = npm(['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8', env: { ...process.env, HUSKY: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
    const [packed] = JSON.parse(packOutput.slice(packOutput.indexOf('[')));
    const target = join(staging, 'package');
    for (const { path } of packed.files) {
        mkdirSync(dirname(join(target, path)), { recursive: true });
        cpSync(join(root, path), join(target, path));
    }

    const publicPkg = { ...pkg, name: PUBLIC_NAME, repository: PUBLIC_REPOSITORY };
    delete publicPkg.publishConfig;
    delete publicPkg.scripts; // build/husky scripts are meaningless to consumers
    delete publicPkg.devDependencies;
    writeFileSync(join(target, 'package.json'), JSON.stringify(publicPkg, null, 2) + '\n');

    const npmrc = join(staging, 'npmrc');
    writeFileSync(npmrc, `registry=${PUBLIC_REGISTRY}\n${token ? `//registry.npmjs.org/:_authToken=${token}\n` : ''}`, { mode: 0o600 });

    const publishArgs = ['publish', '--userconfig', npmrc, '--registry', PUBLIC_REGISTRY, '--access', 'public', '--ignore-scripts'];
    if (dryRun) publishArgs.push('--dry-run');
    if (process.env.npm_config_otp) publishArgs.push('--otp', process.env.npm_config_otp);
    console.log(`publish-npm: publishing ${label} to ${PUBLIC_REGISTRY}${dryRun ? ' (dry run)' : ''}`);
    npm(publishArgs, { cwd: target, stdio: 'inherit' });
} finally {
    rmSync(staging, { recursive: true, force: true });
}
