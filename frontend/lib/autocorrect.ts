/** Gentle auto-capitalisation and auto-correction for English question text, applied while a teacher types in the question editor.
 *  It only acts when she finishes a word (space, punctuation or Enter) and only on a plain word of letters: numbers, web addresses,
 *  e-mail addresses, codes and ALL-CAPS words are never touched. Backspace straight afterwards puts back exactly what she typed, and
 *  Ctrl+Z works as usual. It is a device choice (Settings → Writing questions) and runs only for questions written in English. */
import { useEffect, useState } from "react";

const KEY = "amani_autofix";
export const autofixEnabled = () => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } };
export function setAutofix(on: boolean) { try { localStorage.setItem(KEY, on ? "1" : "0"); window.dispatchEvent(new Event("amani:autofix")); } catch { /* ignore */ } }
export function useAutofix(): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => { const sync = () => setOn(autofixEnabled()); sync(); window.addEventListener("amani:autofix", sync); return () => window.removeEventListener("amani:autofix", sync); }, []);
  return on;
}

/** Common slips only: every entry here is a word that is wrong in every context. */
const FIX: Record<string, string> = {
  "abotu": "about",
  "abuot": "about",
  "acccount": "account",
  "accomodate": "accommodate",
  "accomodation": "accommodation",
  "accout": "account",
  "acheive": "achieve",
  "achive": "achieve",
  "acommodate": "accommodate",
  "acount": "account",
  "addres": "address",
  "adn": "and",
  "adress": "address",
  "aftr": "after",
  "agaisnt": "against",
  "aganist": "against",
  "agian": "again",
  "agin": "again",
  "agnst": "against",
  "ahve": "have",
  "algorithem": "algorithm",
  "algorithim": "algorithm",
  "algoritm": "algorithm",
  "algorythm": "algorithm",
  "alot": "a lot",
  "amrks": "marks",
  "anser": "answer",
  "ansers": "answers",
  "answeer": "answer",
  "anwser": "answer",
  "anwsers": "answers",
  "aobut": "about",
  "aplication": "application",
  "applicaiton": "application",
  "applicaton": "application",
  "arent": "aren't",
  "aswell": "as well",
  "atfer": "after",
  "beacuse": "because",
  "beause": "because",
  "becasue": "because",
  "becaus": "because",
  "becouse": "because",
  "becuase": "because",
  "befor": "before",
  "befroe": "before",
  "beggining": "beginning",
  "begining": "beginning",
  "beleive": "believe",
  "belive": "believe",
  "beofre": "before",
  "biolgy": "biology",
  "biologi": "biology",
  "calender": "calendar",
  "calss": "class",
  "cant": "can't",
  "chemestry": "chemistry",
  "chemisty": "chemistry",
  "clas": "class",
  "clss": "class",
  "cna": "can",
  "collegue": "colleague",
  "comming": "coming",
  "communiction": "communication",
  "compter": "computer",
  "computar": "computer",
  "computr": "computer",
  "comunicate": "communicate",
  "comunication": "communication",
  "comuter": "computer",
  "conditoin": "condition",
  "conditon": "condition",
  "corect": "correct",
  "corrcet": "correct",
  "correst": "correct",
  "coudl": "could",
  "couldnt": "couldn't",
  "databas": "database",
  "databsae": "database",
  "databse": "database",
  "definately": "definitely",
  "definatly": "definitely",
  "definitly": "definitely",
  "devic": "device",
  "didnt": "didn't",
  "diferent": "different",
  "differnt": "different",
  "diffrent": "different",
  "docuemnt": "document",
  "documet": "document",
  "documnet": "document",
  "doesnt": "doesn't",
  "dont": "don't",
  "donwload": "download",
  "dowload": "download",
  "downlaod": "download",
  "eachother": "each other",
  "enviroment": "environment",
  "everytime": "every time",
  "exampel": "example",
  "exampl": "example",
  "excercise": "exercise",
  "exercies": "exercise",
  "exercize": "exercise",
  "exersise": "exercise",
  "exm": "exam",
  "exma": "exam",
  "exmaple": "example",
  "exmas": "exams",
  "experiance": "experience",
  "experiement": "experiment",
  "experment": "experiment",
  "expirement": "experiment",
  "expresion": "expression",
  "expresssion": "expression",
  "freind": "friend",
  "freinds": "friends",
  "fucntion": "function",
  "fuction": "function",
  "funtion": "function",
  "geografy": "geography",
  "geograpy": "geography",
  "geting": "getting",
  "gettin": "getting",
  "gonig": "going",
  "goverment": "government",
  "governmnet": "government",
  "gramar": "grammar",
  "grammer": "grammar",
  "hadnt": "hadn't",
  "haev": "have",
  "hardwear": "hardware",
  "hardwere": "hardware",
  "hasnt": "hasn't",
  "haveing": "having",
  "havent": "haven't",
  "heigth": "height",
  "hisory": "history",
  "histroy": "history",
  "hvae": "have",
  "im": "I'm",
  "imformation": "information",
  "imortant": "important",
  "importan": "important",
  "importent": "important",
  "incorect": "incorrect",
  "incorrcet": "incorrect",
  "infact": "in fact",
  "infomation": "information",
  "informtion": "information",
  "inofrmation": "information",
  "instal": "install",
  "instalation": "installation",
  "instalaton": "installation",
  "instaled": "installed",
  "intenet": "internet",
  "interent": "internet",
  "interesing": "interesting",
  "internat": "internet",
  "intresting": "interesting",
  "isnt": "isn't",
  "ive": "I've",
  "jsut": "just",
  "keyborad": "keyboard",
  "keybord": "keyboard",
  "knowldge": "knowledge",
  "knowlegde": "knowledge",
  "knowlege": "knowledge",
  "knwo": "know",
  "konw": "know",
  "langage": "language",
  "langauge": "language",
  "lenght": "length",
  "lerning": "learning",
  "lesosn": "lesson",
  "lessn": "lesson",
  "literture": "literature",
  "litrature": "literature",
  "loopp": "loop",
  "makeing": "making",
  "marsk": "marks",
  "mathamatics": "mathematics",
  "mathematis": "mathematics",
  "mathmatics": "mathematics",
  "memeory": "memory",
  "memmory": "memory",
  "memroy": "memory",
  "mispelled": "misspelled",
  "mispelt": "misspelt",
  "misspeled": "misspelled",
  "moniter": "monitor",
  "nad": "and",
  "neccesary": "necessary",
  "neccessary": "necessary",
  "necesary": "necessary",
  "netwok": "network",
  "netwrok": "network",
  "newtork": "network",
  "noone": "no one",
  "occured": "occurred",
  "occurence": "occurrence",
  "occuring": "occurring",
  "ofcourse": "of course",
  "onyl": "only",
  "opearting": "operating",
  "opeating": "operating",
  "operater": "operator",
  "opertor": "operator",
  "pape": "paper",
  "papper": "paper",
  "paragraf": "paragraph",
  "paragragh": "paragraph",
  "passwrod": "password",
  "pasword": "password",
  "peice": "piece",
  "peices": "pieces",
  "pepar": "paper",
  "phyics": "physics",
  "physcis": "physics",
  "pleae": "please",
  "plese": "please",
  "porblem": "problem",
  "porgram": "program",
  "presenation": "presentation",
  "presentaion": "presentation",
  "prinnter": "printer",
  "pritner": "printer",
  "probelm": "problem",
  "probem": "problem",
  "problm": "problem",
  "proccesor": "processor",
  "proccessor": "processor",
  "processer": "processor",
  "profesor": "professor",
  "proffesor": "professor",
  "progam": "program",
  "progamming": "programming",
  "programing": "programming",
  "programmin": "programming",
  "puting": "putting",
  "qeustion": "question",
  "quesiton": "question",
  "quesitons": "questions",
  "questoin": "question",
  "questoins": "questions",
  "raeding": "reading",
  "reciept": "receipt",
  "recieve": "receive",
  "recieved": "received",
  "reslts": "results",
  "reslut": "result",
  "resutl": "result",
  "resutls": "results",
  "runing": "running",
  "runnning": "running",
  "scaner": "scanner",
  "sceince": "science",
  "scence": "science",
  "schol": "school",
  "scholl": "school",
  "scienc": "science",
  "scoer": "score",
  "scool": "school",
  "scroe": "score",
  "secuirty": "security",
  "securty": "security",
  "sentance": "sentence",
  "sentances": "sentences",
  "seperate": "separate",
  "seperately": "separately",
  "sercurity": "security",
  "seting": "setting",
  "shcool": "school",
  "shoud": "should",
  "shoudl": "should",
  "shouldnt": "shouldn't",
  "softwere": "software",
  "sofware": "software",
  "speach": "speech",
  "spelin": "spelling",
  "speling": "spelling",
  "spreadshee": "spreadsheet",
  "spredsheet": "spreadsheet",
  "spreedsheet": "spreadsheet",
  "statment": "statement",
  "statments": "statements",
  "stduent": "student",
  "stoping": "stopping",
  "strenght": "strength",
  "studen": "student",
  "studens": "students",
  "studing": "studying",
  "studnet": "student",
  "studnets": "students",
  "stuents": "students",
  "succesful": "successful",
  "successfull": "successful",
  "sucess": "success",
  "sucessful": "successful",
  "sysem": "system",
  "systm": "system",
  "sytem": "system",
  "taht": "that",
  "takeing": "taking",
  "teatcher": "teacher",
  "techer": "teacher",
  "technolgy": "technology",
  "tecnology": "technology",
  "teh": "the",
  "tehnology": "technology",
  "tesst": "test",
  "tets": "test",
  "thankyou": "thank you",
  "thats": "that's",
  "theyre": "they're",
  "theyve": "they've",
  "thier": "their",
  "thikn": "think",
  "thnk": "think",
  "thoese": "those",
  "thsese": "these",
  "tommorow": "tomorrow",
  "tomorow": "tomorrow",
  "tomorrrow": "tomorrow",
  "tset": "test",
  "untill": "until",
  "uplaod": "upload",
  "uplod": "upload",
  "usefull": "useful",
  "useing": "using",
  "usernmae": "username",
  "usng": "using",
  "vairable": "variable",
  "varaible": "variable",
  "varible": "variable",
  "virius": "virus",
  "vrius": "virus",
  "wasnt": "wasn't",
  "webiste": "website",
  "websit": "website",
  "wensite": "website",
  "werent": "weren't",
  "weve": "we've",
  "whats": "what's",
  "whcih": "which",
  "wher": "where",
  "whihc": "which",
  "whiich": "which",
  "whn": "when",
  "whre": "where",
  "wich": "which",
  "wieght": "weight",
  "wierd": "weird",
  "wihch": "which",
  "wont": "won't",
  "woudl": "would",
  "wouldnt": "wouldn't",
  "writen": "written",
  "writting": "writing",
  "youre": "you're",
  "youve": "you've"
};

