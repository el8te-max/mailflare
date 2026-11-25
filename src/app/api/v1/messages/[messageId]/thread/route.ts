import { NextResponse } from "next/server";
import { getMessageThreadForUser } from "@/lib/email/thread-view";
import { authorizeKeyRead } from "../utils";

type MessageRouteParams = {
	params: Promise<{ messageId: string }>;
};

/** Every message in the same conversation as `messageId`, oldest first, for an API key with the `read` scope. As in the web reader, the bodies of `messageId` itself are left out: read them with `GET /api/v1/messages/{id}`. */
export async function GET(request: Request, { params }: MessageRouteParams) {
	const { messageId } = await params;
	const access = await authorizeKeyRead(request, messageId);
	if ("response" in access) return access.response;

	const data = await getMessageThreadForUser(access.env, access.user, messageId);
	if (!data) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}
	return NextResponse.json(data);
}
