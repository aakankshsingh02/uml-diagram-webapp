# PRD Quality Review — UML Chat API

## Overall verdict
The PRD is ready to build CYCLE-1. It has a clear thesis (quality is a data problem), and the FRs follow the generate → verify → render → rate → export loop, with testable consequences on nearly all of them. The risks are one ambiguous ordering rule, a status-code inconsistency in FR-8, and an unmeasured SM-2. All three are fixable in place.

## Decision-readiness — strong
Decisions are stated as decisions (pull + ack, per-Generation Trajectories), and the rejected alternatives are in the addendum. §9 Q1 (GRPO grouping) is a real open tension with an owner, not a rhetorical question.

### Findings
- **medium** FR-8 status code (§4.3) — "returns 201 with the same Feedback id" when replacing a rating muddles create vs. replace. *Fix:* return 200 for every upsert.

## Substance over theater — strong
Two personas, and both drive FRs (Asha → FR-1..9, Ravi → FR-10..13). The NFRs carry numbers.

## Strategic coherence — strong
MVP = FR-1..14 follows the thesis: the feedback loop comes before latency polish. The counter-metric SM-C1 guards SM-1.

### Findings
- **medium** SM-2 measurement (§8) — the denominator window isn't defined. *Fix:* "per rolling 7 days, Generations created in the window".

## Done-ness clarity — adequate
### Findings
- **high** FR-11 ordering (§4.4) — "oldest first" doesn't say by which timestamp (Generation creation or latest Feedback). This changes what a limited pull returns. *Fix:* order by Generation `created_at` ascending, with `id` as the tie-break.
- **low** FR-15..17 are [LATER] but still have consequences, which is fine for later stories.

## Scope honesty — strong
[LATER] tags, a [NOTE FOR PM] on FR-4, and explicit non-goals. 4 open questions for an internal-stakes PRD is acceptable.

## Downstream usability — adequate
### Findings
- **low** Glossary drift — "Rating" is used as a noun in FR-8, UJ-3 and SM-3 but isn't defined. *Fix:* add a Rating entry.

## Shape fit — strong
A developer-product/API shape with API contracts inline. UJs are light, which suits two roles.

## Mechanical notes
- The FR IDs FR-1..17 are contiguous. The UJ-1..4 and SM IDs resolve.
- Assumptions Index roundtrip: the §5 inline assumption is indexed. PASS.
