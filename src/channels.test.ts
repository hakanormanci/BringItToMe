import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { handleIncomingForTest } from "./handler.test_helper.js";

describe("inbound order creation (both channels)", () => {
  for (const channelName of ["whatsapp", "telegram"]) {
    it(`creates a draft order via ${channelName}`, async () => {
      const db = new Database(":memory:");
      const sent: { userId: string; text: string }[] = [];
      const orderId = await handleIncomingForTest(db, channelName, "555", "Milch\nBrot", sent);

      const order = db
        .prepare("SELECT * FROM orders WHERE id = ?")
        .get(orderId) as any;
      assert.equal(order.channel, channelName);
      assert.equal(order.status, "draft");

      const items = db
        .prepare("SELECT COUNT(*) AS c FROM order_items WHERE order_id = ?")
        .get(orderId) as any;
      assert.ok(items.c >= 1);

      const cust = db
        .prepare("SELECT * FROM customers WHERE channel = ? AND phone = ?")
        .get(channelName, "555") as any;
      assert.ok(cust);

      assert.ok(sent.length === 1, "should have sent a draftReceived message");
    });
  }
});
