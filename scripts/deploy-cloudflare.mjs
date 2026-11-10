// Deploys CampusCare to the owner's own Cloudflare account, replacing the
// OpenAI Sites hosting. See hosting/cloudflare/README.md.
//
//   node scripts/deploy-cloudflare.mjs            build, create D1/R2 if missing, migrate, deploy
//   node scripts/deploy-cloudflare.mjs --secrets  also prompt for each missing secret
//   node scripts/deploy-cloudflare.mjs --gmail <authorized-sender.json>  upload the Gmail sender
//   node scripts/deploy-cloudflare.mjs --dry-run  build and validate only; needs no login
//
// Resource names live in hosting/cloudflare/campuscare.json. Nothing secret is
// written to disk: secrets go straight to Cloudflare through `wrangler secret put`.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const builtConfig = fileURLToPath(new URL('../dist/server/wrangler.json', import.meta.url));
const argv = process.argv.slice(2), gmailAt = argv.indexOf('--gmail');
const gmailFile = gmailAt >= 0 ? argv.splice(gmailAt, 2)[1] : null;
if (gmailAt >= 0 && !gmailFile) fail('--gmail needs the path of authorized-sender.json.');
const args = new Set(argv);
const dryRun = args.has('--dry-run'), askSecrets = args.has('--secrets');
for (const arg of args) if (!['--dry-run', '--secrets'].includes(arg)) fail(`Unknown option ${arg}.`);
const names = JSON.parse(await readFile(new URL('../hosting/cloudflare/campuscare.json', import.meta.url), 'utf8'));
for (const key of ['worker', 'database', 'bucket']) if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(names[key] || '')) fail(`hosting/cloudflare/campuscare.json: "${key}" must be lower-case letters, digits and hyphens.`);

const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_WRITE_LOGS: 'false' };

