#!/usr/bin/env node

/**
 * Test suite for MLSH Environment Manager CLI
 * Run with: node test-cli.js
 */

import { ConfigManager } from './lib/config.js';
import { parseExistingMlshrc, generateBashMlshrc } from './lib/parser.js';
import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME;
const TEST_CONFIG = path.join(HOME, '.mlshrc.test.json');
const TEST_BASH = path.join(HOME, '.mlshrc.test');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runTests() {
  console.log('Testing MLSH Environment Manager CLI\n');

  // Test 1: Parser can parse bash config
  test('Parser: Extract environments from bash config', () => {
    const bashConfig = `
export ML_ENV=local
export ML_MODULES_DB=modules

case $ML_ENV in
  local)
    export ML_HOST=localhost
    export ML_PORT=8000
    export ML_USER=admin
    export ML_PASS=admin
    export ML_PROTOCOL=http
    ;;
  
  production)
    export ML_HOST=prod.example.com
    export ML_PORT=8000
    export ML_USER=ml_admin
    export ML_PASS=prod123
    export ML_PROTOCOL=https
    ;;
esac
    `;
    
    const result = parseExistingMlshrc(bashConfig);
    assert(Object.keys(result.environments).length === 2, 'Should parse 2 environments');
    assert(result.environments.local.ML_HOST === 'localhost', 'Local host should be localhost');
    assert(result.environments.production.ML_HOST === 'prod.example.com', 'Production host should be prod.example.com');
    assert(result.currentEnv === 'local', 'Current env should be local');
  });

  // Test 2: Generator creates valid bash config
  test('Generator: Create valid bash config from JSON', () => {
    const config = {
      currentEnv: 'staging',
      environments: {
        dev: { ML_HOST: 'dev', ML_PORT: 8000, ML_USER: 'dev_user' },
        staging: { ML_HOST: 'staging', ML_PORT: 8000, ML_USER: 'staging_user' }
      }
    };
    
    const bash = generateBashMlshrc(config);
    assert(bash.includes('export ML_ENV=staging'), 'Should set current env');
    assert(bash.includes('dev)'), 'Should have dev case');
    assert(bash.includes('staging)'), 'Should have staging case');
    assert(bash.includes('ML_HOST="dev"'), 'Should export dev host');
  });

  // Test 3: ConfigManager initialization
  test('ConfigManager: Initialize with default config', async () => {
    const manager = new ConfigManager();
    // Mock the config file
    manager.config = {
      environments: {
        local: { ML_HOST: 'localhost', ML_PORT: 8000, ML_USER: 'admin' }
      },
      currentEnv: 'local'
    };
    manager.initialized = true;
    
    const envs = manager.getEnvironments();
    assert(Object.keys(envs).length === 1, 'Should have 1 environment');
    assert(manager.getCurrentEnv() === 'local', 'Current env should be local');
  });

  // Test 4: Add environment
  test('ConfigManager: Add environment', async () => {
    const manager = new ConfigManager();
    manager.config = {
      environments: { local: { ML_HOST: 'localhost' } },
      currentEnv: 'local'
    };
    manager.initialized = true;
    
    await manager.addEnvironment('test', { ML_HOST: 'test.com', ML_PORT: 8000 });
    
    assert(manager.config.environments.test, 'Environment should be added');
    assert(manager.config.environments.test.ML_HOST === 'test.com', 'Host should match');
  });

  // Test 5: Update environment
  test('ConfigManager: Update environment', async () => {
    const manager = new ConfigManager();
    manager.config = {
      environments: {
        local: { ML_HOST: 'localhost', ML_PORT: 8000, ML_USER: 'admin' }
      },
      currentEnv: 'local'
    };
    manager.initialized = true;
    
    await manager.updateEnvironment('local', { ML_USER: 'newuser' });
    
    assert(manager.config.environments.local.ML_USER === 'newuser', 'User should be updated');
    assert(manager.config.environments.local.ML_HOST === 'localhost', 'Host should remain unchanged');
  });

  // Test 6: Switch environment
  test('ConfigManager: Switch environment', async () => {
    const manager = new ConfigManager();
    manager.config = {
      environments: {
        local: { ML_HOST: 'localhost' },
        prod: { ML_HOST: 'prod.com' }
      },
      currentEnv: 'local'
    };
    manager.initialized = true;
    
    await manager.setCurrentEnv('prod');
    
    assert(manager.config.currentEnv === 'prod', 'Current env should be prod');
  });

  // Test 7: Delete environment (with protection)
  test('ConfigManager: Prevent deleting current environment', async () => {
    const manager = new ConfigManager();
    manager.config = {
      environments: {
        local: { ML_HOST: 'localhost' },
        prod: { ML_HOST: 'prod.com' }
      },
      currentEnv: 'local'
    };
    manager.initialized = true;
    
    try {
      await manager.deleteEnvironment('local');
      throw new Error('Should have thrown');
    } catch (err) {
      assert(err.message.includes('Cannot delete'), 'Should prevent deleting current env');
    }
  });

  // Test 8: Delete environment (allowed)
  test('ConfigManager: Delete non-current environment', async () => {
    const manager = new ConfigManager();
    manager.config = {
      environments: {
        local: { ML_HOST: 'localhost' },
        staging: { ML_HOST: 'staging.com' },
        prod: { ML_HOST: 'prod.com' }
      },
      currentEnv: 'local'
    };
    manager.initialized = true;
    
    await manager.deleteEnvironment('staging');
    
    assert(!manager.config.environments.staging, 'Staging should be deleted');
    assert(manager.config.environments.local, 'Local should remain');
  });

  // Test 9: Environment validation
  test('ConfigManager: Validate environment exists', async () => {
    const manager = new ConfigManager();
    manager.config = {
      environments: {
        local: { ML_HOST: 'localhost' }
      },
      currentEnv: 'local'
    };
    manager.initialized = true;
    
    const vars = manager.getEnvVars('nonexistent');
    assert(vars === null, 'Should return null for nonexistent environment');
  });

  // Test 10: Prevent duplicate environment names
  test('ConfigManager: Prevent duplicate environment names', async () => {
    const manager = new ConfigManager();
    manager.config = {
      environments: {
        local: { ML_HOST: 'localhost' }
      },
      currentEnv: 'local'
    };
    manager.initialized = true;
    
    try {
      await manager.addEnvironment('local', { ML_HOST: 'new' });
      throw new Error('Should have thrown');
    } catch (err) {
      assert(err.message.includes('already exists'), 'Should prevent duplicates');
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
