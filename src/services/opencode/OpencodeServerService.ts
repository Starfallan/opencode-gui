import * as vscode from 'vscode';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as net from 'node:net';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createDecorator } from '../../di/instantiation';
import { ILogService } from '../logService';
import { IConfigurationService } from '../configurationService';

export const IOpencodeServerService =
  createDecorator<IOpencodeServerService>('opencodeServerService');

export interface IOpencodeServerService {
  readonly _serviceBrand: undefined;
  ensureServer(): Promise<string>;
  getBaseUrl(): string | undefined;
  isManaged(): boolean;
  dispose(): void;
}

type StartResult = {
  url: string;
  proc: ChildProcessWithoutNullStreams;
};

export class OpencodeServerService implements IOpencodeServerService {
  readonly _serviceBrand: undefined;

  private baseUrl?: string;
  private proc?: ChildProcessWithoutNullStreams;
  private startPromise?: Promise<string>;
  private activeConfigFingerprint?: string;

  constructor(
    @ILogService private readonly logService: ILogService,
    @IConfigurationService private readonly configService: IConfigurationService
  ) {}

  getBaseUrl(): string | undefined {
    return this.baseUrl;
  }

  isManaged(): boolean {
    return Boolean(this.proc);
  }

  async ensureServer(): Promise<string> {
    const currentFingerprint = this.getConfigFingerprint();
    if (
      this.baseUrl &&
      this.activeConfigFingerprint &&
      this.activeConfigFingerprint !== currentFingerprint
    ) {
      this.logService.info(
        '[OpencodeServerService] Detected OpenCode server setting changes; restarting server binding'
      );
      this.dispose();
    }

    if (this.baseUrl) {
      return this.baseUrl;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.ensureServerImpl().finally(() => {
      this.startPromise = undefined;
    });

    return this.startPromise;
  }

  dispose(): void {
    const proc = this.proc;
    const pid = proc?.pid;

    try {
      if (proc) {
        if (pid && process.platform === 'win32') {
          try {
            spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
              stdio: 'ignore',
              windowsHide: true
            });
          } catch (error) {
            this.logService.warn(
              `[OpencodeServerService] taskkill failed; falling back to proc.kill(): ${String(error)}`
            );
            proc.kill();
          }
        } else {
          proc.kill();
        }
      }
    } catch (error) {
      this.logService.warn(
        `[OpencodeServerService] Failed to kill server process: ${String(error)}`
      );
    } finally {
      this.proc = undefined;
      this.baseUrl = undefined;
      this.startPromise = undefined;
      this.activeConfigFingerprint = undefined;
    }
  }

  private async ensureServerImpl(): Promise<string> {
    const configuredBaseUrl = this.getConfiguredBaseUrl();
    const configFingerprint = this.getConfigFingerprint(configuredBaseUrl);

    // 1) If user configured non-local address
    if (!this.isLocalBaseUrl(configuredBaseUrl)) {
      this.baseUrl = configuredBaseUrl;
      this.activeConfigFingerprint = configFingerprint;
      return configuredBaseUrl;
    }

    const url = new URL(configuredBaseUrl);
    const port = parseInt(url.port) || 4096;
    const host = url.hostname || '127.0.0.1';

    // 2) Check if port is in use
    const portInUse = await this.isPortAvailable(host, port);

    if (!portInUse) {
      this.logService.info(
        `[OpencodeServerService] Port ${port} is in use, checking for existing OpenCode server...`
      );

      // Try to connect to existing server
      if (await this.checkHealth(configuredBaseUrl, 5000)) {
        this.logService.info(
          `[OpencodeServerService] Reusing existing OpenCode server: ${configuredBaseUrl}`
        );
        this.baseUrl = configuredBaseUrl;
        this.activeConfigFingerprint = configFingerprint;
        return configuredBaseUrl;
      }

      // Port is occupied but not responding - show non-modal notification
      const choice = await vscode.window.showWarningMessage(
        `端口 ${port} 已被占用，可能是之前的 OpenCode 进程未正常关闭。`,
        {
          detail:
            '请选择操作:\n\n1. 强制杀死进程并重启（推荐）\n2. 等待并重连（如果进程正在启动中）'
        },
        '强制杀死并重启',
        '等待并重连'
      );

      if (choice === '强制杀死并重启') {
        await this.killProcessOnPort(host, port);
        this.logService.info(
          `[OpencodeServerService] Killed process on port ${port}, proceeding with fresh start`
        );
      } else {
        this.logService.info(
          `[OpencodeServerService] Waiting for existing server to become ready...`
        );
        const waitOk = await this.waitUntilHealthy(configuredBaseUrl, 60000);
        if (waitOk) {
          this.logService.info(
            `[OpencodeServerService] Existing server became ready: ${configuredBaseUrl}`
          );
          this.baseUrl = configuredBaseUrl;
          this.activeConfigFingerprint = configFingerprint;
          return configuredBaseUrl;
        }

        this.logService.warn(
          `[OpencodeServerService] Existing server still not responding, killing and restarting...`
        );
        await this.killProcessOnPort(host, port);
      }
    }

    // 3) Start local server
    const { url: serverUrl, proc } = await this.startLocalServer(configuredBaseUrl);
    this.proc = proc;
    this.baseUrl = serverUrl;
    this.activeConfigFingerprint = configFingerprint;
    return serverUrl;
  }

  private getConfiguredBaseUrl(): string {
    return (
      this.configService.getValue<string>('opencodeGui.serverBaseUrl', 'http://127.0.0.1:4096') ??
      'http://127.0.0.1:4096'
    );
  }

  private getConfigFingerprint(configuredBaseUrl?: string): string {
    const baseUrl = String(configuredBaseUrl ?? this.getConfiguredBaseUrl()).trim();
    const opencodePath = String(
      this.configService.getValue<string>('opencodeGui.opencodePath', 'opencode') ?? 'opencode'
    ).trim();
    const configDir = String(
      this.configService.getValue<string>('opencodeGui.configDir', '') ?? ''
    ).trim();
    return JSON.stringify({ baseUrl, opencodePath, configDir });
  }

  private isLocalBaseUrl(baseUrl: string): boolean {
    try {
      const url = new URL(baseUrl);
      const host = url.hostname;
      return host === '127.0.0.1' || host === 'localhost';
    } catch {
      return false;
    }
  }

  private async checkHealth(baseUrl: string, timeoutMs: number = 3000): Promise<boolean> {
    try {
      const url = new URL(baseUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url.toString(), {
          method: 'HEAD',
          signal: controller.signal
        });
        return res.ok || res.status === 405;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return false;
    }
  }

  private async startLocalServer(configuredBaseUrl: string): Promise<StartResult> {
    let opencodePath =
      this.configService.getValue<string>('opencodeGui.opencodePath', 'opencode') ?? 'opencode';
    const configDir = (
      this.configService.getValue<string>('opencodeGui.configDir', '') ?? ''
    ).trim();

    const url = new URL(configuredBaseUrl);
    const hostname = url.hostname || '127.0.0.1';
    const bindHost = this.normalizeLocalHostname(hostname);

    const parsedPort = Number(url.port || 4096);
    const requestedPort = Number.isFinite(parsedPort) ? Math.trunc(parsedPort) : 4096;
    const initialPort =
      requestedPort <= 0
        ? await this.getFreePort(bindHost)
        : await this.ensurePortAvailable(bindHost, requestedPort);

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (configDir) {
      env.OPENCODE_CONFIG_DIR = configDir;
    }
    env.OPENCODE_IDE = 'vscode';

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    let spawnCommand = opencodePath;
    let spawnArgs: string[] = [];

    if (process.platform === 'win32') {
      const lowerPath = opencodePath.toLowerCase();

      if (lowerPath.endsWith('.cmd') || lowerPath.endsWith('.bat')) {
        this.logService.info(`[OpencodeServerService] Detected batch file: ${opencodePath}`);
        spawnCommand = 'cmd.exe';
        spawnArgs = ['/c', opencodePath];
      } else if (lowerPath.endsWith('.ps1')) {
        this.logService.info(`[OpencodeServerService] Detected PowerShell script: ${opencodePath}`);
        spawnCommand = 'powershell.exe';
        spawnArgs = ['-ExecutionPolicy', 'Bypass', '-File', opencodePath];
      } else {
        if (!path.isAbsolute(opencodePath) && !opencodePath.endsWith('.exe')) {
          opencodePath = `${opencodePath}.exe`;
        } else if (path.isAbsolute(opencodePath) && !lowerPath.endsWith('.exe')) {
          try {
            await fs.access(opencodePath).catch(() => {
              const withExe = `${opencodePath}.exe`;
              return fs.access(withExe).then(() => {
                opencodePath = withExe;
              });
            });
          } catch {
            // Keep original path
          }
        }
        spawnCommand = opencodePath;
      }
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      const port = attempt === 0 ? initialPort : await this.getFreePort(bindHost);
      if (attempt > 0) {
        this.logService.warn(
          `[OpencodeServerService] Retrying opencode server start on ${hostname}:${port} (previous attempt failed)`
        );
      }

      this.logService.info(`[OpencodeServerService] Starting opencode server: ${hostname}:${port}`);
      this.logService.info(`[OpencodeServerService] Using executable: ${spawnCommand}`);

      const customArgs =
        this.configService.getValue<string[]>('opencodeGui.serverCustomArgs', []) ?? [];

      const serveArgs = ['serve', `--hostname=${hostname}`, `--port=${port}`, ...customArgs];
      if (spawnArgs.length > 0) {
        spawnArgs = spawnArgs.concat(serveArgs);
        this.logService.info(`[OpencodeServerService] With arguments: ${spawnArgs.join(' ')}`);
      } else {
        spawnArgs = serveArgs;
        this.logService.info(`[OpencodeServerService] With arguments: ${spawnArgs.join(' ')}`);
      }
      this.logService.info(`[OpencodeServerService] Working directory: ${cwd}`);

      let proc: ChildProcessWithoutNullStreams;
      try {
        proc = spawn(spawnCommand, spawnArgs, { env, cwd, windowsHide: true });
      } catch (spawnError) {
        this.logService.error(
          `[OpencodeServerService] Failed to spawn process: ${String(spawnError)}`
        );
        this.logService.error(`[OpencodeServerService] Executable: ${spawnCommand}`);
        this.logService.error(`[OpencodeServerService] Arguments: ${spawnArgs.join(' ')}`);
        this.logService.error(`[OpencodeServerService] Working directory: ${cwd}`);

        if (process.platform === 'win32') {
          this.logService.error(`[OpencodeServerService] Windows diagnostics:`);
          this.logService.error(
            `[OpencodeServerService]   - Is path absolute? ${path.isAbsolute(spawnCommand)}`
          );
          this.logService.error(
            `[OpencodeServerService]   - File extension: ${path.extname(spawnCommand)}`
          );
          this.logService.error(
            `[OpencodeServerService]   - Process platform: ${process.platform}`
          );
        }

        throw new Error(
          `Failed to start OpenCode server: ${String(spawnError)}. Please verify the opencode path is correct.`
        );
      }

      this.logService.info(`[OpencodeServerService] Spawned process pid=${proc.pid ?? 'unknown'}`);

      proc.stdout.on('data', (data: Buffer) => {
        const lines = data
          .toString()
          .split('\n')
          .filter((l: string) => l.trim());
        for (const line of lines) {
          this.logOpenCodeLine(line);
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        const lines = data
          .toString()
          .split('\n')
          .filter((l: string) => l.trim());
        for (const line of lines) {
          this.logOpenCodeLine(line);
        }
      });

      try {
        const listeningUrl = await this.waitForListeningUrl(proc);

        const ok = await this.waitUntilHealthy(listeningUrl, 30000);
        if (!ok) {
          try {
            proc.kill();
          } catch {}
          throw new Error(`OpenCode server did not become healthy: ${listeningUrl}`);
        }

        if (requestedPort > 0 && port !== requestedPort) {
          vscode.window.showWarningMessage(
            `OpenCode 端口 ${requestedPort} 已被占用，已改用 ${port}（可在设置 opencodeGui.serverBaseUrl 修改）。`
          );
        }

        return { url: listeningUrl, proc };
      } catch (error) {
        lastError = error;
        try {
          proc.kill();
        } catch {}

        if (this.isAddressInUseError(error)) {
          continue;
        }

        throw error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to start OpenCode server (unknown error): ${String(lastError)}`);
  }

  private normalizeLocalHostname(hostname: string): string {
    const h = String(hostname ?? '').trim() || '127.0.0.1';
    return h === 'localhost' ? '127.0.0.1' : h;
  }

  private isAddressInUseError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return /EADDRINUSE|address already in use|ADDRINUSE/i.test(msg);
  }

  private async ensurePortAvailable(hostname: string, port: number): Promise<number> {
    const available = await this.isPortAvailable(hostname, port);
    if (available) return port;

    const free = await this.getFreePort(hostname);
    this.logService.warn(
      `[OpencodeServerService] Port ${port} is already in use on ${hostname}; using ${free} instead`
    );
    return free;
  }

  private isPortAvailable(hostname: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      try {
        server.listen({ host: hostname, port, exclusive: true });
      } catch {
        resolve(false);
      }
    });
  }

  private getFreePort(hostname: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen({ host: hostname, port: 0, exclusive: true }, () => {
        const address = server.address();
        server.close(() => {
          if (typeof address === 'object' && address && typeof (address as any).port === 'number') {
            resolve((address as any).port);
            return;
          }
          reject(new Error('Failed to allocate a free port'));
        });
      });
    });
  }

  private async killProcessOnPort(hostname: string, port: number): Promise<void> {
    return new Promise((resolve) => {
      const netstatCmd =
        process.platform === 'win32' ? `netstat -ano | findstr :${port}` : `lsof -ti:${port}`;

      const proc = spawn(
        process.platform === 'win32' ? 'cmd.exe' : 'sh',
        process.platform === 'win32' ? ['/c', netstatCmd] : ['-c', netstatCmd],
        { shell: true, windowsHide: true }
      );

      let output = '';
      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', () => {
        const lines = output.split('\n');
        for (const line of lines) {
          let pid: string | null = null;

          if (process.platform === 'win32') {
            if (line.includes('LISTENING')) {
              const parts = line.trim().split(/\s+/);
              pid = parts[parts.length - 1];
            }
          } else {
            const match = line.match(/^(\d+)/);
            if (match) pid = match[1];
          }

          if (pid && /\d+/.test(pid)) {
            this.logService.info(
              `[OpencodeServerService] Found process ${pid} on port ${port}, killing...`
            );

            const killCmd =
              process.platform === 'win32' ? `taskkill /PID ${pid} /T /F` : `kill -9 ${pid}`;

            spawn(
              process.platform === 'win32' ? 'cmd.exe' : 'sh',
              process.platform === 'win32' ? ['/c', killCmd] : ['-c', killCmd],
              { shell: true, windowsHide: true }
            ).on('close', () => {
              this.logService.info(`[OpencodeServerService] Killed process ${pid} on port ${port}`);
              resolve();
            });
            return;
          }
        }

        this.logService.warn(`[OpencodeServerService] Could not find process on port ${port}`);
        resolve();
      });

      proc.on('error', () => {
        this.logService.warn(`[OpencodeServerService] Failed to find process on port ${port}`);
        resolve();
      });
    });
  }

  private waitForListeningUrl(proc: ChildProcessWithoutNullStreams): Promise<string> {
    const maxTotalTimeout = 5 * 60 * 1000;
    const stallTimeoutMs = 30 * 1000;

    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      if (stallTimer) clearTimeout(stallTimer);
      if (totalTimer) clearTimeout(totalTimer);
    };

    return new Promise((resolve, reject) => {
      totalTimer = setTimeout(() => {
        clearTimers();
        cleanup();
        reject(new Error('Timeout waiting for opencode server to start (max 5 minutes reached)'));
      }, maxTotalTimeout);

      const resetStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          clearTimers();
          cleanup();
          reject(new Error('Timeout waiting for opencode server to start (no log output for 30s)'));
        }, stallTimeoutMs);
      };

      resetStallTimer();

      let output = '';
      const onData = (chunk: unknown) => {
        resetStallTimer();

        output += String(chunk);
        const lines = output.split(/\r?\n/);
        for (const line of lines) {
          if (line.startsWith('opencode server listening')) {
            const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
            if (match?.[1]) {
              clearTimers();
              cleanup();
              resolve(match[1]);
              return;
            }
          }
        }
      };

      const onExit = (code: number | null) => {
        clearTimers();
        cleanup();
        reject(new Error(`opencode server exited with code ${code}\n${output}`));
      };

      const onError = (error: Error) => {
        clearTimers();
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        proc.stdout?.off('data', onData);
        proc.stderr?.off('data', onData);
        proc.off('exit', onExit);
        proc.off('error', onError);
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);
      proc.on('exit', onExit);
      proc.on('error', onError);
    });
  }

  private async waitUntilHealthy(baseUrl: string, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.checkHealth(baseUrl)) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }

  private logOpenCodeLine(line: string): void {
    let level = 'INFO ';
    let message = line;

    if (line.length >= 5) {
      const potentialLevel = line.substring(0, 5).toUpperCase();
      if (
        potentialLevel.startsWith('INFO') ||
        potentialLevel.startsWith('WARN') ||
        potentialLevel.startsWith('ERRO') ||
        potentialLevel.startsWith('DEBUG') ||
        potentialLevel.startsWith('TRACE')
      ) {
        level = potentialLevel.padEnd(5, ' ');

        const plusIndex = line.indexOf('+');
        if (plusIndex > 0) {
          message = line.substring(plusIndex);
        }
      }
    }

    switch (level.trim()) {
      case 'ERROR':
        this.logService.error(`[OpenCode] ${message}`);
        break;
      case 'WARN':
        this.logService.warn(`[OpenCode] ${message}`);
        break;
      case 'DEBUG':
        this.logService.debug(`[OpenCode] ${message}`);
        break;
      case 'TRACE':
        this.logService.trace(`[OpenCode] ${message}`);
        break;
      default:
        this.logService.info(`[OpenCode] ${message}`);
    }
  }
}
