import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultShop } from "./config.js";
import { getRoundSlots, computeDeliveryFee, priceOrder, isShopOpen } from "./domain.js";

function at(hour: number, minute: number, weekday: number): Date {
  const d = new Date(2026, 6, 20); // arbitrary
  d.setDate(20 + (weekday - d.getDay()));
  d.setHours(hour, minute, 0, 0);
  return d;
}

describe("round slots", () => {
  it("generates slots aligned to interval from open", () => {
    const slots = getRoundSlots(defaultShop, at(8, 5, 1));
    assert.ok(slots.length > 0);
    assert.equal(slots[0].time.getHours(), 9); // first full hour after 08:00 open
  });

  it("marks past cutoffs unavailable", () => {
    const slots = getRoundSlots(defaultShop, at(8, 55, 1)); // 09:00 slot cutoff at 08:50 -> unavailable
    const nine = slots.find((s) => s.time.getHours() === 9);
    assert.equal(nine?.available, false);
  });
});

describe("delivery fee", () => {
  it("charges default fee below threshold", () => {
    assert.equal(computeDeliveryFee(defaultShop, 20), 3);
  });
  it("is free at/above threshold", () => {
    assert.equal(computeDeliveryFee(defaultShop, 50), 0);
    assert.equal(computeDeliveryFee(defaultShop, 60), 0);
  });
  it("pickup has no fee", () => {
    const b = priceOrder(defaultShop, 20, "pickup");
    assert.equal(b.deliveryFee, 0);
    assert.equal(b.total, 20);
  });
});

describe("shop open", () => {
  it("open on Monday 10:00", () => assert.equal(isShopOpen(defaultShop, at(10, 0, 1)), true));
  it("closed Sunday", () => assert.equal(isShopOpen(defaultShop, at(10, 0, 0)), false));
  it("closed after close", () => assert.equal(isShopOpen(defaultShop, at(19, 0, 1)), false));
});
