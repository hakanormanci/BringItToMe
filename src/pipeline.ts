import { randomUUID } from "node:crypto";
import { DBAdapter } from "./db-adapter.js";
import { GroqProvider } from "./ai.js";
import { defaultShop } from "./config.js";
import { render } from "./i18n.js";
import type { Channel } from "./channel.js";

export interface PipelineDeps {
  db: DBAdapter;
  ai: GroqProvider;
  channel: Channel;
  /** Optional hook to send outbound; defaults to channel.send */
  send?: (userId: string, text: string) => Promise<{ ok: boolean; error?: string }>;
}

/** Check if text is a confirmation (German yes) */
function isConfirmation(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === "ja" || normalized === "j" || normalized === "yes" || normalized === "y" || normalized === "ok";
}

/** Check if text is a cancellation (German no/cancel) */
function isCancellation(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === "nein" || normalized === "n" || normalized === "no" || normalized === "stornieren" || normalized === "cancel" || normalized === "abbrechen";
}

/** Channel-agnostic inbound handler: parse -> draft -> notify customer, or handle confirmation/cancellation. */
export async function handleIncoming(
  deps: PipelineDeps,
  channelName: string,
  userId: string,
  text: string
): Promise<string | null> {
  const { db, ai, channel } = deps;
  let customer = await db.getCustomer(channelName, userId);
  if (!customer) {
    const id = randomUUID();
    await db.createCustomer(id, channelName, userId);
    customer = { id, channel: channelName, phone: userId, name: null };
  }

  // Handle confirmation ("Ja") from customer
  if (isConfirmation(text)) {
    return await handleConfirmation(deps, channelName, userId, customer.id);
  }

  // Handle cancellation ("Nein", "Stornieren") from customer
  if (isCancellation(text)) {
    return await handleCancellation(deps, channelName, userId, customer.id);
  }

  // Normal order parsing flow
  const parsed = await ai.parseOrderText(text);
  const orderId = randomUUID();
  const ref = orderId.slice(0, 8).toUpperCase();

  await db.createOrder({
    id: orderId,
    customer_id: customer.id,
    shop_id: defaultShop.id,
    channel: channelName,
    raw_text: text,
    status: "draft",
    fulfillment: "delivery",
    round_time: null,
    address: null,
    payment_method: null,
    detected_lang: parsed.detectedLang,
    subtotal: 0,
    delivery_fee: 0,
    total: 0,
    created_at: new Date().toISOString(),
  });

  for (const it of parsed.items) {
    await db.createOrderItem({
      id: randomUUID(),
      order_id: orderId,
      name: it.name,
      name_de: it.nameDe,
      qty: it.qty,
      unit: it.unit ?? null,
      brand: it.brand ?? null,
      price: null,
      confidence: it.confidence,
      source: "ai",
    });
  }

  const { text: out } = render("draftReceived", {
    orderRef: ref,
    items: parsed.items,
    detectedLang: parsed.detectedLang,
  });
  const sender = deps.send ?? ((u: string, t: string) => channel.send(u, t));
  await sender(userId, out);

  console.log(
    `New draft ${ref} via ${channelName} from ${userId} [${parsed.detectedLang}]: ${parsed.items.length} items`
  );
  return orderId;
}

/** Handle customer confirmation: find latest draft order, mark confirmed, notify customer. */
async function handleConfirmation(
  deps: PipelineDeps,
  channelName: string,
  userId: string,
  customerId: string
): Promise<string | null> {
  const { db, channel } = deps;

  // Find the most recent draft/confirmed order for this customer
  const orders = await db.getOrdersByStatus("draft");
  const order = orders
    .filter((o) => o.customer_id === customerId && (o.status === "draft" || o.status === "confirmed"))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

  if (!order) {
    // No pending order to confirm
    const sender = deps.send ?? ((u: string, t: string) => channel.send(u, t));
    await sender(userId, "Sie haben keine offene Bestellung zum Bestätigen.");
    return null;
  }

  // Already confirmed? Send confirmation again
  if (order.status === "confirmed") {
    const { text: out } = render("confirmed", {
      orderRef: order.id.slice(0, 8).toUpperCase(),
      items: [],
      detectedLang: order.detected_lang,
      fulfillment: order.fulfillment,
      roundTime: order.round_time ? new Date(order.round_time) : undefined,
    });
    const sender = deps.send ?? ((u: string, t: string) => channel.send(u, t));
    await sender(userId, out);
    return order.id;
  }

  // Mark as confirmed
  await db.updateOrderStatus(order.id, "confirmed");

  const { text: out } = render("confirmed", {
    orderRef: order.id.slice(0, 8).toUpperCase(),
    items: [],
    detectedLang: order.detected_lang,
    fulfillment: order.fulfillment,
    roundTime: order.round_time ? new Date(order.round_time) : undefined,
  });
  const sender = deps.send ?? ((u: string, t: string) => channel.send(u, t));
  await sender(userId, out);

  console.log(`Order ${order.id.slice(0, 8)} confirmed by customer ${userId}`);
  return order.id;
}

/** Handle customer cancellation: find latest draft/confirmed order, mark cancelled, notify customer. */
async function handleCancellation(
  deps: PipelineDeps,
  channelName: string,
  userId: string,
  customerId: string
): Promise<string | null> {
  const { db, channel } = deps;

  // Find the most recent draft/confirmed order for this customer
  const orders = await db.getOrdersByStatus("draft");
  const order = orders
    .filter((o) => o.customer_id === customerId && (o.status === "draft" || o.status === "confirmed"))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

  if (!order) {
    // No pending order to cancel
    const sender = deps.send ?? ((u: string, t: string) => channel.send(u, t));
    await sender(userId, "Sie haben keine offene Bestellung zum Stornieren.");
    return null;
  }

  // Mark as cancelled
  await db.updateOrderStatus(order.id, "cancelled");

  const { text: out } = render("cancelled", {
    orderRef: order.id.slice(0, 8).toUpperCase(),
    items: [],
    detectedLang: order.detected_lang,
    fulfillment: order.fulfillment,
    roundTime: order.round_time ? new Date(order.round_time) : undefined,
  });
  const sender = deps.send ?? ((u: string, t: string) => channel.send(u, t));
  await sender(userId, out);

  console.log(`Order ${order.id.slice(0, 8)} cancelled by customer ${userId}`);
  return order.id;
}