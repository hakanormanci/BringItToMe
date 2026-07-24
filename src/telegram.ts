import type { Request, Response } from "express";
import type { Channel, SendResult } from "./channel.js";

export class TelegramChannel implements Channel {
  name = "telegram" as const;

  constructor(private token: string) {}

  verify(_req: Request, res: Response): void {
    // Telegram has no challenge handshake; webhook is registered via setWebhook
    // with the bot token embedded in the URL. Just acknowledge.
    res.sendStatus(200);
  }

  async handleWebhook(
    req: Request,
    res: Response,
    onText: (userId: string, text: string) => Promise<void>
  ): Promise<void> {
    const msg = req.body?.message;
    if (msg?.text && msg?.from?.id) {
      await onText(String(msg.from.id), String(msg.text));
    }
    res.sendStatus(200);
  }

  async send(userId: string, text: string): Promise<SendResult> {
    if (!this.token) {
      console.warn("[telegram] not configured; logging message instead");
      console.log(`-> ${userId}: ${text}`);
      return { ok: true };
    }

    const res = await fetch(
      `https://api.telegram.org/bot${this.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: userId, text }),
      }
    );

    if (!res.ok) {
      return { ok: false, error: await res.text() };
    }
    return { ok: true };
  }
}
