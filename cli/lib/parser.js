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

/**
 * Generate bash .mlshrc config from JSON config
 */
export function generateBashMlshrc(config) {
  const { environments, currentEnv } = config;
  
  let content = `#!/bin/bash

# Auto-generated MLSH configuration
# This file is generated from .mlshrc.json
# Edits here may be overwritten - modify .mlshrc.json instead

# Note: MLSH_TOP_DIR is set by the entry point, do not override it here
# If needed, set it before sourcing this file:
# export MLSH_TOP_DIR=/path/to/mlsh

# Default paths (only used if MLSH_TOP_DIR is not set)
: \${MLSH_TOP_DIR:=~/.mlsh.d}
export CORB_JAR=\${MLSH_TOP_DIR}/dependencies/corb.jar
export XCC_JAR=\${MLSH_TOP_DIR}/dependencies/xcc.jar
export MLCP_PATH=\${MLSH_TOP_DIR}/dependencies/mlcp/bin/mlcp.sh

# Default database names
export ML_MODULES_DB=modules
export ML_CONTENT_DB=content
export ML_TRIGGERS_DB=triggers
export ML_SCHEMAS_DB=schemas

# Current environment
export ML_ENV=${currentEnv}

case $ML_ENV in
`;

  // Generate case statements for each environment
  for (const [envName, vars] of Object.entries(environments)) {
    content += `  ${envName})\n`;
    
    // Extract and export each variable
    for (const [key, value] of Object.entries(vars)) {
      if (key.startsWith('ML_')) {
        const escapedValue = String(value).replace(/"/g, '\\"');
        content += `    export ${key}="${escapedValue}"\n`;
      }
    }
    
    content += `    ;;\n\n`;
  }

  content += `  *)
    echo "Unknown environment [$ML_ENV]"
    ;;
esac
`;

  return content;
}
