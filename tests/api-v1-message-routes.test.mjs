import assert from "node:assert/strict";
import test from "node:test";
import { loadApp, sharedMailboxSeed } from "./helpers/real-db.mjs";

// GET /api/v1/messages/{id} and /thread: an API key with the `read` scope, limited to its mailboxes,
// sees what its user may read, and never another user's private draft.
const mocks = {
	"@/lib/cloudflare": "export function getEnv(){return globalThis.keyReadEnv}",
	"@/lib/api/auth": "export async function authenticateApiKey(){return globalThis.keyReadAuth} export function requireScope(scopes, scope){return scopes.includes(scope)}",
};
const { app, newDatabase } = await loadApp("api-v1-message-routes", `
	export * as one from "./src/app/api/v1/messages/[messageId]/route.ts";
	export * as thread from "./src/app/api/v1/messages/[messageId]/thread/route.ts";
`, { mocks });

const seed = `${sharedMailboxSeed("read_only")}
	INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, text_body, status, thread_id, private_draft, created_at) VALUES
		('m-1', 'admin', 'mb-team', 'inbound', 'x@example.net', 'team@example.com', 'Hello', 'first', 'received', 't-1', 0, 2),
		('m-2', 'admin', 'mb-team', 'outbound', 'team@example.com', 'x@example.net', 'Re: Hello', 'second', 'sent', 't-1', 0, 3),
		('draft-1', 'author', 'mb-team', 'outbound', 'team@example.com', 'x@example.net', 'Unsent', 'private text', 'draft', 't-1', 1, 4),
		('m-own', 'delegate', 'mb-delegate', 'inbound', 'y@example.net', 'delegate@example.com', 'Mine', 'own', 'received', NULL, 0, 5);
`;
async function setup(t, auth) {
	const { env } = await newDatabase(t, seed);
	globalThis.keyReadEnv = env;
	globalThis.keyReadAuth = auth;
}
const key = (overrides = {}) => ({ userId: "delegate", scopes: ["read"], mailboxIds: null, keyId: "k", ...overrides });
const get = () => new Request("http://localhost/api/v1/messages/x", { headers: { authorization: "Bearer k" } });
const ctx = (messageId) => ({ params: Promise.resolve({ messageId }) });

test("no key, or a key without the read scope, is refused", async (t) => {
	await setup(t, null);
	assert.equal((await app.one.GET(get(), ctx("m-1"))).status, 401);
	assert.equal((await app.thread.GET(get(), ctx("m-1"))).status, 401);
	await setup(t, key({ scopes: ["send"] }));
	assert.equal((await app.one.GET(get(), ctx("m-1"))).status, 401);
	assert.equal((await app.thread.GET(get(), ctx("m-1"))).status, 401);
});

test("a key limited to other mailboxes gets 404, and so does an unknown id", async (t) => {
	await setup(t, key({ mailboxIds: ["mb-delegate"] }));
	assert.equal((await app.one.GET(get(), ctx("m-1"))).status, 404);
	assert.equal((await app.thread.GET(get(), ctx("m-1"))).status, 404);
	assert.equal((await app.one.GET(get(), ctx("m-own"))).status, 200);
	assert.equal((await app.one.GET(get(), ctx("nope"))).status, 404);
});

test("a disabled user's key is refused", async (t) => {
	await setup(t, key());
	globalThis.keyReadEnv.DB.db.exec("UPDATE users SET disabled = 1 WHERE id = 'delegate'");
	assert.equal((await app.one.GET(get(), ctx("m-1"))).status, 401);
});

test("a reader gets one message with its body", async (t) => {
	await setup(t, key({ mailboxIds: ["mb-team"] }));
	const body = await (await app.one.GET(get(), ctx("m-1"))).json();
	assert.equal(body.message.id, "m-1");
	assert.equal(body.body.textBody, "first");
});

test("the thread lists the conversation without another user's draft", async (t) => {
	await setup(t, key());
	const body = await (await app.thread.GET(get(), ctx("m-1"))).json();
	assert.equal(body.threadId, "t-1");
	assert.deepEqual(body.messages.map((row) => row.id), ["m-1", "m-2"]);
	assert.equal(body.messages[1].textBody, "second");
	assert.equal((await app.one.GET(get(), ctx("draft-1"))).status, 404);
	assert.equal((await app.thread.GET(get(), ctx("draft-1"))).status, 404);
});
