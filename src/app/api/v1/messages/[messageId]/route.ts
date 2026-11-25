import { NextResponse } from "next/server";
import { getMessageWithBodyForUser } from "@/lib/email/inbound";
import { authorizeKeyRead } from "./utils";

type MessageRouteParams = {
	params: Promise<{ messageId: string }>;
};

/** One message with its bodies, for an API key with the `read` scope. */
export async function GET(request: Request, { params }: MessageRouteParams) {
	const { messageId } = await params;
	const access = await authorizeKeyRead(request, messageId);
	if ("response" in access) return access.response;

	const data = await getMessageWithBodyForUser(access.env, access.user, messageId);
	if (!data) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}
	return NextResponse.json(data);
}
