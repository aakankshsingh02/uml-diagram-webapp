import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockFetch } from "@test/mock-fetch";
import { RateDiagram } from "./RateDiagram";

const DIAGRAM_ID = "5b0f2a52-7d0e-4b8e-9a39-0d6f6c0f5a11";
const saved = (rating: 1 | -1, comment: string | null = null) => ({
  status: 200,
  body: { id: "9d4b8e0e-3c1a-4c55-8a0f-2f7b7f1f6a22", diagram_id: DIAGRAM_ID, rating, comment },
});

const up = () => screen.getByRole("button", { name: "Rate helpful" });
const down = () => screen.getByRole("button", { name: "Rate not helpful" });
const commentBox = () => screen.getByRole("textbox", { name: "Comment (optional)" });
const sendComment = () => screen.getByRole("button", { name: "Send comment" });

function setup() {
  render(<RateDiagram diagramId={DIAGRAM_ID} />);
  return userEvent.setup();
}

describe("RateDiagram", () => {
  it("sends one request for a first rating and shows it as pressed", async () => {
    const calls = mockFetch(saved(-1));
    const user = setup();

    await user.click(down());

    expect(await screen.findByText("Thanks — feedback saved")).toHaveAttribute("role", "status");
    expect(down()).toHaveAttribute("aria-pressed", "true");
    expect(up()).toHaveAttribute("aria-pressed", "false");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      body: { rating: -1 },
    });
    expect(calls[0]!.url).toMatch(new RegExp(`/diagrams/${DIAGRAM_ID}/feedback$`));
  });

  it("includes a comment typed before rating", async () => {
    const calls = mockFetch(saved(1, "missing fetcher"));
    const user = setup();

    await user.type(commentBox(), "missing fetcher");
    await user.click(up());

    await screen.findByText("Thanks — feedback saved");
    expect(calls[0]!.body).toEqual({ rating: 1, comment: "missing fetcher" });
  });

  it("replaces the rating when the other button is chosen", async () => {
    const calls = mockFetch(saved(-1), saved(1));
    const user = setup();

    await user.click(down());
    await waitFor(() => expect(down()).toHaveAttribute("aria-pressed", "true"));
    await user.click(up());

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.body).toEqual({ rating: 1 });
    await waitFor(() => expect(up()).toHaveAttribute("aria-pressed", "true"));
    expect(down()).toHaveAttribute("aria-pressed", "false");
  });

  it("does nothing when the confirmed rating is chosen again", async () => {
    const calls = mockFetch(saved(1));
    const user = setup();

    await user.click(up());
    await screen.findByText("Thanks — feedback saved");
    await user.click(up());

    expect(calls).toHaveLength(1);
  });

  it("re-sends when the confirmed rating is chosen after editing the comment", async () => {
    const calls = mockFetch(saved(1, "first"), saved(1));
    const user = setup();

    await user.type(commentBox(), "first");
    await user.click(up());
    await screen.findByText("Thanks — feedback saved");
    await user.clear(commentBox());
    await user.click(up());

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.body).toEqual({ rating: 1 });
  });

  it("hides the saved notice and enables Send comment only while the comment has unsaved edits", async () => {
    mockFetch(saved(1));
    const user = setup();

    await user.click(up());
    await screen.findByText("Thanks — feedback saved");
    expect(sendComment()).toBeDisabled();

    await user.type(commentBox(), "x");
    expect(screen.queryByText("Thanks — feedback saved")).not.toBeInTheDocument();
    expect(sendComment()).toBeEnabled();

    await user.clear(commentBox());
    expect(screen.getByText("Thanks — feedback saved")).toBeInTheDocument();
    expect(sendComment()).toBeDisabled();
  });

  it("sends the confirmed rating with a comment from Send comment", async () => {
    const calls = mockFetch(saved(1), saved(1, "add the notifier"));
    const user = setup();

    expect(sendComment()).toBeDisabled();
    await user.click(up());
    await screen.findByText("Thanks — feedback saved");
    await user.type(commentBox(), "add the notifier");
    await user.click(sendComment());

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.body).toEqual({ rating: 1, comment: "add the notifier" });
  });

  it("shows the error and reverts to the last confirmed rating when saving fails", async () => {
    mockFetch(saved(1), { status: 500, body: { error: "Internal server error" } });
    const user = setup();

    await user.click(up());
    await screen.findByText("Thanks — feedback saved");
    await user.click(down());

    expect(await screen.findByRole("alert")).toHaveTextContent("Internal server error");
    expect(up()).toHaveAttribute("aria-pressed", "true");
    expect(down()).toHaveAttribute("aria-pressed", "false");
  });

  it("disables rating and Send comment while a request is in flight", async () => {
    mockFetch(new Promise<never>(() => {}));
    const user = setup();

    await user.click(up());

    expect(up()).toBeDisabled();
    expect(down()).toBeDisabled();
    expect(sendComment()).toBeDisabled();
    expect(up()).toHaveAttribute("aria-pressed", "true");
  });
});
