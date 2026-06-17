import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { appendExpenseRow } from "./sheets";
import { CATEGORIES, type Session, type Step, type PaidBy, type Category } from "./types";
import "dotenv/config";


const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ALLOWED_CHAT_IDS = process.env.ALLOWED_CHAT_IDS!
  .split(",")
  .map((id) => Number(id.trim()));

const bot = new TelegramBot(TOKEN, { polling: true });

// In-memory session store — fine for 2 users
const sessions = new Map<number, Session>();

function getSession(chatId: number): Session {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { step: "idle" });
  }
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

// Split categories into rows of 2 for the inline keyboard
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
    inline_keyboard: [
      [
        { text: "Joint", callback_data: "paid:Joint" },
        { text: "Hadi", callback_data: "paid:Hadi" },
        { text: "Chris", callback_data: "paid:Chris" },
      ],
    ],
  };
}

function confirmKeyboard(): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✓ log it", callback_data: "confirm:yes" },
        { text: "✗ cancel", callback_data: "confirm:no" },
      ],
    ],
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
    `refund/extra: ${session.refund != null ? `$${session.refund.toFixed(2)}` : "none"}`,
  ].join("\n");
}

async function askNotes(chatId: number): Promise<void> {
  await bot.sendMessage(chatId, "what are you logging?");
}

async function askAmount(chatId: number): Promise<void> {
  await bot.sendMessage(chatId, "how much? (SGD)");
}

async function askPaidBy(chatId: number): Promise<void> {
  await bot.sendMessage(chatId, "who paid?", {
    reply_markup: paidByKeyboard(),
  });
}

async function askCategory(chatId: number): Promise<void> {
  await bot.sendMessage(chatId, "which category?", {
    reply_markup: categoryKeyboard(),
  });
}

async function askRefund(chatId: number): Promise<void> {
  await bot.sendMessage(chatId, "any refund or extra amount? (type a number or 'skip')");
}

async function askConfirm(chatId: number, session: Session): Promise<void> {
  await bot.sendMessage(chatId, summaryText(session), {
    parse_mode: "Markdown",
    reply_markup: confirmKeyboard(),
  });
}

// Handle /log or /start
bot.onText(/\/(log|start)/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return;

  resetSession(chatId);
  setSession(chatId, { step: "awaiting_notes" });
  await askNotes(chatId);
});

// Handle /cancel
bot.onText(/\/cancel/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return;

  resetSession(chatId);
  await bot.sendMessage(chatId, "cancelled. send /log to start again.");
});

// Handle free text messages
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

  if (session.step === "awaiting_refund") {
    if (text.toLowerCase() === "skip") {
      session.refund = undefined;
    } else {
      const refund = parseFloat(text.replace("$", ""));
      if (isNaN(refund)) {
        await bot.sendMessage(chatId, "please enter a valid number or 'skip'");
        return;
      }
      session.refund = refund;
    }
    session.step = "awaiting_confirm";
    setSession(chatId, session);
    await askConfirm(chatId, session);
    return;
  }

  if (session.step === "idle") {
    await bot.sendMessage(chatId, "send /log to log an expense.");
  }
});

// Handle inline keyboard callbacks
bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat.id;
  if (!chatId || !isAllowed(chatId)) return;

  const data = query.data ?? "";
  const session = getSession(chatId);

  // Acknowledge the button press
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
    session.step = "awaiting_refund";
    setSession(chatId, session);
    await askRefund(chatId);
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