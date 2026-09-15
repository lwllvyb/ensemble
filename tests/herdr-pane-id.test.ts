import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const SCRIPT = resolve(__dirname, "../scripts/herdr-pane-id.py");

function paneId(json: string): { code: number; out: string; err: string } {
  try {
    const out = execFileSync("python3", [SCRIPT], { input: json, encoding: "utf8" });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").trim(), err: (e.stderr ?? "").trim() };
  }
}

describe("herdr-pane-id", () => {
  // Real response captured from `herdr pane split`, 15-09-2026.
  it("reads the pane id from a split response", () => {
    const json = JSON.stringify({
      id: "cli:pane:split",
      result: { pane: { pane_id: "w3M:p7", tab_id: "w3M:t1", cwd: "/tmp" }, type: "pane_info" },
    });
    expect(paneId(json).out).toBe("w3M:p7");
  });

  // Real response captured from `herdr tab create`, 15-09-2026. This is the shape
  // that used to return nothing: the script only looked at result.pane and
  // result.tab.panes[0], and herdr answers with result.root_pane.
  it("reads the pane id from a tab-create response", () => {
    const json = JSON.stringify({
      id: "cli:tab:create",
      result: {
        root_pane: { pane_id: "w3M:p5", tab_id: "w3M:t3" },
        tab: { tab_id: "w3M:t3", label: "3", pane_count: 1 },
        type: "tab_created",
      },
    });
    expect(paneId(json).out).toBe("w3M:p5");
  });

  // Older shape, kept so an upgrade or downgrade of herdr does not break us.
  it("still reads the historical tab.panes shape", () => {
    const json = JSON.stringify({
      result: { tab: { panes: [{ pane_id: "w1A:p2" }, { pane_id: "w1A:p3" }] } },
    });
    expect(paneId(json).out).toBe("w1A:p2");
  });

  // The point of this script: survive a shape nobody has seen yet.
  it("finds a pane id nested anywhere, so a future API shape still works", () => {
    const json = JSON.stringify({
      result: { workspace: { tabs: [{ layout: { children: [{ pane_id: "w9Z:p1" }] } }] } },
    });
    expect(paneId(json).out).toBe("w9Z:p1");
  });

  it("fails loudly on a response without any pane id", () => {
    const r = paneId(JSON.stringify({ result: { type: "ok" } }));
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("no pane id");
  });

  it("fails loudly on unparseable input instead of printing an empty id", () => {
    const r = paneId("not json at all");
    expect(r.code).not.toBe(0);
    expect(r.out).toBe("");
  });
});
