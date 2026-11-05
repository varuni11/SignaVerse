/**
 * Tracks words that users tried to sign but aren't in the ISL clip library
 * yet, so admins can see demand and grow the library over time. Also holds
 * the "custom" word → clip map that admins add — this is merged into the
 * real translation pipeline (see components/avatar/isl/english-to-isl.ts) so newly added
 * signs are immediately signable, without a code deploy.
 *
 * Storage-only (localStorage) — see auth-store.ts's top comment for the
 * same honest caveat: this is a self-contained demo data layer, built so
 * swapping in a real backend later only means changing this one file.
 */

export type RequestStatus = "pending" | "in_progress" | "added" | "declined";

export interface SignRequest {
  id: string;
  word: string;
  status: RequestStatus;
  count: number;
  requestedBy: string[];
  firstRequestedAt: string;
  lastRequestedAt: string;
  adminNote?: string;
}

const REQUESTS_KEY = "signaverse_sign_requests_v1";
const CUSTOM_CLIPS_KEY = "signaverse_custom_clips_v1";

export const REQUESTS_UPDATED_EVENT = "signaverse:requests-updated";
export const CUSTOM_CLIPS_UPDATED_EVENT = "signaverse:custom-clips-updated";

function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore — quota or private mode
  }
}

function emit(event: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(event));
}

function normaliseWord(word: string): string {
  return word.trim().toLowerCase();
}

/** Call whenever the demo could not find a clip for a whole word. */
export function submitSignRequest(word: string, requestedBy: string): void {
  const clean = normaliseWord(word).replace(/[^a-z']/g, "");
  if (!clean) return;

  const requests = read<SignRequest[]>(REQUESTS_KEY, []);
  const existing = requests.find((r) => r.word === clean);
  const now = new Date().toISOString();

  if (existing) {
    existing.count += 1;
    existing.lastRequestedAt = now;
    if (requestedBy && !existing.requestedBy.includes(requestedBy)) {
      existing.requestedBy = [...existing.requestedBy, requestedBy].slice(-25);
    }
    write(REQUESTS_KEY, requests);
  } else {
    const next: SignRequest = {
      id: uid(),
      word: clean,
      status: "pending",
      count: 1,
      requestedBy: requestedBy ? [requestedBy] : [],
      firstRequestedAt: now,
      lastRequestedAt: now,
    };
    write(REQUESTS_KEY, [next, ...requests]);
  }
  emit(REQUESTS_UPDATED_EVENT);
}

export function getSignRequests(): SignRequest[] {
  return [...read<SignRequest[]>(REQUESTS_KEY, [])].sort((a, b) => {
    if (a.status !== b.status) {
      const order: RequestStatus[] = [
        "pending",
        "in_progress",
        "added",
        "declined",
      ];
      return order.indexOf(a.status) - order.indexOf(b.status);
    }
    return b.count - a.count;
  });
}

export function setRequestStatus(
  id: string,
  status: RequestStatus,
  adminNote?: string,
): void {
  const requests = read<SignRequest[]>(REQUESTS_KEY, []);
  const target = requests.find((r) => r.id === id);
  if (!target) return;
  target.status = status;
  if (adminNote !== undefined) target.adminNote = adminNote;
  write(REQUESTS_KEY, requests);
  emit(REQUESTS_UPDATED_EVENT);
}

export function deleteSignRequest(id: string): void {
  const requests = read<SignRequest[]>(REQUESTS_KEY, []);
  write(
    REQUESTS_KEY,
    requests.filter((r) => r.id !== id),
  );
  emit(REQUESTS_UPDATED_EVENT);
}

/* --------------------------- Custom clip library --------------------------- */

/** Admin-added word → clip URL entries, merged with the built-in library at runtime. */
export function getCustomClips(): Record<string, string> {
  return read<Record<string, string>>(CUSTOM_CLIPS_KEY, {});
}

export function addCustomSign(
  word: string,
  clipUrl: string,
  linkedRequestId?: string,
): void {
  const clean = normaliseWord(word).replace(/[^a-z' ]/g, "");
  if (!clean || !clipUrl.trim()) return;
  const clips = getCustomClips();
  clips[clean] = clipUrl.trim();
  write(CUSTOM_CLIPS_KEY, clips);
  emit(CUSTOM_CLIPS_UPDATED_EVENT);

  if (linkedRequestId) {
    setRequestStatus(linkedRequestId, "added");
  } else {
    // Auto-resolve any pending request for the same word.
    const requests = read<SignRequest[]>(REQUESTS_KEY, []);
    const match = requests.find((r) => r.word === clean);
    if (match) setRequestStatus(match.id, "added");
  }
}

export function removeCustomSign(word: string): void {
  const clean = normaliseWord(word);
  const clips = getCustomClips();
  if (!(clean in clips)) return;
  delete clips[clean];
  write(CUSTOM_CLIPS_KEY, clips);
  emit(CUSTOM_CLIPS_UPDATED_EVENT);
}

export function getLibraryStats() {
  const requests = read<SignRequest[]>(REQUESTS_KEY, []);
  const pending = requests.filter((r) => r.status === "pending").length;
  const inProgress = requests.filter((r) => r.status === "in_progress").length;
  const added = requests.filter((r) => r.status === "added").length;
  const totalDemand = requests.reduce((sum, r) => sum + r.count, 0);
  return {
    totalRequests: requests.length,
    pending,
    inProgress,
    added,
    totalDemand,
    customSigns: Object.keys(getCustomClips()).length,
  };
}

/* --------------------- Camera → Text: unmatched attempts --------------------- */

/**
 * Every time Camera → Text holds a steady hand shape for long enough to be a
 * deliberate attempt but can't confidently match it to any of the 151 ISL
 * templates, we log it here — anonymously, no video/image, just a count —
 * so admins can see recognition-gap volume separately from named word
 * requests (which require the user to type what they meant).
 */
export interface UnmatchedGestureLogEntry {
  id: string;
  at: string;
  /** Best-guess word the matcher considered, for admin triage context only — never shown to the end user as a result. */
  nearestGuess?: string;
}

const UNMATCHED_GESTURES_KEY = "signaverse_unmatched_gestures_v1";
export const UNMATCHED_GESTURES_EVENT = "signaverse:unmatched-gestures-updated";
const UNMATCHED_GESTURES_MAX_STORED = 200;

export function logUnmatchedGesture(nearestGuess?: string): void {
  const entries = read<UnmatchedGestureLogEntry[]>(UNMATCHED_GESTURES_KEY, []);
  const next: UnmatchedGestureLogEntry = {
    id: uid(),
    at: new Date().toISOString(),
    ...(nearestGuess ? { nearestGuess } : {}),
  };
  write(
    UNMATCHED_GESTURES_KEY,
    [next, ...entries].slice(0, UNMATCHED_GESTURES_MAX_STORED),
  );
  emit(UNMATCHED_GESTURES_EVENT);
}

export function getUnmatchedGestureStats(): {
  total: number;
  last24h: number;
  recent: UnmatchedGestureLogEntry[];
} {
  const entries = read<UnmatchedGestureLogEntry[]>(UNMATCHED_GESTURES_KEY, []);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return {
    total: entries.length,
    last24h: entries.filter((e) => new Date(e.at).getTime() >= dayAgo).length,
    recent: entries.slice(0, 20),
  };
}

export function clearUnmatchedGestures(): void {
  write(UNMATCHED_GESTURES_KEY, []);
  emit(UNMATCHED_GESTURES_EVENT);
}
