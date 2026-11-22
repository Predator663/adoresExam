/** Home packages (paper exams): shared types and small helpers for the print page and the scan / answer-entry page. Server: exams/paper.py. */
import { mediaUrl } from "./api";
import { plain } from "./staff";
import type { Question } from "./types";

export type PaperQuestion = Question & { number: number; section: string };
export type PaperSection = { letter: string; type: string; title: string; instructions: string };
export type SheetRow = { code: string; pretty: string; received_at: string | null; entered_at: string | null };
export type PackStudent = { id: number; name: string; class: string; class_id: number | null; index: string; sheet: SheetRow | null; online: boolean };
export type PackData = {
  exam: { id: number; title: string; subject: string; status: string; start_at: string | null; end_at: string | null; duration_minutes: number; rules_text: string; total_marks: number; pass_mark_percent: number };
  school: { name: string; logo: string };
  questions: PaperQuestion[]; sections: PaperSection[]; students: PackStudent[];
  counts: { sheets: number; received: number; entered: number };
};
export type ScanData = {
  sheet: SheetRow & { already_scanned: boolean };
  student: { id: number; name: string; class: string; index: string };
  exam: { id: number; title: string; subject: string; status: string; total_marks: number };
  questions: PaperQuestion[]; sections: PaperSection[];
  answers: Record<string, any>;
  result: { score: number; total: number; percent: number; grade: string; passed: boolean } | null;
};

/** The letter printed beside the i-th choice (A, B, C ...). The paper and the entry screen must use the same one. */
export const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const key = (i: number) => KEYS[i] || String(i + 1);

/** Question and choice HTML is cleaned by the server. Pictures get their full address so they print. */
export const withImages = (html: string) => (html || "").replace(/(<img\b[^>]*?\bsrc=)(["'])(.*?)\2/gi, (_m, a, q, src) => `${a}${q}${mediaUrl(src)}${q}`);

/** One line of a choice for the entry screen: its text, or "(picture)". */
export const itemText = (it: { text?: string; alt_text?: string; image?: string | null }) => plain(it.text || "") || (it.image ? it.alt_text || "(picture)" : "");

export const hasBlanks = (q: PaperQuestion) => q.type === "fill_multi";
export const blankIds = (q: PaperQuestion): string[] => ((q.content?.blanks || []) as { id: string }[]).map((b) => b.id);
