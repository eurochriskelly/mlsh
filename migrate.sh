#!/bin/bash

# MLSH Environment Manager Migration Helper
# Helps migrate existing .mlshrc to the new JSON format

HOME=${HOME:-$(eval echo ~)}
CONFIG_FILE="$HOME/.mlshrc.json"
BASH_CONFIG_FILE="$HOME/.mlshrc"

if [ -f "$CONFIG_FILE" ]; then
  echo "JSON config already exists at $CONFIG_FILE"
  exit 0
fi

if [ ! -f "$BASH_CONFIG_FILE" ]; then
  echo "No existing .mlshrc found - will create default config on first run"
  exit 0
fi

echo "Migrating existing .mlshrc to .mlshrc.json..."
echo "Creating backup: $BASH_CONFIG_FILE.backup"

cp "$BASH_CONFIG_FILE" "$BASH_CONFIG_FILE.backup"

# Run Node.js to handle the migration
cd "$(dirname "${BASH_SOURCE[0]}")/cli" || exit 1

node -e "
import('./lib/config.js').then(async (m) => {
  const manager = m.default;
  await manager.initialize();
  console.log('✓ Migration complete!');
  console.log('  Original: $BASH_CONFIG_FILE.backup');
  console.log('  JSON config: $CONFIG_FILE');
  console.log('  Bash config regenerated: $BASH_CONFIG_FILE');
})
" 2>&1

echo ""
echo "Migration successful!"
