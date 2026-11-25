import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { authenticateApiKey, requireScope } from "@/lib/api/auth";
import { getDb } from "@/db";
import { messages, users } from "@/db/schema";

/**
 * The key's user for reading one message over the API, or the response to send
 * instead. Same rules as `GET /api/v1/messages`: the `read` scope, an enabled user,
 * and a key limited to some mailboxes reaches only those (anything else is 404, so a
 * key can't learn which ids exist). Mailbox access and private drafts are checked
 * again by the shared readers the routes call.
 */
export async function authorizeKeyRead(request: Request, messageId: string) {
	const env = getEnv();
	const auth = await authenticateApiKey(env, request.headers.get("authorization"));
	if (!auth || !requireScope(auth.scopes, "read")) {
		return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
	}
	const db = getDb(env);
	const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
	if (!user || user.disabled) {
		return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
	}
	if (auth.mailboxIds) {
		const [message] = await db.select({ mailboxId: messages.mailboxId }).from(messages).where(eq(messages.id, messageId)).limit(1);
		if (!message?.mailboxId || !auth.mailboxIds.includes(message.mailboxId)) {
			return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;
		}
	}
	return { env, user } as const;
}
