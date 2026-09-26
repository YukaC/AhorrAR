# Oracle Cloud — Always Free hard rules

**Purpose:** keep this tenancy at **$0** on the card. Treat every rule below as **non-negotiable** unless you have explicitly read Oracle pricing and accept paid usage.

## Region (critical)

- Deploy **only** in the tenancy **home region**: `sa-saopaulo-1`.
- **Never** create compute, VCNs, databases, Object Storage buckets, or any other resource in **another region** — that is the fastest path to unexpected charges or out-of-free-tier resources.

## Compute (Ampere A1)

- **Only** shape: `VM.Standard.A1.Flex`.
- **Tenancy-wide cap:** total **≤ 2 OCPUs** and **≤ 12 GB memory** across all A1 Flex instances combined.
- This project uses **1 OCPU / 6 GB** and **50 GB boot** per VM (`scripts/oci-launch-a1.sh`) — plan before adding a second instance.

## Block and boot storage

- Boot volumes: **50 GB** each (matches Always Free allowance for this deploy).
- **Never exceed 200 GB total** block + boot storage for the tenancy (Always Free block volume limit).
- Do not attach extra paid block volumes.

## Services you must NOT provision

These are **paid** or commonly misconfigured:

| Do not create | Use instead |
|---|---|
| **Paid** OCI Load Balancer (non–Always-Free shape / bandwidth) | Caddy on the VM (`deploy/oci` Docker profile or host) |
| Autonomous Database (ADB), MySQL HeatWave | Not needed for AhorrAR API |
| Resources in regions other than `sa-saopaulo-1` | Home region only |
| Paid monitoring / marketplace add-ons without verifying $0 | Default metrics only |

One **Flexible Load Balancer** at **10 Mbps** is Always Free but **optional** — this project does **not** require it; prefer Caddy or Cloudflare Tunnel (free).

Object Storage: stay within Always Free limits (standard tier overage and egress can bill).

## Ingress / TLS ($0 default)

- **Default:** Caddy on the VM with **sslip.io** (`DOMAIN=<PUBLIC_IP>.sslip.io`) — see [`README.md`](README.md).
- **Avoid** a dedicated paid Load Balancer for a single VM.

## Before you click “Create” in the console

1. Region = **`sa-saopaulo-1`** only.
2. Shape = **`VM.Standard.A1.Flex`**, within **2 OCPU / 12 GB** tenancy total.
3. Boot disk **≈ 50 GB**; total block+boot **≤ 200 GB**.
4. **No** ADB, HeatWave, extra regions, or paid LB.
5. Public API only via **Caddy :443** (API bound to **127.0.0.1:4000**).

Launch helper: `scripts/oci-launch-a1.sh` (OCI CLI, retries `OutOfHostCapacity` / `Out of host capacity` every 90s, max 120 tries). Requires `TENANCY_OCID`.

## Spend guard (already created in tenancy)

- Budget `ahorrar-zero-spend-guard`: **$1/month** cap target (Always Free should stay **$0**).
- Alert rules at **1%** ACTUAL + FORECAST → email tenancy owner.
- If you get that mail: stop paid resources immediately; do not ignore.
