#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import {
  loadConfig,
  saveConfig,
  initConfig,
  configExists,
  setProvider,
  setPort,
  setProviderUrl,
  setProviderModel,
  setModelRouting,
  DEFAULT_CONFIG,
} from './config';
import { startServer } from './server';
import { Provider } from './types';

const program = new Command();

program
  .name('sona-router')
  .description('Route Claude Code requests to local LLM providers (LM Studio, Ollama)')
  .version('1.0.0');

// Start command
program
  .command('start')
  .description('Start the router server')
  .option('-p, --port <port>', 'Port to listen on')
  .option('--provider <provider>', 'Provider to use (lmstudio or ollama)')
  .option('--model <model>', 'Model to use')
  .option('--url <url>', 'Provider base URL')
  .action((options) => {
    const config = loadConfig();

    // Override config with CLI options
    if (options.port) {
      config.port = parseInt(options.port, 10);
    }
    if (options.provider) {
      if (options.provider !== 'lmstudio' && options.provider !== 'ollama') {
        console.error(chalk.red('Invalid provider. Use "lmstudio" or "ollama"'));
        process.exit(1);
      }
      config.provider = options.provider as Provider;
    }
    if (options.model) {
      config[config.provider].model = options.model;
    }
    if (options.url) {
      config[config.provider].baseUrl = options.url;
    }

    startServer(config);
  });

// Init command
program
  .command('init')
  .description('Initialize configuration file')
  .option('-f, --force', 'Overwrite existing config')
  .action((options) => {
    if (configExists() && !options.force) {
      console.error(chalk.yellow('Config file already exists. Use --force to overwrite.'));
      process.exit(1);
    }

    saveConfig(DEFAULT_CONFIG);
    console.log(chalk.green('Configuration file created: sona-router.config.yaml'));
    console.log(chalk.gray('\nDefault settings:'));
    console.log(chalk.cyan('  Provider: '), chalk.white('lmstudio'));
    console.log(chalk.cyan('  Port:     '), chalk.white('9001'));
    console.log(chalk.gray('\nEdit the config file or use "sona-router config" to modify settings.'));
  });

// Config command
program
  .command('config')
  .description('View or modify configuration')
  .option('--provider <provider>', 'Set provider (lmstudio or ollama)')
  .option('--port <port>', 'Set server port')
  .option('--lmstudio-url <url>', 'Set LM Studio base URL')
  .option('--lmstudio-model <model>', 'Set LM Studio model')
  .option('--ollama-url <url>', 'Set Ollama base URL')
  .option('--ollama-model <model>', 'Set Ollama model')
  .action((options) => {
    let config = loadConfig();
    let modified = false;

    if (options.provider) {
      if (options.provider !== 'lmstudio' && options.provider !== 'ollama') {
        console.error(chalk.red('Invalid provider. Use "lmstudio" or "ollama"'));
        process.exit(1);
      }
      config = setProvider(options.provider as Provider);
      console.log(chalk.green(`Provider set to: ${options.provider}`));
      modified = true;
    }

    if (options.port) {
      config = setPort(parseInt(options.port, 10));
      console.log(chalk.green(`Port set to: ${options.port}`));
      modified = true;
    }

    if (options.lmstudioUrl) {
      config = setProviderUrl('lmstudio', options.lmstudioUrl);
      console.log(chalk.green(`LM Studio URL set to: ${options.lmstudioUrl}`));
      modified = true;
    }

    if (options.lmstudioModel) {
      config = setProviderModel('lmstudio', options.lmstudioModel);
      console.log(chalk.green(`LM Studio model set to: ${options.lmstudioModel}`));
      modified = true;
    }

    if (options.ollamaUrl) {
      config = setProviderUrl('ollama', options.ollamaUrl);
      console.log(chalk.green(`Ollama URL set to: ${options.ollamaUrl}`));
      modified = true;
    }

    if (options.ollamaModel) {
      config = setProviderModel('ollama', options.ollamaModel);
      console.log(chalk.green(`Ollama model set to: ${options.ollamaModel}`));
      modified = true;
    }

    if (!modified) {
      // Display current config
      console.log(chalk.bold.cyan('\nCurrent Configuration:'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.cyan('Active Provider:'), chalk.white(config.provider));
      console.log(chalk.cyan('Server Port:    '), chalk.white(config.port));
      console.log();
      console.log(chalk.bold.yellow('LM Studio:'));
      console.log(chalk.cyan('  URL:  '), chalk.white(config.lmstudio.baseUrl));
      console.log(chalk.cyan('  Model:'), chalk.white(config.lmstudio.model));
      if (config.lmstudio.modelRouting && Object.keys(config.lmstudio.modelRouting).length > 0) {
        console.log(chalk.cyan('  Routes:'));
        for (const [from, to] of Object.entries(config.lmstudio.modelRouting)) {
          console.log(chalk.gray(`    ${from} → ${to}`));
        }
      }
      console.log();
      console.log(chalk.bold.yellow('Ollama:'));
      console.log(chalk.cyan('  URL:  '), chalk.white(config.ollama.baseUrl));
      console.log(chalk.cyan('  Model:'), chalk.white(config.ollama.model));
      if (config.ollama.modelRouting && Object.keys(config.ollama.modelRouting).length > 0) {
        console.log(chalk.cyan('  Routes:'));
        for (const [from, to] of Object.entries(config.ollama.modelRouting)) {
          console.log(chalk.gray(`    ${from} → ${to}`));
        }
      }
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.gray('\nUse "sona-router routes" to see all model routing.'));
    }
  });

