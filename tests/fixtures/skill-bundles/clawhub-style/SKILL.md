---
name: ebay-research
description: >
  Research eBay listings and price history for a product. Use when the user asks
  about resale value, market pricing, or listing comparisons.
version: 1.2.0
homepage: https://example.com/ebay-research
metadata:
  openclaw:
    emoji: "🛒"
    os: ["darwin", "linux"]
    requires:
      env: ["EBAY_API_KEY"]
      bins: ["jq"]
      anyBins: ["curl", "wget"]
    envVars:
      EBAY_OPTIONAL_AFFILIATE_ID:
        required: false
    primaryEnv: EBAY_API_KEY
    install:
      - "brew install jq"
---

# eBay Research

Fetch listings with `scripts/fetch.sh <query>` (requires `EBAY_API_KEY` in the
environment). Summarize price ranges from the JSON output; see
`references/guide.md` for the response field map.

Never scrape ebay.com HTML — the script uses the official Browse API.
