#!/usr/bin/env bash
# Query the eBay Browse API and emit JSON listings.
set -euo pipefail
: "${EBAY_API_KEY:?EBAY_API_KEY is required}"
QUERY="${1:?usage: fetch.sh <query>}"
curl -sS -H "Authorization: Bearer ${EBAY_API_KEY}" \
  "https://api.ebay.com/buy/browse/v1/item_summary/search?q=$(printf %s "$QUERY" | jq -sRr @uri)" \
  | jq '.itemSummaries[] | {title, price, condition, itemWebUrl}'
