import Database from "better-sqlite3";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
  unit: string | null;
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

export interface DBAdapter {
  // Customers
  getCustomer(channel: string, phone: string): Promise<CustomerRow | undefined>;
  createCustomer(id: string, channel: string, phone: string): Promise<void>;

  // Orders
  createOrder(order: OrderRow): Promise<void>;
  getOrder(id: string): Promise<OrderRow | undefined>;
  getOrdersByStatus(status: string): Promise<OrderRow[]>;
  getOrdersForDriver(roundTime?: string): Promise<OrderRow[]>;
  updateOrderStatus(id: string, status: string): Promise<void>;
  updateOrderPlan(id: string, data: {
    fulfillment: string;
    round_time: string | null;
    payment_method: string | null;
    address: string | null;
    subtotal: number;
    delivery_fee: number;
    total: number;
    status: string;
  }): Promise<void>;

  // Order Items
  createOrderItem(item: OrderItemRow): Promise<void>;
  getOrderItems(orderId: string): Promise<OrderItemRow[]>;
  updateOrderItem(itemId: string, data: {
    qty: number;
    price: number | null;
    brand: string | null;
    name_de: string | null;
  }): Promise<void>;
  deleteOrderItem(itemId: string, orderId: string): Promise<void>;

  // Rounds
  getRoundSlots(shopId: string): Promise<any[]>;

  close(): Promise<void>;
}

export class SQLiteAdapter implements DBAdapter {
  public db: Database.Database;

