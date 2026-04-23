import nodemailer from 'nodemailer'
import 'dotenv/config'

let transporter: nodemailer.Transporter | null = null

async function getTransporter() {
  if (transporter) return transporter

  // Use real SMTP if provided (e.g. Gmail with App Password)
  if (process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD) {
    console.log('[Email] Using configured SMTP credentials')
    transporter = nodemailer.createTransport({
      service: 'gmail', // defaults to gmail if you just provide pass, but better to specify host if not gmail
      auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD,
      },
    })
    return transporter
  }

  // Fallback to Ethereal Email for local testing
  console.log('[Email] No SMTP credentials found. Creating Ethereal testing account...')
  const testAccount = await nodemailer.createTestAccount()
  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  })
  return transporter
}

export async function sendNotificationEmail(
  toEmail: string,
  targetUrl: string,
  value: string,
  ruleSummary: string
) {
  const mailer = await getTransporter()

  const info = await mailer.sendMail({
    from: '"Signal Tracker" <noreply@signal.local>',
    to: toEmail,
    subject: '🔔 Signal Alert: Condition Met!',
    html: `
      <h2>Your Signal Tracker was triggered!</h2>
      <p><strong>Rule:</strong> ${ruleSummary}</p>
      <p><strong>Current Value:</strong> ${value}</p>
      <p><strong>Target URL:</strong> <a href="${targetUrl}">${targetUrl}</a></p>
      <hr />
      <p style="font-size: 12px; color: #555;">Sent from your Signal background worker.</p>
    `,
  })

  // If using Ethereal, we log the preview URL so the developer can see the email
  if (!process.env.SMTP_EMAIL) {
    console.log(`[Email] Preview your test email here: ${nodemailer.getTestMessageUrl(info)}`)
  } else {
    console.log(`[Email] Alert sent to ${toEmail}`)
  }
}
