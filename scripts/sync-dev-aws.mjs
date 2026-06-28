#!/usr/bin/env node
// Launch `wrangler` with AWS credentials injected as --var, resolved from the active
// AWS profile. Nothing is written to disk (no .dev.vars).
//
// Cloudflare Workers has no AWS SDK default-credential chain, so the Worker reads
// env.AWS_* at runtime. This resolves them via `aws configure export-credentials`
// (which honors AWS_PROFILE) and passes them as `--var KEY:VALUE` bindings on the
// wrangler argv — in-memory only, supporting short-lived SSO/temporary creds
// (incl. AWS_SESSION_TOKEN). Re-resolved on every launch, so creds stay fresh.
//
// All args after the script are forwarded to `wrangler` verbatim; the AWS --var flags
// are appended. Wire it as the `dev` npm script (it spawns wrangler itself, so it
// replaces both the old `predev` file-sync and the `wrangler dev` invocation):
//   AWS_PROFILE=<profile> node node_modules/@rdlabo/workers-hono-kit/scripts/sync-dev-aws.mjs dev --var APP_ENV:development
//
// Trade-off vs .dev.vars: creds appear in the wrangler process args (visible to other
// users via `ps` on a shared host). Fine for a personal dev machine; nothing on disk.
// Exits non-zero if the profile can't be resolved, so the dev server never starts blind.
import { spawnSync } from 'node:child_process';

const CRED_KEYS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];
const profile = process.env.AWS_PROFILE ?? '(default)';

const forwarded = process.argv.slice(2);
if (forwarded.length === 0) {
  console.error('[dev-aws] usage: node sync-dev-aws.mjs <wrangler-args...>  (e.g. dev --var APP_ENV:development)');
  process.exit(1);
}

const cred = spawnSync('aws', ['configure', 'export-credentials', '--format', 'env-no-export'], { encoding: 'utf8' });
if (cred.status !== 0) {
  console.error(`[dev-aws] could not export credentials for AWS_PROFILE=${profile}.`);
  console.error('[dev-aws] check the AWS CLI is installed and the profile is valid (e.g. aws sso login).');
  process.exit(1);
}

// "KEY=VALUE" -> ["--var", "KEY:VALUE"]. AWS values are base64 (A-Za-z0-9+/=) and contain
// no ':', so wrangler's split-on-first-':' is safe. Split each line on its first '=' only.
const credVars = (cred.stdout ?? '')
  .split('\n')
  .filter((line) => CRED_KEYS.some((k) => line.startsWith(`${k}=`)))
  .flatMap((line) => {
    const eq = line.indexOf('=');
    return ['--var', `${line.slice(0, eq)}:${line.slice(eq + 1)}`];
  });

if (credVars.length === 0) {
  console.error('[dev-aws] no AWS credentials were returned; aborting.');
  process.exit(1);
}

// Run the repo-local wrangler regardless of how this script was invoked.
const binDir = `${process.cwd()}/node_modules/.bin`;
console.log(`[dev-aws] wrangler ${forwarded.join(' ')} (+${credVars.length / 2} AWS --var, AWS_PROFILE=${profile})`);
const run = spawnSync('wrangler', [...forwarded, ...credVars], {
  stdio: 'inherit',
  env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
});
process.exit(run.status ?? 1);
