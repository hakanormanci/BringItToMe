import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GroqProvider } from "./ai.js";
import { defaultShop } from "./config.js";
import { WhatsAppChannel } from "./whatsapp.js";
import { TelegramChannel } from "./telegram.js";
import { handleIncoming } from "./pipeline.js";
import { mountWorkerApi } from "./worker-api.js";
import { db } from "./db-adapter.js";
import "dotenv/config";

const ai = new GroqProvider(process.env.GROQ_API_KEY || "");

const channels = {
  whatsapp: new WhatsAppChannel(
    process.env.WHATSAPP_TOKEN || "",
    process.env.WHATSAPP_PHONE_ID || defaultShop.whatsappPhoneId,
    process.env.WA_VERIFY_TOKEN || ""
  ),
  telegram: new TelegramChannel(process.env.TELEGRAM_BOT_TOKEN || ""),
};

const app = express();
app.use(express.json());

app.get("/", (_req, res) => res.json({ status: "ok" }));

for (const channel of Object.values(channels)) {
  const path = `/webhook/${channel.name}`;
  app.get(path, (req, res) => channel.verify(req, res));
  app.post(path, (req, res) => {
    channel
      .handleWebhook(req, res, (userId, text) =>
        handleIncoming({ db, ai, channel }, channel.name, userId, text).then(
          () => {}
        )
      )
      .catch((e) => {
        console.error(`[${channel.name}] webhook error`, e);
        res.sendStatus(500);
      });
  });
}

mountWorkerApi(app, { db, channels, ai });

const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dirname, "public")));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`market2 listening on ${port}`));

