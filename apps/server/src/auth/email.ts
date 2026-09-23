/**
 * 发送事务邮件（目前只有访客的邮箱验证）。
 *
 * 通过 SMTP 发送，服务商在部署时选择（大多数邮件服务都提供 SMTP 接入），代码不绑定某一家。
 * 邮件只有纯文本正文，不拼接任何用户输入：验证邮件里不出现访客填写的显示名，
 * 避免有人借我们的发信域名给别人发送任意文字。
 */
import { createTransport } from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  /** 发送失败时抛出。 */
  send(message: EmailMessage): Promise<void>;
}

type Transport = Parameters<typeof createTransport>[0];

export class SmtpEmailSender implements EmailSender {
  private readonly transport: ReturnType<typeof createTransport>;

  /**
   * @param transport SMTP 连接串（`smtps://user:pass@host:465`）或 nodemailer 的传输配置。
   * @param from 发件人，例如 `char.pub <no-reply@char.pub>`。
   */
  constructor(
    transport: Transport,
    private readonly from: string,
  ) {
    this.transport = createTransport(transport);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

/** 访客邮箱验证邮件。链接里的 token 放在 fragment 中，不会出现在服务器日志和 Referer 里。 */
export function guestVerificationEmail(to: string, link: string, ttlMinutes: number): EmailMessage {
  return {
    to,
    subject: "Verify your email for char.pub",
    text: [
      "Someone asked to use this email address to contribute to char.pub as a guest.",
      "",
      `To confirm, open this link within ${ttlMinutes} minutes:`,
      "",
      link,
      "",
      "If this wasn't you, ignore this email. Nothing happens unless the link is opened.",
    ].join("\n"),
  };
}