  constructor(dbPath = "market2.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  public initSchema() {
    this.db.exec(`
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
  }

  async getCustomer(channel: string, phone: string): Promise<CustomerRow | undefined> {
    return this.db.prepare("SELECT * FROM customers WHERE channel = ? AND phone = ?").get(channel, phone) as CustomerRow | undefined;
  }

  async createCustomer(id: string, channel: string, phone: string): Promise<void> {
    this.db.prepare("INSERT INTO customers (id, channel, phone) VALUES (?, ?, ?)").run(id, channel, phone);
  }

  async createOrder(order: OrderRow): Promise<void> {
    this.db.prepare(`
      INSERT INTO orders (id, customer_id, shop_id, channel, raw_text, status, fulfillment, round_time, address, payment_method, detected_lang, subtotal, delivery_fee, total, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(order.id, order.customer_id, order.shop_id, order.channel, order.raw_text, order.status, order.fulfillment, order.round_time, order.address, order.payment_method, order.detected_lang, order.subtotal, order.delivery_fee, order.total, order.created_at);
  }

  async getOrder(id: string): Promise<OrderRow | undefined> {
    return this.db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined;
  }

  async getOrdersByStatus(status: string): Promise<OrderRow[]> {
    return this.db.prepare("SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC").all(status) as OrderRow[];
  }

  async getOrdersForDriver(roundTime?: string): Promise<OrderRow[]> {
    if (roundTime) {
      return this.db.prepare(`
        SELECT o.*, c.phone AS customer_phone FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.fulfillment = 'delivery' AND o.status IN ('confirmed','assigned','picking','delivered') AND o.round_time = ?
        ORDER BY o.round_time, o.address
      `).all(roundTime) as OrderRow[];
    }
    return this.db.prepare(`
      SELECT o.*, c.phone AS customer_phone FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.fulfillment = 'delivery' AND o.status IN ('confirmed','assigned','picking','delivered')
      ORDER BY o.round_time, o.address
    `).all() as OrderRow[];
  }

  async updateOrderStatus(id: string, status: string): Promise<void> {
    this.db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
  }

  async updateOrderPlan(id: string, data: any): Promise<void> {
    this.db.prepare(`
      UPDATE orders SET fulfillment = ?, round_time = ?, payment_method = ?, address = ?, subtotal = ?, delivery_fee = ?, total = ?, status = ? WHERE id = ?
    `).run(data.fulfillment, data.round_time, data.payment_method, data.address, data.subtotal, data.delivery_fee, data.total, data.status, id);
  }

  async createOrderItem(item: OrderItemRow): Promise<void> {
    this.db.prepare(`
      INSERT INTO order_items (id, order_id, name, name_de, qty, unit, brand, price, confidence, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item.id, item.order_id, item.name, item.name_de, item.qty, item.unit, item.brand, item.price, item.confidence, item.source);
  }

  async getOrderItems(orderId: string): Promise<OrderItemRow[]> {
    return this.db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(orderId) as OrderItemRow[];
  }

  async updateOrderItem(itemId: string, data: any): Promise<void> {
    this.db.prepare(`
      UPDATE order_items SET qty = ?, price = ?, brand = ?, name_de = ?, source = 'worker' WHERE id = ?
    `).run(data.qty, data.price, data.brand, data.name_de, itemId);
  }

  async deleteOrderItem(itemId: string, orderId: string): Promise<void> {
    this.db.prepare("DELETE FROM order_items WHERE id = ? AND order_id = ?").run(itemId, orderId);
  }

  async getRoundSlots(shopId: string): Promise<any[]> {
    return [];
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export class PostgreSQLAdapter implements DBAdapter {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
    this.initSchema();
  }

  private async initSchema() {
    const client = await this.pool.connect();
    try {
      await client.query(`
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
          created_at TEXT DEFAULT (now() AT TIME ZONE 'UTC')
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
    } finally {
      client.release();
    }
  }

  async getCustomer(channel: string, phone: string): Promise<CustomerRow | undefined> {
    const result = await this.pool.query("SELECT * FROM customers WHERE channel = $1 AND phone = $2", [channel, phone]);
    return result.rows[0] as CustomerRow | undefined;
  }

  async createCustomer(id: string, channel: string, phone: string): Promise<void> {
    await this.pool.query("INSERT INTO customers (id, channel, phone) VALUES ($1, $2, $3)", [id, channel, phone]);
  }

  async createOrder(order: OrderRow): Promise<void> {
    await this.pool.query(`
      INSERT INTO orders (id, customer_id, shop_id, channel, raw_text, status, fulfillment, round_time, address, payment_method, detected_lang, subtotal, delivery_fee, total, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [order.id, order.customer_id, order.shop_id, order.channel, order.raw_text, order.status, order.fulfillment, order.round_time, order.address, order.payment_method, order.detected_lang, order.subtotal, order.delivery_fee, order.total, order.created_at]);
  }

  async getOrder(id: string): Promise<OrderRow | undefined> {
    const result = await this.pool.query("SELECT * FROM orders WHERE id = $1", [id]);
    return result.rows[0] as OrderRow | undefined;
  }

  async getOrdersByStatus(status: string): Promise<OrderRow[]> {
    const result = await this.pool.query("SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC", [status]);
    return result.rows as OrderRow[];
  }

  async getOrdersForDriver(roundTime?: string): Promise<OrderRow[]> {
    if (roundTime) {
      const result = await this.pool.query(`
        SELECT o.*, c.phone AS customer_phone FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.fulfillment = 'delivery' AND o.status IN ('confirmed','assigned','picking','delivered') AND o.round_time = $1
        ORDER BY o.round_time, o.address
      `, [roundTime]);
      return result.rows as OrderRow[];
    }
    const result = await this.pool.query(`
      SELECT o.*, c.phone AS customer_phone FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.fulfillment = 'delivery' AND o.status IN ('confirmed','assigned','picking','delivered')
      ORDER BY o.round_time, o.address
    `);
    return result.rows as OrderRow[];
  }

  async updateOrderStatus(id: string, status: string): Promise<void> {
    await this.pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, id]);
  }

  async updateOrderPlan(id: string, data: any): Promise<void> {
    await this.pool.query(`
      UPDATE orders SET fulfillment = $1, round_time = $2, payment_method = $3, address = $4, subtotal = $5, delivery_fee = $6, total = $7, status = $8 WHERE id = $9
    `, [data.fulfillment, data.round_time, data.payment_method, data.address, data.subtotal, data.delivery_fee, data.total, data.status, id]);
  }

  async createOrderItem(item: OrderItemRow): Promise<void> {
    await this.pool.query(`
      INSERT INTO order_items (id, order_id, name, name_de, qty, unit, brand, price, confidence, source)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [item.id, item.order_id, item.name, item.name_de, item.qty, item.unit, item.brand, item.price, item.confidence, item.source]);
  }

  async getOrderItems(orderId: string): Promise<OrderItemRow[]> {
    const result = await this.pool.query("SELECT * FROM order_items WHERE order_id = $1", [orderId]);
    return result.rows as OrderItemRow[];
  }

  async updateOrderItem(itemId: string, data: any): Promise<void> {
    await this.pool.query(`
      UPDATE order_items SET qty = $1, price = $2, brand = $3, name_de = $4, source = 'worker' WHERE id = $5
    `, [data.qty, data.price, data.brand, data.name_de, itemId]);
  }

  async deleteOrderItem(itemId: string, orderId: string): Promise<void> {
    await this.pool.query("DELETE FROM order_items WHERE id = $1 AND order_id = $2", [itemId, orderId]);
  }

  async getRoundSlots(shopId: string): Promise<any[]> {
    return [];
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createDBAdapter(): DBAdapter {
  const usePostgres = process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("postgres");
  if (usePostgres) {
    console.log("Using PostgreSQL database");
    return new PostgreSQLAdapter(process.env.DATABASE_URL!);
  } else {
    console.log("Using SQLite database");
    return new SQLiteAdapter();
  }
}

export const db = createDBAdapter();