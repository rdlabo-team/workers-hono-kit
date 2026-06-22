#!/usr/bin/env node
// Sync AWS credentials from the active AWS profile into ./.dev.vars for `wrangler dev`.
//
// Cloudflare Workers has no AWS SDK default-credential chain, so the Worker reads
// env.AWS_* from .dev.vars in local dev. This resolves them via
// `aws configure export-credentials` (which honors AWS_PROFILE) on every `npm run dev`,
// keeping creds fresh — including short-lived SSO/temporary creds — without manual pasting.
//
// Usage (from a repo that depends on @rdlabo/hono-kit, run with cwd = the package root):
//   AWS_PROFILE=<profile> node node_modules/@rdlabo/hono-kit/scripts/sync-dev-aws.mjs
// Typically wired as a `predev` npm script. Non-cred lines in .dev.vars
// (AWS_REGION, ENVIRONMENT, SENTRY_DSN, …) are preserved; only the credential
// triplet is rewritten. Exits non-zero if the profile can't be resolved, so the
// dev server does not start with stale/empty creds.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DEV_VARS = '.dev.vars';
const CRED_KEYS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];
const profile = process.env.AWS_PROFILE ?? '(default)';

let out;
try {
  out = execFileSync('aws', ['configure', 'export-credentials', '--format', 'env-no-export'], { encoding: 'utf8' });
} catch {
  console.error(`[sync-dev-aws] could not export credentials for AWS_PROFILE=${profile}.`);
  console.error('[sync-dev-aws] check the AWS CLI is installed and the profile is valid (e.g. aws sso login).');
  process.exit(1);
}

const isCred = (line) => CRED_KEYS.some((k) => line.startsWith(`${k}=`));
const credLines = out.split('\n').filter(isCred);
if (credLines.length === 0) {
  console.error('[sync-dev-aws] no AWS credentials were returned; aborting.');
  process.exit(1);
}

const existing = existsSync(DEV_VARS) ? readFileSync(DEV_VARS, 'utf8').split('\n') : [];
const kept = existing.filter((line) => !isCred(line));
while (kept.length && kept[kept.length - 1] === '') kept.pop(); // drop trailing blanks

writeFileSync(DEV_VARS, [...kept, ...credLines, ''].join('\n'));
console.log(`[sync-dev-aws] wrote ${credLines.length} AWS cred line(s) to ${DEV_VARS} (AWS_PROFILE=${profile})`);
