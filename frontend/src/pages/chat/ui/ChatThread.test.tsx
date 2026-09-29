import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockFetch } from "@test/mock-fetch";
import { describe, expect, it } from "vitest";
import { ChatThread } from "./ChatThread";

const diagram = (id: string, title: string) => ({
  id,
  type: "sequence" as const,
  engine: "mermaid" as const,
  title,
  source: "sequenceDiagram\nA->>B: hi",
  svg: "<svg></svg>",
  render_error: null,
});

describe("ChatThread", () => {
  it("renders rating controls in each diagram card and rates that diagram", async () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    const calls = mockFetch({
      body: { id: "33333333-3333-4333-8333-333333333333", diagram_id: second, rating: -1, comment: null },
    });
    render(
      <ChatThread
        turns={[
          {
            id: "turn-1",
            prompt: "SEBI circular monitoring",
            diagramTypes: ["sequence"],
            version: 1,
            diagrams: [diagram(first, "Fetch flow"), diagram(second, "Gap analysis")],
          },
        ]}
      />,
    );

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(within(card).getByRole("button", { name: "Rate helpful" })).toBeInTheDocument();
    }

    const gapCard = cards.find((c) => within(c).queryByText("Gap analysis"))!;
    await userEvent.setup().click(within(gapCard).getByRole("button", { name: "Rate not helpful" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toMatch(new RegExp(`/diagrams/${second}/feedback$`));
  });
});
