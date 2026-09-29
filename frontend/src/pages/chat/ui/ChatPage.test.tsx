import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { getSessionToken } from "@/shared/lib";
import { ChatPage } from "./ChatPage";

const API = "http://localhost:4000/api";
const USER = { id: "0b8a1c9e-4f5d-4e2a-9c7b-1d2e3f4a5b6c", email: "asha@example.com", created_at: "2026-09-30T10:00:00.000Z" };
const OLD_CHAT = "6f1e2d3c-4b5a-4e9f-8a7b-6c5d4e3f2a1b";
const NEW_CHAT = "7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d";
const summary = (id: string, title: string) => ({
  id,
  title,
  created_at: "2026-09-30T10:00:00.000Z",
  updated_at: "2026-09-30T10:00:00.000Z",
});
const conversation = (id: string, prompt: string) => ({
  id,
  title: prompt,
  versions: [
    {
      version: 1,
      prompt,
      diagram_types: ["class"],
      created_at: "2026-09-30T10:00:00.000Z",
      diagrams: [],
    },
  ],
});

type Reply = { status?: number; body?: unknown };
type Route = Reply | ((call: { body: unknown; headers: Record<string, string> }) => Reply);

/** Answers by "METHOD /path" regardless of call order; unmatched routes fail loudly. Header names are lower-cased. */
function mockApi(routes: Record<string, Route>) {
  const calls: { route: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const route = `${init.method ?? "GET"} ${url.replace(API, "")}`;
      const call = {
        route,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers: Object.fromEntries(new Headers(init.headers)),
      };
      calls.push(call);
      const handler = routes[route];
      const reply = typeof handler === "function" ? handler(call) : (handler ?? { status: 599, body: { error: `unmocked ${route}` } });
      return new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? null), { status: reply.status ?? 200 });
    }),
  );
  return calls;
}

const signedIn = (token = "tok-1") => localStorage.setItem("uml.sessionToken", token);

