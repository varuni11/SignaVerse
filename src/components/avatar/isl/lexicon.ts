/**
 * Hand-curated lexical rules for the English → ISL pipeline.
 *
 * Everything here maps an English word to a sign that exists in the motion
 * library. Entries are split into:
 *   EXACT   – same meaning (inflection / spelling variants / pronouns)
 *   APPROX  – a close-but-not-identical sign. These are ALWAYS shown to the user
 *             as "approximate" in the UI and in the translation report; they are
 *             never presented as the exact sign.
 * Anything not covered here (and not in the library) is fingerspelled, never guessed.
 */

export const EXACT: Record<string, string> = {
  // pronouns / possessives (ISL points at self / addressee)
  i: "me", me: "me", my: "my", mine: "my", we: "we", us: "us", our: "our", ours: "our",
  you: "you", your: "your", yours: "your", yourself: "yourself", they: "they",
  it: "it", his: "his", her: "her", this: "this", that: "that", those: "those",
  // greetings & politeness
  hi: "hello", hey: "hello", hii: "hello", hiya: "hello", hello: "hello",
  goodbye: "bye", "bye-bye": "bye", byebye: "bye",
  thanks: "thank-you", thankyou: "thank-you",
  // spelling / vocabulary variants
  tv: "television", telly: "television", laptop: "computer", pc: "computer",
  cant: "cannot", cannot: "cannot",
  done: "finish", finished: "finish", completed: "finish", complete: "finish",
  speak: "talk", chat: "talk", conversation: "talk",
  excellent: "great", awesome: "great", wonderful: "great", fantastic: "great",
  lovely: "beautiful", gorgeous: "beautiful",
  incorrect: "wrong", mistake: "wrong",
  glad: "happy", joyful: "happy", cheerful: "happy",
  begin: "start",
};

export const APPROX: Record<string, { key: string; note: string }> = {
  he: { key: "that", note: "no he/she clip in the library — shown with the pointing sign THAT" },
  she: { key: "that", note: "no he/she clip in the library — shown with the pointing sign THAT" },
  him: { key: "that", note: "no he/she clip in the library — shown with the pointing sign THAT" },
  them: { key: "they", note: "'them' shown as THEY" },
  their: { key: "they", note: "'their' shown as THEY" },
  theirs: { key: "they", note: "'theirs' shown as THEY" },
  its: { key: "it", note: "'its' shown as IT" },
  these: { key: "this", note: "'these' shown as THIS" },
  no: { key: "not", note: "'no' shown as NOT (no separate NO clip)" },
  never: { key: "not", note: "'never' shown as NOT" },
  could: { key: "can", note: "'could' shown as CAN" },
  would: { key: "will", note: "'would' shown as WILL" },
  fine: { key: "good", note: "'fine' shown as GOOD" },
  nice: { key: "good", note: "'nice' shown as GOOD" },
  unhappy: { key: "sad", note: "'unhappy' shown as SAD" },
  cute: { key: "pretty", note: "'cute' shown as PRETTY" },
  correct: { key: "right", note: "'correct' shown as RIGHT" },
  house: { key: "home", note: "'house' shown as HOME" },
  job: { key: "work", note: "'job' shown as WORK" },
  university: { key: "college", note: "'university' shown as COLLEGE" },
  look: { key: "see", note: "'look' shown as SEE" },
  watch: { key: "see", note: "'watch' shown as SEE" },
};

/** Function words with no sign of their own in ISL grammar (dropped, and reported). */
export const DROP: Record<string, string> = {
  the: "article", a: "article", an: "article",
  is: "copula", am: "copula", are: "copula", be: "copula", been: "copula", being: "copula",
  was: "copula", were: "copula",
  to: "infinitive marker / preposition", and: "conjunction (juxtaposition is used)",
  very: "intensifier", really: "intensifier", just: "filler", quite: "intensifier",
  please: "politeness word (no clip)", um: "filler", uh: "filler", hmm: "filler",
  do: "auxiliary", does: "auxiliary", did: "auxiliary",
  there: "expletive",
};

export const WH = new Set(["what", "where", "when", "who", "whom", "whose", "why", "how", "which"]);
export const AUX_Q = new Set(["do", "does", "did", "is", "are", "am", "was", "were", "can", "could", "will", "would", "shall", "should", "have", "has", "had", "may"]);
export const PRONOUN_SUBJ = new Set(["i", "you", "we", "they", "he", "she", "it", "there"]);
/** Time words that ISL puts first in the sentence. */
export const TIME_FRONT = new Set(["now", "before", "after", "next", "today", "tomorrow", "yesterday", "tonight", "later", "earlier", "soon", "ago"]);
export const PAST_TIME = new Set(["yesterday", "ago", "earlier", "before"]);
export const FUTURE_TIME = new Set(["tomorrow", "later", "soon", "tonight", "next"]);

export const CONTRACTIONS: [RegExp, string][] = [
  [/\bwon't\b/gi, "will not"],
  [/\bcan't\b/gi, "cannot"],
  [/\bcan not\b/gi, "cannot"],
  [/\bshan't\b/gi, "shall not"],
  [/\blet's\b/gi, "let us"],
  [/n't\b/gi, " not"],
  [/'m\b/gi, " am"],
  [/'re\b/gi, " are"],
  [/\b(it|that|what|he|she|there|here|who|where|how)'s\b/gi, "$1 is"],
  [/'ll\b/gi, " will"],
  [/'ve\b/gi, " have"],
  [/'d\b/gi, " would"],
  [/'s\b/gi, ""],
];
