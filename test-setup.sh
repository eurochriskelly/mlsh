#!/bin/bash

# Test script for MLSH environment manager
# This script validates the setup and demonstrates usage

set -e

echo "================================"
echo "MLSH Environment Manager - Setup Test"
echo "================================"
echo ""

# Check Node.js installation
echo "✓ Checking Node.js installation..."
if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version)
  echo "  Node.js $NODE_VERSION found"
else
  echo "  ✗ Node.js not found. Installing Node.js is required."
  exit 1
fi

echo ""
echo "✓ Checking CLI dependencies..."
cd /Users/chkelly/Workspace/repos/mlsh/cli
if [ -d "node_modules" ]; then
  echo "  Dependencies installed"
else
  echo "  Installing dependencies..."
  npm install
fi

echo ""
echo "✓ Verifying CLI files..."
files=(
  "env-manager.js"
  "lib/config.js"
  "lib/parser.js"
  "lib/formatter.js"
  "package.json"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✓ $file"
  else
    echo "  ✗ $file missing!"
    exit 1
  fi
done

echo ""
echo "✓ Testing config parser..."
node -e "
import('./lib/parser.js').then(m => {
  const content = \`
export ML_ENV=local
case \\\$ML_ENV in
  local)
    export ML_HOST=localhost
    export ML_PORT=8000
    export ML_USER=admin
    ;;
esac
\`;
  const result = m.parseExistingMlshrc(content);
  console.log('  Parser output:', JSON.stringify(result, null, 2));
})
"

echo ""
echo "✓ All checks passed!"
echo ""
echo "================================"
echo "Next Steps:"
echo "================================"
echo ""
echo "1. Run the interactive environment manager:"
echo "   npm run env-manager"
echo ""
echo "2. Or use the bash alias (when in MLSH shell):"
echo "   ce"
echo ""
echo "3. The tool will create ~/.mlshrc.json on first run"
echo "4. Migrates existing ~/.mlshrc automatically"
echo ""
