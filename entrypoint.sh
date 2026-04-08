#!/bin/bash
set -e

# Configure Claude auth from env vars
mkdir -p ~/.claude ~/.claude/session-env

if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    cat > ~/.claude.json <<EOF
{
  "hasCompletedOnboarding": true,
  "oauthAccount": {
    "accountUuid": "${CLAUDE_ACCOUNT_UUID}",
    "emailAddress": "${CLAUDE_EMAIL}",
    "organizationUuid": "${CLAUDE_ORG_UUID}"
  }
}
EOF
fi

exec "$@"
