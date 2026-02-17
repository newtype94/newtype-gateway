import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import { Configuration } from './types.js';
import logger from './logger.js';

export function loadConfig(configPath: string): Configuration {
  try {
    const fileContents = readFileSync(configPath, 'utf8');
    const config = yaml.load(fileContents) as Configuration;
    
    logger.info({ configPath }, 'Configuration loaded successfully');
    return config;
  } catch (error) {
    logger.error({ error, configPath }, 'Failed to load configuration');
    throw new Error(`Failed to load configuration from ${configPath}: ${error}`);
  }
}
