export type EntryType = 'expense' | 'income';
export type Context = 'personal' | 'work';
export type ClaimStatus = 'pending' | 'settled';

/** Calendar date, local time: YYYY-MM-DD */
export type DateStr = string;
/** Calendar month: YYYY-MM */
export type MonthStr = string;

export interface Entry {
  id: string;
  date: DateStr;
  type: EntryType;
  /** Amount in the entry's own currency */
  amount: number;
  currency: string;
  /** Default-currency units per 1 unit of `currency`, frozen at entry time */
  rate: number;
  /** amount × rate, in the default currency */
  base: number;
  categoryId: string;
  subId: string | null;
  context: Context;
  /** null = not claimable */
  claimStatus: ClaimStatus | null;
  claimSettledAt: DateStr | null;
  /** Income entry that reimbursed this claim */
  claimSettlementId: string | null;
  tripId: string | null;
  note: string;
  tags: string[];
  receiptIds: string[];
  recurringId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Subcategory {
  id: string;
  name: string;
  archived?: boolean;
}

export interface Category {
  id: string;
  type: EntryType;
  name: string;
  emoji: string;
  order: number;
  subs: Subcategory[];
  archived?: boolean;
}

export interface Currency {
  code: string;
  /** Default-currency units per 1 unit of this currency */
  rate: number;
  order: number;
}

export type TripKind = 'work' | 'holiday' | 'other';

export interface Trip {
  id: string;
  name: string;
  kind: TripKind;
  start: DateStr;
  end: DateStr | null;
  currency: string | null;
  createdAt: number;
}

export interface Recurring {
  id: string;
  type: EntryType;
  amount: number;
  currency: string;
  categoryId: string;
  subId: string | null;
  context: Context;
  note: string;
  /** 1–28; entries fall on this day each month */
  dayOfMonth: number;
  startMonth: MonthStr;
  /** Inclusive; null = no end */
  endMonth: MonthStr | null;
  /** auto = create silently, confirm = ask on Home */
  mode: 'auto' | 'confirm';
  active: boolean;
  /** Months deliberately not logged */
  skipped?: MonthStr[];
  createdAt: number;
}

export interface Budget {
  categoryId: string;
  monthlyLimit: number;
}

export interface Receipt {
  id: string;
  entryId: string;
  blob: Blob;
  createdAt: number;
}

export interface Settings {
  defaultCurrency: string;
  claimCutoffDay: number;
  claimReminder: boolean;
  receiptRetentionMonths: number | null;
  ratesUpdatedAt: number | null;
  lastBackupAt: number | null;
  kiraImportedAt: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultCurrency: 'MYR',
  claimCutoffDay: 25,
  claimReminder: true,
  receiptRetentionMonths: null,
  ratesUpdatedAt: null,
  lastBackupAt: null,
  kiraImportedAt: null,
};