describe("ChatPage auth", () => {
  it("shows the sign-in form when there is no session and makes no API calls", async () => {
    const calls = mockApi({});
    render(<ChatPage />);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("signs up, stores the token and opens the workspace with the user's chats", async () => {
    const calls = mockApi({
      "POST /auth/signup": { status: 201, body: { token: "tok-new", user: USER } },
      "GET /auth/me": { body: { user: USER } },
      "GET /conversations": { body: { conversations: [] } },
    });
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.click(await screen.findByRole("button", { name: "Create one" }));
    await user.type(screen.getByLabelText("Email"), "  Asha@Example.com ");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("No saved chats yet.")).toBeInTheDocument();
    expect(screen.getByText(USER.email)).toBeInTheDocument();
    expect(getSessionToken()).toBe("tok-new");
    expect(calls.find((c) => c.route === "POST /auth/signup")!.body).toEqual({
      email: "asha@example.com",
      password: "correct horse",
    });
    expect(calls.find((c) => c.route === "GET /conversations")!.headers.authorization).toBe("Bearer tok-new");
  });

  it("checks the signup password length before sending anything", async () => {
    const calls = mockApi({});
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.click(await screen.findByRole("button", { name: "Create one" }));
    await user.type(screen.getByLabelText("Email"), "asha@example.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Use at least 8 characters");
    expect(calls).toHaveLength(0);
  });

  it("shows the server's error for a wrong password and stays signed out", async () => {
    mockApi({ "POST /auth/login": { status: 401, body: { error: "Invalid email or password" } } });
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.type(await screen.findByLabelText("Email"), "asha@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(getSessionToken()).toBeNull();
  });

  it("returns to the sign-in form when the stored session has expired", async () => {
    signedIn("expired");
    mockApi({
      "GET /auth/me": { status: 401, body: { error: "Unauthorized" } },
      "GET /conversations": { status: 401, body: { error: "Unauthorized" } },
    });
    render(<ChatPage />);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(getSessionToken()).toBeNull();
  });

  it("offers a retry when the server cannot be reached", async () => {
    signedIn();
    let up = false;
    mockApi({
      "GET /auth/me": () => (up ? { body: { user: USER } } : { status: 503, body: { error: "Service unavailable" } }),
      "GET /conversations": { body: { conversations: [] } },
    });
    const user = userEvent.setup();
    render(<ChatPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Service unavailable");
    up = true;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(USER.email)).toBeInTheDocument();
    expect(getSessionToken()).toBe("tok-1");
  });

  it("signs out: revokes the session on the server and shows the form again", async () => {
    signedIn();
    const calls = mockApi({
      "GET /auth/me": { body: { user: USER } },
      "GET /conversations": { body: { conversations: [] } },
      "POST /auth/logout": { status: 204 },
    });
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(calls.find((c) => c.route === "POST /auth/logout")!.headers.authorization).toBe("Bearer tok-1");
    expect(getSessionToken()).toBeNull();
  });
});

describe("ChatPage saved chats", () => {
  it("reopens the chat that was open before the reload", async () => {
    signedIn();
    localStorage.setItem(`uml.activeConversation.${USER.id}`, OLD_CHAT);
    mockApi({
      "GET /auth/me": { body: { user: USER } },
      "GET /conversations": { body: { conversations: [summary(OLD_CHAT, "Library system")] } },
      [`GET /conversations/${OLD_CHAT}`]: { body: conversation(OLD_CHAT, "Design a library system") },
    });
    render(<ChatPage />);

    expect(await screen.findByText("Design a library system")).toBeInTheDocument();
    const chats = screen.getByRole("navigation", { name: "Chats" });
    expect(within(chats).getByRole("button", { name: /Library system/ })).toHaveAttribute("aria-current", "page");
  });

  it("forgets a remembered chat that no longer exists and starts empty", async () => {
    signedIn();
    localStorage.setItem(`uml.activeConversation.${USER.id}`, OLD_CHAT);
    mockApi({
      "GET /auth/me": { body: { user: USER } },
      "GET /conversations": { body: { conversations: [] } },
      [`GET /conversations/${OLD_CHAT}`]: { status: 404, body: { error: "Conversation not found" } },
    });
    render(<ChatPage />);

    expect(await screen.findByText("Describe a system, get UML.")).toBeInTheDocument();
    expect(localStorage.getItem(`uml.activeConversation.${USER.id}`)).toBeNull();
  });

  it("opens a chat from the list and sends follow-ups into it", async () => {
    signedIn();
    const calls = mockApi({
      "GET /auth/me": { body: { user: USER } },
      "GET /conversations": { body: { conversations: [summary(OLD_CHAT, "Library system")] } },
      [`GET /conversations/${OLD_CHAT}`]: { body: conversation(OLD_CHAT, "Design a library system") },
      "POST /diagrams/generate": { status: 201, body: { conversation_id: OLD_CHAT, version: 2, diagrams: [] } },
    });
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.click(await screen.findByRole("button", { name: /Library system/ }));
    expect(await screen.findByText("Design a library system")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "Add a fines calculator please");
    await user.click(screen.getByRole("button", { name: "Update diagrams" }));

    await waitFor(() => expect(calls.some((c) => c.route === "POST /diagrams/generate")).toBe(true));
    expect(calls.find((c) => c.route === "POST /diagrams/generate")!.body).toMatchObject({
      conversation_id: OLD_CHAT,
      prompt: "Add a fines calculator please",
    });
    expect(localStorage.getItem(`uml.activeConversation.${USER.id}`)).toBe(OLD_CHAT);
  });

  it("adds a newly created chat to the list after the first prompt", async () => {
    signedIn();
    let saved = false;
    mockApi({
      "GET /auth/me": { body: { user: USER } },
      "GET /conversations": () => ({
        body: { conversations: saved ? [summary(NEW_CHAT, "Design a parking garage")] : [] },
      }),
      "POST /diagrams/generate": () => {
        saved = true;
        return { status: 201, body: { conversation_id: NEW_CHAT, version: 1, diagrams: [] } };
      },
    });
    const user = userEvent.setup();
    render(<ChatPage />);

    await screen.findByText("No saved chats yet.");
    await user.type(screen.getByRole("textbox"), "Design a parking garage");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    const chats = screen.getByRole("navigation", { name: "Chats" });
    expect(await within(chats).findByRole("button", { name: /Design a parking garage/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
