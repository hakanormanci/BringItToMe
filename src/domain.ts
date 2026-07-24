import type { ShopConfig } from "./config.js";

export interface RoundSlot {
  time: Date;
  cutoff: Date;
  available: boolean;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Is the shop open at the given local date/time? */
export function isShopOpen(shop: ShopConfig, at: Date): boolean {
  const weekday = at.getDay();
  const day = shop.openHours[weekday];
  if (!day) return false;
  const nowMin = at.getHours() * 60 + at.getMinutes();
  return nowMin >= toMinutes(day.open) && nowMin < toMinutes(day.close);
}

/**
 * Generate upcoming delivery round slots from now until shop close.
 * A slot is "available" if its cutoff is still in the future.
 */
export function getRoundSlots(shop: ShopConfig, from: Date = new Date(), limit = 24): RoundSlot[] {
  const weekday = from.getDay();
  const day = shop.openHours[weekday];
  if (!day) return [];

  const closeMin = toMinutes(day.close);
  const startMin = Math.max(
    from.getHours() * 60 + from.getMinutes(),
    toMinutes(day.open)
  );

  const slots: RoundSlot[] = [];
  // first slot aligned to interval from open time
  const openMin = toMinutes(day.open);
  let next = Math.ceil((startMin - openMin) / shop.roundIntervalMin) * shop.roundIntervalMin + openMin;

  while (next <= closeMin && slots.length < limit) {
    const slotTime = new Date(from);
    slotTime.setHours(0, 0, 0, 0);
    slotTime.setMinutes(next);
    const cutoff = new Date(slotTime.getTime() - shop.cutoffMinutes * 60_000);
    slots.push({
      time: slotTime,
      cutoff,
      available: cutoff.getTime() > from.getTime(),
    });
    next += shop.roundIntervalMin;
  }
  return slots;
}

/** Compute delivery fee based on subtotal and shop threshold. */
export function computeDeliveryFee(shop: ShopConfig, subtotal: number): number {
  if (subtotal >= shop.freeDeliveryThreshold) return 0;
  return shop.deliveryFee;
}

export interface PriceBreakdown {
  subtotal: number;
  deliveryFee: number;
  total: number;
}

export function priceOrder(shop: ShopConfig, subtotal: number, fulfillment: "delivery" | "pickup"): PriceBreakdown {
  const deliveryFee = fulfillment === "delivery" ? computeDeliveryFee(shop, subtotal) : 0;
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}

/** Format a round time for WhatsApp messages (de-DE). */
export function formatRoundTime(t: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(t);
}
