export const CATEGORIES = [
  "Mortgage",
  "S&CC",
  "Phone bill",
  "Wifi bill",
  "Electricity",
  "Water & gas",
  "Household maint.",
  "Groceries",
  "Dining out",
  "Ordering in",
  "Treating/hosting",
  "Public transport",
  "Taxis / Grab",
  "Medical",
  "Therapy",
  "Insurance",
  "Fitness",
  "Fun / entertainment",
  "Self maintenance",
  "Subscriptions",
  "Shopping",
  "Donations",
  "For others/gifts",
  "Travel",
  "Savings",
  "Investments",
  "Fun fund",
  "Parents allowance",
  "Taxes",
] as const;

export type Category = (typeof CATEGORIES)[number];
export type PaidBy = "Joint" | "Hadi" | "Chris";

export type Step =
  | "idle"
  | "awaiting_notes"
  | "awaiting_amount"
  | "awaiting_paid_by"
  | "awaiting_category"
  | "awaiting_confirm";

export interface Session {
  step: Step;
  notes?: string;
  amount?: number;
  paidBy?: PaidBy;
  category?: Category;
  refund?: number;
}