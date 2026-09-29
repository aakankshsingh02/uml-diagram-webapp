import type { ExportDiagram, ExportableGeneration, GenerationRepository } from "../repositories/generation.repository.js";
import type { GenerationKind } from "../schemas/training.schema.js";

/** One line of the NDJSON export; maps 1:1 onto art.Trajectory (see trajectory-export-format.md). */
export interface Trajectory {
  id: string;
  group_id: string;
  messages_and_choices: ExportableGeneration["messages"];
  reward: number;
  metrics: {
    diagrams: number;
    rated: number;
    positive: number;
    negative: number;
    render_failures: number;
    repaired: number;
    attempts: number;
    latency_ms: number;
  };
  metadata: {
    model: string;
    conversation_id: string;
    version: number;
    created_at: string;
    feedback: { diagram_id: string; type: string; engine: string; rating: number; comment: string | null }[];
  };
}

/**
 * The trajectory holds the model's original output. A diagram that did not render as generated
 * (failed, or only rendered after repair) was wrong regardless of how the user rated the final result.
 */
export function diagramScore(d: ExportDiagram): number {
  if (!d.rendered || d.repaired) return -1;
  return d.rating ?? 0;
}

/**
 * The architecture exchange is judged by how the user rated the diagrams drawn from it. Render
 * failures and repairs are the drawing's fault (LLM or projector), not the model's, so they aren't penalised.
 */
export function architectureScore(d: ExportDiagram): number {
  return d.rating ?? 0;
}

export function toTrajectory(g: ExportableGeneration, kind: GenerationKind): Trajectory {
  const scores = g.diagrams.map(kind === "architecture" ? architectureScore : diagramScore);
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const rated = g.diagrams.filter((d) => d.rating !== null);

  return {
    id: g.id,
    group_id: g.message_id,
    messages_and_choices: g.messages,
    reward: Math.round(mean * 1000) / 1000,
    metrics: {
      diagrams: g.diagrams.length,
      rated: rated.length,
      positive: rated.filter((d) => d.rating === 1).length,
      negative: rated.filter((d) => d.rating === -1).length,
      render_failures: g.diagrams.filter((d) => !d.rendered).length,
      repaired: g.diagrams.filter((d) => d.repaired).length,
      attempts: g.attempts,
      latency_ms: g.latency_ms,
    },
    metadata: {
      model: g.model,
      conversation_id: g.conversation_id,
      version: g.version,
      created_at: new Date(g.created_at).toISOString(),
      feedback: rated.map((d) => ({
        diagram_id: d.diagram_id,
        type: d.type,
        engine: d.engine,
        rating: d.rating!,
        comment: d.comment,
      })),
    },
  };
}

export class TrainingService {
  constructor(private readonly generations: GenerationRepository) {}

  async exportTrajectories(limit: number, kind: GenerationKind) {
    const { asOf, rows } = await this.generations.listExportable(limit, kind);
    return { asOf, trajectories: rows.map((g) => toTrajectory(g, kind)) };
  }

  async acknowledge(ids: string[], asOf: string) {
    return { acknowledged: await this.generations.acknowledge(ids, asOf) };
  }
}