// Use command (shortcut for switching providers)
program
  .command('use <provider>')
  .description('Switch to a provider (lmstudio or ollama)')
  .action((provider: string) => {
    if (provider !== 'lmstudio' && provider !== 'ollama') {
      console.error(chalk.red('Invalid provider. Use "lmstudio" or "ollama"'));
      process.exit(1);
    }

    setProvider(provider as Provider);
    console.log(chalk.green(`Switched to ${provider}`));
  });

// Model command (shortcut for setting model)
program
  .command('model <model>')
  .description('Set the model for the current provider')
  .option('--provider <provider>', 'Specify which provider to set the model for')
  .action((model: string, options) => {
    const config = loadConfig();
    const provider = (options.provider as Provider) || config.provider;

    if (provider !== 'lmstudio' && provider !== 'ollama') {
      console.error(chalk.red('Invalid provider. Use "lmstudio" or "ollama"'));
      process.exit(1);
    }

    setProviderModel(provider, model);
    console.log(chalk.green(`Model for ${provider} set to: ${model}`));
  });

// Route command (set model routing)
program
  .command('route <claude-model> <local-model>')
  .description('Map a Claude model to a local model')
  .option('--provider <provider>', 'Specify which provider to set the route for')
  .action((claudeModel: string, localModel: string, options) => {
    const config = loadConfig();
    const provider = (options.provider as Provider) || config.provider;

    if (provider !== 'lmstudio' && provider !== 'ollama') {
      console.error(chalk.red('Invalid provider. Use "lmstudio" or "ollama"'));
      process.exit(1);
    }

    setModelRouting(provider, claudeModel, localModel);
    console.log(chalk.green(`Route added for ${provider}:`));
    console.log(chalk.cyan(`  ${claudeModel}`), chalk.gray('→'), chalk.white(localModel));
  });

// Routes command (list all model routes)
program
  .command('routes')
  .description('List all model routing mappings')
  .option('--provider <provider>', 'Show routes for specific provider only')
  .action((options) => {
    const config = loadConfig();

    const showRoutes = (providerName: Provider) => {
      const providerConfig = config[providerName];
      const routes = providerConfig.modelRouting || {};
      const routeEntries = Object.entries(routes);

      console.log(chalk.bold.yellow(`\n${providerName === 'lmstudio' ? 'LM Studio' : 'Ollama'} Model Routes:`));

      if (routeEntries.length === 0) {
        console.log(chalk.gray('  No routes configured (using default model)'));
      } else {
        for (const [claudeModel, localModel] of routeEntries) {
          console.log(chalk.cyan(`  ${claudeModel}`), chalk.gray('→'), chalk.white(localModel));
        }
      }
      console.log(chalk.gray(`  Default model: ${providerConfig.model}`));
    };

    if (options.provider) {
      if (options.provider !== 'lmstudio' && options.provider !== 'ollama') {
        console.error(chalk.red('Invalid provider. Use "lmstudio" or "ollama"'));
        process.exit(1);
      }
      showRoutes(options.provider as Provider);
    } else {
      showRoutes('lmstudio');
      showRoutes('ollama');
    }
    console.log();
  });

// Parse arguments
program.parse();

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
