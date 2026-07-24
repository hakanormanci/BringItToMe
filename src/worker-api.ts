import type { Express, Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { DBAdapter } from "./db-adapter.js";
import { defaultShop } from "./config.js";
import { priceOrder, getRoundSlots } from "./domain.js";
import { render } from "./i18n.js";
import type { Channel } from "./channel.js";
import { GroqProvider } from "./ai.js";

// Simple auth middleware
const WORKER_PASSWORD = process.env.WORKER_PASSWORD || "changeme";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = auth.slice(7);
  if (token !== WORKER_PASSWORD) {
    return res.status(401).json({ error: "Invalid token" });
  }
  next();
}

export interface WorkerDeps {
  db: DBAdapter;
  channels: Record<string, Channel>;
  ai: GroqProvider;
}

export function mountWorkerApi(app: Express, deps: WorkerDeps) {
  const { db } = deps;

  // Login endpoint
  app.post("/api/auth/login", (req, res) => {
    const { password } = req.body;
    if (password === WORKER_PASSWORD) {
      res.json({ token: WORKER_PASSWORD });
    } else {
      res.status(401).json({ error: "Invalid password" });
    }
  });

  // All worker routes require auth
  app.use("/api/orders", requireAuth);
  app.use("/api/rounds", requireAuth);
  app.use("/api/driver", requireAuth);

  // List orders by status (default: draft + confirmed + assigned + picking)
  app.get("/api/orders", async (req, res) => {
    const status = (req.query.status as string) || "draft";
    const rows = await db.getOrdersByStatus(status);
    res.json(rows);
  });

  // Get one order with items
  app.get("/api/orders/:id", async (req, res) => {
    const order = await db.getOrder(req.params.id);
    if (!order) return res.sendStatus(404);
    const items = await db.getOrderItems(order.id);
    const customer = await db.getCustomer(order.channel, ""); // We'll need to adjust this
    // For now, just return what we have
    res.json({ order, items, customer: { phone: order.customer_id } });
  });

  // Update an item (worker sets qty/price/brand/nameDe)
  app.put("/api/orders/:id/items/:itemId", async (req, res) => {
    const { qty, price, brand, nameDe } = req.body;
    await db.updateOrderItem(req.params.itemId, {
      qty: qty ?? 0,
      price: price ?? null,
      brand: brand ?? null,
      name_de: nameDe ?? null,
    });
    res.json({ ok: true });
  });

  // Add an item manually
  app.post("/api/orders/:id/items", async (req, res) => {
    const { name, nameDe, qty, price, brand } = req.body;
    const id = randomUUID();
    await db.createOrderItem({
      id,
      order_id: req.params.id,
      name,
      name_de: nameDe ?? name,
      qty: qty ?? 1,
      unit: null,
      brand: brand ?? null,
      price: price ?? null,
      confidence: null,
      source: "worker",
    });
    res.json({ ok: true, id });
  });

  // Delete an item
  app.delete("/api/orders/:id/items/:itemId", async (req, res) => {
    await db.deleteOrderItem(req.params.itemId, req.params.id);
    res.json({ ok: true });
  });

  // Set fulfillment + round/pickup + payment, recompute price
  app.post("/api/orders/:id/plan", async (req, res) => {
    const { fulfillment, roundTime, paymentMethod, address } = req.body;
    const items = await db.getOrderItems(req.params.id);
    const subtotal = items.reduce(
      (s, it) => s + (Number(it.price) || 0) * Number(it.qty),
      0
    );
    const price = priceOrder(defaultShop, subtotal, fulfillment);
    await db.updateOrderPlan(req.params.id, {
      fulfillment,
      round_time: roundTime ?? null,
      payment_method: paymentMethod ?? null,
      address: address ?? null,
      subtotal: price.subtotal,
      delivery_fee: price.deliveryFee,
      total: price.total,
      status: "confirmed",
    });
    res.json({ ok: true, price });
  });

  // Confirm -> send summary to customer
  app.post("/api/orders/:id/confirm", async (req, res) => {
    const order = await db.getOrder(req.params.id);
    if (!order) return res.sendStatus(404);
    const items = await db.getOrderItems(order.id);
    const channel = deps.channels[order.channel];
    if (!channel) return res.status(400).json({ error: "unknown channel" });

    // Map snake_case DB columns to camelCase expected by templates
    const mappedItems = items.map((it) => ({
      ...it,
      nameDe: it.name_de ?? it.name,
      unit: it.unit ?? undefined,
      brand: it.brand ?? undefined,
      confidence: it.confidence ?? 0,
    }));

    const ref = order.id.slice(0, 8).toUpperCase();
    const { text } = render("summary", {
      orderRef: ref,
      items: mappedItems,
      detectedLang: order.detected_lang,
      price: { subtotal: order.subtotal, deliveryFee: order.delivery_fee, total: order.total },
      fulfillment: order.fulfillment,
      roundTime: order.round_time ? new Date(order.round_time) : undefined,
      paymentMethod: order.payment_method ?? undefined,
    });
    const result = await channel.send(order.customer_id, text);
    if (!result.ok) return res.status(502).json({ error: result.error });
    res.json({ ok: true, text });
  });

  // List upcoming delivery rounds (for the worker to pick a slot)
  app.get("/api/rounds", (_req, res) => {
    const slots = getRoundSlots(defaultShop);
    res.json(slots.map((s) => ({ time: s.time, cutoff: s.cutoff, available: s.available })));
  });

  // Driver view: orders assigned to a round time
  app.get("/api/driver", async (req, res) => {
    const roundTime = req.query.roundTime as string | undefined;
    const rows = await db.getOrdersForDriver(roundTime);
    res.json(rows);
  });

  // Mark order status (driver: assigned/picking/delivered)
  app.post("/api/orders/:id/status", async (req, res) => {
    const { status } = req.body;
    await db.updateOrderStatus(req.params.id, status);
    res.json({ ok: true });
  });
}
