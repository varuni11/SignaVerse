/**
 * English → ISL translation pipeline (text and speech-recognised English share it).
 *
 *  1 normalise      unicode, contractions, number words → digits, fillers
 *  2 segment        sentences; sentence type (statement / yes-no / WH / imperative)
 *  3 tag            part of speech, tense, negation (open-source `compromise`)
 *  4 grammar        ISL-style gloss order:
 *                   [time] [subject] [objects / complements] VERB [FINISH|WILL] [NOT|CANNOT] [WH]
 *                   articles / copula / infinitive "to" dropped
 *  5 lexicon        word → sign: exact → inflection/lemma → listed synonym → approximate (flagged)
 *  6 unseen words   names + words with no sign are FINGERSPELLED (never guessed); digits sign digit-by-digit
 *  7 report         what was dropped, approximated, fingerspelled, or unsupported
 *
 * The grammar rules are a documented, rule-based approximation of ISL — they have
 * NOT been validated by a fluent ISL signer (see the project report).
 */
import nlp from "compromise";
import {
  APPROX, AUX_Q, CONTRACTIONS, DROP, EXACT, FUTURE_TIME, PAST_TIME, TIME_FRONT, WH,
} from "./lexicon";
import type { SignStep } from "./motion";

export interface Vocabulary {
  /** multi-letter word clips available */
  words: Set<string>;
  letters: Set<string>;
  digits: Set<string>;
  /** optional per-key handshape confidence for UI warnings */
  lowConfidence?: Set<string> | undefined;
}

export type GlossKind = "sign" | "spell" | "number";
export interface GlossToken {
  gloss: string;
  kind: GlossKind;
  source: string;
  keys: string[];
  approx?: boolean | undefined;
  note?: string | undefined;
  lowConfidence?: boolean | undefined;
  /** a proper name (fingerspelling is the correct treatment) vs an unknown ordinary word */
  isName?: boolean;
}

export type SentenceType = "statement" | "yes-no" | "wh" | "imperative";

export interface SentenceReport {
  text: string;
  type: SentenceType;
  tagged: string;
  gloss: string[];
}

export interface IslTranslation {
  input: string;
  normalized: string;
  sentences: SentenceReport[];
  tokens: GlossToken[];
  steps: SignStep[];
  /** ordinary words with no sign in the library → fingerspelled (candidates for "Request this sign") */
  fingerspelled: string[];
  names: string[];
  approximations: { word: string; used: string; note: string }[];
  dropped: { word: string; reason: string }[];
  unsupported: string[];
  notes: string[];
  /** question type of the LAST sentence (drives head tilt; brows are not available on this avatar) */
  nonManual: SentenceType;
}

const MAX_TOKENS = 80;
const NUM_WORDS = new Set("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand".split(" "));

interface Tagged { text: string; lower: string; tags: Set<string>; capital: boolean; pos: number }

