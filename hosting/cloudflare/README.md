# Self-hosting CampusCare on your own Cloudflare account

CampusCare was first hosted on OpenAI Sites (`*.chatgpt.site`). That host can't be edited or exported once access to it is gone, but the app doesn't depend on it: it is an ordinary Cloudflare Worker with a D1 database and an R2 photo bucket. This guide moves it to a Cloudflare account you own. After that you edit the code here and redeploy with one command.

What moves: all of the code. What doesn't: the data stored on Sites (sites, buildings, rooms, members, test complaints). No real students have used the pilot yet, so you set those up again in step 6.

Everything below fits in Cloudflare's free plan.

## Before you start

- Node.js 22.13 or newer, and `npm ci` run once in this folder.
- A free Cloudflare account. Use the one that owns `campuscare-dln.pages.dev` if you still have it.
- The resource names are in [`campuscare.json`](campuscare.json): Worker `campuscare-app`, database `campuscare`, bucket `campuscare-photos`. Change them before the first deploy if you want different names.

## 1. Sign in to Cloudflare

```sh
node node_modules/wrangler/bin/wrangler.js login
```

A browser window opens and asks you to approve Wrangler's access to your Cloudflare account.

## 2. Turn on R2 (one time)

Open the Cloudflare dashboard → **R2 Object Storage** and enable it. Cloudflare asks for a payment method as verification. The free tier (10 GB) isn't charged.

## 3. Deploy

```sh
npm run deploy
```

This runs [`scripts/deploy-cloudflare.mjs`](../../scripts/deploy-cloudflare.mjs), which:

1. creates the D1 database and R2 bucket if they don't exist,
2. builds the app and points its `DB` and `BUCKET` bindings at them,
3. applies the migrations in `drizzle/` (it tracks which have already run, so it's safe to repeat),
4. deploys the Worker and prints its address, such as `https://campuscare-app.<your-subdomain>.workers.dev`,
5. generates `OTP_HMAC_SECRET` if it's missing, and lists any sign-in secrets still to set.

Run `npm run deploy -- --dry-run` to check that the build bundles correctly without signing in or uploading anything.

## 4. Set the sign-in secrets

Sign-in stays locked until email delivery is configured. There is no test login.

Set the administrator email:

```sh
node node_modules/wrangler/bin/wrangler.js secret put BMSIT_ADMIN_EMAIL --name campuscare-app
```

Then set up the Gmail sender. The old tokens lived in Sites settings you can't reach, so authorise again. Your Google Cloud project and OAuth client are unaffected; follow [the Gmail sender guide](../../docs/GMAIL-SENDER-SETUP.md) up to `authorize-gmail.mjs`. Then upload the file it wrote:

```sh
node scripts/authorize-gmail.mjs <sender>@bmsit.in
npm run deploy -- --gmail .sites-runtime/gmail/setup-<id>/authorized-sender.json
```

The script pipes the four `GMAIL_*` values to Cloudflare as secrets, sets `OTP_MAIL_PROVIDER=gmail`, and never prints them. Delete that file and the downloaded client JSON afterwards.

`npm run deploy -- --secrets` prompts for each missing value instead (for Resend, for example).

Open the `workers.dev` address and sign in with the admin email to check that it works.

## 5. Keep the public address (`campuscare-dln.pages.dev`)

The Pages proxy in [`hosting/free-address/`](../free-address/README.md) still forwards to the old Sites backend. Point it at your Worker:

1. In the Cloudflare dashboard, open **Workers & Pages → campuscare (Pages) → Settings → Variables and secrets**. Add a **Production** variable named `UPSTREAM_ORIGIN` set to your Worker address from step 3, for example `https://campuscare-app.<your-subdomain>.workers.dev`, with no trailing path.
2. Redeploy the proxy so the variable and the updated `worker.mjs` take effect. Run `node hosting/free-address/pages/prepare.mjs`, then upload `hosting/free-address/pages/dist` as a new production deployment (see [the Pages guide](../free-address/pages/README.md)).

The address stays the same, so the Android app keeps working without changes. If `UPSTREAM_ORIGIN` isn't a plain `https://` origin, the proxy refuses requests instead of guessing.

If you no longer have the account that owns `campuscare-dln.pages.dev`, you can use the `workers.dev` address directly, or create a new Pages project from `hosting/free-address/pages`. Then update `DEFAULT_BASE_URL` in `android/app/src/main/java/com/campuscare/app/ApiClient.kt` and the links in `README.md`.

Session cookies are tied to the hostname, so users sign in once more on each address.

## 6. Set up the pilot again

The new database starts empty. Sign in as the administrator and follow **First use** in the [README](../../README.md#first-use): student batches and records, the site and building geofences, rooms, staff roles and settings.

## Changing the interface from now on

Run the app locally with a `.dev.vars` file in this folder (it's ignored by Git). It holds the same keys as the secrets, for local sign-in:

```ini
BMSIT_ADMIN_EMAIL=you@bmsit.in
OTP_HMAC_SECRET=<any random string of 32+ characters>
OTP_MAIL_PROVIDER=gmail
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_SENDER_EMAIL=...
```

```sh
npm run dev        # http://127.0.0.1:5173
```

Most of the interface is in `app/campuscare.tsx`, `app/report-dialog.tsx`, `app/ticket-sheet.tsx`, `app/signin-panel.tsx`, `app/globals.css` and `app/product.css`. When you're happy with a change, run the checks and publish:

```sh
node node_modules/typescript/bin/tsc --noEmit
node --test tests/*.test.mjs
npm run deploy
```

## Troubleshooting

- **"Wrangler is not signed in"**: repeat step 1.
- **"R2 is not enabled"**: repeat step 2.
- **"The database already has CampusCare tables that were created by hand"**: the migrations were run earlier with `d1 execute`, so they aren't tracked. The database holds no pilot data yet, so delete it in the dashboard (D1 → campuscare → Settings → Delete) and run `npm run deploy` again.
- **Sign-in says email verification isn't configured**: a secret from step 4 is missing. Run `npm run deploy` to see which.
- **The Pages address shows "CampusCare is not configured correctly"**: `UPSTREAM_ORIGIN` has a path, `http://`, or a typo in it.

`.openai/hosting.json` and the Sites build plugins are still there because the build reads them. They don't affect a Cloudflare deployment.
