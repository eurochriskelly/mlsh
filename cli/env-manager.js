#!/usr/bin/env node

import prompts from 'prompts';
import configManager from './lib/config.js';
import { formatEnvDisplay, formatEnvironmentList, clearScreen, header, info, success, error, warning } from './lib/formatter.js';

const MENU_OPTIONS = {
  SELECT: 'select',
  CREATE: 'create',
  DELETE: 'delete',
  MODIFY: 'modify',
  BACK: 'back'
};

async function main() {
  try {
    await configManager.initialize();
    await showMainMenu();
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
}

async function showMainMenu() {
  clearScreen();
  
  const environments = configManager.getEnvironments();
  const currentEnv = configManager.getCurrentEnv();
  const currentVars = configManager.getEnvVars(currentEnv);
  
  header(`MLSH - Environment Manager`);
  
  console.log(`  Current Environment: ${currentEnv}`);
  console.log(`  ${formatEnvDisplay(currentEnv, currentVars)}\n`);
  
  const envList = formatEnvironmentList(environments, currentEnv);
  
  console.log('  Available Environments:\n');
  envList.forEach(env => {
    console.log(`  ${env.display}`);
  });
  
  console.log('\n  Options: [1-' + Object.keys(environments).length + '] Select | [C]reate | [D]elete | [M]odify | [B]ack\n');
  
  const response = await prompts({
    type: 'text',
    name: 'choice',
    message: '  Your choice',
    validate: (val) => {
      const num = parseInt(val);
      if (!isNaN(num) && num > 0 && num <= Object.keys(environments).length) return true;
      return ['c', 'd', 'm', 'b'].includes(val.toLowerCase()) || 'Invalid choice';
    }
  });

  const choice = response.choice.toLowerCase();
  const num = parseInt(choice);

  if (!isNaN(num)) {
    const envName = envList[num - 1].name;
    await selectEnvironment(envName);
  } else if (choice === 'c') {
    await createEnvironment();
  } else if (choice === 'd') {
    await deleteEnvironment();
  } else if (choice === 'm') {
    await modifyEnvironment();
  } else if (choice === 'b') {
    clearScreen();
    process.exit(0);
  }
}

async function selectEnvironment(envName) {
  try {
    await configManager.setCurrentEnv(envName);
    clearScreen();
    header('Environment Changed');
    const vars = configManager.getEnvVars(envName);
    success(`Switched to: ${envName}`);
    info(`Address: ${formatEnvDisplay(envName, vars)}`);
    console.log('\n  Exported Variables:\n');
    Object.entries(vars).forEach(([key, value]) => {
      if (key.startsWith('ML_')) {
        console.log(`    ${key}=${value}`);
      }
    });
    console.log();
    await pause();
    await showMainMenu();
  } catch (err) {
    clearScreen();
    error(err.message);
    await pause();
    await showMainMenu();
  }
}

async function createEnvironment() {
  clearScreen();
  header('Create New Environment');

  const envName = await prompts({
    type: 'text',
    name: 'value',
    message: '  Environment name',
    validate: (val) => {
      if (!val.match(/^[a-zA-Z0-9_-]+$/)) return 'Name must be alphanumeric with dashes/underscores';
      if (configManager.getEnvVars(val)) return 'Environment already exists';
      return true;
    }
  });

  const host = await prompts({
    type: 'text',
    name: 'value',
    message: '  ML_HOST (hostname or IP)',
    initial: 'localhost'
  });

  const port = await prompts({
    type: 'number',
    name: 'value',
    message: '  ML_PORT (port number)',
    initial: 8000
  });

  const user = await prompts({
    type: 'text',
    name: 'value',
    message: '  ML_USER (username)',
    initial: 'admin'
  });

  const pass = await prompts({
    type: 'password',
    name: 'value',
    message: '  ML_PASS (password)',
  });

  const protocol = await prompts({
    type: 'select',
    name: 'value',
    message: '  ML_PROTOCOL',
    choices: [
      { title: 'http', value: 'http' },
      { title: 'https', value: 'https' }
    ],
    initial: 0
  });

  const modulesDb = await prompts({
    type: 'text',
    name: 'value',
    message: '  ML_MODULES_DB',
    initial: 'modules'
  });

  const contentDb = await prompts({
    type: 'text',
    name: 'value',
    message: '  ML_CONTENT_DB',
    initial: 'content'
  });

  try {
    await configManager.addEnvironment(envName.value, {
      ML_HOST: host.value,
      ML_PORT: port.value,
      ML_USER: user.value,
      ML_PASS: pass.value,
      ML_PROTOCOL: protocol.value,
      ML_MODULES_DB: modulesDb.value,
      ML_CONTENT_DB: contentDb.value
    });

    clearScreen();
    header('Environment Created');
    success(`Created environment: ${envName.value}`);
    await pause();
    await showMainMenu();
  } catch (err) {
    clearScreen();
    error(err.message);
    await pause();
    await showMainMenu();
  }
}

async function deleteEnvironment() {
  clearScreen();
  header('Delete Environment');

  const environments = configManager.getEnvironments();
  const currentEnv = configManager.getCurrentEnv();
  const deletableEnvs = Object.entries(environments)
    .filter(([name]) => name !== currentEnv)
    .map(([name, vars]) => ({
      title: `${name} [${formatEnvDisplay(name, vars)}]`,
      value: name
    }));

  if (deletableEnvs.length === 0) {
    warning('No environments available to delete (cannot delete current environment)');
    await pause();
    await showMainMenu();
    return;
  }

  const response = await prompts({
    type: 'select',
    name: 'env',
    message: '  Select environment to delete',
    choices: deletableEnvs
  });

  const confirm = await prompts({
    type: 'confirm',
    name: 'value',
    message: `  Are you sure you want to delete "${response.env}"?`,
    initial: false
  });

  if (confirm.value) {
    try {
      await configManager.deleteEnvironment(response.env);
      clearScreen();
      header('Environment Deleted');
      success(`Deleted environment: ${response.env}`);
      await pause();
      await showMainMenu();
    } catch (err) {
      clearScreen();
      error(err.message);
      await pause();
      await showMainMenu();
    }
  } else {
    clearScreen();
    info('Delete cancelled');
    await pause();
    await showMainMenu();
  }
}

async function modifyEnvironment() {
  clearScreen();
  header('Modify Environment');

  const environments = configManager.getEnvironments();
  const envChoices = Object.entries(environments).map(([name, vars]) => ({
    title: `${name} [${formatEnvDisplay(name, vars)}]`,
    value: name
  }));

  const response = await prompts({
    type: 'select',
    name: 'env',
    message: '  Select environment to modify',
    choices: envChoices
  });

  const envName = response.env;
  const currentVars = configManager.getEnvVars(envName);

  clearScreen();
  header(`Modify Environment: ${envName}`);

  const fieldChoices = [
    { title: `ML_HOST (${currentVars.ML_HOST})`, value: 'ML_HOST' },
    { title: `ML_PORT (${currentVars.ML_PORT})`, value: 'ML_PORT' },
    { title: `ML_USER (${currentVars.ML_USER})`, value: 'ML_USER' },
    { title: `ML_PASS (${'*'.repeat(currentVars.ML_PASS?.length || 0)})`, value: 'ML_PASS' },
    { title: `ML_PROTOCOL (${currentVars.ML_PROTOCOL})`, value: 'ML_PROTOCOL' },
    { title: `ML_MODULES_DB (${currentVars.ML_MODULES_DB})`, value: 'ML_MODULES_DB' },
    { title: `ML_CONTENT_DB (${currentVars.ML_CONTENT_DB})`, value: 'ML_CONTENT_DB' },
    { title: 'Done', value: '__DONE__' }
  ];

  const fieldResponse = await prompts({
    type: 'select',
    name: 'field',
    message: '  Select field to modify',
    choices: fieldChoices
  });

  if (fieldResponse.field === '__DONE__') {
    await showMainMenu();
    return;
  }

  const field = fieldResponse.field;
  let newValue;

  if (field === 'ML_PASS') {
    const passResponse = await prompts({
      type: 'password',
      name: 'value',
      message: `  Enter new ${field}`,
    });
    newValue = passResponse.value;
  } else if (field === 'ML_PORT') {
    const portResponse = await prompts({
      type: 'number',
      name: 'value',
      message: `  Enter new ${field}`,
      initial: currentVars[field]
    });
    newValue = portResponse.value;
  } else if (field === 'ML_PROTOCOL') {
    const protoResponse = await prompts({
      type: 'select',
      name: 'value',
      message: `  Select new ${field}`,
      choices: [
        { title: 'http', value: 'http' },
        { title: 'https', value: 'https' }
      ]
    });
    newValue = protoResponse.value;
  } else {
    const textResponse = await prompts({
      type: 'text',
      name: 'value',
      message: `  Enter new ${field}`,
      initial: currentVars[field]
    });
    newValue = textResponse.value;
  }

  try {
    await configManager.updateEnvironment(envName, { [field]: newValue });
    clearScreen();
    header('Environment Updated');
    success(`Updated ${field} for ${envName}`);
    await pause();
    await modifyEnvironment();
  } catch (err) {
    clearScreen();
    error(err.message);
    await pause();
    await modifyEnvironment();
  }
}

async function pause() {
  await prompts({
    type: 'text',
    name: 'continue',
    message: '  Press Enter to continue...',
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