// ------------------------------------------------------------ stage 1: normalise
export function normalise(raw: string): string {
  let s = raw.normalize("NFKC").replace(/[\u2018\u2019\u02bc`]/g, "'").replace(/[\u201c\u201d]/g, '"');
  for (const [re, rep] of CONTRACTIONS) s = s.replace(re, rep);
  s = s.replace(/\s+/g, " ").trim();
  // number words → digits ("twenty five" → "25"); a lone "one" is left alone (pronoun/determiner use)
  if ([...s.toLowerCase().matchAll(/[a-z]+/g)].some((m) => NUM_WORDS.has(m[0]) && m[0] !== "one")) {
    try {
      const d = nlp(s);
      d.numbers().toNumber();
      s = d.text();
    } catch { /* keep text */ }
  }
  return s;
}

function splitSentences(s: string): { text: string; q: boolean }[] {
  const out: { text: string; q: boolean }[] = [];
  for (const m of s.matchAll(/[^.!?;\n]+[.!?;]*/g)) {
    const t = m[0].trim();
    if (!t.replace(/[.!?;]/g, "").trim()) continue;
    out.push({ text: t.replace(/[.!?;]+$/g, "").trim(), q: /\?/.test(t) });
  }
  return out;
}

// ------------------------------------------------------------ stage 3: tagging
function tagSentence(text: string): Tagged[] {
  const words = [...text.matchAll(/[A-Za-z][A-Za-z'-]*|\d+(?:\.\d+)?/g)].map((m) => ({ w: m[0], pos: m.index ?? 0 }));
  let terms: { text: string; tags: string[] }[] = [];
  try {
    terms = nlp(words.map((x) => x.w).join(" ")).terms().json().map((x: any) => x.terms[0]);
  } catch { /* fall through */ }
  const aligned = terms.length === words.length;
  // multi-word units that are ONE sign
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i]!.w.toLowerCase() === "thank" && words[i + 1]!.w.toLowerCase() === "you") {
      words.splice(i, 2, { w: "thank-you", pos: words[i]!.pos });
      if (aligned) terms.splice(i, 2, { text: "thank-you", tags: ["Expression"] });
    }
  }
  const aligned2 = aligned && terms.length === words.length;
  return words.map((x, i) => {
    let tags: string[] = [];
    if (aligned2) tags = terms[i]!.tags;
    else {
      try { tags = nlp(x.w).terms().json()[0]?.terms[0]?.tags ?? []; } catch { tags = []; }
    }
    if (/^\d/.test(x.w)) tags = [...tags, "Value"];
    return { text: x.w, lower: x.w.toLowerCase(), tags: new Set(tags), capital: /^[A-Z]/.test(x.w) && x.w !== "I", pos: x.pos };
  });
}

const lemmaVerb = (w: string) => {
  try { const d = nlp("they " + w); d.verbs().toInfinitive(); return d.text("normal").replace(/^they /, "") || w; } catch { return w; }
};
const lemmaNoun = (w: string) => {
  try { const d = nlp(w); d.nouns().toSingular(); return d.text("normal") || w; } catch { return w; }
};

function suffixCandidates(w: string): string[] {
  const c: string[] = [];
  const add = (x: string) => x.length > 1 && !c.includes(x) && c.push(x);
  if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
  if (w.endsWith("es")) add(w.slice(0, -2));
  if (w.endsWith("s")) add(w.slice(0, -1));
  if (w.endsWith("ing")) { const b = w.slice(0, -3); add(b); add(b + "e"); if (/(.)\1$/.test(b)) add(b.slice(0, -1)); }
  if (w.endsWith("ed")) { const b = w.slice(0, -2); add(b); add(b + "e"); add(w.slice(0, -1)); if (/(.)\1$/.test(b)) add(b.slice(0, -1)); if (w.endsWith("ied")) add(w.slice(0, -3) + "y"); }
  if (w.endsWith("est")) { add(w.slice(0, -3)); add(w.slice(0, -2)); }
  if (w.endsWith("er")) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
  if (w.endsWith("ly")) add(w.slice(0, -2));
  return c;
}

// ------------------------------------------------------------ stage 5/6: lexicon
type Resolved =
  | { kind: "sign"; key: string; approx?: boolean; note?: string }
  | { kind: "spell" };

function resolveWord(t: Tagged, V: Vocabulary): Resolved {
  const w = t.lower;
  const has = (k: string) => V.words.has(k);
  if (has(w)) return { kind: "sign", key: w };
  if (EXACT[w] && has(EXACT[w])) return { kind: "sign", key: EXACT[w] };
  if (APPROX[w] && has(APPROX[w].key)) return { kind: "sign", key: APPROX[w].key, approx: true, note: APPROX[w].note };
  const cands: string[] = [];
  if (t.tags.has("Verb")) cands.push(lemmaVerb(w));
  if (t.tags.has("Noun") || t.tags.has("Plural")) cands.push(lemmaNoun(w));
  cands.push(lemmaVerb(w), lemmaNoun(w), ...suffixCandidates(w));
  for (const c of cands) {
    if (c === w) continue;
    if (has(c)) return { kind: "sign", key: c };
    if (EXACT[c] && has(EXACT[c])) return { kind: "sign", key: EXACT[c] };
    if (APPROX[c] && has(APPROX[c].key)) return { kind: "sign", key: APPROX[c].key, approx: true, note: APPROX[c].note };
  }
  return { kind: "spell" };
}

const upper = (s: string) => s.toUpperCase();

// ------------------------------------------------------------ stage 4: grammar
interface Item { t: Tagged; role: "time" | "subj" | "post" | "verb" | "wh" | "skip" }

export function translateEnglishToISL(input: string, V: Vocabulary): IslTranslation {
  const normalized = normalise(input);
  const tokens: GlossToken[] = [];
  const sentencesOut: SentenceReport[] = [];
  const dropped: IslTranslation["dropped"] = [];
  const approximations: IslTranslation["approximations"] = [];
  const unsupported: string[] = [];
  const notes: string[] = [];
  const fingerspelled: string[] = [];
  const names: string[] = [];
  let lastType: SentenceType = "statement";

  const push = (tok: GlossToken) => { tokens.push(tok); };
  const sign = (key: string, source: string, extra: Partial<GlossToken> = {}) =>
    push({ gloss: upper(key), kind: "sign", source, keys: [key], lowConfidence: V.lowConfidence?.has(key), ...extra });

  const spell = (word: string, isName: boolean) => {
    const letters = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!letters) return;
    const keys = [...letters].filter((l) => V.letters.has(l));
    if (!keys.length) return;
    push({ gloss: [...letters].map(upper).join("-"), kind: "spell", source: word, keys, isName });
    const list = isName ? names : fingerspelled;
    if (!list.includes(word.toLowerCase())) list.push(word.toLowerCase());
  };
  const number = (n: string) => {
    const digits = [...n].filter((c) => /\d/.test(c));
    if (digits.some((d) => !V.digits.has(d))) return;
    push({ gloss: digits.join(""), kind: "number", source: n, keys: digits });
    if (digits.length > 1) notes.push(`Number ${n} is signed digit by digit (${digits.join(" ")}); ISL's dedicated forms for 10+ are not in the library.`);
  };

  const emit = (t: Tagged, forceName = false) => {
    if (/^\d/.test(t.text)) return number(t.text);
    const r = forceName ? ({ kind: "spell" } as Resolved) : resolveWord(t, V);
    if (r.kind === "sign") {
      if (r.approx) approximations.push({ word: t.lower, used: upper(r.key), note: r.note! });
      return sign(r.key, t.text, r.approx ? { approx: true, note: r.note ?? "" } : {});
    }
    const looksName = forceName || (t.tags.has("ProperNoun") && !V.words.has(t.lower)) || (t.capital && t.pos > 0);
    spell(t.text, looksName);
  };

  for (const sent of splitSentences(normalized)) {
    const toks = tagSentence(sent.text);
    if (!toks.length) continue;
    const first = toks[0]!.lower;
    const hasWh = toks.some((t) => WH.has(t.lower));
    const negImp = first === "do" && toks[1]?.lower === "not";
    const type: SentenceType = hasWh ? "wh"
      : negImp || (toks[0]!.tags.has("Imperative") && !sent.q) ? "imperative"
      : sent.q || (AUX_Q.has(first) && toks.length > 2) ? "yes-no"
      : "statement";
    lastType = type;
    const tagged = toks.map((t) => `${t.text}/${[...t.tags].filter((g) => ["Verb", "Noun", "Adjective", "Adverb", "Pronoun", "Preposition", "Determiner", "Copula", "Modal", "Negative", "QuestionWord", "ProperNoun", "Date", "Value", "PastTense", "Auxiliary", "Possessive", "Conjunction"].includes(g)).slice(0, 2).join("+") || "?"}`).join(" ");

    // clause splitting on clause-joining conjunctions when both sides have a verb
    const clauses: Tagged[][] = [];
    const joiners: (string | null)[] = [];
    let cur: Tagged[] = [];
    const hasVerb = (a: Tagged[]) => a.some((t) => t.tags.has("Verb") && !t.tags.has("Copula"));
    toks.forEach((t, i) => {
      if (["and", "but", "then"].includes(t.lower) && hasVerb(cur) && hasVerb(toks.slice(i + 1))) {
        clauses.push(cur); joiners.push(t.lower === "but" ? "but" : null); cur = [];
      } else cur.push(t);
    });
    clauses.push(cur);

    const before = tokens.length;
    clauses.forEach((cl, ci) => {
      let past = false, future = false, perfect = false, neg = false, cannot = false, canPos = false, doNotImp = false;
      const time: Tagged[] = [], subj: Tagged[] = [], post: Tagged[] = [], whs: Tagged[] = [];
      let verb: Tagged | null = null;
      const lowers = cl.map((t) => t.lower);
      const mainIdx = cl.findIndex((t, i) =>
        t.tags.has("Verb") && !t.tags.has("Copula") && !["will", "can", "cannot", "could", "would", "do", "does", "did", "have", "has", "had", "going", "shall", "should", "may"].includes(t.lower) && !(t.lower === "to") ||
        (["have", "has", "had"].includes(t.lower) && i === cl.length - 2 && !cl[i + 1]?.tags.has("Verb") && false));
      cl.forEach((t, i) => {
        const w = t.lower;
        const dropIt = (why: string) => { dropped.push({ word: t.text, reason: why }); };
        if (w === "not" || w === "never" && false) { neg = true; return; }
        if (w === "cannot") { cannot = true; return; }
        if (w === "can" && !(i === mainIdx)) { canPos = true; return; }
        if (w === "will" || w === "shall") { future = true; return; }
        if (w === "going" && cl[i + 1]?.lower === "to" && cl[i + 2]?.tags.has("Verb")) { future = true; return dropIt("future 'going to' → WILL marker"); }
        if (["have", "has", "had"].includes(w) && mainIdx > i && cl[mainIdx]!.tags.has("PastTense")) { perfect = true; return dropIt("perfect auxiliary → FINISH marker"); }
        if (w === "did") { past = true; return dropIt("past auxiliary → FINISH marker"); }
        if (["was", "were"].includes(w)) { past = true; return dropIt(DROP[w] ?? ""); }
        if (DROP[w] && !(w === "to" && false)) { if (w === "do" && type === "imperative" && cl[i + 1]?.lower === "not") doNotImp = true; return dropIt(DROP[w]); }
        if (WH.has(w)) { whs.push(t); return; }
        if (TIME_FRONT.has(w) && (t.tags.has("Date") || t.tags.has("Adverb") || ["now", "before", "after", "next"].includes(w))) {
          if (PAST_TIME.has(w)) past = false;
          if (FUTURE_TIME.has(w)) future = false;
          time.push(t); return;
        }
        if (i === mainIdx) { verb = t; if (t.tags.has("PastTense")) past = true; return; }
        (mainIdx >= 0 && i < mainIdx ? subj : post).push(t);
      });
      if (time.some((t) => PAST_TIME.has(t.lower))) past = false;
      if (doNotImp) neg = false;

      const items: { t: Tagged; name?: boolean }[] = [];
      const nameAfter = (t: Tagged, arr: Tagged[]) => {
        const k = arr.indexOf(t);
        return k > 0 && arr[k - 1]!.lower === "name" && !V.words.has(t.lower);
      };
      for (const t of time) items.push({ t });
      for (const t of subj) items.push({ t, name: nameAfter(t, subj) });
      // verb chains ("want to LEARN sign language"): each later verb follows its own objects (SOV)
      const orderedPost: Tagged[] = [];
      let pendV: Tagged | null = null, pendObjs: Tagged[] = [];
      const flush = () => { orderedPost.push(...pendObjs); if (pendV) orderedPost.push(pendV); pendV = null; pendObjs = []; };
      for (const t of post) {
        if (t.tags.has("Verb") && !t.tags.has("Copula") && !t.tags.has("Noun")) { flush(); pendV = t; }
        else if (pendV) pendObjs.push(t);
        else orderedPost.push(t);
      }
      flush();
      for (const t of orderedPost) items.push({ t, name: nameAfter(t, post) || (cl.indexOf(t) > 0 && cl[cl.indexOf(t) - 1]?.lower === "called" && !V.words.has(t.lower)) });
      const startLen = tokens.length;
      for (const it of items) emit(it.t, !!it.name);
      if (verb) emit(verb);
      if (past || perfect) { if (V.words.has("finish")) sign("finish", "(past/perfect)", { note: "completed-action marker added for past tense" }); }
      if (future && !time.some((t) => FUTURE_TIME.has(t.lower))) { if (V.words.has("will")) sign("will", "(future)", { note: "future marker added" }); }
      if (cannot) sign("cannot", "cannot");
      else if (neg) sign("not", "not");
      else if (doNotImp) sign("do-not", "do not");
      if (canPos && !cannot) sign("can", "can");
      for (const t of whs) emit(t);
      if (ci < joiners.length && joiners[ci] === "but") sign("but", "but");
      void lowers; void startLen;
    });

    sentencesOut.push({ text: sent.text, type, tagged, gloss: tokens.slice(before).map((t) => t.gloss) });
    if (type === "yes-no") notes.push("Yes/no question: ISL marks it with raised eyebrows and a head tilt. This avatar can only tilt its head — eyebrows are not supported.");
    if (type === "wh") notes.push("WH-question: ISL marks it with a furrowed brow; this avatar cannot show eyebrow movement.");
  }

  let capped = tokens;
  if (tokens.length > MAX_TOKENS) { capped = tokens.slice(0, MAX_TOKENS); notes.push(`Sentence is long — only the first ${MAX_TOKENS} signs are shown.`); }

  const nonAscii = [...input].filter((c) => /[^\x00-\x7F]/.test(c) && !/[\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u00a0]/.test(c));
  if (nonAscii.length) {
    const words = input.split(/\s+/).filter((w) => /[^\x00-\x7F]/.test(w));
    unsupported.push(...words);
    notes.push("Only English input is supported — non-English words were skipped.");
  }

  const steps: SignStep[] = [];
  capped.forEach((tok, ti) => {
    tok.keys.forEach((key) => steps.push({
      key,
      caption: tok.kind === "sign" ? tok.gloss : key.toUpperCase(),
      kind: tok.kind === "sign" ? "sign" : tok.kind === "number" ? "digit" : "letter",
      token: ti,
    }));
  });
  const uniq = (a: string[]) => [...new Set(a)];
  return {
    input, normalized, sentences: sentencesOut, tokens: capped, steps,
    fingerspelled: uniq(fingerspelled), names: uniq(names), approximations,
    dropped, unsupported, notes: uniq(notes), nonManual: lastType,
  };
}

export function vocabularyFromKeys(keys: string[], lowConfidence?: Set<string>): Vocabulary {
  return {
    words: new Set(keys.filter((k) => k.length > 1)),
    letters: new Set(keys.filter((k) => /^[a-z]$/.test(k))),
    digits: new Set(keys.filter((k) => /^\d$/.test(k))),
    lowConfidence,
  };
}
