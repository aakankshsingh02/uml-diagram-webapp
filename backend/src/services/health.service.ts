import type { Queryable } from "../db/pool.js";
import type { KrokiService } from "./kroki.service.js";

export class HealthService {
  constructor(
    private readonly db: Queryable,
    private readonly kroki: Pick<KrokiService, "isHealthy">,
    private readonly llmConfigured: boolean,
  ) {}

  async check() {
    const [database, kroki] = await Promise.all([
      this.db.query("SELECT 1").then(
        () => true,
        () => false,
      ),
      this.kroki.isHealthy(),
    ]);
    return { ok: database && kroki, database, kroki, llm_configured: this.llmConfigured };
  }
}
