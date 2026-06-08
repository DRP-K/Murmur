import { signAuthChallenge } from './crypto'
import type {
  AuthRequest,
  AuthResponse,
  RegisterRequest,
  SendMessageRequest,
  MessageListResponse,
  CreatePostRequest,
  PostAssistRequest,
  PostAssistResponse,
  PostListResponse,
  AckPostRequest,
  AddFriendRequest,
  FriendListResponse,
  GroupInfo,
  GroupListResponse,
  GroupMessageListResponse,
  SendGroupMessageRequest,
} from './types'

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? 'http://localhost:3000'

export class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'RelayError'
  }
}

// Set once by the root layout after first auth so authedFetch can self-heal on 401.
let reauthHandler: (() => Promise<string>) | null = null

export function setReauthHandler(fn: () => Promise<string>): void {
  reauthHandler = fn
}

async function authedFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
    Authorization: `Bearer ${token}`,
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
  }
  const res = await fetch(`${RELAY_URL}${path}`, { ...init, headers })

  if (res.status === 401 && reauthHandler) {
    const freshToken = await reauthHandler()
    return fetch(`${RELAY_URL}${path}`, {
      ...init,
      headers: { ...headers, Authorization: `Bearer ${freshToken}` },
    })
  }
  return res
}

async function requireOk(res: Response): Promise<Response> {
  if (!res.ok) throw new RelayError(res.status, `relay error ${res.status} at ${res.url}`)
  return res
}

// No auth required — idempotent; 409 = already registered.
export async function register(userId: string, pubkeyHex: string): Promise<void> {
  const body: RegisterRequest = { user_id: userId, pubkey_hex: pubkeyHex }
  const res = await fetch(`${RELAY_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok && res.status !== 409) throw new RelayError(res.status, 'register failed')
}

export async function auth(userId: string, privkeyHex: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000)
  const body: AuthRequest = {
    user_id: userId,
    timestamp,
    signature_hex: signAuthChallenge(privkeyHex, userId, timestamp),
  }
  const res = await fetch(`${RELAY_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  await requireOk(res)
  const data: AuthResponse = await res.json()
  return data.token
}

export async function sendMessage(token: string, req: SendMessageRequest): Promise<void> {
  await requireOk(
    await authedFetch(token, '/api/messages', { method: 'POST', body: JSON.stringify(req) }),
  )
}

export async function getMessages(token: string): Promise<MessageListResponse> {
  const res = await requireOk(await authedFetch(token, '/api/messages'))
  return res.json()
}

export async function ackMessage(token: string, messageId: string): Promise<void> {
  const res = await authedFetch(token, `/api/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' })
  if (res.status === 404) return // already acked — idempotent
  await requireOk(res)
}

export async function createPost(token: string, req: CreatePostRequest): Promise<void> {
  await requireOk(
    await authedFetch(token, '/api/posts', { method: 'POST', body: JSON.stringify(req) }),
  )
}

export async function assistPost(token: string, prefix: string): Promise<PostAssistResponse> {
  const body: PostAssistRequest = { prefix }
  const res = await requireOk(
    await authedFetch(token, '/api/posts/assist', { method: 'POST', body: JSON.stringify(body) }),
  )
  return res.json()
}

export async function uploadMedia(
  token: string,
  file: File,
): Promise<{ url: string; media_type: 'image' | 'video' }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${RELAY_URL}/api/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  await requireOk(res)
  const data = await res.json()
  // Make the URL absolute so it resolves to the relay server regardless of page origin.
  return { url: `${RELAY_URL}${data.url}`, media_type: data.media_type }
}

export async function getPosts(token: string): Promise<PostListResponse> {
  const res = await requireOk(await authedFetch(token, '/api/posts'))
  return res.json()
}

export async function ackPost(token: string, postId: string): Promise<void> {
  const body: AckPostRequest = { post_id: postId }
  await requireOk(
    await authedFetch(token, '/api/posts/ack', { method: 'POST', body: JSON.stringify(body) }),
  )
}

export async function addFriend(token: string, friendId: string): Promise<void> {
  const body: AddFriendRequest = { friend_id: friendId }
  await requireOk(
    await authedFetch(token, '/api/friends', { method: 'POST', body: JSON.stringify(body) }),
  )
}

export async function getFriends(token: string): Promise<FriendListResponse> {
  const res = await requireOk(await authedFetch(token, '/api/friends'))
  return res.json()
}

export async function getGroups(token: string): Promise<GroupListResponse> {
  const res = await requireOk(await authedFetch(token, '/api/groups'))
  return res.json()
}

export async function joinGroup(token: string, groupId: string): Promise<GroupInfo> {
  const res = await requireOk(
    await authedFetch(token, `/api/groups/${encodeURIComponent(groupId)}/join`, { method: 'POST' }),
  )
  return res.json()
}

export async function sendGroupMessage(
  token: string,
  groupId: string,
  req: SendGroupMessageRequest,
): Promise<void> {
  await requireOk(
    await authedFetch(token, `/api/groups/${encodeURIComponent(groupId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  )
}

export async function getGroupMessages(
  token: string,
  groupId: string,
): Promise<GroupMessageListResponse> {
  const res = await requireOk(
    await authedFetch(token, `/api/groups/${encodeURIComponent(groupId)}/messages`),
  )
  return res.json()
}

export async function ackGroupMessage(
  token: string,
  groupId: string,
  messageId: string,
): Promise<void> {
  const res = await authedFetch(token, `/api/groups/${encodeURIComponent(groupId)}/messages/ack`, {
    method: 'POST',
    body: JSON.stringify({ message_id: messageId }),
  })
  if (res.status === 404) return
  await requireOk(res)
}

export async function createInviteToken(token: string): Promise<{ code: string; expires_at: number }> {
  const res = await requireOk(await authedFetch(token, '/api/invite-token', { method: 'POST' }))
  return res.json()
}

export async function redeemInviteToken(token: string, code: string): Promise<void> {
  await requireOk(
    await authedFetch(token, '/api/friends/by-token', { method: 'POST', body: JSON.stringify({ code }) }),
  )
}

// Converts http(s) base URL to ws(s) for WebSocket connection.
export function wsUrl(token: string): string {
  const base = RELAY_URL.replace(/^http/, 'ws')
  return `${base}/api/ws?token=${encodeURIComponent(token)}`
}

export async function getFavouriteCategories(token: string): Promise<string[]> {
  const res = await requireOk(await authedFetch(token, '/api/favourites'))
  const data = await res.json()
  return data.categories as string[]
}

export async function addFavouriteCategory(token: string, category: string): Promise<void> {
  await requireOk(
    await authedFetch(token, '/api/favourites', {
      method: 'POST',
      body: JSON.stringify({ category }),
    }),
  )
}

export async function removeFavouriteCategory(token: string, category: string): Promise<void> {
  const res = await authedFetch(token, `/api/favourites/${encodeURIComponent(category)}`, {
    method: 'DELETE',
  })
  if (res.status === 204 || res.status === 404) return
  await requireOk(res)
}
