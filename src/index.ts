import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { appendExpenseRow } from "./sheets";
import { CATEGORIES, type Session, type PaidBy, type Category } from "./types";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ALLOWED_CHAT_IDS = process.env.ALLOWED_CHAT_IDS!
  .split(",")
  .map((id) => Number(id.trim()));

const bot = new TelegramBot(TOKEN, { polling: true });
const sessions = new Map<number, Session>();

function getSession(chatId: number): Session {
  if (!sessions.has(chatId)) sessions.set(chatId, { step: "idle" });
  return sessions.get(chatId)!;
}

function setSession(chatId: number, session: Session): void {
  sessions.set(chatId, session);
}

function resetSession(chatId: number): void {
  sessions.set(chatId, { step: "idle" });
}

function isAllowed(chatId: number): boolean {
  return ALLOWED_CHAT_IDS.includes(chatId);
}

function categoryKeyboard(): TelegramBot.InlineKeyboardMarkup {
  const rows: TelegramBot.InlineKeyboardButton[][] = [];
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    const row: TelegramBot.InlineKeyboardButton[] = [
      { text: CATEGORIES[i], callback_data: `cat:${CATEGORIES[i]}` },
    ];
    if (CATEGORIES[i + 1]) {
      row.push({ text: CATEGORIES[i + 1], callback_data: `cat:${CATEGORIES[i + 1]}` });
    }
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

function paidByKeyboard(): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "Joint", callback_data: "paid:Joint" },
      { text: "Hadi", callback_data: "paid:Hadi" },
      { text: "Chris", callback_data: "paid:Chris" },
    ]],
  };
}

function confirmKeyboard(): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "✓ log it", callback_data: "confirm:yes" },
      { text: "✗ cancel", callback_data: "confirm:no" },
    ]],
  };
}

function summaryText(session: Session): string {
  return [
    `📋 *confirm entry*`,
    ``,
    `notes: ${session.notes}`,
    `amount: $${session.amount?.toFixed(2)}`,
    `paid by: ${session.paidBy}`,
    `category: ${session.category}`,
  ].join("\n");
}

// ── step-by-step helpers ──────────────────────────────────────────

async function askNotes(chatId: number) {
  await bot.sendMessage(chatId, "what are you logging?");
}

async function askAmount(chatId: number) {
  await bot.sendMessage(chatId, "how much? (SGD)");
}

async function askPaidBy(chatId: number) {
  await bot.sendMessage(chatId, "who paid?", { reply_markup: paidByKeyboard() });
}

async function askCategory(chatId: number) {
  await bot.sendMessage(chatId, "which category?", { reply_markup: categoryKeyboard() });
}

async function askConfirm(chatId: number, session: Session) {
  await bot.sendMessage(chatId, summaryText(session), {
    parse_mode: "Markdown",
    reply_markup: confirmKeyboard(),
  });
}

// ── /log — step-by-step ───────────────────────────────────────────

bot.onText(/\/(log|start)/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return;
  resetSession(chatId);
  setSession(chatId, { step: "awaiting_notes" });
  await askNotes(chatId);
});

// ── /q — quick format: /q price, notes, category, person ─────────

bot.onText(/\/q (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return;

  const parts = match?.[1].split(",").map((s) => s.trim());
  if (!parts || parts.length < 4) {
    await bot.sendMessage(chatId, "format: /q price, notes, category, person\ne.g. /q 12.50, lunch, Dining out, Hadi");
    return;
  }

  const [priceStr, notes, categoryRaw, personRaw] = parts;
  const amount = parseFloat(priceStr);

  if (isNaN(amount) || amount <= 0) {
    await bot.sendMessage(chatId, "invalid price. format: /q 12.50, lunch, Dining out, Hadi");
    return;
  }

  // fuzzy match category (case-insensitive)
  const category = CATEGORIES.find(
    (c) => c.toLowerCase() === categoryRaw.toLowerCase()
  );
  if (!category) {
    await bot.sendMessage(
      chatId,
      `unknown category: "${categoryRaw}"\n\nvalid categories:\n${CATEGORIES.join(", ")}`
    );
    return;
  }

  // fuzzy match paid by (case-insensitive)
  const validPeople: PaidBy[] = ["Joint", "Hadi", "Chris"];
  const paidBy = validPeople.find(
    (p) => p.toLowerCase() === personRaw.toLowerCase()
  );
  if (!paidBy) {
    await bot.sendMessage(chatId, `unknown person: "${personRaw}"\nvalid options: Joint, Hadi, Chris`);
    return;
  }

  const session: Session = {
    step: "awaiting_confirm",
    notes,
    amount,
    paidBy,
    category,
  };

  setSession(chatId, session);
  await askConfirm(chatId, session);
});

// ── /cancel ───────────────────────────────────────────────────────

bot.onText(/\/cancel/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return;
  resetSession(chatId);
  await bot.sendMessage(chatId, "cancelled. send /log to start again.");
});

// ── free text handler ─────────────────────────────────────────────

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return;
  if (!msg.text || msg.text.startsWith("/")) return;

  const session = getSession(chatId);
  const text = msg.text.trim();

  if (session.step === "awaiting_notes") {
    session.notes = text;
    session.step = "awaiting_amount";
    setSession(chatId, session);
    await askAmount(chatId);
    return;
  }

  if (session.step === "awaiting_amount") {
    const amount = parseFloat(text.replace("$", ""));
    if (isNaN(amount) || amount <= 0) {
      await bot.sendMessage(chatId, "please enter a valid amount, e.g. 12.50");
      return;
    }
    session.amount = amount;
    session.step = "awaiting_paid_by";
    setSession(chatId, session);
    await askPaidBy(chatId);
    return;
  }

  if (session.step === "idle") {
    await bot.sendMessage(chatId, "send /log to log an expense, or /q for quick entry.");
  }
});

// ── callback handler ──────────────────────────────────────────────

bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat.id;
  if (!chatId || !isAllowed(chatId)) return;

  const data = query.data ?? "";
  const session = getSession(chatId);

  await bot.answerCallbackQuery(query.id);

  if (data.startsWith("paid:") && session.step === "awaiting_paid_by") {
    session.paidBy = data.replace("paid:", "") as PaidBy;
    session.step = "awaiting_category";
    setSession(chatId, session);
    await askCategory(chatId);
    return;
  }

  if (data.startsWith("cat:") && session.step === "awaiting_category") {
    session.category = data.replace("cat:", "") as Category;
    session.step = "awaiting_confirm";
    setSession(chatId, session);
    await askConfirm(chatId, session);
    return;
  }

  if (data.startsWith("confirm:") && session.step === "awaiting_confirm") {
    if (data === "confirm:yes") {
      try {
        await appendExpenseRow(session);
        await bot.sendMessage(chatId, "✅ logged! send /log to add another.");
      } catch (err) {
        console.error("sheets error:", err);
        await bot.sendMessage(chatId, "⚠️ something went wrong writing to the sheet. try again.");
      }
    } else {
      await bot.sendMessage(chatId, "cancelled. send /log to start again.");
    }
    resetSession(chatId);
    return;
  }
});

console.log("expense bot running...");