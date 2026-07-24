import Database from "better-sqlite3";

export interface CustomerRow {
  id: string;
  channel: string;
  phone: string;
  name: string | null;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  name: string;
  name_de: string | null;
  qty: number;
  brand: string | null;
  price: number | null;
  confidence: number | null;
  source: "ai" | "worker";
}

export interface OrderRow {
  id: string;
  customer_id: string;
  shop_id: string;
  channel: string;
  raw_text: string;
  status: "draft" | "confirmed" | "assigned" | "picking" | "delivered" | "cancelled";
  fulfillment: "delivery" | "pickup";
  round_time: string | null;
  address: string | null;
  payment_method: string | null;
  detected_lang: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
  created_at: string;
}

export function initDb(path = "market2.db"): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      phone TEXT NOT NULL,
      name TEXT,
      UNIQUE (channel, phone)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      raw_text TEXT NOT NULL,
      status TEXT NOT NULL,
      fulfillment TEXT NOT NULL,
      round_time TEXT,
      address TEXT,
      payment_method TEXT,
      detected_lang TEXT DEFAULT 'de',
      subtotal REAL DEFAULT 0,
      delivery_fee REAL DEFAULT 0,
      total REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      name TEXT NOT NULL,
      name_de TEXT,
      qty REAL NOT NULL,
      unit TEXT,
      brand TEXT,
      price REAL,
      confidence REAL,
      source TEXT NOT NULL
    );
  `);
  return db;
}
