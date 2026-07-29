/**
 * Parser for existing .mlshrc bash config files
 * Extracts environment definitions from bash case statements
 */

export function parseExistingMlshrc(content) {
  const environments = {};
  let currentEnv = 'local';
  let savedCurrentEnv = 'local'; // Save the actual current env before case parsing
  let currentVars = {};
  let inCaseStatement = false;
  let caseVarName = ''; // Track which case we're in

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect export statements like: export ML_HOST=localhost
    const exportMatch = line.match(/^export\s+(\w+)=(.+)$/);
    if (exportMatch) {
      const varName = exportMatch[1];
      const varValue = exportMatch[2].replace(/^["']|["']$/g, ''); // Remove quotes
      
      if (varName.startsWith('ML_') || varName.startsWith('MLSH_')) {
        // Track current env from ML_ENV export (before case statement)
        if (varName === 'ML_ENV' && !inCaseStatement) {
          savedCurrentEnv = varValue;
          currentEnv = varValue;
        }
        
        // Store in current case vars if in case statement
        if (inCaseStatement) {
          currentVars[varName] = isNaN(varValue) ? varValue : Number(varValue);
        }
      }
    }

    // Detect case statement start: case $ML_ENV in
    if (line.match(/case\s+\$ML_ENV\s+in/)) {
      inCaseStatement = true;
      continue;
    }

    // Detect case pattern: local) or odct)
    const caseMatch = line.match(/^(\w+)\)$/);
    if (caseMatch && inCaseStatement) {
      const envName = caseMatch[1];
      if (envName !== '*') { // Skip the default case
        // Save previous env if exists
        if (caseVarName && Object.keys(currentVars).length > 0) {
          environments[caseVarName] = { ...currentVars };
        }
        caseVarName = envName;
        currentVars = {};
      }
      continue;
    }

    // Detect case end: ;;
    if (line === ';;' && inCaseStatement) {
      if (caseVarName && Object.keys(currentVars).length > 0) {
        environments[caseVarName] = { ...currentVars };
      }
      caseVarName = '';
    }

    // Detect case statement end: esac
    if (line === 'esac') {
      inCaseStatement = false;
    }
  }

  // Handle any remaining variables
  if (caseVarName && Object.keys(currentVars).length > 0) {
    environments[caseVarName] = { ...currentVars };
  }

  return {
    environments,
    currentEnv: savedCurrentEnv
  };
}