/** Names and terms that always take capitals (days, months, places, languages, well-known computer terms). "may" and "march" are left alone: they are ordinary words. */
const SPECIAL: Record<string, string> = Object.fromEntries([
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "January", "February", "April", "June", "July", "August", "September", "October", "November", "December",
  "English", "Kiswahili", "Swahili", "Tanzania", "Kenya", "Uganda", "Rwanda", "Burundi", "Africa", "Dodoma", "Mwanza", "Arusha", "Singida", "Manyoni", "Zanzibar", "Tanzanian", "African",
  "Google", "Microsoft", "Linux", "Android", "Facebook", "WhatsApp", "YouTube", "Instagram", "Python", "JavaScript", "PowerPoint", "Wi-Fi",
  "HTML", "CSS", "CPU", "USB", "URL", "PDF", "ICT", "GUI", "LAN", "SQL", "HTTP", "HTTPS", "BIOS",
].map((w) => [w.toLowerCase().replace("-", ""), w]));

const ABBR = new Set(["mr", "mrs", "ms", "dr", "prof", "vs", "etc", "no", "fig", "approx", "st", "sr", "jr", "eg", "ie", "cf", "viz", "al"]);
const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);

/** One finished word → what it should be. `startsSentence` capitalises it. Returns the same text if nothing needs changing. */
export function fixWord(core: string, startsSentence: boolean): string {
  const lower = core.replace(/’/g, "'").toLowerCase();
  const allCaps = core.length > 1 && core === core.toUpperCase();
  const plainCase = core === core.toLowerCase() || core === cap(core.toLowerCase());
  let w = core;
  if (!allCaps) {
    const f = FIX[lower];
    if (f) w = /^[A-Z]/.test(core) && !/^I/.test(f) ? cap(f) : f;
  }
  const lw = w.replace(/’/g, "'").toLowerCase();
  if (/^i(?:'(?:m|ll|ve|d))?$/.test(lw) && !(allCaps && core.length > 1)) w = "I" + w.slice(1).toLowerCase();
  else if (plainCase && SPECIAL[lw]) w = SPECIAL[lw];
  if (startsSentence && /^[a-z]/.test(w)) w = cap(w);
  return w;
}

const BLOCKS = new Set(["P", "DIV", "LI", "BLOCKQUOTE", "H1", "H2", "H3"]);
function blockOf(node: Node, root: HTMLElement): Node {
  let n: Node | null = node.parentNode;
  while (n && n !== root && !(n instanceof HTMLElement && BLOCKS.has(n.tagName))) n = n.parentNode;
  return n || root;
}
function textBefore(root: HTMLElement, node: Node, offset: number): string {
  const r = document.createRange();
  r.setStart(blockOf(node, root), 0); r.setEnd(node, offset);
  const frag = r.cloneContents();
  frag.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
  return (frag.textContent || "").replace(/\u00a0/g, " ");
}
/** Does a new sentence begin right after this text? (start of a line, or after . ! ? that is not an abbreviation, a decimal or a list number) */
export function sentenceStart(before: string, capStart: boolean): boolean {
  if (/(^|\n)\s*$/.test(before)) return capStart;
  const m = before.match(/(\S*?)([.!?]+)["'”’)\]]*\s+$/);
  if (!m) return false;
  if (/[!?]/.test(m[2])) return true;
  const prev = m[1].toLowerCase();
  return !(ABBR.has(prev) || /^\d+$/.test(prev) || prev.includes(".") || /^[a-z]$/.test(prev));
}

let last: { node: Node; start: number; fixed: string; orig: string } | null = null;
const DELIMS = /^[ .,;:!?)\u00a0]$/;

/** Call from a native `beforeinput` listener. Only intervenes when a correction is needed; otherwise the browser does its normal thing. */
export function applyAutofix(e: InputEvent, root: HTMLElement, opts: { capStart: boolean }) {
  if (e.isComposing) return;
  const enter = e.inputType === "insertParagraph" || e.inputType === "insertLineBreak";
  const delim = e.inputType === "insertText" && !!e.data && DELIMS.test(e.data);
  last = null;
  if (!enter && !delim) return;
  const sel = getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
  const node = sel.getRangeAt(0).startContainer, caret = sel.getRangeAt(0).startOffset;
  if (node.nodeType !== 3 || !root.contains(node)) return;
  const text = (node as Text).data;
  let s = caret; while (s > 0 && !/\s/.test(text[s - 1])) s--;
  const m = text.slice(s, caret).match(/^([("'“‘[]*)([A-Za-z]+(?:['’][A-Za-z]+)?)([.,;:!?)"”’']*)$/);
  if (!m) return;  // numbers, links, e-mail addresses, code: leave alone
  const [, lead, core, trail] = m, start = s + lead.length;
  const fixed = fixWord(core, sentenceStart(textBefore(root, node, start), opts.capStart));
  if (fixed === core) return;
  e.preventDefault();
  const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + core.length);
  sel.removeAllRanges(); sel.addRange(range);
  document.execCommand("insertText", false, fixed);
  for (let i = 0; i < trail.length; i++) (sel as any).modify?.("move", "forward", "character");
  if (delim) { document.execCommand("insertText", false, e.data!); if (!trail) last = { node, start, fixed, orig: core }; }
  else document.execCommand(e.inputType === "insertParagraph" ? "insertParagraph" : "insertLineBreak");
}

/** Backspace right after an automatic change puts back what she typed. Returns true when it did (the key must then be cancelled). */
export function undoAutofix(): boolean {
  const l = last; last = null;
  if (!l) return false;
  const sel = getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  if (r.startContainer !== l.node || r.startOffset !== l.start + l.fixed.length + 1) return false;
  if ((l.node as Text).data.substr(l.start, l.fixed.length) !== l.fixed) return false;
  const range = document.createRange(); range.setStart(l.node, l.start); range.setEnd(l.node, l.start + l.fixed.length);
  sel.removeAllRanges(); sel.addRange(range);
  document.execCommand("insertText", false, l.orig);
  (sel as any).modify?.("move", "forward", "character");
  return true;
}
