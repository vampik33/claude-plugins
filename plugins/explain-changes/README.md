# Explain Changes Plugin

Explains code changes in detail - what was done and why. Provides educational insights about patterns and practices.

## Installation

```bash
claude plugin add vampik33/claude-plugins/explain-changes
```

## Usage

```bash
/explain                    # All changes (staged + unstaged)
/explain --staged           # Staged changes only
/explain --unstaged         # Unstaged changes only
/explain src/file.ts        # Specific file(s)
/explain --staged src/      # Combine flags with paths
```

## Output

Structured explanations covering:
- **What changed** - Files and modifications
- **Why** - Inferred intent and motivation
- **Impact** - Breaking changes, dependencies
- **Insights** - Patterns, best practices, architecture

### Example

```
## Changes Explanation

Added JWT refresh token support to authentication module.

### Feature: JWT Refresh Tokens

**What changed:**
- Added `refreshToken()` in `src/auth/jwt.ts`
- Updated token validation in `src/middleware/auth.ts`

**Why:**
Enables persistent sessions without re-authentication when access tokens expire.

`★ Insight ─────────────────────────────────────`
- Refresh tokens follow OAuth 2.0 standard pattern
- Server-side storage prevents token theft attacks
`─────────────────────────────────────────────────`
```

## Natural Language

The skill can also be invoked naturally:
- "Explain the changes"
- "What did I change?"
- "Walk me through the diff"

## License

MIT
