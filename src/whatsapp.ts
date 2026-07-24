import type { Request, Response } from "express";
import type { Channel, SendResult } from "./channel.js";
import { defaultShop } from "./config.js";

export class WhatsAppChannel implements Channel {
  name = "whatsapp" as const;

  constructor(
    private token: string,
    private phoneId: string,
    private verifyToken: string
  ) {}

  verify(req: Request, res: Response): void {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === this.verifyToken) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }

  async handleWebhook(
    req: Request,
    res: Response,
    onText: (userId: string, text: string) => Promise<void>
  ): Promise<void> {
    const entry = req.body?.entry?.[0];
    const msg = entry?.changes?.[0]?.value?.messages?.[0];
    if (msg?.type === "text") {
      await onText(String(msg.from), String(msg.text.body));
    }
    res.sendStatus(200);
  }

  async send(userId: string, text: string): Promise<SendResult> {
    if (!this.token || !this.phoneId) {
      console.warn("[whatsapp] not configured; logging message instead");
      console.log(`-> ${userId}: ${text}`);
      return { ok: true };
    }

    const res = await fetch(
      `https://graph.facebook.com/v20.0/${this.phoneId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: userId,
          type: "text",
          text: { body: text },
        }),
      }
    );

    if (!res.ok) {
      return { ok: false, error: await res.text() };
    }
    return { ok: true };
  }
}
