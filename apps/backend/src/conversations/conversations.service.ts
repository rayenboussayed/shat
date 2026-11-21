import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
} from "drizzle-orm";
import { DatabaseService } from "../db/db.ts";
import {
  conversationMembers,
  conversations,
} from "../db/db.ts";
import { AuthService } from "../identity/auth.service.ts";
import type { IdentityResult } from "../identity/schemas.ts";
import type { ConversationCreateBody, ConversationsQuery, SessionHeaders } from "./schemas.ts";

const publicError = (statusCode: number) => {
  const map: Record<number, { error: string; message: string }> = {
    400: { error: "Bad Request", message: "The request is invalid" },
    401: { error: "Unauthorized", message: "Authentication is required" },
    403: { error: "Forbidden", message: "The request is not permitted" },
    404: { error: "Not Found", message: "The requested resource was not found" },
    409: { error: "Conflict", message: "The request conflicts with current state" },
  };
  return { statusCode, ...map[statusCode] };
};

/** Direct conversation creation and listing. */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
  ) {}

  /** Creates a direct conversation between the actor device and a recipient device. */
  async createConversation(
    headers: SessionHeaders,
    body: ConversationCreateBody,
  ): Promise<IdentityResult> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      return { status: 401, body: publicError(401) };
    }
    if (body.recipientDeviceId === actor.id) {
      return {
        status: 400,
        body: { statusCode: 400, error: "Bad Request", message: "Self-conversation is not allowed" },
      };
    }
    const recipient = await this.auth.getActiveDevice(body.recipientDeviceId);
    if (!recipient) {
      return { status: 404, body: publicError(404) };
    }

    const db = this.database.db;
    const now = new Date();
    const conversationId = randomUUID();
    await db.transaction(async (transaction) => {
      await transaction.insert(conversations).values({
        id: conversationId,
        kind: "direct",
        createdAt: now,
      });
      await transaction.insert(conversationMembers).values([
        {
          conversationId,
          memberDeviceId: actor.id,
          role: "member",
          joinedAt: now,
        },
        {
          conversationId,
          memberDeviceId: body.recipientDeviceId,
          role: "member",
          joinedAt: now,
        },
      ]);
    });

    return {
      status: 201,
      body: {
        conversationId,
        kind: "direct",
        createdAt: now.toISOString(),
        members: [actor.id, body.recipientDeviceId],
      },
    };
  }

  /** Lists conversations for the actor's device with bounded pagination. */
  async listConversations(
    headers: SessionHeaders,
    query: ConversationsQuery,
  ): Promise<IdentityResult> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      return { status: 401, body: publicError(401) };
    }
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);

    const db = this.database.db;
    const rows = await db
      .select({
        id: conversations.id,
        kind: conversations.kind,
        createdAt: conversations.createdAt,
      })
      .from(conversations)
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, conversations.id),
          eq(conversationMembers.memberDeviceId, actor.id),
          isNull(conversationMembers.leftAt),
        ),
      )
      .where(isNull(conversations.deletedAt))
      .orderBy(desc(conversations.createdAt))
      .limit(limit)
      .offset(offset);

    const ids = rows.map((row) => row.id);
    const membersByConversation = new Map<string, string[]>();
    if (ids.length > 0) {
      const memberRows = await db
        .select({
          conversationId: conversationMembers.conversationId,
          memberDeviceId: conversationMembers.memberDeviceId,
        })
        .from(conversationMembers)
        .where(
          and(
            inArray(conversationMembers.conversationId, ids),
            isNull(conversationMembers.leftAt),
          ),
        );
      for (const member of memberRows) {
        const list = membersByConversation.get(member.conversationId) ?? [];
        list.push(member.memberDeviceId);
        membersByConversation.set(member.conversationId, list);
      }
    }

    return {
      status: 200,
      body: {
        conversations: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          createdAt: row.createdAt,
          members: membersByConversation.get(row.id) ?? [],
        })),
      },
    };
  }
}