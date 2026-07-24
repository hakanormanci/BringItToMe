import type { Request, Response } from "express";

export type ChannelName = "whatsapp" | "telegram";

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface Channel {
  name: ChannelName;
  /** GET webhook verification handshake. */
  verify(req: Request, res: Response): void;
  /** POST inbound messages; should call onText(userId, text) for each text message. */
  handleWebhook(req: Request, res: Response, onText: (userId: string, text: string) => Promise<void>): Promise<void>;
  /** Send an outbound text message to a user on this channel. */
  send(userId: string, text: string): Promise<SendResult>;
}
