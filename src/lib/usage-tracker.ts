/**
 * Tracks the actual words the person has had signed (via the demo's
 * text/voice-to-sign translator) per calendar day. Stored entirely in
 * localStorage — there is no backend, so this is a per-device usage log,
 * not an account-wide analytics service.
 */

const USAGE_KEY = "signaverse_usage_history";
export const USAGE_UPDATED_EVENT = "signaverse:usage-updated";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function readHistory(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function writeHistory(history: Record<string, string[]>) {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(history));
  } catch {
    // ignore — tracking is a nice-to-have, not critical path
  }
}

/** Call whenever a sentence gets translated/signed, with the words in it. */
export function recordSignedWords(words: string[]) {
  const clean = words.map((w) => w.trim()).filter(Boolean);
  if (!clean.length) return;
  const history = readHistory();
  const key = todayKey();
  history[key] = [...(history[key] ?? []), ...clean];
  writeHistory(history);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(USAGE_UPDATED_EVENT));
  }
}

export interface DailyUsage {
  date: string;
  words: string[];
  count: number;
}

/** Most-recent-first list of every day with recorded activity. */
export function getHistory(): DailyUsage[] {
  const history = readHistory();
  return Object.entries(history)
    .map(([date, words]) => ({ date, words, count: words.length }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getTodayWords(): string[] {
  return readHistory()[todayKey()] ?? [];
}

export function getTodayCount(): number {
  return getTodayWords().length;
}

/** Average words/day across all days with any recorded activity. */
export function getAverageDaily(): number {
  const dailyCounts = Object.values(readHistory()).map((w) => w.length);
  if (!dailyCounts.length) return 0;
  const total = dailyCounts.reduce((sum, v) => sum + v, 0);
  return Math.round((total / dailyCounts.length) * 10) / 10;
}

/** Escapes a field for CSV — wraps in quotes and doubles any inner quotes. */
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function downloadHistoryCSV() {
  const rows = getHistory();
  const lines = [
    "date,words_used",
    ...rows.map((r) => `${r.date},${csvField(r.words.join(" "))}`),
  ];
  const csv = `${lines.join("\n")}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `signaverse-usage-history-${todayKey()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
