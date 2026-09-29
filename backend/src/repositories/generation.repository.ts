import type { Queryable } from "../db/pool.js";
import type { DiagramType, Engine } from "../schemas/diagram.schema.js";
import type { GenerationKind } from "../schemas/training.schema.js";
import type { ChatMessage, GenerationTrace } from "../services/llm.service.js";

// ISO-8601 UTC with microseconds; a JS Date would truncate to ms and let acks drift from reads.
const AS_OF = `to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface ExportDiagram {
  diagram_id: string;
  type: DiagramType;
  engine: Engine;
  rendered: boolean;
  repaired: boolean;
  projected: boolean;
  rating: 1 | -1 | null;
  comment: string | null;
}

export interface ExportableGeneration {
  id: string;
  message_id: string;
  conversation_id: string;
  version: number;
  model: string;
  messages: ChatMessage[];
  attempts: number;
  latency_ms: number;
  created_at: Date;
  diagrams: ExportDiagram[];
}

export class GenerationRepository {
  constructor(private readonly db: Queryable) {}

  async insert(messageId: string, trace: GenerationTrace, kind: GenerationKind, db: Queryable = this.db): Promise<void> {
    await db.query(
      `INSERT INTO generations (message_id, kind, model, messages, attempts, latency_ms, consistency_issues)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [messageId, kind, trace.model, JSON.stringify(trace.messages), trace.attempts, trace.latencyMs, trace.issues],
    );
  }

  /**
   * Generations of `kind` with at least one feedback that is newer than their last acknowledged export.
   * A `diagrams` exchange only answers for the diagrams the LLM drew, so its lines list, score and
   * become exportable through non-projected diagrams only; an `architecture` exchange answers for all.
   * `asOf` is the database time of this read; acknowledging with it keeps later feedback exportable.
   */
  async listExportable(
    limit: number,
    kind: GenerationKind,
  ): Promise<{ asOf: string; rows: ExportableGeneration[] }> {
    const { rows } = await this.db.query<ExportableGeneration & { as_of: string }>(
      `WITH latest AS (
         SELECT d.message_id, MAX(f.updated_at) AS feedback_at
         FROM feedback f JOIN diagrams d ON d.id = f.diagram_id
         WHERE $2::text = 'architecture' OR NOT d.projected
         GROUP BY d.message_id
       )
       SELECT g.id, g.message_id, m.conversation_id, m.version, g.model, g.messages,
              g.attempts, g.latency_ms, g.created_at, ${AS_OF} AS as_of,
              (SELECT json_agg(json_build_object(
                        'diagram_id', d.id, 'type', d.diagram_type, 'engine', d.engine,
                        'rendered', d.svg IS NOT NULL, 'repaired', d.repaired, 'projected', d.projected,
                        'rating', f.rating, 'comment', f.comment)
                      ORDER BY d.position, d.created_at, d.id)
                 FROM diagrams d
                 LEFT JOIN feedback f ON f.diagram_id = d.id
                WHERE d.message_id = g.message_id
                  AND ($2::text = 'architecture' OR NOT d.projected)) AS diagrams
       FROM generations g
       JOIN latest l ON l.message_id = g.message_id
       JOIN messages m ON m.id = g.message_id
       WHERE g.kind = $2::text
         AND (g.exported_at IS NULL OR l.feedback_at > g.exported_at)
       ORDER BY g.created_at, g.id
       LIMIT $1`,
      [limit, kind],
    );
    const asOf = rows[0]?.as_of ?? (await this.now());
    return { asOf, rows: rows.map(({ as_of: _asOf, ...row }) => row) };
  }

  /** Never moves the watermark backwards (replayed acks) or past the present (bad as_of). */
  async acknowledge(ids: string[], asOf: string): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE generations
       SET exported_at = GREATEST(COALESCE(exported_at, '-infinity'), LEAST($2::timestamptz, statement_timestamp()))
       WHERE id = ANY($1::uuid[])`,
      [ids, asOf],
    );
    return rowCount ?? 0;
  }

  private async now(): Promise<string> {
    const { rows } = await this.db.query<{ now: string }>(`SELECT ${AS_OF} AS now`);
    return rows[0]!.now;
  }
}
