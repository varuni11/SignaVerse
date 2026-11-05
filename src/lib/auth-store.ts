/**
 * Two independent, client-side auth systems for SignaVerse.
 *
 * There is no backend/API server in this project, so this cannot be real
 * multi-device authentication — it's an honest, self-contained demo auth
 * layer: accounts and sessions are both kept in this browser's
 * localStorage. The important part for the product requirement is that
 * USER and ADMIN are two completely separate systems: separate account
 * tables, separate session keys, separate login screens and separate
 * route guards. Logging in as one never grants the other.
 *
 * To upgrade to real auth later: swap the storage calls below for API
 * calls to a real backend (e.g. POST /api/auth/login) and replace the
 * plaintext password check with server-side hashing — nothing else in the
 * app needs to change, since everything else talks to this module only.
 */

export type CommunicationStatus =
  "deaf" | "mute" | "deaf_mute" | "hard_of_hearing" | "hearing";

export const communicationStatusLabels: Record<CommunicationStatus, string> = {
  deaf: "Deaf",
  mute: "Mute",
  deaf_mute: "Deaf & Mute",
  hard_of_hearing: "Hard of hearing",
  hearing: "Hearing",
};

export interface SignaUser {
  id: string;
  name: string;
  email: string;
  password: string;
  age: string;
  dob: string;
  communicationStatus: CommunicationStatus;
  createdAt: string;
}

export interface SignaAdmin {
  id: string;
  name: string;
  email: string;
  password: string;
  createdAt: string;
}

const USERS_KEY = "signaverse_users_v1";
const ADMINS_KEY = "signaverse_admins_v1";
const USER_SESSION_KEY = "signaverse_user_session_v1";
const ADMIN_SESSION_KEY = "signaverse_admin_session_v1";

export const USER_SESSION_EVENT = "signaverse:user-session-updated";
export const ADMIN_SESSION_EVENT = "signaverse:admin-session-updated";

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
    // localStorage may be unavailable (private mode, quota) — fail silently.
  }
}

function emit(event: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(event));
}

/* ------------------------------- Users ------------------------------- */

function readUsers(): SignaUser[] {
  return read<SignaUser[]>(USERS_KEY, []);
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  age: string;
  dob: string;
  communicationStatus: CommunicationStatus;
}

export function signUpUser(
  input: SignUpInput,
): { ok: true; user: SignaUser } | { ok: false; error: string } {
  const email = input.email.trim().toLowerCase();
  const users = readUsers();
  if (users.some((u) => u.email === email)) {
    return { ok: false, error: "An account with this email already exists." };
  }
  const user: SignaUser = {
    id: uid(),
    name: input.name.trim(),
    email,
    password: input.password,
    age: input.age.trim(),
    dob: input.dob,
    communicationStatus: input.communicationStatus,
    createdAt: new Date().toISOString(),
  };
  write(USERS_KEY, [...users, user]);
  write(USER_SESSION_KEY, { userId: user.id });
  emit(USER_SESSION_EVENT);
  return { ok: true, user };
}

export function loginUser(
  email: string,
  password: string,
): { ok: true; user: SignaUser } | { ok: false; error: string } {
  const users = readUsers();
  const user = users.find((u) => u.email === email.trim().toLowerCase());
  if (!user || user.password !== password) {
    return { ok: false, error: "Incorrect email or password." };
  }
  write(USER_SESSION_KEY, { userId: user.id });
  emit(USER_SESSION_EVENT);
  return { ok: true, user };
}

export function logoutUser() {
  try {
    localStorage.removeItem(USER_SESSION_KEY);
  } catch {
    // ignore
  }
  emit(USER_SESSION_EVENT);
}

export function getCurrentUser(): SignaUser | null {
  const session = read<{ userId: string } | null>(USER_SESSION_KEY, null);
  if (!session) return null;
  return readUsers().find((u) => u.id === session.userId) ?? null;
}

export function isUserAuthed(): boolean {
  return getCurrentUser() !== null;
}

/* ------------------------------- Admins ------------------------------- */

const DEFAULT_ADMIN: SignaAdmin = {
  id: "admin-seed",
  name: "Library Admin",
  email: "admin@signaverse.app",
  password: "Admin@2024",
  createdAt: new Date(0).toISOString(),
};

function readAdmins(): SignaAdmin[] {
  const admins = read<SignaAdmin[]>(ADMINS_KEY, []);
  if (admins.length === 0) {
    write(ADMINS_KEY, [DEFAULT_ADMIN]);
    return [DEFAULT_ADMIN];
  }
  return admins;
}

export function loginAdmin(
  email: string,
  password: string,
): { ok: true; admin: SignaAdmin } | { ok: false; error: string } {
  const admins = readAdmins();
  const admin = admins.find((a) => a.email === email.trim().toLowerCase());
  if (!admin || admin.password !== password) {
    return { ok: false, error: "Incorrect admin email or password." };
  }
  write(ADMIN_SESSION_KEY, { adminId: admin.id });
  emit(ADMIN_SESSION_EVENT);
  return { ok: true, admin };
}

export function logoutAdmin() {
  try {
    localStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {
    // ignore
  }
  emit(ADMIN_SESSION_EVENT);
}

export function getCurrentAdmin(): SignaAdmin | null {
  const session = read<{ adminId: string } | null>(ADMIN_SESSION_KEY, null);
  if (!session) return null;
  return readAdmins().find((a) => a.id === session.adminId) ?? null;
}

export function isAdminAuthed(): boolean {
  return getCurrentAdmin() !== null;
}

/** Demo credentials shown on the admin login screen so it's usable out of the box. */
export const DEMO_ADMIN_CREDENTIALS = {
  email: DEFAULT_ADMIN.email,
  password: DEFAULT_ADMIN.password,
};
