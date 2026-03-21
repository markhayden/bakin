/**
 * send-email.ts
 * Sends a branded HTML email via Gmail SMTP using nodemailer.
 *
 * Usage:
 *   npx tsx scripts/send-email.ts
 *
 * Prerequisites:
 *   npm install nodemailer @types/nodemailer
 *
 * Environment variables (or edit the CONFIG block below):
 *   GMAIL_USER       - Gmail address (e.g. yourname@gmail.com)
 *   GMAIL_APP_PASS   - Gmail App Password (16 chars, no spaces)
 *                      Generate at: https://myaccount.google.com/apppasswords
 */

import nodemailer from 'nodemailer'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = {
  from: {
    name: 'Roscoe · Made in Wyo',
    address: process.env.GMAIL_USER || 'YOUR_GMAIL@gmail.com',
  },
  to: 'hi@markhayden.me',
  subject: 'Hello from Roscoe 👋',
  gmailUser: process.env.GMAIL_USER || 'YOUR_GMAIL@gmail.com',
  gmailAppPass: process.env.GMAIL_APP_PASS || '',
}

// ─── TEMPLATE ────────────────────────────────────────────────────────────────

function loadTemplate(): string {
  const templatePath = join(__dirname, 'email-template.html')
  return readFileSync(templatePath, 'utf-8')
}

// ─── SEND ────────────────────────────────────────────────────────────────────

async function sendEmail() {
  // Validate config
  if (!CONFIG.gmailAppPass || CONFIG.gmailAppPass.trim() === '') {
    console.error('\n❌  Gmail App Password not configured.\n')
    console.error('To set it up:')
    console.error('  1. Go to https://myaccount.google.com/apppasswords')
    console.error('  2. Sign in and create an App Password for "Mail"')
    console.error('  3. Copy the 16-character password (no spaces)')
    console.error('  4. Set environment variables:')
    console.error('       export GMAIL_USER="yourname@gmail.com"')
    console.error('       export GMAIL_APP_PASS="abcd efgh ijkl mnop"')
    console.error('  5. Re-run: npx tsx scripts/send-email.ts\n')
    process.exit(1)
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: CONFIG.gmailUser,
      pass: CONFIG.gmailAppPass,
    },
  })

  const html = loadTemplate()

  // Plain text fallback
  const text = [
    'Hello, World. 👋',
    '',
    "This is Roscoe — your AI team lead at Made in Wyo. Just checking in to let you",
    'know the email pipeline is live and working.',
    '',
    'The team is running smoothly. Patch built this, Pixel keeps the visuals sharp,',
    'Basil handles the content, and Rolo keeps the reels rolling. You focus on the',
    "big picture — we'll handle the rest.",
    '',
    'More coming soon. 🚀',
    '',
    '— Roscoe · Made in Wyo AI Team',
  ].join('\n')

  console.log(`\n📧  Sending email to ${CONFIG.to}...`)

  const info = await transporter.sendMail({
    from: `"${CONFIG.from.name}" <${CONFIG.from.address}>`,
    to: CONFIG.to,
    subject: CONFIG.subject,
    text,
    html,
  })

  console.log(`\n✅  Email sent!`)
  console.log(`    Message ID : ${info.messageId}`)
  console.log(`    To         : ${CONFIG.to}`)
  console.log(`    Subject    : ${CONFIG.subject}\n`)
}

sendEmail().catch((err) => {
  console.error('\n❌  Failed to send email:', err.message)
  process.exit(1)
})
