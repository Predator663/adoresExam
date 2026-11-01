"use client";
import { useEffect } from "react";
import { words } from "@/lib/api";

/** If a screen crashes, people see a plain message and a button, never a technical error. The details stay in the console (F12). */
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error("[app]", error); }, [error]);
  const sw = words().generic.startsWith("Hitilafu");
  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem", textAlign: "center" }}>
      <h1>⚠</h1>
      <p>{words().generic}</p>
      <button className="btn primary big" onClick={() => reset()}>{sw ? "Jaribu tena" : "Try again"}</button>{" "}
      <button className="btn big" onClick={() => location.replace("/")}>{sw ? "Mwanzo" : "Home"}</button>
    </main>
  );
}
