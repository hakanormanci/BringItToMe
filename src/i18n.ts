import type { ParsedItem, ParsedOrder } from "./ai.js";
import type { PriceBreakdown } from "./domain.js";
import { formatRoundTime } from "./domain.js";

/**
 * Outbound message templates. Currently German (full support).
 * Unknown/unsupported languages fall back to German.
 * Add keys per language later (en/tr/ar) following the same shape.
 */
export interface OutboundContext {
  orderRef: string;
  items: ParsedItem[];
  detectedLang: string;
  price?: PriceBreakdown;
  fulfillment?: "delivery" | "pickup";
  roundTime?: Date;
  paymentMethod?: string;
}

/** Format number in German locale (1.234,56 €) */
function fmtEur(n: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(n);
}

const de = {
  draftReceived: (ctx: OutboundContext) =>
    `Hallo! Wir haben Ihre Bestellung erhalten (Nr. ${ctx.orderRef}). ` +
    `Unser Team prüft sie gleich und meldet sich mit den Details.`,

  summary: (ctx: OutboundContext) => {
    const lines = ctx.items
      .map((i) => `• ${i.nameDe} — ${i.qty}${i.unit ? " " + i.unit : ""}`)
      .join("\n");
    let msg = `Ihre Bestellung (Nr. ${ctx.orderRef}):\n${lines}\n`;
    if (ctx.price) {
      msg += `Zwischensumme: ${fmtEur(ctx.price.subtotal)}\n`;
      if (ctx.price.deliveryFee > 0)
        msg += `Liefergebühr: ${fmtEur(ctx.price.deliveryFee)}\n`;
      msg += `Gesamt: ${fmtEur(ctx.price.total)}\n`;
    }
    if (ctx.fulfillment === "delivery" && ctx.roundTime)
      msg += `Lieferung: ${formatRoundTime(ctx.roundTime)} Uhr\n`;
    if (ctx.fulfillment === "pickup" && ctx.roundTime)
      msg += `Abholung bereit ab: ${formatRoundTime(ctx.roundTime)} Uhr\n`;
    if (ctx.paymentMethod) msg += `Zahlung: ${ctx.paymentMethod}\n`;
    msg += `\nStimmt alles? Antworten Sie mit "Ja" zum Bestätigen.`;
    return msg;
  },

  confirmed: (ctx: OutboundContext) =>
    `Danke! Ihre Bestellung (Nr. ${ctx.orderRef}) ist bestätigt. ` +
    (ctx.fulfillment === "delivery" && ctx.roundTime
      ? `Wir liefern um ${formatRoundTime(ctx.roundTime)} Uhr.`
      : `Sie können ab ${ctx.roundTime ? formatRoundTime(ctx.roundTime) : ""} Uhr abholen.`),

  ready: (ctx: OutboundContext) =>
    `Ihre Bestellung (Nr. ${ctx.orderRef}) ist bereit${
      ctx.fulfillment === "delivery" ? " und wird geliefert" : " zur Abholung"
    }.`,

  cancelled: () => `Ihre Bestellung wurde storniert.`,
};

export function render(
  template: keyof typeof de,
  ctx: OutboundContext
): { text: string; lang: string } {
  return { text: de[template](ctx), lang: "de" };
}
