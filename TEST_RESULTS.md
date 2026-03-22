# Custom Prompts Feature Test Results

**Ticket:** AGENTWORKE-14
**Date:** 2026-03-22
**Status:** ✅ VERIFIED - All tests passing

## Summary

The custom prompts feature (implemented in AGENTWORKE-8) has been thoroughly tested and verified to work correctly. The feature allows users to prepend custom instructions to executor runs for both implementation and feedback scenarios.

## Feature Overview

The custom prompts feature adds a new `prompts` configuration section with two optional fields:

1. **`implement`** - Custom prompt prepended when implementing a ticket
2. **`feedback`** - Custom prompt prepended when addressing PR feedback

Both prompts support template variable interpolation:
- `{id}` - Ticket identifier (e.g., "ENG-100")
- `{title}` - Slugified ticket title
- `{raw_title}` - Sanitized original title
- `{branch}` - Generated branch name
- `{worktree}` - Worktree directory path
- `{date}` - Current ISO 8601 timestamp

## Test Coverage

### Configuration Tests (test/config.test.ts)
✅ Parses prompts config with both implement and feedback
✅ Parses prompts config with only implement
✅ Parses prompts config with only feedback
✅ Parses config without prompts section (defaults to empty object)
✅ Parses prompts config with special characters
✅ Parses empty string prompts

### Pipeline Tests (test/pipeline.test.ts)
✅ Prepends custom prompt to executor prompt with interpolation
✅ Works without custom prompt (default behavior)
✅ Interpolates all template variables in custom prompt
✅ Handles multi-line custom prompts

### Feedback Handler Tests (test/feedback/feedback-handler.test.ts)
✅ Prepends custom feedback prompt with interpolation
✅ Works without custom feedback prompt (default behavior)
✅ Interpolates all template variables in custom feedback prompt
✅ Handles multi-line custom feedback prompts

### Scheduler Tests (test/scheduler.test.ts)
✅ Config includes prompts section
✅ Custom prompts are passed to executePipeline

## Test Results

```
187 pass
0 fail
400 expect() calls
Ran 187 tests across 21 files. [11.26s]
```

All existing tests continue to pass, and 6 new tests were added to improve coverage:
- 2 tests for config parsing (special characters and empty strings)
- 2 tests for pipeline (all variables and multi-line)
- 2 tests for feedback handler (all variables and multi-line)

## Verification Steps Completed

1. ✅ Merged AGENTWORKE-8 feature branch into AGENTWORKE-14
2. ✅ Ran `bun typecheck` - No type errors
3. ✅ Ran `bun test` - All 187 tests passing
4. ✅ Verified config loading with example YAML
5. ✅ Added comprehensive documentation to README.md
6. ✅ Created example configuration file (test-prompts.example.yaml)

## Documentation Updates

### README.md
- Added `prompts` section to configuration reference
- Added new "Custom Prompts" section with detailed explanation
- Included examples for both implement and feedback prompts
- Documented template variables with examples

### AGENTS.md
- Already documented in the Config Reference table

## Example Usage

```yaml
prompts:
  implement: |
    Working on {id}: {raw_title}
    
    Project conventions:
    - Follow the coding standards in AGENTS.md
    - Run `bun typecheck && bun test` before finishing
    - Write clear, concise commit messages
    
  feedback: |
    Keep changes minimal and focused on the specific feedback.
    Don't refactor unrelated code.
```

## Edge Cases Tested

1. ✅ Multi-line prompts with proper formatting
2. ✅ All template variables interpolated correctly
3. ✅ Special characters in prompts (quotes, dollar signs, etc.)
4. ✅ Empty string prompts
5. ✅ Missing prompts section (defaults to empty object)
6. ✅ Partial prompts (only implement or only feedback)

## Conclusion

The custom prompts feature is fully functional and well-tested. All tests pass, type checking is clean, and documentation is comprehensive. The feature provides valuable customization for injecting project-specific instructions into executor runs.
