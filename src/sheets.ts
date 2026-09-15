import { google } from "googleapis";
import type { Session } from "./types";

const SHEET_ID = (process.env.GOOGLE_SHEET_ID ?? "").split("#")[0].trim();
const SHEET_NAME = (process.env.GOOGLE_SHEET_NAME ?? "Sheet1").split("#")[0].trim() || "Sheet1";

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  let credentials: object;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${dd}-${mm}`;
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString("en-SG", { month: "short" });
}

export async function appendExpenseRow(session: Session): Promise<void> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const now = new Date();

  const row = [
    formatDate(now),               // Date: YYYY-DD-MM
    formatMonth(now),              // Month: Jan, Feb, etc.
    session.category ?? "",        // Category
    session.paidBy ?? "",          // Paid by
    session.amount ?? 0,           // Amount (SGD)
    session.notes ?? "",           // Notes
    "Telegram",                    // Via
  ];

  if (!SHEET_ID) throw new Error("GOOGLE_SHEET_ID is not set");
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  }

  // Quote sheet title so names with spaces/emoji parse correctly.
  const range = `'${SHEET_NAME.replace(/'/g, "''")}'!A:H`;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}