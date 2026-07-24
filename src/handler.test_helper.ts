import Database from "better-sqlite3";
import { GroqProvider } from "./ai.js";
import { handleIncoming } from "./pipeline.js";
import type { Channel } from "./channel.js";
import { SQLiteAdapter } from "./db-adapter.js";

/** Stub channel that records outbound messages; uses a fake AI parser. */
export async function handleIncomingForTest(
  db: Database.Database,
  channelName: string,
  userId: string,
  text: string,
  sent: { userId: string; text: string }[]
): Promise<string> {
  // Create SQLiteAdapter using the same in-memory database
  const sqliteAdapter = new SQLiteAdapter(":memory:");
  // Replace the internal database with the test database
  sqliteAdapter.db = db;
  // Initialize schema on the test database
  sqliteAdapter.initSchema();

  const stubChannel: Channel = {
    name: channelName as any,
    verify: () => {},
    handleWebhook: async () => {},
    send: async (u, t) => {
      sent.push({ userId: u, text: t });
      return { ok: true };
    },
  };

  // Fake AI: split lines into items
  class FakeAI extends GroqProvider {
    async parseOrderText(raw: string) {
      const items = raw
        .split(/[\n,;]+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => ({ name: l, nameDe: l, qty: 1, confidence: 0.5 }));
      return { detectedLang: "de", items };
    }
  }

  return handleIncoming(
    { db: sqliteAdapter, ai: new FakeAI(""), channel: stubChannel },
    channelName,
    userId,
    text
  ) as Promise<string>;
}