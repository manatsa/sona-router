import express, { Request, Response, NextFunction } from 'express';
import { Config, ClaudeRequest, TokenCountRequest, TokenCountResponse, BetaFeature } from './types';
import { createProvider } from './providers';
import { resolveModel } from './config';
import chalk from 'chalk';

// Simple token estimation (approx 4 chars per token for English)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Parse beta header into array of features
function parseBetaHeader(header: string | undefined): BetaFeature[] {
  if (!header) return [];
  return header.split(',').map(f => f.trim()) as BetaFeature[];
}

export function createServer(config: Config) {
  const app = express();
  const provider = createProvider(config);

  app.use(express.json({ limit: '50mb' }));

  // Logging middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const betaHeader = req.headers['anthropic-beta'] as string | undefined;
    const betaFeatures = parseBetaHeader(betaHeader);

    console.log(
      chalk.gray(`[${new Date().toISOString()}]`),
      chalk.cyan(req.method),
      req.path
    );

    if (betaFeatures.length > 0) {
      console.log(chalk.magenta('  Beta features:'), chalk.white(betaFeatures.join(', ')));
    }

    next();
  });

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', provider: config.provider });
  });

  // Claude API: Create a Message
  app.post('/v1/messages', async (req: Request, res: Response) => {
    try {
      const claudeRequest = req.body as ClaudeRequest;
      const betaHeader = req.headers['anthropic-beta'] as string | undefined;
      const betaFeatures = parseBetaHeader(betaHeader);

      // Resolve the model based on routing configuration
      const resolvedModel = resolveModel(config, claudeRequest.model);
      provider.setModelOverride(resolvedModel);
      provider.setBetaFeatures(betaFeatures);

      console.log(
        chalk.yellow('Routing request to'),
        chalk.green(config.provider),
        chalk.yellow('model:'),
        chalk.green(resolvedModel),
        chalk.gray(`(requested: ${claudeRequest.model})`)
      );

      // Log thinking config if present
      if (claudeRequest.thinking) {
        console.log(
          chalk.blue('  Thinking:'),
          chalk.white(claudeRequest.thinking.type),
          claudeRequest.thinking.budget_tokens
            ? chalk.gray(`(budget: ${claudeRequest.thinking.budget_tokens} tokens)`)
            : ''
        );
      }

      if (claudeRequest.stream) {
        await provider.stream(claudeRequest, res);
      } else {
        const response = await provider.complete(claudeRequest);
        res.json(response);
      }
    } catch (error) {
      console.error(chalk.red('Error processing request:'), error);
      res.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    } finally {
      provider.clearModelOverride();
      provider.clearBetaFeatures();
    }
  });

  // Anthropic API alias (same as /v1/messages)
  app.post('/v1/complete', async (req: Request, res: Response) => {
    try {
      const claudeRequest = req.body as ClaudeRequest;
      const betaHeader = req.headers['anthropic-beta'] as string | undefined;
      const betaFeatures = parseBetaHeader(betaHeader);

      // Resolve the model based on routing configuration
      const resolvedModel = resolveModel(config, claudeRequest.model);
      provider.setModelOverride(resolvedModel);
      provider.setBetaFeatures(betaFeatures);

      console.log(
        chalk.yellow('Routing request to'),
        chalk.green(config.provider),
        chalk.yellow('model:'),
        chalk.green(resolvedModel),
        chalk.gray(`(requested: ${claudeRequest.model})`)
      );

      if (claudeRequest.stream) {
        await provider.stream(claudeRequest, res);
      } else {
        const response = await provider.complete(claudeRequest);
        res.json(response);
      }
    } catch (error) {
      console.error(chalk.red('Error processing request:'), error);
      res.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    } finally {
      provider.clearModelOverride();
      provider.clearBetaFeatures();
    }
  });

  // Token counting endpoint
  app.post('/v1/messages/count_tokens', (req: Request, res: Response) => {
    try {
      const countRequest = req.body as TokenCountRequest;
      let totalTokens = 0;

      // Count system tokens
      if (countRequest.system) {
        if (typeof countRequest.system === 'string') {
          totalTokens += estimateTokens(countRequest.system);
        } else {
          for (const block of countRequest.system) {
            totalTokens += estimateTokens(block.text);
          }
        }
      }

      // Count message tokens
      for (const msg of countRequest.messages) {
        if (typeof msg.content === 'string') {
          totalTokens += estimateTokens(msg.content);
        } else {
          for (const block of msg.content) {
            if (block.type === 'text') {
              totalTokens += estimateTokens(block.text);
            } else if (block.type === 'tool_use') {
              totalTokens += estimateTokens(JSON.stringify(block.input));
              totalTokens += estimateTokens(block.name);
            } else if (block.type === 'tool_result') {
              const content = typeof block.content === 'string'
                ? block.content
                : block.content.map((b: { text: string }) => b.text).join('');
              totalTokens += estimateTokens(content);
            }
          }
        }
        // Add overhead for role
        totalTokens += 4;
      }

      // Count tool definitions
      if (countRequest.tools) {
        for (const tool of countRequest.tools) {
          totalTokens += estimateTokens(tool.name);
          totalTokens += estimateTokens(tool.description);
          totalTokens += estimateTokens(JSON.stringify(tool.input_schema));
        }
      }

      // Add thinking budget overhead estimate
      if (countRequest.thinking?.type === 'enabled' && countRequest.thinking.budget_tokens) {
        // Thinking tokens are separate but we report estimated input
        console.log(
          chalk.blue('  Thinking budget:'),
          chalk.white(`${countRequest.thinking.budget_tokens} tokens`)
        );
      }

      const response: TokenCountResponse = {
        input_tokens: totalTokens,
      };

      console.log(chalk.green('  Estimated tokens:'), chalk.white(totalTokens));
      res.json(response);
    } catch (error) {
      console.error(chalk.red('Error counting tokens:'), error);
      res.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  });

  // Models endpoint (for compatibility)
  app.get('/v1/models', (_req: Request, res: Response) => {
    const now = Math.floor(Date.now() / 1000);
    res.json({
      object: 'list',
      data: [
        // Claude 4 models
        {
          id: 'claude-opus-4-20250514',
          object: 'model',
          created: now,
          owned_by: 'sona-router',
        },
        {
          id: 'claude-sonnet-4-20250514',
          object: 'model',
          created: now,
          owned_by: 'sona-router',
        },
        // Claude 3.5 models
        {
          id: 'claude-3-5-sonnet-20241022',
          object: 'model',
          created: now,
          owned_by: 'sona-router',
        },
        {
          id: 'claude-3-5-haiku-20241022',
          object: 'model',
          created: now,
          owned_by: 'sona-router',
        },
        // Claude 3 models
        {
          id: 'claude-3-opus-20240229',
          object: 'model',
          created: now,
          owned_by: 'sona-router',
        },
        {
          id: 'claude-3-sonnet-20240229',
          object: 'model',
          created: now,
          owned_by: 'sona-router',
        },
        {
          id: 'claude-3-haiku-20240307',
          object: 'model',
          created: now,
          owned_by: 'sona-router',
        },
      ],
    });
  });

  // Catch-all for unknown routes
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      type: 'error',
      error: {
        type: 'not_found',
        message: 'The requested endpoint does not exist',
      },
    });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(chalk.red('Unhandled error:'), err);
    res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: 'An internal error occurred',
      },
    });
  });

  return app;
}

export function startServer(config: Config): void {
  const app = createServer(config);

  app.listen(config.port, () => {
    console.log(chalk.bold.green('\nSona Router Started'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(chalk.cyan('Provider:   '), chalk.white(config.provider));
    console.log(chalk.cyan('Model:      '), chalk.white(config[config.provider].model));
    console.log(chalk.cyan('Backend URL:'), chalk.white(config[config.provider].baseUrl));
    console.log(chalk.cyan('Listening:  '), chalk.white(`http://localhost:${config.port}`));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(chalk.yellow('\nSet ANTHROPIC_BASE_URL to:'));
    console.log(chalk.white(`  http://localhost:${config.port}\n`));
  });
}
