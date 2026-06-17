import { google } from "googleapis";
import type { Session } from "./types";

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME ?? "Sheet1";

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
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
    session.refund ?? "",          // Refund/Extra (blank if none)
    session.notes ?? "",           // Notes
    "Telegram",                    // Via
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:H`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}