export interface ShopConfig {
  id: string;
  name: string;
  whatsappPhoneId: string;
  whatsappToken: string;
  timezone: string;
  /** Shop open/close per weekday, 24h "HH:mm" */
  openHours: { [weekday: number]: { open: string; close: string } | null };
  /** Delivery round interval in minutes */
  roundIntervalMin: number;
  /** Default delivery fee in EUR */
  deliveryFee: number;
  /** Subtotal (EUR) above which delivery is free */
  freeDeliveryThreshold: number;
  /** Minutes before a round that ordering closes */
  cutoffMinutes: number;
}

export const defaultShop: ShopConfig = {
  id: "shop-1",
  name: "Demo Tante Emma Laden",
  whatsappPhoneId: "",
  whatsappToken: "",
  timezone: "Europe/Berlin",
  openHours: {
    0: null, // Sunday closed
    1: { open: "08:00", close: "18:00" },
    2: { open: "08:00", close: "18:00" },
    3: { open: "08:00", close: "18:00" },
    4: { open: "08:00", close: "18:00" },
    5: { open: "08:00", close: "18:00" },
    6: { open: "08:00", close: "14:00" },
  },
  roundIntervalMin: 60,
  deliveryFee: 3,
  freeDeliveryThreshold: 50,
  cutoffMinutes: 10,
};
