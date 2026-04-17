/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {EntityBaseRow} from 'persistence-typeorm-sqllite/entity-schema/entity-base.js';
import {EntityManager, type EntityTarget, type ObjectLiteral} from 'typeorm';

export interface BatchInsertError {
  /** System ID of the failing entity */
  systemId: number;

  message: string;
}

export interface BatchInsertResult {
  success: boolean;
  failedEntities: BatchInsertError[];
}

export const BatchInserter = {
  async insert<TEntity extends EntityBaseRow & ObjectLiteral>(
    manager: EntityManager,
    target: EntityTarget<TEntity>,
    rows: TEntity[],
    batchSize = 100,
  ): Promise<BatchInsertResult> {
    if (batchSize <= 0) {
      throw new Error('batchSize must be > 0');
    }

    const result: BatchInsertResult = {
      success: true,
      failedEntities: [],
    };

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);

      try {
        await manager.insert<TEntity>(target, batch);
      } catch (_batchError: unknown) {
        // fallback to isolate failing rows
        for (const row of batch) {
          try {
            await manager.insert<TEntity>(target, row);
          } catch (rowError: unknown) {
            const message =
              rowError instanceof Error ? rowError.message : String(rowError);

            result.failedEntities.push({
              systemId: row.systemId,
              message,
            });

            result.success = false;
          }
        }
      }
    }

    return result;
  },
};
