# PR #13 Summary

This PR simplifies the feedback poller's reaction-based deduplication logic.

## Changes

### README.md
- Added placeholder text ("Hi", "Bye") and a tagline for testing purposes

### src/feedback/feedback-poller.ts
- Removed the `hasAgentReaction` helper function that checked for multiple reactions (eyes, +1, -1)
- Simplified deduplication to only check for "eyes" reaction instead of three different reactions
- Changed PR tracking to always use current timestamp for `lastCommentCheck` instead of preserving previous value

### test/feedback/feedback-poller.test.ts
- Removed tests for the deleted `hasAgentReaction` function (no longer needed)

## Rationale

The simplification reduces complexity by using a single "eyes" reaction to mark comments as seen, rather than maintaining logic for three different reaction types. This makes the code easier to understand and maintain.
