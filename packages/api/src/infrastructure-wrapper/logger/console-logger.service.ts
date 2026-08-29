/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {Injectable, type OnModuleDestroy} from '@nestjs/common';
import {type Logger, type LogData, LogLevel} from '@arc/core';
import * as fs from 'node:fs';
import path from 'node:path';
import {RuntimePaths} from '../runtime/runtime-paths.js';

@Injectable()
export class ConsoleLoggerService implements Logger, OnModuleDestroy {
  private readonly filePath: string;
  private logStream: fs.WriteStream;

  constructor(runtimePaths: RuntimePaths) {
    if (!fs.existsSync(runtimePaths.logsDir)) {
      fs.mkdirSync(runtimePaths.logsDir, {recursive: true});
    }

    this.filePath = path.join(runtimePaths.logsDir, 'api.jsonl');
    this.logStream = fs.createWriteStream(this.filePath, {flags: 'a'});

    // Log startup information
    this.logInfo({
      component: 'Logger',
      action: 'initialize',
      msg: `Logger initialized. Writing to ${this.filePath}`,
      timestamp: new Date(),
      tag: 'startup',
    });
  }
  async onModuleDestroy() {
    // Properly close the stream on shutdown
    return new Promise<void>(resolve => {
      this.logStream.end(() => {
        resolve();
      });
    });
  }

  logFilePath(): string {
    return this.filePath;
  }

  logVerbose(data: LogData): void {
    this.log(LogLevel.Verbose, data);
  }

  logDebug(data: LogData): void {
    this.log(LogLevel.Debug, data);
  }

  logInfo(data: LogData): void {
    this.log(LogLevel.Info, data);
  }

  logWarn(data: LogData): void {
    this.log(LogLevel.Warn, data);
  }

  logError(data: LogData): void {
    this.log(LogLevel.Error, data);
  }

  logCritical(data: LogData): void {
    this.log(LogLevel.Critical, data);
  }

  private log(level: LogLevel, data: LogData): void {
    const logEntry = this.formatLogEntry(level, data);

    // Write to file
    this.logStream.write(`${logEntry}\n`);

    // Also log to console
    switch (level) {
      case LogLevel.Verbose:
      case LogLevel.Debug:
        console.debug(logEntry);
        break;
      case LogLevel.Info:
        console.info(logEntry);
        break;
      case LogLevel.Warn:
        console.warn(logEntry);
        break;
      case LogLevel.Error:
      case LogLevel.Critical:
        console.error(logEntry);
        if (data.error) {
          console.error(data.error);
        }
        break;
    }
  }

  private formatLogEntry(level: LogLevel, data: LogData): string {
    return JSON.stringify({
      level,
      msg: data.msg,
      action: data.action,
      component: data.component,
      tag: data.tag,
      timestamp: data.timestamp.toISOString(),
      ...(data.clientId ? {clientId: data.clientId} : {}),
      ...(data.projectId ? {projectId: data.projectId} : {}),
      ...(data.error
        ? {
            error: {
              name: data.error.name,
              message: data.error.message,
              stack: data.error.stack,
            },
          }
        : {}),
    });
  }
}
