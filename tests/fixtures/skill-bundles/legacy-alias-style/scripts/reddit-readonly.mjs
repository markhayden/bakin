#!/usr/bin/env node
const userAgent = process.env.REDDIT_RO_USER_AGENT || 'script:example:v1'
const res = await fetch('https://www.reddit.com/r/programming/hot.json?limit=3', { headers: { 'User-Agent': userAgent } })
console.log(JSON.stringify({ ok: res.ok, status: res.status }))
