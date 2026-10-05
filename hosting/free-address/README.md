# CampusCare's free public address

This small Cloudflare Worker gives visitors a `workers.dev` website address. The existing public Site remains the backend, retaining its database, private photos, sender and eligibility checks. This is a new public entry point, not a migration of stored data to another account.

The address is assigned by the user's Cloudflare account at deployment; do not publish a guessed URL. Use the account's free Workers plan. No D1/R2 resources or mail secrets are needed in this proxy. Users sign in once on the new hostname because session cookies are bound to the host.

## Publish

1. Sign into the user's Cloudflare account with Wrangler OAuth. The user reviews and authorizes the requested permissions in Cloudflare; never paste tokens into chat or source.
2. Check the selected account and whether a Worker named `campuscare` already exists. Do not overwrite an unrelated Worker; choose an unused name if necessary.
3. From the project root, run `node node_modules/wrangler/bin/wrangler.js deploy --config hosting/free-address/wrangler.jsonc` and retain the actual returned `workers.dev` URL.
4. Test anonymous status, a denied non-BMSIT login, emailed OTP, session refresh, protected complaint/photo access and logout on the new address. Cross-origin POST requests must remain rejected. Confirm camera/location permissions on the new hostname before a campus pilot.
5. Update advertised links and the native client's default server only after the new address works. Keep the original backend online; deleting it would remove the proxy's service.

The proxy validates the public Origin before rewriting it to the backend Origin, forwards only the CampusCare session cookie, removes platform identity and forwarded-host headers, blocks automatic upstream redirect following, rewrites same-backend redirects, preserves streaming and Set-Cookie headers, and disables response caching. It never stores or logs OTPs or credentials.

Cloudflare Workers Free quotas apply to traffic. `workers.dev` is suitable for this student pilot; an owned custom domain can later attach directly to the existing Site or the proxy.

References: [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [public Worker subrequests](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public), [request redirects](https://developers.cloudflare.com/workers/runtime-apis/request/).
