# CampusCare Pages address

Current production address: **https://campuscare-dln.pages.dev**.

Cloudflare assigned this hostname to the `campuscare` Pages project because the unsuffixed name was taken. It removes the account name and `workers` from the public address, while remaining a free hosting subdomain. The existing public Site supplies all application routes, assets, data, private photos and OTP delivery.

`prepare.mjs` copies the reviewed sibling `worker.mjs` into `dist/_worker.js` and generates `_routes.json` for all paths. The upload contains no Gmail credentials, application records or photos. The proxy keeps exactly the same Origin, cookie, destination, redirect and cache checks as the original Worker.

## Rebuild and publish

1. Run `node hosting/free-address/pages/prepare.mjs` from the repository root.
2. Use the already signed-in Cloudflare dashboard: Workers & Pages > Pages project `campuscare` > Create deployment > Production. Upload a zip containing `dist/_worker.js` and `dist/_routes.json` at the archive root, then deploy. Avoid unrelated applications in this account.
3. Production runtime settings are compatibility date `2026-05-14`, no explicit compatibility flags, and **Fail closed** when the free Pages Functions allowance is exhausted. Keep these settings when uploading from the dashboard. The separate Workers configuration remains unchanged.
4. Alternatively, Wrangler requires Pages publishing access. After the user personally authorizes that access, run `node ../../../node_modules/wrangler/bin/wrangler.js pages deploy --branch main` from this directory. Its Pages configuration targets the existing project. Do not select a paid plan or create a second copy of the backend.
5. Verify the production hostname, page assets, anonymous status, rejected foreign-origin requests, denied non-BMSIT emails and protected complaint/photo requests. A real emailed-code login, reload and logout should be checked on the new host; session cookies and camera/location permissions belong to each hostname separately.

The original Worker remains available as a fallback. Keep the Site backend online: this deployment changes the entry address and does not migrate stored data. Pages Functions free limits apply.

References: [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [advanced-mode Worker](https://developers.cloudflare.com/pages/functions/advanced-mode/), [Pages configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/), [function pricing](https://developers.cloudflare.com/pages/functions/pricing/).
