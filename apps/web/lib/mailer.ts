import nodemailer from 'nodemailer'
import type { MailConfig } from '@repo-radar/core'

export async function sendMail(
  config: MailConfig,
  input: {
    to: string
    subject: string
    text: string
    html?: string | null
  },
): Promise<void> {
  const transport = config.url
    ? nodemailer.createTransport(config.url)
    : nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
        ...(config.user && config.pass
          ? { auth: { user: config.user, pass: config.pass } }
          : {}),
      })
  await transport.sendMail({
    from: config.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    ...(input.html ? { html: input.html } : {}),
  })
}
