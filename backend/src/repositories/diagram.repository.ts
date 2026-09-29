import type { Queryable } from "../db/pool.js";
import type { DiagramType, Engine } from "../schemas/diagram.schema.js";

export interface Diagram {
  id: string;
  message_id: string;
  diagram_type: DiagramType;
  engine: Engine;
  title: string;
  source: string;
  svg: string | null;
  render_error: string | null;
  repaired: boolean;
  /** Drawn by code from the architecture model (projection.ts), not by the LLM. */
  projected: boolean;
  created_at: Date;
}

export type NewDiagram = Pick<
  Diagram,
  "diagram_type" | "engine" | "title" | "source" | "svg" | "render_error" | "repaired" | "projected"
>;

export interface DiagramOwner {
  diagram_id: string;
  user_id: string;
}

export class DiagramRepository {
  constructor(private readonly db: Queryable) {}

  async insertMany(messageId: string, diagrams: NewDiagram[], db: Queryable = this.db): Promise<Diagram[]> {
    if (diagrams.length === 0) return [];
    const { rows } = await db.query<Diagram>(
      `INSERT INTO diagrams (message_id, diagram_type, engine, title, source, svg, render_error, repaired, projected, position)
       SELECT $1, t.*
       FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::boolean[], $9::boolean[])
            WITH ORDINALITY AS t
       RETURNING *`,
      [
        messageId,
        diagrams.map((d) => d.diagram_type),
        diagrams.map((d) => d.engine),
        diagrams.map((d) => d.title),
        diagrams.map((d) => d.source),
        diagrams.map((d) => d.svg),
        diagrams.map((d) => d.render_error),
        diagrams.map((d) => d.repaired),
        diagrams.map((d) => d.projected),
      ],
    );
    return rows;
  }

  async findByMessageId(messageId: string, db: Queryable = this.db): Promise<Diagram[]> {
    const { rows } = await db.query<Diagram>(
      // created_at, id break ties for rows written before `position` existed (all 0).
      "SELECT * FROM diagrams WHERE message_id = $1 ORDER BY position, created_at, id",
      [messageId],
    );
    return rows;
  }

  /** The user who owns the conversation a diagram belongs to. */
  async findOwner(diagramId: string, db: Queryable = this.db): Promise<DiagramOwner | null> {
    const { rows } = await db.query<DiagramOwner>(
      `SELECT d.id AS diagram_id, c.user_id
       FROM diagrams d
       JOIN messages m ON m.id = d.message_id
       JOIN conversations c ON c.id = m.conversation_id
       WHERE d.id = $1`,
      [diagramId],
    );
    return rows[0] ?? null;
  }
}
