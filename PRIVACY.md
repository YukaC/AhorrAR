# Privacy Policy — AhorrAR

**Last updated:** 2026-09-21  
**Project:** [AhorrAR](https://github.com/YukaC/AhorrAR) (open source)  
**Contact:** open an issue on the GitHub repository.

## What this app is

AhorrAR is a personal price-comparison tool focused on Argentina. It searches public store pages and (when configured) the Mercado Libre API to show product offers with price, link, image, and shipping signals.

## Data we process

### When you run a search
- The **product query** you type is sent to the AhorrAR backend/crawler so it can look up offers.
- Search jobs may be kept **in memory for a short time** (order of minutes) to return progress and results, then discarded.
- We do **not** require an AhorrAR user account for basic search.

### Mercado Libre (optional)
If an operator enables Mercado Libre integration:
- OAuth may link a **Mercado Libre developer/user token** to the server (operator-side credentials), not your personal shopping login in the default open-source setup.
- API responses used for search (title, price, permalink, thumbnail, shipping flags) are processed to build the result list.
- See Mercado Libre’s own [privacy policy](https://www.mercadolibre.com.ar/privacidad) for how ML handles account data.

### Logs and hosting
- Self-hosted or cloud deployments may log request metadata (time, status, errors) according to the host’s settings.
- Deployers (you, if you host an instance) are responsible for their own logging, retention, and compliance.

## Cookies and local storage
- The web UI follows the **device theme** (light/dark) automatically and stores the **theme preference** in `localStorage` **only after a manual toggle**.
- No advertising trackers are shipped in the default open-source UI.
- The crawler does **not** persist third-party cookies; dev-only fixtures (e.g. `scripts/firecrawl/fixtures/`) are never served in production.

## What we do not do (default open-source build)
- We do not sell personal data.
- We do not use search queries for advertising profiles.
- We do not claim to store long-term purchase history.

## Third-party sites
Crawling or calling third-party shops and APIs is subject to **their** terms of service and privacy policies. AhorrAR only displays publicly available offer data when the deployment is configured to fetch it.

## Your choices
- Do not enter personal data in the search box (use product names only).
- If you operate a public instance, publish your own contact and retention policy for that instance.
- To remove operator credentials (e.g. ML tokens), delete them from the server environment.

## Changes
Updates to this policy will be committed to this repository with a new “Last updated” date.

## License note
This privacy text is part of the AhorrAR documentation and is provided under the same [MIT License](../LICENSE) as the project, without warranty.
