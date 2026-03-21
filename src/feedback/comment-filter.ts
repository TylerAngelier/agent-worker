export interface FeedbackEvent {
  source: "pr" | "ticket";
  commentId: string;
  author: string;
  body: string;
  createdAt: string;
}

export function findActionableComments(
  comments: { body: string; id: string | number; author: string; createdAt: string }[],
  prefix: string,
  excludeAuthor?: string,
): Omit<FeedbackEvent, "source">[] {
  return comments
    .filter((c) => c.body.trim().startsWith(prefix))
    .filter((c) => !excludeAuthor || c.author !== excludeAuthor)
    .map((c) => ({
      commentId: String(c.id),
      author: c.author,
      body: c.body,
      createdAt: c.createdAt,
    }));
}