function fail(message) { console.error(`\n✖ ${message}`); process.exit(1); }
function step(message) { console.log(`\n▶ ${message}`); }
// mode 'show' streams output (stdin closed, so Wrangler never waits on a prompt);
// 'capture' returns it; 'interactive' hands the terminal to Wrangler.
function run(file, list, { mode = 'show', input } = {}) {
 const stdio = mode === 'interactive' ? 'inherit' : mode === 'capture' ? ['ignore', 'pipe', 'pipe'] : input !== undefined ? ['pipe', 'inherit', 'inherit'] : ['ignore', 'inherit', 'inherit'];
 const result = spawnSync(file, list, { cwd: root, env, stdio, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
 if (result.error) throw result.error;
 return { ok: result.status === 0, out: `${result.stdout || ''}${result.stderr || ''}` };
}
const wr = (list, options) => run(process.execPath, [wrangler, ...list], options);
function json(text) { const start = text.search(/[[{]/); try { return JSON.parse(text.slice(start)); } catch { return null; } }

let databaseId = '00000000-0000-4000-8000-000000000000';
if (!dryRun) {
 step('Checking the Cloudflare login');
 const who = wr(['whoami'], { mode: 'capture' });
 if (!who.ok || /not authenticated|You are not logged in/i.test(who.out)) fail('Wrangler is not signed in. Run: node node_modules/wrangler/bin/wrangler.js login');
 const account = /associated with the email (\S+?)\.?(?:\s|$)/i.exec(who.out)?.[1];
 console.log(account ? `Signed in as ${account}.` : 'Signed in.');

 step(`D1 database "${names.database}"`);
 const findDatabase = () => { const list = wr(['d1', 'list', '--json'], { mode: 'capture' }); if (!list.ok) fail(`Could not list D1 databases:\n${list.out}`); return (json(list.out) || []).find(item => item.name === names.database); };
 let database = findDatabase();
 if (!database) {
  console.log('Not found, creating it.');
  if (!wr(['d1', 'create', names.database]).ok) fail('Could not create the D1 database.');
  database = findDatabase();
 }
 databaseId = database?.uuid || database?.id;
 if (!databaseId) fail('The D1 database exists but its id could not be read.');
 console.log(`Using ${databaseId}.`);

 step(`R2 bucket "${names.bucket}"`);
 const buckets = wr(['r2', 'bucket', 'list'], { mode: 'capture' });
 if (!buckets.ok) fail(/enable R2|10042/i.test(buckets.out) ? 'R2 is not enabled on this account yet. Open the Cloudflare dashboard → R2, enable it (a payment method is asked for verification; the free tier is not charged), then run this again.' : `Could not list R2 buckets:\n${buckets.out}`);
 if ([...buckets.out.matchAll(/^name:\s+(\S+)/gm)].some(match => match[1] === names.bucket)) console.log('Already exists.');
 else if (!wr(['r2', 'bucket', 'create', names.bucket]).ok) fail('Could not create the R2 bucket.');
}

step('Building CampusCare');
if (!run(process.execPath, [fileURLToPath(new URL('./run-framework.mjs', import.meta.url)), 'build']).ok) fail('The build failed.');

// The Vite build emits the Sites placeholder bindings; point them at this account.
step('Writing the deploy configuration (dist/server/wrangler.json)');
const config = JSON.parse(await readFile(builtConfig, 'utf8'));
Object.assign(config, { name: names.worker, topLevelName: names.worker, workers_dev: true, preview_urls: false });
config.d1_databases = [{ binding: 'DB', database_name: names.database, database_id: databaseId, migrations_dir: '../../drizzle' }];
config.r2_buckets = [{ binding: 'BUCKET', bucket_name: names.bucket }];
await writeFile(builtConfig, JSON.stringify(config));

if (dryRun) {
 step('Validating the Worker bundle (dry run, nothing is uploaded)');
 if (!wr(['deploy', '--dry-run', '--config', builtConfig]).ok) fail('Dry run failed.');
 console.log('\n✔ Dry run passed. Run without --dry-run to deploy.');
 process.exit(0);
}

step('Applying database migrations (drizzle/)');
const applied = wr(['d1', 'migrations', 'list', 'DB', '--remote', '--config', builtConfig], { mode: 'capture' });
if (applied.ok && !/No migrations to apply/i.test(applied.out)) {
 // A database set up by hand with `d1 execute` has the tables but no migration log.
 const tables = json(wr(['d1', 'execute', 'DB', '--remote', '--json', '--config', builtConfig, '--command', "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('organisations','d1_migrations')"], { mode: 'capture' }).out);
 const found = new Set((tables?.[0]?.results || []).map(row => row.name));
 if (found.has('organisations') && !found.has('d1_migrations')) fail('The database already has CampusCare tables that were created by hand, so the migrations cannot be tracked. Delete and recreate the database (it holds no pilot data yet), or ask for help before continuing.');
}
if (!wr(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', builtConfig], { input: 'y\n' }).ok) fail('Migrations failed.');

step(`Deploying Worker "${names.worker}"`);
const deployed = wr(['deploy', '--config', builtConfig], { mode: 'capture' });
console.log(deployed.out.trim());
if (!deployed.ok) fail('Deploy failed.');
const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(deployed.out)?.[0];

step('Checking secrets');
const listed = json(wr(['secret', 'list', '--name', names.worker, '--format', 'json'], { mode: 'capture' }).out);
const have = new Set(Array.isArray(listed) ? listed.map(item => item.name) : []);
if (!have.has('OTP_HMAC_SECRET')) {
 // A random key nobody needs to know; it only signs one-time codes.
 console.log('Generating OTP_HMAC_SECRET.');
 if (wr(['secret', 'put', 'OTP_HMAC_SECRET', '--name', names.worker], { input: randomBytes(48).toString('base64url') }).ok) have.add('OTP_HMAC_SECRET');
}
const required = ['BMSIT_ADMIN_EMAIL', 'OTP_MAIL_PROVIDER'];
const gmail = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_SENDER_EMAIL'], resend = ['RESEND_API_KEY', 'OTP_FROM_EMAIL'];
if (gmailFile) {
 // The file written by scripts/authorize-gmail.mjs; values are piped, never printed.
 let sender; try { sender = JSON.parse(await readFile(gmailFile, 'utf8')); } catch { fail(`Could not read ${gmailFile}.`); }
 const absent = gmail.filter(name => typeof sender[name] !== 'string' || !sender[name]);
 if (absent.length) fail(`${gmailFile} is missing ${absent.join(', ')}.`);
 for (const [name, value] of [...gmail.map(name => [name, sender[name]]), ['OTP_MAIL_PROVIDER', 'gmail']]) {
  console.log(`Setting ${name}.`);
  if (wr(['secret', 'put', name, '--name', names.worker], { input: value }).ok) have.add(name); else fail(`Could not set ${name}.`);
 }
 console.log(`Gmail sender uploaded. You can now delete ${gmailFile} and the downloaded client JSON.`);
}
const usesResend = resend.some(name => have.has(name)) && !gmail.some(name => have.has(name));
const missing = [...required, ...(usesResend ? resend : gmail)].filter(name => !have.has(name));
if (missing.length && askSecrets) {
 for (const name of missing) {
  console.log(`\nEnter ${name}${name === 'OTP_MAIL_PROVIDER' ? ' (gmail or resend)' : ''}:`);
  if (wr(['secret', 'put', name, '--name', names.worker], { mode: 'interactive' }).ok) have.add(name);
 }
}
const still = missing.filter(name => !have.has(name));

console.log('\n────────────────────────────────────────');
console.log(`✔ CampusCare is deployed${url ? ` at ${url}` : ''}.`);
if (still.length) {
 console.log('\nSign-in stays locked until these secrets are set. Run this script again with --secrets, or set each one with:');
 for (const name of still) console.log(`  node node_modules/wrangler/bin/wrangler.js secret put ${name} --name ${names.worker}`);
 console.log('For Gmail: run node scripts/authorize-gmail.mjs <sender> (docs/GMAIL-SENDER-SETUP.md), then run this script again with --gmail <path of authorized-sender.json>.');
} else console.log('All sign-in secrets are set.');
if (url) console.log(`\nTo serve it from https://campuscare-dln.pages.dev, set the Pages variable UPSTREAM_ORIGIN=${url}\n(see hosting/cloudflare/README.md, step 5).`);
