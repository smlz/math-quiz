import { expect, test, type APIRequestContext } from "@playwright/test";

// Anyone who knows (or guesses) a pin can mint a player token and send the
// host arbitrary JSON, bypassing the player UI entirely. These tests talk to
// the relay directly (through Vite's /api proxy) to play that stranger.

async function mintPlayer(request: APIRequestContext, pin: string): Promise<string> {
  const response = await request.post(`/api/v1/session/${pin}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).player_token;
}

async function send(request: APIRequestContext, pin: string, token: string, payload: unknown) {
  const response = await request.post(`/api/v1/session/${pin}/message`, {
    headers: { "X-Player-Token": token },
    data: payload,
  });
  expect(response.ok()).toBe(true);
}

test("host ignores or trims hostile player messages", async ({ page: host, request }) => {
  await host.goto("/");
  await host.getByRole("button", { name: "Quiz erstellen" }).click();
  const pin = (await host.locator(".host-lobby__pin").textContent())!;

  const long = await mintPlayer(request, pin);
  const bogus = await mintPlayer(request, pin);
  const sentinel = await mintPlayer(request, pin);

  await send(request, pin, bogus, { type: "join", nickname: { toString: "no" } });
  await send(request, pin, bogus, { type: "join", nickname: "   " });
  await send(request, pin, long, { type: "join", nickname: "X".repeat(500) });
  await send(request, pin, long, { type: "join", nickname: "Renamed" });
  // The host handles messages in order, so once this one shows up every
  // message before it has been dealt with.
  await send(request, pin, sentinel, { type: "join", nickname: "Zed" });

  const names = host.locator(".host-lobby li");
  await expect(names).toHaveText(["X".repeat(30), "Zed"]);

  await host.getByRole("button", { name: "Frage starten" }).click();
  await send(request, pin, long, { type: "answer", question_index: 0, option_index: 7 });
  await send(request, pin, long, { type: "answer", question_index: 0, option_index: "0" });
  await send(request, pin, bogus, { type: "answer", question_index: 0, option_index: 0 });
  await send(request, pin, sentinel, { type: "answer", question_index: 0, option_index: 0 });

  await expect(host.getByRole("button", { name: /Antwort zeigen · 1 von 2 beantwortet/ })).toBeVisible();
});
