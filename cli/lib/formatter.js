/**
 * Formatting utilities for display
 */

export function formatEnvDisplay(currentEnv, vars) {
  const host = vars.ML_HOST || 'unknown';
  const user = vars.ML_USER || 'unknown';
  const proto = vars.ML_PROTOCOL || 'http';
  
  return `${proto}://${host} (${user})`;
}

export function formatEnvironmentList(environments, currentEnv) {
  const entries = Object.entries(environments);
  return entries.map((entry, idx) => {
    const [name, vars] = entry;
    const current = name === currentEnv ? '✓' : ' ';
    const display = formatEnvDisplay(name, vars);
    return {
      name,
      display: `${current} ${idx + 1}. ${name.padEnd(12)} [${display}]`,
      index: idx + 1
    };
  });
}

export function clearScreen() {
  console.clear();
}

export function header(text) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ${text}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

export function info(text) {
  console.log(`  ℹ  ${text}`);
}

export function success(text) {
  console.log(`  ✓  ${text}`);
}

export function error(text) {
  console.log(`  ✗  ${text}`);
}

export function warning(text) {
  console.log(`  ⚠  ${text}`);
}
