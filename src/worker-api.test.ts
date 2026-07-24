import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { GroqProvider } from "./ai.js";
import { mountWorkerApi } from "./worker-api.js";
import type { Channel } from "./channel.js";
import { SQLiteAdapter } from "./db-adapter.js";

function initTestDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE customers (
      id TEXT PRIMARY KEY, channel TEXT NOT NULL DEFAULT 'whatsapp',
      phone TEXT NOT NULL, name TEXT, UNIQUE (channel, phone)
    );
    CREATE TABLE orders (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, shop_id TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'whatsapp', raw_text TEXT NOT NULL,
      status TEXT NOT NULL, fulfillment TEXT NOT NULL, round_time TEXT,
      address TEXT, payment_method TEXT, detected_lang TEXT DEFAULT 'de',
      subtotal REAL DEFAULT 0, delivery_fee REAL DEFAULT 0, total REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE order_items (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL, name TEXT NOT NULL, name_de TEXT,
      qty REAL NOT NULL, unit TEXT, brand TEXT, price REAL, confidence REAL, source TEXT NOT NULL
    );
  `);
}

function makeApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  const sent: any[] = [];
  const stub: Channel = {
    name: "telegram",
    verify: () => {},
    handleWebhook: async () => {},
    send: async (u, t) => { sent.push({ u, t }); return { ok: true }; },
  };
  // Create SQLiteAdapter using the same in-memory database
  const sqliteAdapter = new SQLiteAdapter(":memory:");
  sqliteAdapter.db = db;
  sqliteAdapter.initSchema();
  mountWorkerApi(app, { db: sqliteAdapter, channels: { telegram: stub }, ai: new GroqProvider("") });
  return { app, sent };
}

describe("worker api", () => {
  it("plans delivery with fee under threshold, then confirms sends summary", async () => {
    const db = new Database(":memory:");
    initTestDb(db);
    db.prepare("INSERT INTO customers (id, channel, phone) VALUES ('c1','telegram','555')").run();
    db.prepare("INSERT INTO orders (id, customer_id, shop_id, channel, raw_text, status, fulfillment, detected_lang) VALUES ('o1','c1','s1','telegram','x','draft','delivery','de')").run();
    db.prepare("INSERT INTO order_items (id, order_id, name, name_de, qty, price, source) VALUES ('i1','o1','Milch','Milch',2,1.0,'worker')").run();

    const { app, sent } = makeApp(db);
    const server = app.listen(0);
    const port = (server.address() as any).port;
    const base = `http://127.0.0.1:${port}`;

    const planRes = await fetch(`${base}/api/orders/o1/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer changeme" },
      body: JSON.stringify({ fulfillment: "delivery", roundTime: new Date().toISOString(), paymentMethod: "Karte" }),
    });
    assert.equal(planRes.status, 200);
    const order = db.prepare("SELECT * FROM orders WHERE id='o1'").get() as any;
    // 2 x 1.00 = 2.00 subtotal; under 50 -> 3 fee; total 5
    assert.equal(order.subtotal, 2);
    assert.equal(order.delivery_fee, 3);
    assert.equal(order.total, 5);
    assert.equal(order.status, "confirmed");

    const confRes = await fetch(`${base}/api/orders/o1/confirm`, { method: "POST", headers: { "Authorization": "Bearer changeme" } });
    assert.equal(confRes.status, 200);
    assert.equal(sent.length, 1);
    assert.match(sent[0].t, /Gesamt: 5,00\s*€/);

    server.close();
  });

  it("free delivery at/above 50 euro", async () => {
    const db = new Database(":memory:");
    initTestDb(db);
    db.prepare("INSERT INTO customers (id, channel, phone) VALUES ('c1','telegram','555')").run();
    db.prepare("INSERT INTO orders (id, customer_id, shop_id, channel, raw_text, status, fulfillment, detected_lang) VALUES ('o1','c1','s1','telegram','x','draft','delivery','de')").run();
    db.prepare("INSERT INTO order_items (id, order_id, name, name_de, qty, price, source) VALUES ('i1','o1','Fleisch','Fleisch',1,55.0,'worker')").run();
    const { app } = makeApp(db);
    const server = app.listen(0);
    const port = (server.address() as any).port;
    await fetch(`http://127.0.0.1:${port}/api/orders/o1/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer changeme" },
      body: JSON.stringify({ fulfillment: "delivery" }),
    });
    const order = db.prepare("SELECT * FROM orders WHERE id='o1'").get() as any;
    assert.equal(order.delivery_fee, 0);
    assert.equal(order.total, 55);
    server.close();
  });
});