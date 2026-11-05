import { readFileSync } from "node:fs";
import { translateEnglishToISL, vocabularyFromKeys } from "../src/components/avatar/isl/english-to-isl";

const idx = JSON.parse(readFileSync("public/isl-motion/motion-index.json", "utf8"));
const V = vocabularyFromKeys(Object.keys(idx.clips));

/** sentence -> expected ISL gloss (`~` marks an approximate sign) */
const EXPECT: Record<string, string> = {
  "Hello": "HELLO",
  "Thank you": "THANK-YOU",
  "How are you": "YOU HOW",
  "My name is Rahul": "MY NAME R-A-H-U-L",
  "I can not come": "ME COME CANNOT",
  "Where is the college?": "COLLEGE WHERE",
  "What is your name?": "YOUR NAME WHAT",
  "Who are you?": "YOU WHO",
  "Are you happy?": "YOU HAPPY",
  "Do not go": "GO DO-NOT",
  "I do not eat": "ME EAT NOT",
  "I have eaten": "ME EAT FINISH",
  "I am going to study": "ME STUDY WILL",
  "I want to learn sign language": "ME SIGN LANGUAGE LEARN W-A-N-T",
  "She went to the market": "THAT~ M-A-R-K-E-T GO FINISH",
  "I will study tomorrow": "T-O-M-O-R-R-O-W ME STUDY",
  "Can you help me?": "YOU ME HELP CAN",
  "hi my name is priya i am from chennai": "HELLO MY NAME P-R-I-Y-A ME FROM C-H-E-N-N-A-I",
  "I am twenty five": "ME 25",
  "": "",
  "the": "",
};
let fail = 0;
for (const [s, want] of Object.entries(EXPECT)) {
  const r = translateEnglishToISL(s, V);
  const got = r.tokens.map((t) => t.gloss + (t.approx ? "~" : "")).join(" ");
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(s).padEnd(46)} -> ${got}${ok ? "" : `   (expected: ${want})`}`);
}
// unseen words must be fingerspelled and reported, never silently dropped or guessed
const u = translateEnglishToISL("Please open the refrigerator", V);
const spelled = u.tokens.filter((t) => t.kind === "spell").map((t) => t.gloss);
const okU = spelled.includes("R-E-F-R-I-G-E-R-A-T-O-R") && u.fingerspelled.includes("refrigerator");
if (!okU) fail++;
console.log(`${okU ? "PASS" : "FAIL"}  unseen word fingerspelled + reported -> ${u.tokens.map((t) => t.gloss).join(" ")}`);
const h = translateEnglishToISL("नमस्ते hello", V);
const okH = h.unsupported.length === 1 && h.tokens.map((t) => t.gloss).join(" ") === "HELLO";
if (!okH) fail++;
console.log(`${okH ? "PASS" : "FAIL"}  non-English text reported as unsupported -> ${h.tokens.map((t) => t.gloss).join(" ")} | unsupported=${h.unsupported.join(",")}`);
console.log(fail ? `\n${fail} FAILED` : "\nall pipeline checks passed");
process.exit(fail ? 1 : 0);
