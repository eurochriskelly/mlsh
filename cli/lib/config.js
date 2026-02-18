import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseExistingMlshrc, generateBashMlshrc } from './parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME || process.env.USERPROFILE;
const CONFIG_FILE = path.join(HOME, '.mlshrc.json');
const BASH_CONFIG_FILE = path.join(HOME, '.mlshrc');
const BASH_GEN_FILE = path.join(HOME, '.mlshrc-gen');

export class ConfigManager {
  constructor() {
    this.config = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    // Check if JSON config exists, if not migrate from bash
    if (!fs.existsSync(CONFIG_FILE)) {
      if (fs.existsSync(BASH_CONFIG_FILE)) {
        // Migrate from existing bash config
        console.log('Migrating existing .mlshrc to .mlshrc.json...');
        await this.migrateFromBash();
      } else {
        // Create default config
        this.config = {
          environments: {
            local: {
              ML_HOST: 'localhost',
              ML_PORT: 8000,
              ML_USER: 'admin',
              ML_PASS: 'admin',
              ML_PROTOCOL: 'http',
              ML_MODULES_DB: 'modules',
              ML_CONTENT_DB: 'content'
            }
          },
          currentEnv: 'local'
        };
        await this.save();
      }
    }
    
    // Load existing config
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      this.config = JSON.parse(data);
    } catch (err) {
      console.error('Error reading config:', err.message);
      process.exit(1);
    }
    
    this.initialized = true;
  }

  async migrateFromBash() {
    try {
      const bashConfig = fs.readFileSync(BASH_CONFIG_FILE, 'utf-8');
      const envData = parseExistingMlshrc(bashConfig);
      
      this.config = {
        environments: envData.environments,
        currentEnv: envData.currentEnv || 'local'
      };
      
      await this.save();
      console.log('Migration complete!');
    } catch (err) {
      console.error('Migration failed:', err.message);
      // Create default if migration fails
      this.config = {
        environments: {
          local: {
            ML_HOST: 'localhost',
            ML_PORT: 8000,
            ML_USER: 'admin',
            ML_PASS: 'admin',
            ML_PROTOCOL: 'http'
          }
        },
        currentEnv: 'local'
      };
      await this.save();
    }
  }

  async save() {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
      // Also generate/update bash config for compatibility
      await this.syncToBash();
    } catch (err) {
      console.error('Error saving config:', err.message);
      process.exit(1);
    }
  }

  async syncToBash() {
    try {
      const bashContent = generateBashMlshrc(this.config);
      fs.writeFileSync(BASH_CONFIG_FILE, bashContent);
      
      // Also generate .mlshrc-gen with the current environment variables
      this.generateMlshrcGen();
    } catch (err) {
      console.error('Error syncing to bash config:', err.message);
    }
  }

  generateMlshrcGen() {
    try {
      const currentEnv = this.config.currentEnv || 'local';
      const envVars = this.config.environments[currentEnv] || {};
      
      let content = '#!/bin/bash\n';
      
      // Export all ML_* variables for the current environment
      for (const [key, value] of Object.entries(envVars)) {
        if (key.startsWith('ML_')) {
          const escapedValue = String(value).replace(/"/g, '\\"');
          content += `export ${key}="${escapedValue}"\n`;
        }
      }
      
      // Also export key paths - always use ~/.mlsh.d for dependencies
      content += '\n# Key paths (dependencies are always in ~/.mlsh.d)\n';
      content += 'export CORB_JAR=${HOME:-~}/.mlsh.d/dependencies/corb.jar\n';
      content += 'export XCC_JAR=${HOME:-~}/.mlsh.d/dependencies/xcc.jar\n';
      content += 'export MLCP_PATH=${HOME:-~}/.mlsh.d/dependencies/mlcp/bin/mlcp.sh\n';
      
      fs.writeFileSync(BASH_GEN_FILE, content);
    } catch (err) {
      console.error('Error generating .mlshrc-gen:', err.message);
    }
  }

  getEnvironments() {
    return this.config.environments || {};
  }

  getCurrentEnv() {
    return this.config.currentEnv || 'local';
  }

  getEnvVars(envName) {
    return this.config.environments[envName] || null;
  }

  async setCurrentEnv(envName) {
    if (!this.config.environments[envName]) {
      throw new Error(`Environment '${envName}' not found`);
    }
    this.config.currentEnv = envName;
    await this.save();
  }

  async addEnvironment(envName, vars) {
    if (this.config.environments[envName]) {
      throw new Error(`Environment '${envName}' already exists`);
    }
    this.config.environments[envName] = vars;
    await this.save();
  }

  async updateEnvironment(envName, vars) {
    if (!this.config.environments[envName]) {
      throw new Error(`Environment '${envName}' not found`);
    }
    this.config.environments[envName] = { ...this.config.environments[envName], ...vars };
    await this.save();
  }

  async deleteEnvironment(envName) {
    if (!this.config.environments[envName]) {
      throw new Error(`Environment '${envName}' not found`);
    }
    if (this.config.currentEnv === envName) {
      throw new Error(`Cannot delete current environment '${envName}'`);
    }
    delete this.config.environments[envName];
    await this.save();
  }
}

export default new ConfigManager();
