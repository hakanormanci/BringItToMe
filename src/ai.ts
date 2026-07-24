/**
 * AI parser. Calls Groq (free tier) to turn free-text grocery needs in any
 * language into a structured draft. Designed behind LLMProvider so we can
 * swap to local Ollama later.
 */

export interface ParsedItem {
  name: string;
  nameDe: string;
  qty: number;
  unit?: string;
  brand?: string;
  confidence: number;
}

export interface ParsedOrder {
  detectedLang: string;
  items: ParsedItem[];
  notes?: string;
}

export interface LLMProvider {
  parseOrderText(raw: string): Promise<ParsedOrder>;
}

const SUPPORTED_LANGS = ["de", "en", "tr", "ar"] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];

const SYSTEM_PROMPT = `You are an order parser for a small grocery shop in Germany.
The customer writes their shopping needs in FREE TEXT, possibly in German, English, Turkish, or Arabic.
Extract a structured list of items. Rules:
- "name": the item exactly as the customer wrote it (keep original language/spelling).
- "nameDe": the item name translated to German for the shop worker. If already German, copy "name".
- "qty": numeric quantity (default 1 if not stated).
- "unit": optional unit (e.g. kg, Liter, Stück, Packung) if stated.
- "brand": brand if explicitly stated, else null.
- "confidence": 0..1 estimate that the parse is correct (lower if ambiguous language or unclear item).
Respond ONLY with strict JSON of shape:
{"detectedLang": "de|en|tr|ar", "items": [{"name","nameDe","qty","unit?","brand?","confidence"}], "notes?": string}
If you cannot detect the language, use "de".`;

export class GroqProvider implements LLMProvider {
  constructor(
    private apiKey: string,
    private model = "llama-3.3-70b-versatile"
  ) {}

  async parseOrderText(raw: string): Promise<ParsedOrder> {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: raw },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Groq error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    const content = data.choices[0].message.content;
    const parsed = JSON.parse(content) as ParsedOrder;

    // Normalize / validate lightly
    if (!SUPPORTED_LANGS.includes(parsed.detectedLang as Lang)) {
      parsed.detectedLang = "de";
    }
    parsed.items = (parsed.items || []).map((it) => ({
      name: it.name || "",
      nameDe: it.nameDe || it.name || "",
      qty: Number(it.qty) > 0 ? Number(it.qty) : 1,
      unit: it.unit,
      brand: it.brand ?? undefined,
      confidence: Math.min(1, Math.max(0, Number(it.confidence) || 0.3)),
    }));

    return parsed;
  }
}
