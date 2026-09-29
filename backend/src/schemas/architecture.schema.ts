import { z } from "zod";

/**
 * Identifier-safe in both Mermaid and PlantUML, so diagrams can use names verbatim. Letters and
 * digits only, so case-insensitive uniqueness here matches the consistency check's name matching.
 */
export const ELEMENT_NAME = /^[A-Za-z][A-Za-z0-9]{0,59}$/;

export const ElementKindSchema = z.enum(["actor", "service", "datastore", "external"]);

export const ArchitectureElementSchema = z.strictObject({
  name: z.string().regex(ELEMENT_NAME, "must be an identifier: letters and digits only (e.g. CircularFetcher)"),
  kind: ElementKindSchema,
  description: z.string().min(1).max(200),
});

export const InteractionSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  message: z.string().min(1).max(120),
});

/**
 * The single source of truth every diagram in a version is drawn from: the system's parts and
 * how they interact. Data (documents, tables, reports) is not an element; it lives in messages.
 */
export const ArchitectureModelSchema = z
  .strictObject({
    elements: z.array(ArchitectureElementSchema).min(2).max(25),
    interactions: z.array(InteractionSchema).min(1).max(60),
  })
  .superRefine((model, ctx) => {
    const names = new Set<string>();
    for (const [i, el] of model.elements.entries()) {
      const key = el.name.toLowerCase();
      if (names.has(key)) {
        ctx.addIssue({ code: "custom", path: ["elements", i, "name"], message: `duplicate element name "${el.name}"` });
      }
      names.add(key);
    }
    const used = new Set<string>();
    for (const [i, it] of model.interactions.entries()) {
      for (const end of ["from", "to"] as const) {
        const key = it[end].toLowerCase();
        if (!names.has(key)) {
          ctx.addIssue({
            code: "custom",
            path: ["interactions", i, end],
            message: `"${it[end]}" is not an element; use one of the element names`,
          });
        }
        used.add(key);
      }
    }
    for (const [i, el] of model.elements.entries()) {
      if (!used.has(el.name.toLowerCase())) {
        ctx.addIssue({
          code: "custom",
          path: ["elements", i],
          message: `"${el.name}" takes part in no interaction; add one or remove the element`,
        });
      }
    }
  });

export type ArchitectureModel = z.infer<typeof ArchitectureModelSchema>;

export const LlmArchitectureResponseSchema = z.strictObject({
  architecture: ArchitectureModelSchema,
});
