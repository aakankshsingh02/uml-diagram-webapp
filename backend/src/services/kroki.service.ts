import type { Engine } from "../schemas/diagram.schema.js";

/** `retryable` marks infrastructure failures (network, timeout, 5xx), as opposed to a syntax error in the source. */
export type RenderResult = { ok: true; svg: string } | { ok: false; error: string; retryable: boolean };

/** What DiagramService needs from the renderer; lets tests substitute a fake. */
export type DiagramRenderer = Pick<KrokiService, "renderSvg">;

export class KrokiService {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 15_000,
  ) {}

  /** Renders diagram source to SVG. Kroki returns 400 with the parser message on syntax errors. */
  async renderSvg(engine: Engine, source: string): Promise<RenderResult> {
    try {
      const res = await fetch(`${this.baseUrl}/${engine}/svg`, {
        method: "POST",
        headers: { "Content-Type": "text/plain", Accept: "image/svg+xml" },
        body: source,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = await res.text();
      if (res.ok && engine === "plantuml" && body.includes("Welcome to PlantUML")) {
        // PlantUML answers 200 with its welcome page when it finds no diagram body; treat it as a
        // syntax error so the repair step runs instead of showing the placeholder.
        return {
          ok: false,
          error: "PlantUML found no diagram body (it rendered its welcome page). Check line breaks and @startuml/@enduml.",
          retryable: false,
        };
      }
      if (res.ok) return { ok: true, svg: body };
      return { ok: false, error: body.slice(0, 2000), retryable: res.status >= 500 };
    } catch (err) {
      return { ok: false, error: `Kroki request failed: ${(err as Error).message}`, retryable: true };
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
