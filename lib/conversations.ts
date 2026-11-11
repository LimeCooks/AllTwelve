export type SavedMessage = {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
};
export type Conversation = {
  id: string;
  name: string;
  createdAt: string;
  messages: SavedMessage[];
};
export type Conversations = { threads: Conversation[] };
export type LegacyConversation = {
  name: string;
  messages: { author: string; text: string; time: string }[];
};
export type ConversationPayload = Conversations & {
  legacy: LegacyConversation[];
  legacyError: string;
};

export function parseConversations(value: unknown): Conversations {
  const data = value as Conversations | null;
  const id = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 100;
  const date = (value: unknown): value is string =>
    typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (
    !data ||
    !Array.isArray(data.threads) ||
    data.threads.length > 100 ||
    !data.threads.every(
      (thread) =>
        thread &&
        id(thread.id) &&
        typeof thread.name === 'string' &&
        Boolean(thread.name.trim()) &&
        thread.name.length <= 100 &&
        date(thread.createdAt) &&
        Array.isArray(thread.messages) &&
        thread.messages.length <= 2000 &&
        thread.messages.every(
          (message) =>
            message &&
            id(message.id) &&
            id(message.authorId) &&
            typeof message.authorName === 'string' &&
            message.authorName.length <= 500 &&
            typeof message.text === 'string' &&
            Boolean(message.text.trim()) &&
            message.text.length <= 4000 &&
            date(message.createdAt),
        ),
    )
  )
    throw new Error('Saved conversations could not be read. Please reload.');
  const ids = data.threads.map((thread) => thread.id),
    names = data.threads.map((thread) => thread.name.toLowerCase()),
    messageIds = data.threads.flatMap((thread) =>
      thread.messages.map((message) => message.id),
    );
  if (
    new Set(ids).size !== ids.length ||
    new Set(names).size !== names.length ||
    new Set(messageIds).size !== messageIds.length
  )
    throw new Error(
      'Saved conversations contain conflicting records. Please reload.',
    );
  return { threads: data.threads };
}

export function parseLegacyConversations(value: unknown): LegacyConversation[] {
  if (value === null) return [];
  const store = (value as { store?: unknown })?.store;
  if (!store || typeof store !== 'object' || Array.isArray(store))
    throw new Error(
      'Earlier conversations could not be read. Their saved data is unchanged.',
    );
  return Object.entries(store)
    .map(([name, messages]) => {
      if (
        !Array.isArray(messages) ||
        !messages.every(
          (message) => message && typeof message.text === 'string',
        )
      )
        throw new Error(
          'Earlier conversations could not be read. Their saved data is unchanged.',
        );
      return {
        name,
        messages: messages.map((message) => ({
          text: message.text,
          author:
            typeof message.author === 'string'
              ? message.author
              : 'Earlier author',
          time: typeof message.time === 'string' ? message.time : '',
        })),
      };
    })
    .filter((thread) => thread.messages.length);
}
