# OCI deploy — DISABLED until A1 capacity

This directory is the **Always Free Ampere** target for the full API profile.

**Do not point production Vercel here** while Oracle returns `Out of host capacity` for `VM.Standard.A1.Flex` in `sa-saopaulo-1`.

- Production bridge: Render Free — [`docs/PROD.md`](../../docs/PROD.md)
- Migration notes: [`STATUS.md`](STATUS.md)
- When capacity appears: [`README.md`](README.md) + `scripts/oci-finish-when-ready.sh`
